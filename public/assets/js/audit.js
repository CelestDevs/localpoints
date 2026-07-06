/**
 * audit.js — Sistema de Log de Auditoria Local Points
 *
 * Registra ações críticas no Firebase em /audit_logs/{pushId}
 * Disponível globalmente via window.auditLog()
 * Reaproveitado do projeto-base (unibiotech-frota) sem mudança de lógica —
 * o formato já é genérico o suficiente para qualquer domínio.
 *
 * Estrutura de cada log:
 * {
 *   action:    string  — identificador da ação (ex: 'empresa.aprovar')
 *   actor:     { uid, name, email, role } — quem fez
 *   target:    { type, id, label } — sobre o que (empresa, usuário, plano...)
 *   details:   object  — dados relevantes da ação
 *   timestamp: number  — Date.now()
 *   datetime:  string  — legível em pt-BR
 *   sessionId: string  — identificador da sessão
 * }
 */

(function() {
  const SESSION_ID = Math.random().toString(36).slice(2, 10).toUpperCase();
  window._auditActor = null;

  // Remove undefined recursivamente — Firebase rejeita undefined em qualquer nível
  function _sanitize(obj) {
    if (obj === null || obj === undefined) return null;
    if (typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(_sanitize).filter(v => v !== null);
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) continue;
      const s = _sanitize(v);
      if (s !== null) out[k] = s;
    }
    return out;
  }

  window.auditLog = async function(action, target = {}, details = {}) {
    try {
      const actor = window._auditActor || { uid: 'unknown', name: 'Desconhecido', role: 'unknown' };
      const now   = Date.now();

      const entry = _sanitize({
        action,
        actor: {
          uid:   actor.uid   || 'unknown',
          name:  actor.name  || actor.email || 'Desconhecido',
          email: actor.email || '',
          role:  actor.role  || 'unknown',
        },
        target: {
          type:  target.type  || '',
          id:    target.id    || null,
          label: target.label || '',
        },
        details,
        timestamp: now,
        datetime:  new Date(now).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
        sessionId: SESSION_ID,
      });

      await db.ref('audit_logs').push(entry);
    } catch(e) {
      console.warn('[audit] falha ao registrar log:', e.message);
    }
  };

  window._auditSessionId = SESSION_ID;
})();
