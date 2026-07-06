# Local Points — Arquitetura

> **Se você só quer saber o que foi encontrado numa auditoria de segurança e
> corrigido, veja `AUDITORIA.md`.** Este documento aqui é o mapa geral do
> projeto.

Este documento é o mapa do projeto. Ele existe para que qualquer pessoa (ou qualquer
sessão futura de desenvolvimento) consiga continuar o sistema sem precisar redescobrir
decisões já tomadas.

## Stack

- **Hosting:** Firebase Hosting (deploy via GitHub Actions a cada push em `main`) — **não mudou**
- **API sensível:** Cloudflare Worker (`cloudflare-worker/`) — pontos, resgates
  e gamificação passaram a ser processados aqui, não mais direto do client
- **Auth:** Firebase Authentication (e-mail/senha)
- **Banco:** Firebase Realtime Database (RTDB)
- **Imagens:** IMGDB (chave de API guardada em `/settings/integrations`, legível
  apenas por `admin` e `empresa` — nunca exposta a `usuario`)
- **Frontend:** HTML + JS vanilla (sem framework/bundler), um arquivo por portal,
  Firebase SDK compat via CDN, ícones Lucide, Service Worker próprio para PWA

Essa stack começou 100% herdada do projeto-base (`unibiotech-frota`), depois ganhou
uma divisão deliberada: **hospedagem, Auth e banco continuam 100% Firebase** (é onde
ele é bom — regras declarativas, SDK direto no client, deploy que já existia), e
**só a lógica que move pontos ou saldo foi para uma Cloudflare Worker** (é onde ela é
boa — Workers gratuitas e rápidas, e uma service account do Firebase que bypassa as
regras dá o controle fino que só client + regras não davam). Ver `CLOUDFLARE.md` para
o deploy dessa Worker e a seção "Fase 4" abaixo para o porquê da divisão.

## Estrutura de pastas

```
public/                  → PWA (hospedado no Firebase Hosting — sem mudança)
  index.html          → login único + roteamento por role (admin/empresa/usuario)
  setup.html           → wizard de primeiro acesso (cria o admin inicial 1x)
  manifest.json
  sw.js                → Service Worker (mesma estratégia do projeto-base)
  admin/index.html     → painel do administrador
  empresa/index.html   → painel da empresa (dono + funcionários)
  usuario/index.html   → app do usuário final
  assets/
    css/style.css      → design system (tokens compartilhados pelos 3 portais)
    js/firebase-config.js
    js/sw-update.js    → mesmo mecanismo de auto-update do projeto-base
    js/audit.js        → log de auditoria (reaproveitado quase 1:1)
    js/storage.js      → upload de imagens via IMGDB
    js/api.js          → chama a Cloudflare Worker (pontos, resgates)
    icons/

cloudflare-worker/       → API sensível (Cloudflare — hospedagem do SITE continua Firebase)
  src/index.js         → roteador — verifica o ID Token e despacha pro handler
  src/lib/
    firebaseAuth.js    → verifica Firebase ID Token sem o Admin SDK
    serviceAccount.js  → troca a service account por um token admin do RTDB
    rtdb.js            → REST do RTDB + transação segura via ETag
    gamificacao.js     → XP/nível/streak/conquistas, server-side
    cashback.js        → credita cashback (chamado por lançar-pontos)
    indicacao.js       → bônus de indicação (chamado por lançar-pontos)
    cors.js
  src/handlers/
    lancarPontos.js, estornarLancamento.js, resgatar.js,
    solicitarResgate.js, cancelarResgate.js, usarCashback.js,
    campeonatoInscrever.js
  wrangler.toml
```

## Papéis (roles)

Guardado em `/users/{uid}/role`:

- `admin` — acesso total
- `empresa` — dono ou funcionário de uma empresa (`empresaId` aponta para `/empresas`).
  Funcionários têm `isOwner: false` e um mapa `permissions` granular.
- `usuario` — cliente final

## Schema do Realtime Database

Estrutura pensada para RTDB (dados achatados, sem aninhamento profundo, com índices
nos campos usados em queries). Nós marcados **[F1]** já têm UI nesta fase de fundação;
os demais têm regras de segurança prontas, aguardando a UI das próximas fases.

