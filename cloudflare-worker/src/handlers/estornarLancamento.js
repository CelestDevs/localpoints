import { rtdbGet, rtdbPut, rtdbTransaction, rtdbPush, assertSafeKey } from '../lib/rtdb.js';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * POST /api/estornar-lancamento
 * body: { empresaId, lancamentoId }
 */
export async function handleEstornarLancamento(env, token, callerUid, body) {
  const { empresaId, lancamentoId } = body;
  if (!empresaId || !lancamentoId) throw httpError(400, 'Parâmetros faltando.');
  assertSafeKey(empresaId, 'empresaId');
  assertSafeKey(lancamentoId, 'lancamentoId');

  const caller = await rtdbGet(env, token, `users/${callerUid}`);
  if (!caller || caller.role !== 'empresa' || caller.empresaId !== empresaId) throw httpError(403, 'Sem acesso a esta empresa.');
  if (!caller.isOwner && !caller.permissions?.lancarPontos) throw httpError(403, 'Sem permissão para estornar.');

  const lanc = await rtdbGet(env, token, `pontos/lancamentos/${empresaId}/${lancamentoId}`);
  if (!lanc) throw httpError(404, 'Lançamento não encontrado.');
  if (lanc.estornado) throw httpError(400, 'Este lançamento já foi estornado.');
  if (lanc.tipo !== 'credito') throw httpError(400, 'Só é possível estornar lançamentos de crédito.');

  const result = await rtdbTransaction(
    env, token, `pontos/saldo/${lanc.usuarioId}/${empresaId}`,
    cur => Math.max(0, (cur || 0) - lanc.quantidade)
  );

  const estornoId = await rtdbPush(env, token, `pontos/lancamentos/${empresaId}`);
  await rtdbPut(env, token, `pontos/lancamentos/${empresaId}/${estornoId}`, {
    usuarioId: lanc.usuarioId,
    usuarioNome: lanc.usuarioNome,
    tipo: 'estorno',
    quantidade: lanc.quantidade,
    motivo: 'Estorno do lançamento anterior',
    origem: lanc.origem,
    funcionarioId: callerUid,
    createdAt: Date.now(),
    refLancamentoId: lancamentoId
  });
  await rtdbPut(env, token, `pontos/lancamentos/${empresaId}/${lancamentoId}/estornado`, true);

  return { ok: true, novoSaldo: result.value, estornoId };
}
