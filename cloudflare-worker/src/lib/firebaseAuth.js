/**
 * firebaseAuth.js — Verifica um Firebase ID Token (JWT RS256) sem o Admin SDK.
 *
 * O Admin SDK do Firebase não roda no runtime da Cloudflare Worker (depende de
 * APIs do Node que não existem lá). Em vez disso, verificamos a assinatura do
 * token manualmente com a Web Crypto API nativa, contra as chaves públicas que
 * o Google publica. É exatamente o que o Admin SDK faz por debaixo dos panos.
 *
 * IMPORTANTE: confira esta URL contra a documentação atual do Firebase antes
 * de ir para produção — endpoints de chave pública podem mudar.
 */

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64UrlDecodeToString(str) {
  return new TextDecoder().decode(base64UrlDecode(str));
}

async function getJWKS() {
  // Cache API da Cloudflare — evita buscar as chaves do Google em toda requisição.
  // Respeita o Cache-Control que o próprio Google devolve.
  const cache = caches.default;
  const cacheKey = new Request(JWKS_URL);
  let res = await cache.match(cacheKey);
  if (!res) {
    res = await fetch(JWKS_URL);
    if (res.ok) await cache.put(cacheKey, res.clone());
  }
  return res.json();
}

async function importPublicKey(jwk) {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
}

/**
 * @param {string} idToken - o Firebase ID Token enviado pelo client (Authorization: Bearer ...)
 * @param {string} projectId - o Project ID do Firebase (usado para validar aud/iss)
 * @returns {Promise<{uid: string, email: string|null}>}
 * @throws {Error} com .status = 401 se o token for inválido/expirado
 */
export async function verifyFirebaseIdToken(idToken, projectId) {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw authError('Token malformado.');
  const [headerB64, payloadB64, sigB64] = parts;

  let header, payload;
  try {
    header = JSON.parse(base64UrlDecodeToString(headerB64));
    payload = JSON.parse(base64UrlDecodeToString(payloadB64));
  } catch (e) {
    throw authError('Token com JSON inválido.');
  }

  if (header.alg !== 'RS256') throw authError('Algoritmo de assinatura inesperado.');

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) throw authError('Token expirado.');
  if (typeof payload.iat === 'number' && payload.iat > now + 60) throw authError('Token com iat no futuro.');
  if (payload.aud !== projectId) throw authError('Audience do token não corresponde a este projeto.');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw authError('Issuer do token inválido.');
  if (!payload.sub) throw authError('Token sem uid (sub).');

  const jwks = await getJWKS();
  const jwk = (jwks.keys || []).find(k => k.kid === header.kid);
  if (!jwk) throw authError('Chave pública correspondente não encontrada.');

  const key = await importPublicKey(jwk);
  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlDecode(sigB64);

  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signedData);
  if (!valid) throw authError('Assinatura do token inválida.');

  return { uid: payload.sub, email: payload.email || null };
}

function authError(message) {
  const err = new Error(message);
  err.status = 401;
  return err;
}