```
/settings
  /public          [F1]  { platformName, logoUrl, primaryColor, secondaryColor, supportEmail }
  /setupDone       [F1]  boolean — trava o setup.html depois do primeiro admin
  /integrations    [F1]  { imgdbApiKey }  — leitura: admin + empresa. escrita: admin

/users/{uid}       [F1]  { role, name, email, phone, cpf, photoUrl, status, createdAt,
                            empresaId?, isOwner?, permissions?,
                            xp?, level?, streak?, uniqueCode?, referralCode?, referredBy? }
                   xp/level/streak/totalPontosGanhos/totalResgates → [Worker] só a
                   Cloudflare Worker escreve (client é admin-only nesses campos)

/empresas/{empresaId}   [F1]  { name, cnpj, category, description, logoUrl, bannerUrl,
                            address, phone, email, status, ownerId, planId, planExpiresAt,
                            loyaltyRules:{pointsPerCurrency, minValue, pointsValidityDays},
                            cashback:{enabled, percent}, createdAt, approvedAt, approvedBy }

/planos/{planoId}      [F5]  { nome, precoMensal, precoAnual,
                            limites:{maxFuncionarios, maxRecompensas},  // 0 = ilimitado
                            features:{promocoes, cashback, relatoriosAvancados},
                            ativo, createdAt }

/pagamentos/{empresaId}/{id}   { planoId, valor, status, dataVencimento, dataPagamento, metodo }

/pontos/saldo/{usuarioId}/{empresaId}  [Worker] → number (carteira por empresa)
/pontos/lancamentos/{empresaId}/{id}   [Worker] → { usuarioId, tipo, quantidade, motivo,
                                                    origem, funcionarioId, createdAt }

/recompensas/{empresaId}/{id}    [F2]  { nome, descricao, imagemUrl, tipo, quantidadeDisponivel,
                                    valorPontos, status, createdAt }
                                  — CRUD é do client; só `quantidadeDisponivel` também
                                    é escrito pela Worker (debita 1 a cada resgate)
/resgates/{empresaId}/{id}       [Worker]  { usuarioId, recompensaId, pontosGastos, status, createdAt }
/resgates_usuario/{usuarioId}/{id}  [Worker]  → espelho do resgate acima, mesma chave `{id}`,
                                    para o usuário conseguir ver o status dos próprios pedidos
                                    em várias empresas sem precisar de índice global por usuarioId
                                    (RTDB não permite query filtrada entre nós de empresas diferentes).
/cupons/{usuarioId}/{id}      [F6][Worker cria] { empresaId, recompensaId, recompensaNome,
                                    codigo, status:'disponivel'|'utilizado', createdAt }
                                    — só recompensas tipo 'desconto' geram cupom; usuário
                                    pode marcar como utilizado (regra permite só essa transição)
/promocoes/{empresaId}/{id}      { titulo, tipo, dataInicio, dataFim, ativo }

/cashback/saldo/{usuarioId}/{empresaId}         [F6][Worker] → number
/cashback/historico/{empresaId}/{id}            [F6][Worker] → { usuarioId, tipo:'credito'|'uso', valor, motivo, createdAt }
/cashback/historico_usuario/{usuarioId}/{id}    [F6][Worker] → espelho do histórico acima (mesmo padrão de resgates_usuario)

/temporadas/{id}    [F7]  { nome, descricao, bannerUrl, dataInicio, dataFim, status:'futura'|'ativa'|'encerrada', createdAt }

/campeonatos/{id}   [F7]  { nome, descricao, bannerUrl, temporadaId (opcional),
                            dataInicio (fim das inscrições), dataFim (informativa),
                            maxParticipantes: 4|8|16|32,
                            taxaInscricaoXp, recompensaCampeaoXp, recompensaViceXp, regulamento,
                            status:'inscricoes'|'sorteado'|'em_andamento'|'encerrado',
                            participantes:{uid:{nome,inscritoEm}},   // [Worker] só a inscrição passa por lá
                            chaveamento:{rounds:[{nome, partidas:[{jogador1Uid,jogador1Nome,
                              jogador2Uid,jogador2Nome,vencedorUid,vencedorNome,status}]}]},
                            campeaoUid, campeaoNome, viceUid, viceNome, encerradoEm, createdAt }

/ranking_global/{usuarioId}          [F7]  → { nome, pontos }  // pontos de colocação em campeonatos, não XP
/ranking_temporada/{temporadaId}/{usuarioId} [F7]  → { nome, pontos }

/gamificacao/niveis/{n}              { xpNecessario, nome }
/gamificacao/conquistas/{id}         { nome, descricao, icone, criterio }
/gamificacao/missoes/{id}            { tipo, nome, descricao, recompensaXp, recompensaPontos, criterio }
/gamificacao/progresso/{usuarioId}/{missaoId}      { progresso, concluida, concluidaEm }
/gamificacao/conquistasUsuario/{usuarioId}/{id}    [Worker] → timestamp

/notificacoes/{usuarioId}/{id}       { titulo, mensagem, tipo, lida, createdAt, link }
/notificacoes_broadcast/{id}         { titulo, mensagem, alvo, empresaId?, criadoPor, createdAt }

/indicacoes/{usuarioId}/{id}         [F6][Worker cria] { indicadoUid, indicadoNome, status:'confirmado', recompensaXp, createdAt }

/audit_logs/{id}          [F1]  — mesmo formato do projeto-base (audit.js)

/codigosUnicos/{code}     [F1]  → uid   (índice para leitura de QR / código manual)
/telefones/{phone}        [F1]  → uid   (índice para busca por telefone)
/funcionarios/{empresaId}/{uid}  → { nome, permissions, status }  (espelho rápido de /users)
```

