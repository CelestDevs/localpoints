# Deploy — Local Points

> A API sensível (pontos, resgates, gamificação) roda numa Cloudflare Worker —
> ver **`CLOUDFLARE.md`** para o deploy dela. Hospedagem, Auth e banco
> continuam 100% no Firebase, como sempre.

## 1. Configurar o Firebase

1. Crie (ou use o que você já criou) um projeto em https://console.firebase.google.com
2. Ative **Authentication → Sign-in method → E-mail/senha**
3. Ative **Realtime Database** (modo "bloqueado" — as regras vêm do arquivo deste repo)
4. Em **Configurações do projeto → Seus apps**, crie um app Web e copie o objeto de
   config para `public/assets/js/firebase-config.js` (substitua os valores `COLE_AQUI...`)
5. Em **Configurações do projeto → Contas de serviço**, gere a chave que a
   Cloudflare Worker vai usar (detalhes em `CLOUDFLARE.md`)

## 2. Regras do Realtime Database

As regras ficam versionadas em **`database.rules.json`** (controle por papel: `admin`,
`empresa`, `usuario`, e agora também a própria Worker via service account — que
bypassa as regras de propósito, ver `CLOUDFLARE.md`). **Não cole regras abertas no
Console** — isso desfaz toda a proteção e deixa qualquer usuário autenticado
ler/gravar tudo.

Para publicar as regras versionadas:

```bash
firebase deploy --only database
```

Ou, pelo Console (Build → Realtime Database → Rules), cole exatamente o conteúdo de
`database.rules.json` deste repositório e clique em **Publish**.

> O deploy de hosting (`deploy.yml`) **não** publica as regras automaticamente — de
> propósito, para evitar que uma mudança de regra vá ao ar sem revisão. Publique as
> regras manualmente sempre que `database.rules.json` mudar.

## 3. Primeiro acesso (setup)

Depois do primeiro deploy, acesse:

```
https://SEU-PROJETO.web.app/setup.html
```

Essa tela cria o primeiro administrador, configura o nome/cores da plataforma e
(opcionalmente) a chave do IMGDB. Ela se desativa sozinha depois de concluída
(`/settings/setupDone` vira `true`) — rodar de novo só mostra um aviso.

## 4. IMGDB (hospedagem de imagens)

Crie uma conta em https://imgbb.com e gere sua chave de API em https://api.imgbb.com.
Cole a chave no setup inicial ou depois em **Admin → Configurações → IMGDB**. A chave
fica em `/settings/integrations/imgdbApiKey`, legível só por `admin` e `empresa`.

## 5. Cloudflare Worker (API sensível)

Antes do primeiro deploy do site, configure e publique a Worker — o client já vem
programado para chamá-la (`public/assets/js/api.js`). Passo a passo completo em
**`CLOUDFLARE.md`**. Depois de publicar a Worker, você precisa:

1. Trocar `COLE_AQUI_SUA_WORKER` em `public/assets/js/api.js` pela URL real da Worker
2. Trocar `SUA-WORKER.workers.dev` pelo mesmo domínio no `Content-Security-Policy`
   (`connect-src`) dentro de `firebase.json` — sem isso o navegador bloqueia as
   chamadas de lançar pontos/resgates

## 6. Build + Deploy do Hosting

```bash
npm install            # instala o Terser (minificação)
npm run build          # gera dist/
firebase deploy --only hosting
```

Ou tudo de uma vez (hosting + regras, com revisão manual das regras antes):

```bash
firebase deploy --only database   # só quando database.rules.json mudar
npm run build && firebase deploy --only hosting
```

O deploy automático via GitHub Actions (`.github/workflows/deploy.yml`) roda
`npm install → node build.js → firebase deploy --only hosting` a cada push na branch
`main`. Configure o secret `GCP_SA_KEY` (chave de uma service account com permissão de
Firebase Hosting Admin) nas configurações do repositório no GitHub. O deploy da Worker
é um workflow separado (`.github/workflows/deploy-worker.yml`), só roda quando algo em
`cloudflare-worker/` muda — precisa do secret `CLOUDFLARE_API_TOKEN`.

> **Cache-busting:** a cada deploy, atualize `BUILD_ID` em `public/sw.js`. O `build.js`
> lê esse valor e adiciona `?v=BUILD_ID` aos links de CSS, forçando o navegador/Service
> Worker a buscar a versão nova.

## Estrutura e próximas fases

Veja `ARQUITETURA.md` para o schema completo do banco, o que já funciona e o que
fica para as próximas fases.
