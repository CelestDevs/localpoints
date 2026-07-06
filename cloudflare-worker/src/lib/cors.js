/**
 * cors.js — CORS e respostas JSON padronizadas.
 *
 * ALLOWED_ORIGIN é uma lista separada por vírgula (secret), ex:
 * "https://seu-projeto.web.app,https://seu-projeto.firebaseapp.com". Se não
 * for configurado, cai para "*" (qualquer origem) — serve pra testar em dev,
 * mas configure o secret antes de ir pra produção (ver CLOUDFLARE.md).
 */
export function corsHeaders(origin, env) {
  const allowed = (env?.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
  const allowOrigin = allowed.length === 0 ? '*' : (allowed.includes(origin) ? origin : allowed[0]);
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

export function jsonResponse(data, status, origin, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, env) }
  });
}