## O que a Fase 1 (Fundação) entregou

1. Autenticação + roteamento pelas 3 roles (`index.html`)
2. Wizard de primeiro acesso (`setup.html`)
3. Schema completo do banco, com `database.rules.json` cobrindo todos os nós
4. Painel admin: cadastro/aprovação/bloqueio de empresas
5. Shells navegáveis dos 3 portais
6. Service Worker, auto-update, build de produção e pipeline de deploy
7. `storage.js` — upload de imagem para o IMGDB

## O que a Fase 2 (Pontos e Recompensas) entrega

1. **Empresa → Clientes**: busca por código único ou telefone, mostra saldo do cliente
   *nesta* empresa
2. **Empresa → Pontos**: lançamento manual ou automático (por valor de compra, usando
   `loyaltyRules`), estorno, histórico — tudo com transação atômica no saldo
3. **Empresa → Recompensas**: CRUD completo com upload de imagem
4. **Empresa → Resgates**: fila de pedidos pendentes (feitos pelo usuário no catálogo)
   com confirmar/cancelar, mais resgate direto no balcão a partir da busca de cliente
5. **Usuário → Carteira**: saldo real por empresa participante
6. **Usuário → Recompensas**: catálogo de todas as empresas ativas, com pedido de
   resgate quando o saldo é suficiente
7. Correções de regra necessárias para isso funcionar: empresa agora pode ler o
   perfil básico de qualquer cliente (antes só lia perfis de outros funcionários), e
   o novo nó `resgates_usuario` dá ao usuário uma visão dos próprios pedidos entre
   empresas diferentes

## O que a Fase 2.1 (Funcionários e Promoções) entrega

1. **Empresa → Funcionários** (só dono): cadastra conta de equipe com permissões
   granulares (lançar pontos, resgatar recompensas, gerenciar clientes, gerenciar
   recompensas), bloqueia/desbloqueia, edita permissões
2. **Empresa → Promoções** (só dono): CRUD de promoções por período; pontos em
   dobro/triplo são aplicados automaticamente no cálculo do lançamento automático em
   **Pontos**, sem precisar de nenhuma ação manual na hora da venda
3. Ajuste de regra: `promocoes` também virou owner-only (era qualquer funcionário),
   para ficar consistente com Configurações e Funcionários — decisões estratégicas da
   empresa, não delegáveis por permissão individual

## O que a Fase 2.2 (Admin: Usuários e Métricas) entrega

1. **Admin → Usuários**: lista todos os clientes cadastrados, filtro por nome/e-mail,
   bloquear/desbloquear
2. **Admin → Dashboard**: métricas reais de Pontos Emitidos e Pontos Resgatados
   (somados de todas as empresas), mais um ranking das Empresas Mais Ativas
3. **Correção de regra crítica**: a query `db.ref('users').orderByChild('role')...`
   usada desde a Fase 1 para contar usuários no dashboard nunca teria funcionado em
   produção — faltava `.read` no próprio nó `/users`, só existia no filho `$uid`. Ver
   a seção "Pegadinha das regras do RTDB" abaixo antes de escrever queries novas.

