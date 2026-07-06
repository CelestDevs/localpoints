// ─── Config da API sensível (Cloudflare Worker) ───
const API_BASE = "https://api.celestdevs.workers.dev";

/**
 * Chama um endpoint da API sensível (lançar pontos, resgates, etc.),
 * anexando o Firebase ID Token do usuário logado. A Worker verifica esse
 * token, confere as permissões no RTDB e só então executa a operação.
 *
 * @param {string} endpoint - ex: '/api/lancar-pontos'
 * @param {object} body
 * @returns {Promise<object>} resposta da Worker
 * @throws {Error} com a mensagem vinda da Worker em caso de falha
 */
async function callApi(endpoint, body) {
  const user = auth.currentUser;
  if (!user) throw new Error('Sessão expirada. Faça login novamente.');

  const idToken = await user.getIdToken();
  const res = await fetch(API_BASE + endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + idToken
    },
    body: JSON.stringify(body)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro na API (${res.status}).`);
  return data;
}
