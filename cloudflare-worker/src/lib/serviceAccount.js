/**
 * serviceAccount.js — Troca as credenciais da service account do Firebase
 * por um access_token OAuth2 que a REST API do RTDB aceita com privilégio de
 * ADMIN — ou seja, que ignora completamente database.rules.json.
 *
 * É por isso que só a Worker tem essa chave (como secret, nunca no código).
 * O client nunca vê nem toca nesse token.
 */

let cachedToken = null; // { token, expiresAt } — reaproveitado entre requisições no mesmo isolate

/**
 * Aceita a chave privada tanto com quebras de linha de verdade quanto com
 * "\n" literal (2 caracteres: barra + n) — é assim que ela aparece quando
 * alguém copia o valor de dentro do arquivo JSON da service account direto
 * (JSON representa quebra de linha em string como \n literal, não uma quebra
 * de linha real). Sem isso, sobra esse literal misturado no meio do base64 e
 * o atob() quebra com "invalid base64-encoded data".
 */
function pemToArrayBuffer(pem) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\\n/g, '')
    .replace(/\s+/g, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64UrlEncode(input) {
  let str;
  if (typeof input === 'string') {
    str = btoa(input);
  } else {
    str = btoa(String.fromCharCode(...new Uint8Array(input)));
  }
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * @param {object} env - bindings da Worker (secrets)
 * @returns {Promise<string>} access_token OAuth2 válido
 */
export async function getServiceAccountAccessToken(env) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: env.FIREBASE_SERVICE_ACCOUNT_EMAIL,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const claimB64 = base64UrlEncode(JSON.stringify(claim));
  const unsigned = `${headerB64}.${claimB64}`;

  const keyData = pemToArrayBuffer(env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY);
  const key = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${base64UrlEncode(signature)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error('Falha ao obter token da service account: ' + JSON.stringify(data));
  }

  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}