**Nota de escala**: o cálculo de Pontos Emitidos/Resgatados e o ranking de empresas
ativas leem `/pontos/lancamentos` e `/resgates` de **todas** as empresas a cada vez que
o dashboard abre. Ótimo para a escala da Fundação (dezenas de empresas), mas não
escala para milhares. Quando isso importar, a forma certa é manter contadores já
somados (ex.: `/empresas/{id}/totais/pontosEmitidos`) atualizados por Cloud Function a
cada lançamento, em vez de recalcular tudo no client a cada carga de página.

## O que a Fase 3 (Gamificação) entrega

1. **Admin → Gamificação**: CRUD de Níveis (nome + XP necessário) e Conquistas
   (nome, descrição, ícone Lucide, critério de desbloqueio)
2. **`gamificacao.js`** (novo módulo compartilhado): 1 XP para cada ponto ganho em
   qualquer empresa; nível calculado pelo XP total; streak de dias ativos (incrementa
   se a última atividade foi ontem, reseta se o intervalo foi maior); conquistas
   desbloqueadas automaticamente contra 4 critérios simples — nível mínimo, total de
   pontos ganhos, total de resgates, streak mínimo
3. Disparado pela **Empresa** a cada lançamento de pontos (crédito, não estorno) e a
   cada resgate confirmado — dono e funcionários veem toast de "subiu de nível" /
   "conquista desbloqueada" na hora
4. **Usuário → Conquistas**: nível atual, barra de progresso até o próximo, streak,
   grid de conquistas desbloqueadas/bloqueadas

**Fora do escopo, de propósito**: Missões diárias/semanais. Elas precisam resetar por
período (dia/semana) e isso é frágil de fazer bem sem um gatilho de servidor — um
Cloud Function agendado é o jeito certo. O schema (`/gamificacao/missoes`,
`/gamificacao/progresso`) já existe para quando isso entrar.

**Regras alteradas**: `xp`, `level`, `streak`, e os novos contadores
`totalPontosGanhos`/`totalResgates` em `/users/{uid}` agora aceitam escrita da
`empresa` (além do próprio usuário e do admin) — é a empresa, não o usuário, quem
dispara esses eventos. `conquistasUsuario` também passou a aceitar escrita da empresa
e do próprio usuário (antes só admin).

## O que a Fase 4 (Cloudflare — API sensível) entrega

A pedido do cliente, a lógica que move pontos, saldo ou desbloqueia conquista foi
para uma Cloudflare Worker (`cloudflare-worker/`). Firebase continua com **tudo o
resto** — hospedagem, Auth e RTDB. Só essa parte sensível saiu de lá.

1. **`cloudflare-worker/`** — 5 rotas (`lancar-pontos`, `estornar-lancamento`,
   `resgatar`, `solicitar-resgate`, `cancelar-resgate`). Cada uma verifica o
   Firebase ID Token de quem chamou (sem precisar do Admin SDK — a Worker
   reimplementa a verificação do JWT com Web Crypto nativo), troca a service
   account do Firebase por um token OAuth2 que **bypassa `database.rules.json`
   por completo**, e só então executa a lógica de negócio já validando
   permissões — a mesma validação que antes vivia nas regras + no client agora
   é código explícito, revisável, testável
2. **Transação segura sem o SDK client:** a REST API do RTDB não tem
   `.transaction()`, mas tem o mecanismo por baixo (ETag + `if-match`).
   `rtdb.js` reimplementa isso manualmente — é uma peça nova, mais robusta que
   a versão anterior (client-side com duas transações sequenciais e rollback
   manual). Agora saldo e estoque são debitados com a mesma garantia de
   qualquer transação de banco: lê, tenta escrever condicionalmente, se
   alguém escreveu no meio do caminho, tenta de novo
3. **`database.rules.json` travado**: `pontos/*`, `resgates`, `resgates_usuario`
   e os contadores de gamificação em `/users/{uid}` (`xp`, `level`, `streak`,
   `totalPontosGanhos`, `totalResgates`) e `gamificacao/conquistasUsuario`
   deixaram de aceitar escrita de `empresa`/`usuario` — só `admin` (correção
   manual de emergência) e a Worker (via service account, que ignora a regra
   de qualquer forma). O client não escreve mais direto nesses caminhos —
   só chama a Worker
