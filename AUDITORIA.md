# Auditoria de Segurança e Funcionamento — Local Points

Feita lendo cada regra do RTDB e cada handler da Worker de novo, do zero, sem
confiar em memória de decisões anteriores. Datada desta sessão — se o projeto
mudar depois, esta lista pode ficar desatualizada.

## 🔴 Crítico — corrigido

### 1. Path traversal na Worker (todos os handlers)

Todo handler monta caminhos do RTDB concatenando valores que vêm do corpo da
requisição — `empresaId`, `clienteUid`, `recompensaId`, `resgateId`,
`lancamentoId`, `campeonatoId`. Nenhum desses valores era validado antes de
entrar na URL passada pro `fetch()`.

**Por que isso é grave**: a Worker fala com o RTDB via REST usando o token da
service account, que **ignora `database.rules.json` por completo**. Se um
desses campos contivesse `../`, a normalização padrão de URL (que qualquer
`fetch()`/`URL` faz, por spec — testei e confirmei) colapsa o caminho antes da
requisição saber pra onde vai. Testado:

```
new URL('https://x/users/' + 'victima/../../settings/integrations' + '.json').pathname
→ '/settings/integrations.json'
```

Ou seja: alguém que descobrisse essa falha podia mandar `clienteUid` (ou
qualquer um dos outros campos) contendo `../../settings/integrations` e fazer
a Worker — com privilégio de admin — escrever em **qualquer caminho do banco**,
incluindo `/users/{uid}/role`, `/settings/integrations/imgdbApiKey`, etc.

**Correção**: `cloudflare-worker/src/lib/rtdb.js` ganhou `assertSafeKey()` /
`isSafeKey()` — rejeita qualquer valor que não seja uma chave de Firebase
"limpa" (sem `. $ # [ ] /`, sem caracteres de controle, tamanho razoável).
Todo handler agora valida cada identificador vindo do body **antes** de
montar qualquer caminho.

**Segunda ocorrência da mesma classe de bug**: o campo `referredBy` em
`/users/{uid}` é preenchido pelo próprio usuário no cadastro, sem validação
de formato nas regras — e depois é reaproveitado como segmento de caminho na
lógica de bônus de indicação (`indicacao.js`). Mesmo risco, origem diferente
(dado antigo do banco, não do body da requisição atual). Corrigido com a
mesma função (`isSafeKey`), com a diferença de que aqui o comportamento
correto é **ignorar silenciosamente** o bônus de indicação se o valor for
suspeito, não derrubar o lançamento de pontos inteiro por causa disso.

## 🟠 Alto — corrigido

### 2. Sequestro de número de telefone

`database.rules.json` → `/telefones/{phone}` permitia sobrescrever o mapa
telefone→uid de **qualquer pessoa**, contanto que o novo valor fosse o uid de
quem está escrevendo. Faltava a checagem `!data.exists()` que o nó
`/codigosUnicos` (paralelo, mesma função) já tinha. Sem isso, o usuário B
podia roubar a identificação por telefone do usuário A só chamando
`db.ref('telefones/5511999999999').set(meuUid)` — depois disso, toda busca
por aquele telefone (empresa lançando pontos, etc.) resolveria pro usuário B.

**Correção**: adicionado `!data.exists()` mais uma via de admin pra correção
manual quando genuinamente necessário.

### 3. `empresaId` podia ser atribuído sem checar se era o do próprio dono

A regra permitia que o dono de uma empresa gravasse `empresaId` em qualquer
conta nova (`!data.exists()`), **sem confirmar que o valor gravado era o
`empresaId` do próprio dono**. Na prática, baixo risco de exploração real
(a conta alvo também precisaria ter `role: 'empresa'`, campo que só admin
grava) — mas era uma permissão mais aberta do que o necessário. Corrigido:
agora exige `newData.val() === (empresaId do próprio dono)`.

## 🟡 Médio — corrigido

Todos os itens abaixo eram grants de escrita/leitura que **nenhum código do
projeto usa** — não foram explorados por nada que eu construí, mas ficavam
abertos pra qualquer conta com aquele papel, sem necessidade:

- **`ranking_global` / `ranking_temporada`**: qualquer `empresa` podia
  escrever ali. Só o admin escreve (fluxo de campeonato). Corrigido pra
  admin-only — sem isso, uma empresa mal-intencionada podia fabricar
  colocações falsas no ranking pra si ou pra terceiros.
- **`notificacoes`**: qualquer `empresa` podia escrever na caixa de
  **qualquer** usuário — nada no app usa isso (só o admin manda broadcast).
  Era um vetor de spam/assédio pronto pra ser usado. Restringido: usuário só
  pode alterar o campo `lida` das próprias notificações; o resto é admin-only.
- **`notificacoes_broadcast`**: mesma história, restringido a admin-only.
- **`cupons`**: `empresa` conseguia ler cupons de **qualquer** usuário,
  inclusive os de empresas concorrentes — pequeno vazamento de inteligência
  competitiva ("esse cliente tem desconto pendente no concorrente").
  Restringido a admin + o próprio usuário.
- **`gamificacao/conquistasUsuario`**: mesma correção (`empresa` não usa,
  removido).
