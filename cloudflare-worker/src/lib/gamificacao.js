/**
 * gamificacao.js — Porta server-side do módulo de gamificação do client
 * (public/assets/js/gamificacao.js). Mesma lógica, mas usando os helpers REST
 * do RTDB em vez do SDK. Mantida em paralelo de propósito — ver nota em
 * ARQUITETURA.md sobre por que os dois arquivos existem.
 */
import { rtdbGet, rtdbPut, rtdbTransaction } from './rtdb.js';

const GAMIF_XP_POR_PONTO = 1;

export async function calcularNivel(env, token, xp) {
  const niveisObj = await rtdbGet(env, token, 'gamificacao/niveis');
  const niveis = Object.values(niveisObj || {});
  if (!niveis.length) return { nome: null, xpNecessario: 0, indice: 0 };
  niveis.sort((a, b) => (a.xpNecessario || 0) - (b.xpNecessario || 0));
  let indice = 0, atual = null;
  niveis.forEach((n, i) => {
    if (xp >= (n.xpNecessario || 0)) { atual = n; indice = i + 1; }
  });
  return atual ? { nome: atual.nome, xpNecessario: atual.xpNecessario, indice } : { nome: null, xpNecessario: 0, indice: 0 };
}

export async function atualizarStreak(env, token, uid, streakAtual) {
  const hoje = new Date().toISOString().slice(0, 10);
  const streak = streakAtual || { count: 0, lastActiveDate: null };
  if (streak.lastActiveDate === hoje) return streak;

  const ontem = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const novoCount = streak.lastActiveDate === ontem ? (streak.count || 0) + 1 : 1;
  const novoStreak = { count: novoCount, lastActiveDate: hoje };
  await rtdbPut(env, token, `users/${uid}/streak`, novoStreak);
  return novoStreak;
}

export async function checarConquistas(env, token, uid) {
  const [user, conquistas, unlocked] = await Promise.all([
    rtdbGet(env, token, `users/${uid}`),
    rtdbGet(env, token, 'gamificacao/conquistas'),
    rtdbGet(env, token, `gamificacao/conquistasUsuario/${uid}`)
  ]);
  const u = user || {};
  const nivelAtual = await calcularNivel(env, token, u.xp || 0);

  const valores = {
    nivel_minimo: nivelAtual.indice,
    total_pontos_minimo: u.totalPontosGanhos || 0,
    total_resgates_minimo: u.totalResgates || 0,
    streak_minimo: u.streak?.count || 0
  };

  const novas = [];
  for (const [id, c] of Object.entries(conquistas || {})) {
    if (unlocked && unlocked[id]) continue;
    const valorAtual = valores[c.criterio?.tipo];
    if (valorAtual != null && c.criterio?.valor != null && valorAtual >= c.criterio.valor) {
      await rtdbPut(env, token, `gamificacao/conquistasUsuario/${uid}/${id}`, Date.now());
      novas.push({ id, ...c });
    }
  }
  return novas;
}

/**
 * Credita XP "solto" (sem vir de um lançamento de pontos) — usado pelo bônus
 * de indicação. Atualiza nível e checa conquistas do mesmo jeito.
 */
export async function creditarXpBonus(env, token, uid, xpBonus) {
  const xpResult = await rtdbTransaction(env, token, `users/${uid}/xp`, cur => (cur || 0) + xpBonus);
  const novoXp = xpResult.value;
  const nivel = await calcularNivel(env, token, novoXp);
  if (nivel.nome) await rtdbPut(env, token, `users/${uid}/level`, nivel.nome);
  await checarConquistas(env, token, uid);
  return novoXp;
}

/**
 * Ponto de entrada único — chamado pelos handlers depois de creditar pontos
 * ou confirmar um resgate.
 */
export async function registrarAtividadeGamificacao(env, token, uid, opts = {}) {
  const { pontosGanhos = 0, resgateRealizado = false } = opts;
  const resultado = { novasConquistas: [], subiuDeNivel: false, nivelAnterior: null, nivelNovo: null };

  if (pontosGanhos > 0) {
    await rtdbTransaction(env, token, `users/${uid}/totalPontosGanhos`, cur => (cur || 0) + pontosGanhos);

    const user = (await rtdbGet(env, token, `users/${uid}`)) || {};
    resultado.nivelAnterior = user.level || null;

    await atualizarStreak(env, token, uid, user.streak);

    const xpResult = await rtdbTransaction(env, token, `users/${uid}/xp`, cur => (cur || 0) + pontosGanhos * GAMIF_XP_POR_PONTO);
    const novoXp = xpResult.value;
    const nivel = await calcularNivel(env, token, novoXp);
    if (nivel.nome) {
      await rtdbPut(env, token, `users/${uid}/level`, nivel.nome);
      resultado.nivelNovo = nivel.nome;
      resultado.subiuDeNivel = nivel.nome !== resultado.nivelAnterior;
    }
  }

  if (resgateRealizado) {
    await rtdbTransaction(env, token, `users/${uid}/totalResgates`, cur => (cur || 0) + 1);
  }

  resultado.novasConquistas = await checarConquistas(env, token, uid);
  return resultado;
}