4. **`gamificacao.js` do client foi removido** — a lógica de XP/nível/streak/
   conquistas migrou para `cloudflare-worker/src/lib/gamificacao.js` (mesma
   lógica, porta server-side). O client só lê o resultado pra exibir
5. **Hospedagem não mudou**: continua Firebase Hosting, do jeito que já estava
   desde a Fase 1. `firebase.json` ganhou só uma linha no `Content-Security-Policy`
   (`connect-src`) liberando o domínio da Worker — sem isso o navegador bloqueia
   as chamadas de lançar pontos/resgates

Isso resolve, na prática, o item que já estava anotado em "Pontos de atenção" desde
a Fase 1: regras do RTDB protegem *acesso*, não *integridade de fluxo* — agora a
integridade de fluxo mora em código server-side de verdade.

## O que a Fase 5 (Rate limiting, Planos e Relatórios) entrega

1. **Rate limiting na Worker**: dois limites nativos da Cloudflare (por IP e por
   usuário autenticado) na frente das 5 rotas sensíveis. Ver `CLOUDFLARE.md` —
   é um filtro de abuso "grosso" (contadores por datacenter, não uma garantia
   matemática exata), proporcional ao risco de um app deste porte
2. **Admin → Planos**: CRUD completo — nome, preço mensal/anual, limites
   (máx. funcionários e recompensas — `0` = ilimitado) e módulos liberados
   (Promoções, Cashback, Relatórios avançados). Atribuído a cada empresa em
   **Admin → Empresas → Editar** (campo Plano + data de vencimento)
3. **Empresa → gating pelo plano**: nav de Promoções escondida se o plano não
   incluir; checkbox de Cashback desabilitado com aviso; botões de "Novo
   Funcionário"/"Nova Recompensa" bloqueados com toast quando o limite do
   plano é atingido (dono não conta no limite de funcionários)
4. **Empresa → Relatórios**: métricas básicas (pontos emitidos/resgatados,
   contagens) disponíveis pra qualquer plano; bloco avançado (faturamento
   gerado, evolução mensal em gráfico de barras CSS, clientes mais ativos,
   clientes que mais resgataram) só aparece se o plano tiver
   `features.relatoriosAvancados`

**Importante sobre como o gating é aplicado**: os limites de plano (`maxFuncionarios`,
`maxRecompensas`, os 3 módulos booleanos) são checados **no client**, não nas regras
do RTDB. Isso é uma escolha deliberada, não um esquecimento: contar quantos filhos
existem sob um caminho não é algo que `database.rules.json` consiga fazer (a
linguagem de regras não tem agregação), e encadear `root.child()` até um valor que
pode não existir (empresa sem plano atribuído) é frágil de acertar sem testar contra
um projeto real. Um dono de empresa tecnicamente capaz consegue, em teoria, contornar
esses limites abrindo o console do navegador. Pra a maioria dos casos de uso (upsell
de plano, não proteção contra fraude) isso é aceitável — mas se um dia isso precisar
ser à prova de bypass, o caminho certo é mover Funcionários/Recompensas/Promoções
para rotas da Worker também, do mesmo jeito que pontos e resgates já são, e validar o
limite lá.

## O que a Fase 6 (Cupons, Cashback, Indicação, Notificações, Financeiro, Comunicação) entrega

1. **Cupons**: recompensas do tipo "desconto" agora geram um cupom com código
   ao serem resgatadas (Worker, dentro de `/api/resgatar`) — produto/brinde/
   serviço não geram (são entregues na hora). Usuário vê em **Cupons** e pode
   marcar como utilizado; a regra só permite essa transição específica
   (disponível → utilizado), nunca criar ou reverter
2. **Cashback**: creditado automaticamente pela Worker dentro de
   `/api/lancar-pontos` sempre que a empresa tem cashback ativado e o
   lançamento tem valor de compra real (não em lançamento manual). Nova rota
   **`/api/usar-cashback`** — empresa aplica o desconto no balcão, a partir da
   busca de cliente. Usuário vê saldo por empresa + histórico em **Cashback**
3. **Indicação**: bônus de **100 XP** pro indicador, creditado automaticamente
   pela Worker na primeira compra do indicado (em qualquer empresa) — checagem
   de "primeira compra" via `totalPontosGanhos`, idempotente (não paga duas
   vezes pro mesmo indicado mesmo com retry/corrida). Usuário vê o próprio
   código, compartilha, e acompanha quem já indicou em **Indicações**
