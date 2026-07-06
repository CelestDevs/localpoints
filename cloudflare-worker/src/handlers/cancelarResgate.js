import { rtdbGet, rtdbMultiUpdate, assertSafeKey } from '../lib/rtdb.js';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * POST /api/cancelar-resgate
 * body: { empresaId, resgateId }
 */
export async function handleCancelarResgate(env, token, callerUid, body) {
  const { empresaId, resgateId } = body;
  if (!empresaId || !resgateId) throw httpError(400, 'Parâmetros faltando.');
  assertSafeKey(empresaId, 'empresaId');
  assertSafeKey(resgateId, 'resgateId');

  const caller = await rtdbGet(env, token, `users/${callerUid}`);
  if (!caller || caller.role !== 'empresa' || caller.empresaId !== empresaId) throw httpError(403, 'Sem acesso a esta empresa.');
  if (!caller.isOwner && !caller.permissions?.resgatarRecompensas) throw httpError(403, 'Sem permissão.');

  const pendente = await rtdbGet(env, token, `resgates/${empresaId}/${resgateId}`);
  if (!pendente) throw httpError(404, 'Pedido não encontrado.');
  if (pendente.status !== 'pendente') throw httpError(400, 'Este pedido já foi processado.');

  await rtdbMultiUpdate(env, token, {
    [`resgates/${empresaId}/${resgateId}/status`]: 'cancelado',
    [`resgates_usuario/${pendente.usuarioId}/${resgateId}/status`]: 'cancelado'
  });

  return { ok: true };
}
