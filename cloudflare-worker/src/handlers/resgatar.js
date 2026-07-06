import { rtdbGet, rtdbTransaction, rtdbPush, rtdbPut, rtdbMultiUpdate, assertSafeKey } from '../lib/rtdb.js';
import { registrarAtividadeGamificacao } from '../lib/gamificacao.js';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function gerarCodigoCupom() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sem caracteres ambíguos (0/O, 1/I)
  let out = '';
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

/**
 * POST /api/resgatar
 * body:
 *   modo 'balcao'    → { empresaId, modo: 'balcao', clienteUid, recompensaId }
 *   modo 'confirmar' → { empresaId, modo: 'confirmar', resgateId }
 *
 * Os dois caminhos terminam no mesmo lugar: debita saldo, debita estoque,
 * grava o resgate como 'entregue' em /resgates e /resgates_usuario (escrita
 * multi-path atômica), roda a gamificação.
 */
export async function handleResgatar(env, token, callerUid, body) {
  const { empresaId, modo, recompensaId, clienteUid, resgateId } = body;
  if (!empresaId || !modo) throw httpError(400, 'Parâmetros obrigatórios faltando.');
  assertSafeKey(empresaId, 'empresaId');
  if (recompensaId) assertSafeKey(recompensaId, 'recompensaId');
  if (clienteUid) assertSafeKey(clienteUid, 'clienteUid');
  if (resgateId) assertSafeKey(resgateId, 'resgateId');

  const caller = await rtdbGet(env, token, `users/${callerUid}`);
  if (!caller || caller.role !== 'empresa' || caller.empresaId !== empresaId) throw httpError(403, 'Sem acesso a esta empresa.');
  if (!caller.isOwner && !caller.permissions?.resgatarRecompensas) throw httpError(403, 'Sem permissão para resgatar.');

  const empresa = await rtdbGet(env, token, `empresas/${empresaId}`);
  if (!empresa || empresa.status !== 'ativo') throw httpError(403, 'Empresa não está ativa.');

  let usuarioId, recId, finalResgateId, createdAtOriginal;

  if (modo === 'confirmar') {
    if (!resgateId) throw httpError(400, 'resgateId é obrigatório no modo confirmar.');
    const pendente = await rtdbGet(env, token, `resgates/${empresaId}/${resgateId}`);
    if (!pendente) throw httpError(404, 'Pedido não encontrado.');
    if (pendente.status !== 'pendente') throw httpError(400, 'Este pedido já foi processado.');
    usuarioId = pendente.usuarioId;
    recId = pendente.recompensaId;
    finalResgateId = resgateId;
    createdAtOriginal = pendente.createdAt;
  } else if (modo === 'balcao') {
    if (!clienteUid || !recompensaId) throw httpError(400, 'clienteUid e recompensaId são obrigatórios no modo balcão.');
    usuarioId = clienteUid;
    recId = recompensaId;
    finalResgateId = await rtdbPush(env, token, `resgates/${empresaId}`);
    createdAtOriginal = Date.now();
  } else {
    throw httpError(400, 'modo inválido — use "balcao" ou "confirmar".');
  }

  const [recompensa, usuario] = await Promise.all([
    rtdbGet(env, token, `recompensas/${empresaId}/${recId}`),
    rtdbGet(env, token, `users/${usuarioId}`)
  ]);
  if (!recompensa || recompensa.status !== 'ativo') throw httpError(400, 'Recompensa não disponível.');

  // 1. Debita o saldo — aborta se insuficiente (seguro contra corrida)
  const saldoResult = await rtdbTransaction(env, token, `pontos/saldo/${usuarioId}/${empresaId}`, cur => {
    const atual = cur || 0;
    if (atual < recompensa.valorPontos) return undefined;
    return atual - recompensa.valorPontos;
  });
  if (saldoResult.aborted) throw httpError(400, 'Saldo insuficiente para este resgate.');

  // 2. Debita o estoque — se esgotado, devolve os pontos já debitados
  const stockResult = await rtdbTransaction(
    env, token, `recompensas/${empresaId}/${recId}/quantidadeDisponivel`,
    cur => {
      const atual = cur || 0;
      if (atual <= 0) return undefined;
      return atual - 1;
    }
  );
  if (stockResult.aborted) {
    await rtdbTransaction(env, token, `pontos/saldo/${usuarioId}/${empresaId}`, cur => (cur || 0) + recompensa.valorPontos);
    throw httpError(400, 'Recompensa esgotada. Os pontos foram devolvidos.');
  }

  // 3. Grava o resgate nos dois nós numa escrita atômica só
  const payload = {
    usuarioId,
    usuarioNome: usuario?.name || '',
    recompensaId: recId,
    recompensaNome: recompensa.nome,
    pontosGastos: recompensa.valorPontos,
    status: 'entregue',
    createdAt: createdAtOriginal,
    entregueAt: Date.now(),
    entreguePor: callerUid
  };
  await rtdbMultiUpdate(env, token, {
    [`resgates/${empresaId}/${finalResgateId}`]: payload,
    [`resgates_usuario/${usuarioId}/${finalResgateId}`]: { ...payload, empresaId }
  });

  // Recompensas do tipo "desconto" geram um cupom com código — o cliente
  // mostra na loja depois pra aplicar. Produtos/brindes/serviços são
  // entregues na hora do resgate, não precisam de cupom.
  let cupom = null;
  if (recompensa.tipo === 'desconto') {
    const cupomId = await rtdbPush(env, token, `cupons/${usuarioId}`);
    cupom = {
      empresaId, recompensaId: recId, recompensaNome: recompensa.nome,
      codigo: gerarCodigoCupom(), status: 'disponivel', createdAt: Date.now()
    };
    await rtdbPut(env, token, `cupons/${usuarioId}/${cupomId}`, cupom);
  }

  const gamif = await registrarAtividadeGamificacao(env, token, usuarioId, { resgateRealizado: true });

  return { ok: true, resgateId: finalResgateId, cupom, ...gamif };
}