4. **Notificações**: sistema simples **in-app** (não é push real — não há
   Firebase Cloud Messaging configurado, então nada chega fora do app aberto).
   Admin → Comunicação envia pra todos os usuários (fan-out: um push por
   usuário, aceitável na escala da Fundação); usuário vê em **Notificações**,
   marcadas como lida ao abrir
5. **Admin → Financeiro**: receita mensal estimada, assinaturas ativas,
   empresas inadimplentes (plano vencido) e distribuição por plano — tudo
   calculado a partir de `/empresas` + `/planos`, sem nó novo

**Duas peças com escopo deliberadamente reduzido**: Comunicação segmentada por
empresa específica não entrou (só "todos os usuários") — motivo:
determinar "quais usuários interagiram com esta empresa" exigiria escanear todo
`/pontos/lancamentos` ou manter um índice novo, e isso não parecia valer a
complexidade ainda. E "Inadimplência" no Financeiro é só um alerta visual — não
bloqueia a empresa automaticamente nem manda cobrança; é informação pro humano
decidir.

## O que a Fase 7 (Temporadas e Campeonatos) entrega

**Decisão de design que precisou ser tomada**: o brief original pede "taxa de
inscrição em pontos" e "recompensas em pontos" para campeonatos — mas pontos são
moeda de *cada empresa* (`/pontos/saldo/{uid}/{empresaId}`), e campeonatos são da
*plataforma inteira*, sem empresa dona. Não existe "a empresa certa" pra debitar ou
creditar. Resolvido do mesmo jeito que resolvi Missões e Indicação: taxa de
inscrição e recompensas de campeonato são em **XP** (a única moeda que já é da
plataforma como um todo), não em pontos de empresa nenhuma.

1. **Admin → Temporadas**: CRUD simples — nome, descrição, banner, período, status
2. **Admin → Campeonatos**: cria o campeonato (nome, banner, temporada opcional,
   prazo de inscrição, tamanho do bracket — 4/8/16/32 —, taxa e recompensas em XP,
   regulamento). O botão **Gerenciar** abre participantes + chaveamento
3. **Inscrição** (`/api/campeonato/inscrever`, única parte que passa pela Worker):
   debita XP do usuário e adiciona à lista de participantes, ambos em transação
   segura contra corrida — protege tanto contra saldo insuficiente quanto contra
   duas pessoas disputando a última vaga ao mesmo tempo
4. **Sorteio do chaveamento** (admin, direto no client — sem risco de corrida
   porque só o admin faz isso, uma vez): embaralha os inscritos e monta o bracket.
   Quando o número de inscritos não é uma potência de 2 exata, sobra vaga de "bye"
   (passagem automática) — a distribuição garante **no máximo 1 bye por partida na
   primeira rodada**, nunca duas vagas vazias na mesma partida. Isso é garantido
   matematicamente: o tamanho do bracket é sempre a *menor* potência de 2 que cobre
   os inscritos, então byes < número de partidas, sempre
5. **Avanço de vencedores** (admin, direto no client): ao declarar o vencedor de
   uma partida, ele é automaticamente posicionado na partida certa da rodada
   seguinte. Na final, o campeonato encerra, campeão e vice são gravados, e as
   recompensas em XP são creditadas + pontos de colocação em `/ranking_global` e
   `/ranking_temporada` (campeão +100, vice +50)
6. **Usuário → Campeonatos**: vê campeonatos com inscrição aberta (com contagem de
   vagas), se inscreve, acompanha chaveamento em andamento e histórico de
   encerrados (visualização somente leitura, em rodadas empilhadas verticalmente —
   mais adequado a tela de celular que um bracket horizontal clássico)
7. **Usuário → Ranking**: ranking da temporada ativa (se houver) + ranking global,
   os dois vindos só de colocação em campeonatos — não é "XP ganho no período"
   (isso exigiria um livro-caixa de XP com timestamp, que não construímos)

**Bug real pego e corrigido no caminho**: a primeira versão do botão "Declarar
Vencedor" passava o nome do jogador direto pro atributo `onclick` como string
JS entre aspas simples — um nome com apóstrofo (ex: "O'Brien") quebraria o
JavaScript gerado. Corrigido: o `onclick` agora só recebe índices e o uid (sempre
alfanumérico, nunca quebra), e a função busca o nome de volta nos dados.

