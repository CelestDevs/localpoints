import { rtdbGet, rtdbTransaction, assertSafeKey } from '../lib/rtdb.js';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * POST /api/campeonato/inscrever
 * body: { campeonatoId }
 *
 * Única operação de Campeonatos que passa pela Worker — é a única que move
 * XP (taxa de inscrição) e tem risco real de corrida (duas pessoas
 * disputando a última vaga ao mesmo tempo). Sorteio de chaveamento e avanço
 * de vencedores são feitos direto pelo admin (ver ARQUITETURA.md — admin já
 * tem acesso total ao banco, não precisa de intermediário pra ações que só
 * ele executa, uma de cada vez).
 */
export async function handleCampeonatoInscrever(env, token, callerUid, body) {
  const { campeonatoId } = body;
  if (!campeonatoId) throw httpError(400, 'Parâmetro campeonatoId faltando.');
  assertSafeKey(campeonatoId, 'campeonatoId');

  const [usuario, campeonato] = await Promise.all([
    rtdbGet(env, token, `users/${callerUid}`),
    rtdbGet(env, token, `campeonatos/${campeonatoId}`)
  ]);
  if (!usuario || usuario.role !== 'usuario') throw httpError(403, 'Só usuários podem se inscrever.');
  if (!campeonato) throw httpError(404, 'Campeonato não encontrado.');
  if (campeonato.status !== 'inscricoes') throw httpError(400, 'Inscrições encerradas para este campeonato.');
  if (campeonato.dataInicio && Date.now() > new Date(campeonato.dataInicio).getTime()) {
    throw httpError(400, 'Prazo de inscrição encerrado.');
  }

  const participantesAtuais = campeonato.participantes || {};
  if (participantesAtuais[callerUid]) throw httpError(400, 'Você já está inscrito neste campeonato.');
  if (Object.keys(participantesAtuais).length >= campeonato.maxParticipantes) {
    throw httpError(400, 'Campeonato com vagas esgotadas.');
  }

  const taxa = campeonato.taxaInscricaoXp || 0;
  if (taxa > 0) {
    const xpResult = await rtdbTransaction(env, token, `users/${callerUid}/xp`, cur => {
      const atual = cur || 0;
      if (atual < taxa) return undefined;
      return atual - taxa;
    });
    if (xpResult.aborted) throw httpError(400, `Você precisa de ${taxa} XP para se inscrever (não tem saldo suficiente).`);
  }

  // A vaga em si também é uma transação — protege contra duas pessoas
  // disputando a última vaga ao mesmo tempo.
  const vagaResult = await rtdbTransaction(env, token, `campeonatos/${campeonatoId}/participantes`, cur => {
    const atuais = cur || {};
    if (atuais[callerUid]) return undefined;
    if (Object.keys(atuais).length >= campeonato.maxParticipantes) return undefined;
    return { ...atuais, [callerUid]: { nome: usuario.name || '', inscritoEm: Date.now() } };
  });

  if (vagaResult.aborted) {
    // não conseguiu a vaga (esgotou entre o cheque e a escrita) — devolve o XP
    if (taxa > 0) await rtdbTransaction(env, token, `users/${callerUid}/xp`, cur => (cur || 0) + taxa);
    throw httpError(400, 'Não foi possível confirmar sua vaga (esgotou). XP devolvido.');
  }

  return { ok: true, taxaPaga: taxa };
}
