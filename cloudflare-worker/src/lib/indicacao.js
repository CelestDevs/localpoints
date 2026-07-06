import { rtdbGet, rtdbPut, rtdbPush, isSafeKey } from './rtdb.js';
import { creditarXpBonus } from './gamificacao.js';

const BONUS_XP_INDICACAO = 100;

/**
 * Se este for o primeiro lançamento de pontos do cliente (em qualquer
 * empresa) e ele tiver sido indicado por alguém, credita XP bônus ao
 * indicador e registra a indicação como confirmada.
 *
 * Idempotente por construção: só considera "primeira compra" quando
 * totalPontosGanhos ainda é 0 (checado ANTES do crédito desta compra) e
 * confirma não haver registro anterior pra esse indicado antes de creditar —
 * então mesmo em retries/corrida, não paga bônus duas vezes pro mesmo
 * indicado.
 *
 * @param {object} cliente - o perfil do cliente ANTES do lançamento atual
 *   (precisa ser lido antes de creditar totalPontosGanhos)
 */
export async function processarIndicacaoSePrimeiraCompra(env, token, cliente, clienteUid) {
  if (!cliente.referredBy) return null;
  if ((cliente.totalPontosGanhos || 0) > 0) return null; // não é a primeira compra

  const referrerUid = cliente.referredBy;
  // referredBy é preenchido pelo próprio usuário no cadastro, sem validação de
  // formato nas regras — é tão não-confiável quanto qualquer campo do body de
  // uma requisição. Sem este check, alguém poderia se auto-cadastrar com
  // referredBy = "algumUid/../../settings/integrations" e usar essa função pra
  // escrever fora do caminho pretendido, com o privilégio da service account.
  if (!isSafeKey(referrerUid)) return null;
  if (referrerUid === clienteUid) return null; // defesa contra auto-indicação

  const existentes = await rtdbGet(env, token, `indicacoes/${referrerUid}`);
  const jaProcessada = Object.values(existentes || {}).some(i => i.indicadoUid === clienteUid);
  if (jaProcessada) return null;

  const referrer = await rtdbGet(env, token, `users/${referrerUid}`);
  if (!referrer || referrer.role !== 'usuario') return null;

  await creditarXpBonus(env, token, referrerUid, BONUS_XP_INDICACAO);

  const indicacaoId = await rtdbPush(env, token, `indicacoes/${referrerUid}`);
  await rtdbPut(env, token, `indicacoes/${referrerUid}/${indicacaoId}`, {
    indicadoUid: clienteUid,
    indicadoNome: cliente.name || '',
    status: 'confirmado',
    recompensaXp: BONUS_XP_INDICACAO,
    createdAt: Date.now()
  });

  return { referrerUid, bonusXp: BONUS_XP_INDICACAO };
}
