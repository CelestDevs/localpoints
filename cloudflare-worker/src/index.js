/**
 * index.js — ponto de entrada da API sensível do Local Points.
 *
 * Toda rota aqui: 1) verifica o Firebase ID Token de quem chamou,
 * 2) troca a service account por um token admin do RTDB,
 * 3) roda a lógica de negócio já validando permissões,
 * 4) devolve JSON.
 *
 * O client nunca mais escreve direto em /pontos, /resgates,
 * /resgates_usuario ou nos contadores de gamificação — só chama estas rotas.
 * As regras do RTDB (database.rules.json) foram travadas para admin-only
 * nesses caminhos: só quem tem a service account (esta Worker) escreve ali.
 */
import { verifyFirebaseIdToken } from './lib/firebaseAuth.js';
import { getServiceAccountAccessToken } from './lib/serviceAccount.js';
import { corsHeaders, jsonResponse } from './lib/cors.js';
import { handleLancarPontos } from './handlers/lancarPontos.js';
import { handleEstornarLancamento } from './handlers/estornarLancamento.js';
import { handleResgatar } from './handlers/resgatar.js';
import { handleSolicitarResgate } from './handlers/solicitarResgate.js';
import { handleCancelarResgate } from './handlers/cancelarResgate.js';
import { handleUsarCashback } from './handlers/usarCashback.js';
import { handleCampeonatoInscrever } from './handlers/campeonatoInscrever.js';
import { handleVerificarConquistas } from './handlers/verificarConquistas.js';

const ROUTES = {
  '/api/lancar-pontos': handleLancarPontos,
  '/api/estornar-lancamento': handleEstornarLancamento,
  '/api/resgatar': handleResgatar,
  '/api/solicitar-resgate': handleSolicitarResgate,
  '/api/cancelar-resgate': handleCancelarResgate,
  '/api/usar-cashback': handleUsarCashback,
  '/api/campeonato/inscrever': handleCampeonatoInscrever,
  '/api/verificar-conquistas': handleVerificarConquistas
};

const REQUIRED_ENV_VARS = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_DATABASE_URL',
  'FIREBASE_SERVICE_ACCOUNT_EMAIL',
  'FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY'
];

function checkRequiredEnvVars(env) {
  const faltando = REQUIRED_ENV_VARS.filter(nome => !env[nome]);
  if (faltando.length > 0) {
    throw statusError(500, `Configuração incompleta na Worker — faltando: ${faltando.join(', ')}. Confira em Settings → Variables and Secrets se o nome está exatamente igual (maiúsculas/minúsculas importam) e se está marcado como tipo "Secret".`);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin, env) });
    }

    const handler = ROUTES[url.pathname];
    if (!handler) return jsonResponse({ error: 'Rota não encontrada.' }, 404, origin, env);
    if (request.method !== 'POST') return jsonResponse({ error: 'Use POST.' }, 405, origin, env);

    // Rate limit por IP, antes de qualquer trabalho — barra spam bruto mesmo
    // com token inválido ou ausente. Verificação defensiva: se o binding não
    // estiver configurado (ex: deploy antigo sem os secrets do rate limit),
    // a Worker segue funcionando sem rate limit em vez de quebrar.
    if (env.RATE_LIMITER_IP) {
      const ip = request.headers.get('cf-connecting-ip') || 'sem-ip';
      const { success } = await env.RATE_LIMITER_IP.limit({ key: ip });
      if (!success) return jsonResponse({ error: 'Muitas requisições deste endereço. Aguarde um pouco.' }, 429, origin, env);
    }

    try {
      checkRequiredEnvVars(env);

      const authHeader = request.headers.get('Authorization') || '';
      const idToken = authHeader.replace(/^Bearer\s+/i, '').trim();
      if (!idToken) throw statusError(401, 'Token de autenticação ausente.');

      const { uid } = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID);

      // Rate limit por usuário autenticado — mais rigoroso, protege contra
      // abuso de uma conta específica (comprometida ou com bug no client).
      if (env.RATE_LIMITER_UID) {
        const { success } = await env.RATE_LIMITER_UID.limit({ key: uid });
        if (!success) throw statusError(429, 'Muitas requisições para esta conta. Aguarde um pouco.');
      }

      const serviceToken = await getServiceAccountAccessToken(env);
      const body = await request.json().catch(() => ({}));

      const result = await handler(env, serviceToken, uid, body);
      return jsonResponse(result, 200, origin, env);
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error('Erro interno:', err);
      return jsonResponse({ error: err.message || 'Erro interno.' }, status, origin, env);
    }
  }
};

function statusError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
