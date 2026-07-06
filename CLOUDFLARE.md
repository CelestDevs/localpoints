# Cloudflare Worker — API sensível

Este documento cobre só a Worker (`cloudflare-worker/`), que processa pontos,
resgates, cashback, indicação, inscrição em campeonatos e gamificação (7 rotas:
`lancar-pontos`, `estornar-lancamento`, `resgatar`, `solicitar-resgate`,
`cancelar-resgate`, `usar-cashback`, `campeonato/inscrever`). **Hospedagem
continua no Firebase Hosting** (ver `DEPLOY.md`) — a Cloudflare entra só nessa
API. Auth e Realtime Database também continuam 100% no Firebase. Veja
`ARQUITETURA.md` para o desenho completo.

## Visão geral do fluxo

```
Navegador (PWA hospedado no Firebase Hosting)
  │
  ├─ Firebase Auth SDK ──────────► login/cadastro (sem mudança)
  ├─ Firebase RTDB SDK ───────────► leituras e escritas "normais"
  │                                  (perfis, catálogo, configurações...)
  │                                  — database.rules.json ainda protege isso
  │
  └─ fetch() com Bearer <ID Token> ► Cloudflare Worker (cloudflare-worker/)
                                        │
                                        ├─ verifica o ID Token (JWT, sem Admin SDK)
                                        ├─ vira "admin" no RTDB via service account
                                        │  (bypassa database.rules.json de propósito)
                                        └─ executa lançar pontos / resgatar / etc.
```

## 1. Criar a service account do Firebase

1. Firebase Console → ⚙️ Configurações do projeto → **Contas de serviço**
2. **Gerar nova chave privada** → baixa um JSON com `client_email`, `private_key` e `project_id`
3. Guarde esse arquivo em local seguro — **nunca** comite ele no repositório

## 2. Configurar e publicar a Worker

```bash
cd cloudflare-worker
npm install        # só o wrangler, a Worker em si não tem dependências
wrangler login      # abre o navegador pra autenticar com sua conta Cloudflare
```

Configure os secrets (usa os valores do JSON baixado no passo 1):

```bash
wrangler secret put FIREBASE_PROJECT_ID
# cole o "project_id" do JSON

wrangler secret put FIREBASE_DATABASE_URL
# ex: https://SEU-PROJETO-default-rtdb.firebaseio.com

wrangler secret put FIREBASE_SERVICE_ACCOUNT_EMAIL
# cole o "client_email" do JSON

wrangler secret put FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY
# cole o "private_key" do JSON — INTEIRO, incluindo
# -----BEGIN PRIVATE KEY----- e -----END PRIVATE KEY-----

wrangler secret put ALLOWED_ORIGIN
# o domínio onde o site fica no Firebase Hosting, ex:
# https://seu-projeto.web.app,https://seu-projeto.firebaseapp.com
```

Deploy:

```bash
wrangler deploy
```

Isso imprime a URL da Worker, algo como `https://local-points-api.SEU-USUARIO.workers.dev`.
**Guarde essa URL** — ela vai em dois lugares no passo 3.

## 3. Ligar a Worker ao site

Com a URL real da Worker em mãos:

1. Em `public/assets/js/api.js`, troque:
   ```js
   const API_BASE = "https://COLE_AQUI_SUA_WORKER.workers.dev";
   ```
   pela URL real da Worker.

2. Em `firebase.json`, dentro do `Content-Security-Policy` (bloco `hosting.headers`),
   troque `SUA-WORKER.workers.dev` pelo mesmo domínio no `connect-src`. Sem isso, o
   navegador bloqueia as chamadas de lançar pontos/resgates mesmo com tudo certo no
   resto.

3. Confirme que o secret `ALLOWED_ORIGIN` da Worker (passo 2) tem o domínio real
   onde o site está publicado no Firebase Hosting.

4. `npm run build && firebase deploy --only hosting` (ou deixe o GitHub Actions
   fazer isso). Se você mudou algo em `cloudflare-worker/`, rode `wrangler deploy`
   de novo (ou deixe `.github/workflows/deploy-worker.yml` fazer isso, configurando
   o secret `CLOUDFLARE_API_TOKEN` nas configurações do repositório no GitHub — gere
   o token em Cloudflare Dashboard → Meu Perfil → API Tokens → **Edit Cloudflare Workers**).

## 4. Rate limiting

`wrangler.toml` já declara dois limites nativos da Cloudflare (API de bindings,
sem custo extra no plano grátis):

- **Por IP** (`RATE_LIMITER_IP`): 60 requisições/minuto — barra spam bruto,
  antes até de checar o token
- **Por usuário autenticado** (`RATE_LIMITER_UID`): 30 requisições/minuto —
  pega abuso de uma conta específica (comprometida ou com bug no client)

Não precisa criar nada à parte — o `namespace_id` (1001/1002) é só um número
que você escolhe, funciona automaticamente no primeiro `wrangler deploy`.
Ajuste os valores de `limit`/`period` em `wrangler.toml` se 30-60 req/min
não fizer sentido pro seu volume (`period` só aceita 10 ou 60).

**Seja realista sobre o que isso é**: é um filtro de abuso "grosso", não uma
garantia matemática — os contadores são por datacenter da Cloudflare e ficam
sincronizados de forma assíncrona, então em rajadas bem distribuídas geograficamente
o limite real observado pode passar um pouco do configurado. Para um app de
fidelidade de comércio local isso é proporcional ao risco; se um dia precisar de
um limite rígido e exato, a solução correta é um Durable Object — mais complexo,
não fizemos isso aqui.

## 5. Testar

1. Abra o site (no domínio do Firebase Hosting), faça login como empresa
2. Vá em **Clientes** → busque um cliente de teste → **Lançar Pontos**
3. Se der erro de rede/CORS no console do navegador, confira o `API_BASE` (passo 3.1)
   e o `ALLOWED_ORIGIN` (passo 2) primeiro — são os dois pontos mais comuns de erro
4. Se der "Token de autenticação ausente" ou 401, confira se
   `FIREBASE_PROJECT_ID` bate exatamente com o project ID do Firebase

## O que NÃO mudou

- Hospedagem continua Firebase Hosting, do jeito que já estava
- `public/setup.html` continua criando o primeiro admin do mesmo jeito
- CRUD de empresas, recompensas, funcionários, promoções, configurações — tudo
  isso continua direto no RTDB, sem passar pela Worker (não é "sensível" no
  sentido de mover pontos/dinheiro)
- `database.rules.json` continua protegendo tudo isso; só os caminhos que a
  Worker agora controla (`pontos/*`, `resgates*`, contadores de gamificação em
  `/users/{uid}`) ficaram travados para admin-only no client, porque a Worker
  os escreve com privilégio de admin, ignorando as regras

## Sobre o gratuito

- **Cloudflare Workers:** 100.000 requisições/dia no plano grátis — cada
  lançamento de pontos ou resgate é 1 requisição
- **Firebase (Spark/grátis):** RTDB com 1GB armazenado e 10GB/mês baixados,
  100 conexões simultâneas; Auth é gratuito para e-mail/senha sem limite de
  usuários; Hosting grátis tem 10GB armazenados e 360MB/dia de transferência.
  Se o Hosting virar gargalo antes do resto, é hora do plano Blaze
  (pay-as-you-go) do Firebase — não muda nada do que construímos aqui
