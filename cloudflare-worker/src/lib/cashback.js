import { rtdbTransaction, rtdbPush, rtdbPut } from './rtdb.js';

/**
 * Credita cashback ao cliente depois de uma compra com pontuação automática.
 * Guarda histórico nos dois nós (por empresa e por usuário, mesma chave) —
 * mesmo padrão de espelhamento já usado em resgates/resgates_usuario.
 *
 * @returns {Promise<number>} valor de cashback creditado (0 se não gerou nada)
 */
export async function creditarCashback(env, token, { usuarioId, usuarioNome, empresaId, empresaNome, valorCompra, percent }) {
  const valorCashback = Math.round(valorCompra * (percent / 100) * 100) / 100; // 2 casas decimais
  if (!valorCashback || valorCashback <= 0) return 0;

  await rtdbTransaction(env, token, `cashback/saldo/${usuarioId}/${empresaId}`, cur => Math.round(((cur || 0) + valorCashback) * 100) / 100);

  const histId = await rtdbPush(env, token, `cashback/historico/${empresaId}`);
  const payload = {
    usuarioId,
    usuarioNome: usuarioNome || '',
    tipo: 'credito',
    valor: valorCashback,
    motivo: 'Cashback de compra',
    createdAt: Date.now()
  };
  await rtdbPut(env, token, `cashback/historico/${empresaId}/${histId}`, payload);
  await rtdbPut(env, token, `cashback/historico_usuario/${usuarioId}/${histId}`, { ...payload, empresaId, empresaNome: empresaNome || '' });

  return valorCashback;
}
