// ─── Firebase Config — Local Points ───
const firebaseConfig = {
  apiKey: "AIzaSyDsRXmCuKEfwb0V1vy1RnxVZwDzsLSC0ZM",
  authDomain: "localpoints-celestdevs.firebaseapp.com",
  databaseURL: "https://localpoints-celestdevs-default-rtdb.firebaseio.com",
  projectId: "localpoints-celestdevs",
  storageBucket: "localpoints-celestdevs.firebasestorage.app",
  messagingSenderId: "257426756081",
  appId: "1:257426756081:web:37e2cf4ea24644875ef450",
  measurementId: "G-VQHDKVCCYB"
};

// Inicializa uma única vez
if (!firebase.apps || !firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db   = firebase.database();

// ─── Cria usuário via REST (não desloga quem está logado) ───
// Usado pelo admin ao cadastrar empresas, pela empresa ao cadastrar funcionários,
// e pelo próprio usuário ao se registrar.
// Retorna { uid, idToken } — o idToken serve só para desfazer a criação
// (deleteFirebaseUser) se os writes seguintes no RTDB falharem, evitando
// contas "órfãs" (existem no Auth, sem perfil, e não dá pra recriar nem logar).
async function createFirebaseUser(email, password) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseConfig.apiKey}`;
  const res  = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const data = await res.json();
  if (data.error) {
    const map = {
      'EMAIL_EXISTS'  : 'Este e-mail já está cadastrado.',
      'INVALID_EMAIL' : 'E-mail inválido.',
      'WEAK_PASSWORD' : 'Senha deve ter no mínimo 6 caracteres.'
    };
    const key = Object.keys(map).find(k => (data.error.message || '').includes(k));
    throw new Error(key ? map[key] : data.error.message);
  }
  return { uid: data.localId, idToken: data.idToken };
}

// ─── Desfaz a criação de uma conta (rollback de melhor esforço) ───
async function deleteFirebaseUser(idToken) {
  try {
    await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${firebaseConfig.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken })
    });
  } catch (e) { /* melhor esforço — se falhar, é preciso apagar manualmente no console do Firebase Auth */ }
}

// ─── Helpers de formatação ───
function formatDateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}
function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}
function formatCurrency(v) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
}
function formatPoints(v) {
  return new Intl.NumberFormat('pt-BR').format(Math.trunc(v || 0)) + ' pts';
}

// ─── Sanitização HTML — previne XSS em campos de texto livre ───
// Usar sempre que dados do banco forem inseridos em innerHTML
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Código único (identificação do usuário — carteira / QR / busca manual) ───
// 8 caracteres, sem caracteres ambíguos (0/O, 1/I/l)
function generateUniqueCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// ─── Normalização de telefone (índice /telefones) ───
function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

const STATUS_LABELS = {
  ativo:     'Ativo',
  pendente:  'Pendente',
  suspenso:  'Suspenso',
  cancelado: 'Cancelado',
  bloqueado: 'Bloqueado'
};

// ─── Tema personalizado (cor primária/secundária de Admin → Configurações) ───
// Roda em toda página, mesmo antes do login — /settings/public é público de
// propósito, exatamente pra isso funcionar na tela de login também.
function hexToRgba(hex, alpha) {
  const clean = (hex || '').replace('#', '');
  if (clean.length !== 6) return null;
  const bigint = parseInt(clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

(function aplicarTemaPersonalizado() {
  db.ref('settings/public').once('value').then(snap => {
    const s = snap.val();
    if (!s) return;
    const root = document.documentElement;
    if (s.primaryColor) {
      root.style.setProperty('--gold', s.primaryColor);
      const dim = hexToRgba(s.primaryColor, 0.14);
      const glow = hexToRgba(s.primaryColor, 0.7);
      const soft = hexToRgba(s.primaryColor, 0.10);
      if (dim) root.style.setProperty('--gold-dim', dim);
      if (glow) root.style.setProperty('--gold-glow', glow);
      if (soft) root.style.setProperty('--gold-soft', soft);
    }
    if (s.secondaryColor) {
      root.style.setProperty('--teal', s.secondaryColor);
      const dim = hexToRgba(s.secondaryColor, 0.14);
      const border = hexToRgba(s.secondaryColor, 0.3);
      if (dim) root.style.setProperty('--teal-dim', dim);
      if (border) root.style.setProperty('--teal-border', border);
    }
  }).catch(() => { /* silencioso — mantém as cores padrão se falhar */ });
})();
