import { rtdbGet, rtdbPush, rtdbMultiUpdate, assertSafeKey } from '../lib/rtdb.js';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * POST /api/solicitar-resgate
 * body: { empresaId, recompensaId }
 * Chamado pelo próprio usuário — não move pontos ainda, só cria o pedido
 * 'pendente' que a empresa confirma depois (via /api/resgatar modo confirmar).
 */
export async function handleSolicitarResgate(env, token, callerUid, body) {
  const { empresaId, recompensaId } = body;
  if (!empresaId || !recompensaId) throw httpError(400, 'Parâmetros faltando.');
  assertSafeKey(empresaId, 'empresaId');
  assertSafeKey(recompensaId, 'recompensaId');

  const [usuario, recompensa, saldo, empresa] = await Promise.all([
    rtdbGet(env, token, `users/${callerUid}`),
    rtdbGet(env, token, `recompensas/${empresaId}/${recompensaId}`),
    rtdbGet(env, token, `pontos/saldo/${callerUid}/${empresaId}`),
    rtdbGet(env, token, `empresas/${empresaId}`)
  ]);
  if (!usuario || usuario.role !== 'usuario') throw httpError(403, 'Só usuários podem solicitar resgate.');
  if (!empresa || empresa.status !== 'ativo') throw httpError(403, 'Esta empresa não está mais ativa.');
  if (!recompensa || recompensa.status !== 'ativo') throw httpError(400, 'Recompensa não disponível.');
  if ((saldo || 0) < recompensa.valorPontos) throw httpError(400, 'Saldo insuficiente.');

  const resgateId = await rtdbPush(env, token, `resgates/${empresaId}`);
  const payload = {
    usuarioId: callerUid,
    usuarioNome: usuario.name || '',
    recompensaId,
    recompensaNome: recompensa.nome,
    pontosGastos: recompensa.valorPontos,
    status: 'pendente',
    createdAt: Date.now()
  };
  await rtdbMultiUpdate(env, token, {
    [`resgates/${empresaId}/${resgateId}`]: payload,
    [`resgates_usuario/${callerUid}/${resgateId}`]: { ...payload, empresaId }
  });

  return { ok: true, resgateId };
}
