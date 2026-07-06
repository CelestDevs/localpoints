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
async function createFirebaseUser(email, password) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseConfig.apiKey}`;
  const res  = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: false })
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
  return data.localId;
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
