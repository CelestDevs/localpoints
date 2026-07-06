import { rtdbGet, rtdbTransaction, rtdbPush, rtdbPut, assertSafeKey } from '../lib/rtdb.js';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * POST /api/usar-cashback
 * body: { empresaId, clienteUid, valor }
 * A empresa aplica o desconto no balcão — deduz do saldo de cashback do
 * cliente NESSA empresa (cashback não é compartilhado entre empresas).
 */
export async function handleUsarCashback(env, token, callerUid, body) {
  const { empresaId, clienteUid, valor } = body;
  if (!empresaId || !clienteUid) throw httpError(400, 'Parâmetros obrigatórios faltando.');
  assertSafeKey(empresaId, 'empresaId');
  assertSafeKey(clienteUid, 'clienteUid');

  const valorUso = Math.round(parseFloat(valor) * 100) / 100;
  if (!valorUso || valorUso <= 0) throw httpError(400, 'Informe um valor válido.');

  const caller = await rtdbGet(env, token, `users/${callerUid}`);
  if (!caller || caller.role !== 'empresa' || caller.empresaId !== empresaId) throw httpError(403, 'Sem acesso a esta empresa.');
  if (!caller.isOwner && !caller.permissions?.lancarPontos) throw httpError(403, 'Sem permissão.');

  const empresa = await rtdbGet(env, token, `empresas/${empresaId}`);
  if (!empresa || empresa.status !== 'ativo') throw httpError(403, 'Empresa não está ativa.');

  const cliente = await rtdbGet(env, token, `users/${clienteUid}`);
  if (!cliente || cliente.role !== 'usuario') throw httpError(404, 'Cliente não encontrado.');

  const result = await rtdbTransaction(env, token, `cashback/saldo/${clienteUid}/${empresaId}`, cur => {
    const atual = cur || 0;
    if (atual < valorUso) return undefined; // aborta
    return Math.round((atual - valorUso) * 100) / 100;
  });
  if (result.aborted) throw httpError(400, 'Saldo de cashback insuficiente.');

  const histId = await rtdbPush(env, token, `cashback/historico/${empresaId}`);
  const payload = {
    usuarioId: clienteUid,
    usuarioNome: cliente.name || '',
    tipo: 'uso',
    valor: valorUso,
    motivo: 'Usado no balcão',
    funcionarioId: callerUid,
    createdAt: Date.now()
  };
  await rtdbPut(env, token, `cashback/historico/${empresaId}/${histId}`, payload);
  await rtdbPut(env, token, `cashback/historico_usuario/${clienteUid}/${histId}`, { ...payload, empresaId });

  return { ok: true, novoSaldo: result.value };
}