- **`gamificacao/progresso`** (nó de Missões, ainda não construído): o
  usuário tinha escrita livre — inofensivo hoje porque nada lê/escreve esse
  nó ainda, mas deixaria a porta aberta pra fraude de progresso assim que
  Missões for implementado. Travado pra admin-only preventivamente.
- **`users/{uid}/walletBalance`**: campo morto, herdado do projeto-base
  (fleet management), nunca usado por nenhuma tela do Local Points. Removido
  — não faz sentido manter escrita liberada num campo com nome financeiro
  que ninguém lê.

### 4. Checagem de "empresa ativa" inconsistente entre rotas da Worker

`lancar-pontos` sempre checou se a empresa estava com `status: 'ativo'` antes
de mover qualquer coisa. `resgatar`, `solicitar-resgate` e `usar-cashback`
**não** checavam — uma empresa suspensa ou cancelada continuaria permitindo
resgates e uso de cashback. Adicionada a mesma checagem nos três.

## 🟢 Baixo / informativo — não corrigido, decisão registrada

- **Janela de bootstrap do primeiro admin**: entre o deploy e a execução de
  `setup.html`, qualquer conta nova poderia teoricamente se autopromover a
  admin (ver `ARQUITETURA.md`). Risco aceito e documentado desde a Fase 1 —
  mitigação é operacional (rodar o setup antes de divulgar a URL), não de
  código.
- **Lançamento manual de pontos é um limite de confiança, não técnico**: um
  funcionário com permissão `lancarPontos` pode digitar qualquer quantidade.
  Isso é inerente a qualquer sistema de fidelidade com lançamento manual
  (inclusive os em papel) — a arquitetura não tenta detectar padrão de fraude,
  só garante que só quem tem a permissão consegue lançar, e que cada
  lançamento fica em log auditável.
- **`audit_logs` aceita escrita de qualquer usuário autenticado** (criação
  apenas, nunca edição) — necessário pra usuário/empresa registrarem as
  próprias ações. Uma conta mal-intencionada podia, em tese, floodar o log
  com entradas falsas (custo: armazenamento, não integridade — o admin só lê,
  nunca confia no log pra autorizar nada). Baixa severidade, não corrigido.
- **CORS da Worker cai pra `*` se o secret `ALLOWED_ORIGIN` não for
  configurado**. É um fallback de desenvolvimento — a chamada exige Bearer
  token, então não é um roubo de sessão via CORS, mas ainda assim configure o
  secret antes de produção (ver `CLOUDFLARE.md`). Comentário no código
  corrigido pra não sugerir que o fallback "reflete" a origem — ele usa `*`
  literal.
- **Rate limiting é "impreciso" por natureza** — contadores por datacenter da
  Cloudflare, não uma garantia matemática exata. Já documentado no
  `CLOUDFLARE.md` desde que a feature foi construída.

## ✅ Verificado e sem problema encontrado

- **XSS no client**: toda renderização via `innerHTML` que usa texto livre
  (nome de cliente, empresa, recompensa, conquista, título de promoção...)
  passa por `esc()`. Os únicos lugares sem `esc()` ao redor de interpolação
  são `showToast()` (usa `.textContent`, não `innerHTML`), `confirm()`/
  `alert()` (diálogos nativos, não renderizam HTML) e atribuições diretas a
  `.textContent` — nenhum desses interpreta HTML, então não precisam escapar.
- **Verificação de JWT na Worker**: rejeita corretamente `alg` diferente de
  RS256 (fecha o ataque clássico de "alg:none"), confere `exp`, `iat`, `aud`,
  `iss`, busca a chave pública só no keyset oficial do Google (nunca aceita
  uma chave vinda do próprio token). Sem problema encontrado.
- **Transações de saldo/estoque na Worker**: usam ETag + `if-match`,
  corretamente abortam e tentam de novo em caso de corrida (testado o
  raciocínio, não apenas assumido).
- **Chaveamento de campeonato**: a matemática de "no máximo 1 bye por
  partida" foi reconfirmada (byes < número de partidas sempre, porque o
  tamanho do bracket é a menor potência de 2 que cobre os inscritos).
- **Bug de escaping no `onclick` do botão "Declarar Vencedor"** (nome de
  jogador com apóstrofo quebraria o JS gerado) — encontrado e corrigido *na
  sessão anterior*, reconfirmado aqui que a correção está no lugar certo
  (índices e uid no `onclick`, nome buscado de volta nos dados).
- **Sintaxe de todo arquivo `.js` e `.html`** (incluindo scripts inline),
  balanceamento de `<div>`, IDs referenciados no JS existindo no HTML,
  funções chamadas em `onclick` existindo, classes CSS usadas existindo no
  `style.css`, `imports`/`exports` da Worker combinando 1:1 — tudo validado
  automaticamente depois de cada correção desta auditoria.

## O que isto NÃO cobre

Esta auditoria não substitui testar contra um projeto Firebase e uma conta
Cloudflare reais — não tenho como rodar a Worker nem as regras contra
infraestrutura de verdade neste ambiente. Validei sintaxe, lógica e a
matemática de cada regra manualmente; o primeiro deploy real ainda é o teste
definitivo, especialmente pra a URL de verificação de chave pública do Google
(já sinalizada em `firebaseAuth.js`) e para o comportamento exato de
`ServerValue.increment()` dentro de `update()` multi-campo.
