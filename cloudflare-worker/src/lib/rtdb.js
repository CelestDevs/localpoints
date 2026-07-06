/**
 * rtdb.js — Helpers para a REST API do Firebase Realtime Database,
 * autenticados como service account (bypassa database.rules.json).
 *
 * O ponto mais importante aqui é `rtdbTransaction`: a REST API não tem o
 * `.transaction()` do SDK cliente, mas oferece o mesmo mecanismo por baixo —
 * leitura com ETag + escrita condicional (`if-match`). Reimplementamos isso
 * manualmente para ler-modificar-escrever saldo e estoque sem corrida, mesmo
 * com duas requisições concorrentes.
 *
 * SEGURANÇA — leia antes de adicionar um handler novo: todo valor que vem do
 * corpo da requisição (empresaId, clienteUid, recompensaId, resgateId...) e
 * é usado para montar um caminho do RTDB PRECISA passar por `assertSafeKey()`
 * antes. Sem isso, alguém poderia mandar algo como
 * "vitimaUid/../../settings/integrations" e a URL final, depois de
 * normalizada pelo parser de URL padrão, apontaria pra
 * "/settings/integrations" em vez do caminho pretendido — e como a Worker
 * fala com o RTDB via service account (que ignora database.rules.json), essa
 * escrita passaria com privilégio total. Isso foi encontrado e corrigido
 * numa auditoria; não reintroduza o bug.
 */

const FORBIDDEN_KEY_CHARS = /[.$#\[\]/\x00-\x1F\x7F]/;

/**
 * Versão booleana, sem lançar erro — usada quando o valor suspeito vem de um
 * lugar onde a resposta certa é "ignora essa parte" e não "derruba a
 * requisição inteira" (ex: um campo preenchido pelo próprio usuário há muito
 * tempo, tipo referredBy, que alimenta uma função auxiliar/best-effort).
 */
export function isSafeKey(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !FORBIDDEN_KEY_CHARS.test(value);
}

/**
 * Garante que um valor vindo do client é seguro pra usar como segmento de
 * caminho no RTDB. Lança 400 se não for.
 * @param {string} value
 * @param {string} fieldName - só pra mensagem de erro
 */
export function assertSafeKey(value, fieldName) {
  if (!isSafeKey(value)) {
    throw httpError(400, `${fieldName} inválido.`);
  }
  return value;
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function baseUrl(env) {
  return env.FIREBASE_DATABASE_URL.replace(/\/$/, '');
}

export async function rtdbGet(env, token, path) {
  const res = await fetch(`${baseUrl(env)}/${path}.json`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`RTDB GET ${path} falhou: ${res.status}`);
  return res.json();
}

async function rtdbGetWithETag(env, token, path) {
  const res = await fetch(`${baseUrl(env)}/${path}.json`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Firebase-ETag': 'true' }
  });
  if (!res.ok) throw new Error(`RTDB GET ${path} falhou: ${res.status}`);
  const etag = res.headers.get('ETag');
  const value = await res.json();
  return { value, etag };
}

async function rtdbPutIfMatch(env, token, path, value, etag) {
  const res = await fetch(`${baseUrl(env)}/${path}.json`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'if-match': etag
    },
    body: JSON.stringify(value)
  });
  if (res.status === 412) return { ok: false }; // ETag não bateu — outro request alterou o valor
  if (!res.ok) throw new Error(`RTDB PUT ${path} falhou: ${res.status}`);
  return { ok: true };
}

export async function rtdbPut(env, token, path, value) {
  const res = await fetch(`${baseUrl(env)}/${path}.json`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  });
  if (!res.ok) throw new Error(`RTDB PUT ${path} falhou: ${res.status}`);
  return res.json();
}

/**
 * Escreve em vários caminhos absolutos de uma vez só, atomicamente
 * (tudo aplica ou nada aplica) — equivalente ao update() multi-path do SDK.
 */
export async function rtdbMultiUpdate(env, token, updates) {
  const res = await fetch(`${baseUrl(env)}/.json`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`RTDB multi-update falhou: ${res.status} ${text}`);
  }
  return res.json();
}

export async function rtdbPush(env, token, path) {
  const res = await fetch(`${baseUrl(env)}/${path}.json`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  if (!res.ok) throw new Error(`RTDB PUSH ${path} falhou: ${res.status}`);
  const data = await res.json();
  return data.name;
}

/**
 * Lê, aplica `updateFn` e escreve de volta só se nada mudou desde a leitura
 * (via ETag). Se `updateFn` devolver `undefined`, a transação é abortada sem
 * escrever nada (mesmo comportamento do `.transaction()` client-side quando
 * a função retorna `undefined`). Tenta novamente em caso de corrida (412).
 *
 * @returns {Promise<{aborted: boolean, value: any}>}
 */
export async function rtdbTransaction(env, token, path, updateFn, maxRetries = 5) {
  for (let i = 0; i < maxRetries; i++) {
    const { value, etag } = await rtdbGetWithETag(env, token, path);
    const novoValor = updateFn(value);
    if (novoValor === undefined) return { aborted: true, value };

    const result = await rtdbPutIfMatch(env, token, path, novoValor, etag);
    if (result.ok) return { aborted: false, value: novoValor };
    // 412 — outra requisição escreveu nesse caminho entre o GET e o PUT. Tenta de novo.
  }
  throw new Error(`Muita concorrência em ${path} — tente novamente.`);
}
