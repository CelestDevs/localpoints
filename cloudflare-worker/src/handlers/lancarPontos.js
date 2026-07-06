import { rtdbGet, rtdbPut, rtdbTransaction, rtdbPush, assertSafeKey } from '../lib/rtdb.js';
import { registrarAtividadeGamificacao } from '../lib/gamificacao.js';
import { creditarCashback } from '../lib/cashback.js';
import { processarIndicacaoSePrimeiraCompra } from '../lib/indicacao.js';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function obterMultiplicadorPromocaoAtiva(env, token, empresaId) {
  const promos = await rtdbGet(env, token, `promocoes/${empresaId}`);
  const hoje = new Date().toISOString().slice(0, 10);
  const ativa = Object.values(promos || {}).find(
    p => p.ativo && p.dataInicio <= hoje && hoje <= p.dataFim &&
      (p.tipo === 'pontos_dobro' || p.tipo === 'pontos_triplo')
  );
  if (!ativa) return { multiplicador: 1, titulo: null };
  return { multiplicador: ativa.tipo === 'pontos_triplo' ? 3 : 2, titulo: ativa.titulo };
}

/**
 * POST /api/lancar-pontos
 * body: { empresaId, clienteUid, tipo: 'manual'|'automatico', valorCompra?, pontosManual?, motivo? }
 */
export async function handleLancarPontos(env, token, callerUid, body) {
  const { empresaId, clienteUid, tipo, valorCompra, pontosManual, motivo } = body;
  if (!empresaId || !clienteUid || !tipo) throw httpError(400, 'Parâmetros obrigatórios faltando.');
  assertSafeKey(empresaId, 'empresaId');
  assertSafeKey(clienteUid, 'clienteUid');

  const caller = await rtdbGet(env, token, `users/${callerUid}`);
  if (!caller || caller.role !== 'empresa' || caller.empresaId !== empresaId) {
    throw httpError(403, 'Você não tem acesso a esta empresa.');
  }
  if (!caller.isOwner && !caller.permissions?.lancarPontos) {
    throw httpError(403, 'Sem permissão para lançar pontos.');
  }

  const empresa = await rtdbGet(env, token, `empresas/${empresaId}`);
  if (!empresa || empresa.status !== 'ativo') throw httpError(403, 'Empresa não está ativa.');

  const cliente = await rtdbGet(env, token, `users/${clienteUid}`);
  if (!cliente || cliente.role !== 'usuario') throw httpError(404, 'Cliente não encontrado.');

  let pontos, origem, valorFinal = null, promocaoTitulo = null;

  if (tipo === 'manual') {
    pontos = parseInt(pontosManual, 10);
    origem = 'manual';
    if (!pontos || pontos <= 0) throw httpError(400, 'Quantidade de pontos inválida.');
  } else {
    const rules = empresa.loyaltyRules || { pointsPerCurrency: 1, minValue: 0 };
    const valor = parseFloat(valorCompra) || 0;
    if (valor < (rules.minValue || 0)) throw httpError(400, `Valor mínimo para pontuar é ${rules.minValue}.`);

    const { multiplicador, titulo } = await obterMultiplicadorPromocaoAtiva(env, token, empresaId);
    pontos = Math.floor(valor * (rules.pointsPerCurrency || 0) * multiplicador);
    origem = multiplicador > 1 ? 'promocao' : 'automatico';
    valorFinal = valor;
    if (multiplicador > 1) promocaoTitulo = titulo;
    if (pontos <= 0) throw httpError(400, 'O valor informado não gera pontos com as regras atuais.');
  }

  // Credita o saldo — seguro contra dois lançamentos simultâneos pro mesmo cliente
  await rtdbTransaction(env, token, `pontos/saldo/${clienteUid}/${empresaId}`, cur => (cur || 0) + pontos);

  const lancId = await rtdbPush(env, token, `pontos/lancamentos/${empresaId}`);
  await rtdbPut(env, token, `pontos/lancamentos/${empresaId}/${lancId}`, {
    usuarioId: clienteUid,
    usuarioNome: cliente.name || '',
    tipo: 'credito',
    quantidade: pontos,
    motivo: motivo || '',
    origem,
    valorCompra: valorFinal,
    funcionarioId: callerUid,
    createdAt: Date.now()
  });

  const gamif = await registrarAtividadeGamificacao(env, token, clienteUid, { pontosGanhos: pontos });

  // Cashback — só em lançamentos com valor de compra real (não em manual)
  let cashbackCreditado = 0;
  if (valorFinal && empresa.cashback?.enabled && empresa.cashback?.percent > 0) {
    cashbackCreditado = await creditarCashback(env, token, {
      usuarioId: clienteUid, usuarioNome: cliente.name, empresaId, empresaNome: empresa.name,
      valorCompra: valorFinal, percent: empresa.cashback.percent
    });
  }

  // Bônus de indicação — só dispara na primeira compra do cliente, em qualquer empresa
  const indicacao = await processarIndicacaoSePrimeiraCompra(env, token, cliente, clienteUid);

  return { pontos, origem, promocaoTitulo, lancamentoId: lancId, cashbackCreditado, indicacaoConfirmada: !!indicacao, ...gamif };
}