## O que fica para as próximas fases

- Missões diárias/semanais (ver nota acima — ideal com Cloud Function agendada)
- Notificações push de verdade (exigiria configurar Firebase Cloud Messaging
  + permissão do navegador — hoje é só lista dentro do app)
- Comunicação segmentada por empresa específica
- Ranking por "XP ganho no período" (hoje é só colocação em campeonato) — exigiria
  um livro-caixa de XP com timestamp
- Editar/cancelar um campeonato depois de criado (hoje só existe criar + gerenciar;
  mudar `maxParticipantes` ou taxa no meio das inscrições foi deixado de fora de
  propósito, pra não criar inconsistência com quem já se inscreveu)

## Pegadinha das regras do RTDB (ler antes de mexer em `database.rules.json`)

No Realtime Database, `.write` concedido num nó **cascateia para todos os filhos** — uma
regra de filho só consegue *adicionar* permissão, nunca *tirar* a que o pai já deu. Por
isso `/users/{uid}` e `/empresas/{empresaId}` têm o `.write` do nó principal restrito a
`admin`, e cada campo que o próprio usuário (ou o dono da empresa) pode editar tem sua
própria regra explícita (`name`, `phone`, `description`, `logoUrl` etc.) — nunca o nó
inteiro. Campos sensíveis (`role`, `status`, `empresaId`, `isOwner`, `planId`) ficam de
fora dessa lista, exceto um "bootstrap" único (`!data.exists()`) que permite o próprio
usuário se autocadastrar como `usuario` a primeira vez. Ao adicionar um novo módulo
(temporadas, campeonatos, etc.), siga o mesmo padrão: nunca dê `.write` amplo num nó pai
esperando que uma regra de filho "restrinja" depois — ela não vai restringir nada.

Segunda pegadinha, essa do lado da **leitura em query**: `.read` também cascateia, mas
uma *query* (`orderByChild`, `equalTo`, `limitToLast` etc.) só é permitida se existir uma
regra `.read` que resolva `true` **no local exato onde a query é feita** — uma regra só
no filho wildcard (`$uid`, `$empresaId`...) não vale para uma query no nó pai, porque a
query não está presa a nenhuma chave específica ainda. Foi assim que a query
`db.ref('users').orderByChild('role').equalTo('usuario')` do dashboard do admin ficaria
quebrada em produção: só existia regra em `/users/$uid`, nunca em `/users` mesmo. Por
isso `/users` agora tem um `.read` próprio (admin) além da regra em `$uid`. Se um dia
uma query nova voltar "permission denied" mesmo com as regras "parecendo certas", esse
é o primeiro lugar a checar: existe `.read` no nó onde a query é feita, ou só num filho
mais profundo?

## Pontos de atenção (para decidir com o cliente antes de avançar)

- ~~Regras do RTDB protegem *acesso*, não *integridade de fluxo*~~ — resolvido na
  Fase 4 para pontos/resgates/gamificação, via Cloudflare Worker. **Ainda vale** para
  o que falta: geração/avanço automático de chaveamento em Campeonatos e expiração de
  pontos por validade (`pointsValidityDays` existe no schema mas nada ainda expira
  pontos vencidos) são bons candidatos a ganhar sua própria rota na Worker quando
  entrarem, em vez de tentar fazer client-side.
- A chave do IMGDB fica no RTDB (`/settings/integrations/imgdbApiKey`), lida só por
  admin/empresa, exatamente como pedido. Vale saber que qualquer usuário com esse
  papel consegue ver a chave no client (é a natureza de uma API key usada no
  navegador) — o controle real de abuso está nas configurações do próprio IMGDB.
- **Consequência direta dessa regra:** o papel `usuario` nunca consegue chamar
  `uploadImage()` (ele não lê a chave). Então hoje o usuário final não tem como
  enviar, por exemplo, uma foto de perfil própria — só admin/empresa fazem upload
  (logo, banner, imagens de recompensas). Se no futuro o usuário precisar subir
  imagem própria, a forma correta é uma rota na própria Worker que recebe o
  arquivo, guarda a chave só como secret do servidor, e nunca a expõe a nenhum
  client — não vale abrir a leitura de `/settings/integrations` para `usuario`
  só para resolver isso.
