import { checarConquistas } from '../lib/gamificacao.js';

/**
 * POST /api/verificar-conquistas
 * body: {} (nenhum parâmetro — só verifica as conquistas do próprio chamador)
 *
 * Sem isso, uma conquista só é checada no momento de um evento novo (ganhar
 * pontos, confirmar resgate) — se o admin cria uma conquista nova, ou o
 * usuário já cumpria o critério antes dela existir, ela nunca desbloqueia
 * sozinha. Esta rota permite ao próprio usuário disparar a checagem contra
 * os próprios contadores já salvos, sempre que abre a tela de Conquistas.
 *
 * Seguro por construção: só lê/escreve as conquistas do PRÓPRIO chamador
 * (callerUid vem do token verificado, nunca do body) — não dá pra checar ou
 * desbloquear conquista de outra pessoa por aqui.
 */
export async function handleVerificarConquistas(env, token, callerUid) {
  const novasConquistas = await checarConquistas(env, token, callerUid);
  return { ok: true, novasConquistas };
}
