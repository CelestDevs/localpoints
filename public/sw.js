// ═══════════════════════════════════════════════════════════════
// SERVICE WORKER — Local Points
// Mesma estratégia do projeto-base (unibiotech-frota):
// network-first para tudo (sem cache stale) — CSS/JS ficam em cache
// mas com validação de versão via BUILD_ID na URL.
// Atualização: automática e silenciosa — sem banner, sem clique.
// ═══════════════════════════════════════════════════════════════

// ATENÇÃO: mude este valor a cada deploy para invalidar o cache
const BUILD_ID    = '060720260925';
const CACHE_NAME  = 'localpoints-v' + BUILD_ID;

// Recursos estáticos que podem ser cacheados com segurança
// (NÃO incluir HTML nem firebase-config.js aqui)
const STATIC_ASSETS = [
  '/assets/css/style.css?v=' + BUILD_ID,
  '/assets/js/firebase-config.js',
  '/manifest.json',
];

// ── INSTALL: pré-cacheia apenas assets estáticos ──────────────
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        STATIC_ASSETS.map(url =>
          fetch(url, { cache: 'no-store' })
            .then(r => r.ok ? cache.put(url, r) : null)
            .catch(() => null)
        )
      );
    })
  );
});

// ── ACTIVATE: apaga TODOS os caches antigos e toma controle ───
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => {
            console.log('[SW] Apagando cache antigo:', k);
            return caches.delete(k);
          })
      ))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => {
        clients.forEach(client =>
          client.postMessage({ type: 'SW_UPDATED', buildId: BUILD_ID })
        );
      })
  );
});

// ── FETCH: estratégia por tipo de recurso ─────────────────────
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;

  // ── Firebase / APIs externas → SEMPRE rede, zero cache ──
  if (
    url.hostname.includes('firebase') ||
    url.hostname.includes('googleapis') ||
    url.hostname.includes('gstatic') ||
    url.hostname.includes('firebaseio') ||
    url.hostname.includes('cdnjs') ||
    url.hostname.includes('unpkg') ||
    url.hostname.includes('imgbb') ||
    url.hostname.includes('ibb.co')
  ) {
    return;
  }

  // ── HTML → Network-first, fallback para cache ──
  if (
    req.mode === 'navigate' ||
    url.pathname.endsWith('.html') ||
    url.pathname === '/' ||
    url.pathname.endsWith('/admin/') ||
    url.pathname.endsWith('/empresa/') ||
    url.pathname.endsWith('/usuario/')
  ) {
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .catch(() => caches.match(req))
    );
    return;
  }

  // ── CSS / JS / imagens → Cache-first com atualização em background ──
  event.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(req).then(cached => {
        const networkFetch = fetch(req)
          .then(response => {
            if (response && response.status === 200) {
              cache.put(req, response.clone());
            }
            return response;
          })
          .catch(() => null);

        return cached || networkFetch;
      })
    )
  );
});

// ── MESSAGES: comandos vindos da página ───────────────────────
self.addEventListener('message', event => {
  if (!event.data) return;

  if (event.data === 'skipWaiting' || event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data.type === 'GET_VERSION') {
    event.source?.postMessage({ type: 'VERSION', buildId: BUILD_ID });
  }
});
