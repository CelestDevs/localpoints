/**
 * sw-update.js — Gerenciamento de atualização do Service Worker
 * Reaproveitado do projeto-base sem mudança de lógica.
 *
 * Como funciona:
 * 1. Registra o SW e escuta por atualizações
 * 2. Quando novo SW instala, força ativação imediata (skipWaiting)
 * 3. Quando SW assume controle (controllerchange), recarrega a página
 * 4. Polling a cada 5min para verificar se há nova versão mesmo sem evento
 * 5. Mostra banner discreto APENAS se o reload automático falhar
 *
 * Uso: <script src="/assets/js/sw-update.js"></script>
 * (incluir em TODAS as páginas, antes do </body>)
 */

(function () {
  if (!('serviceWorker' in navigator)) return;

  // Caminho do SW relativo à raiz do site (3 portais + setup)
  const inSubfolder = ['/admin', '/empresa', '/usuario'].some(p => location.pathname.startsWith(p));
  const swPath = inSubfolder ? '../sw.js' : 'sw.js';

  let _reloading = false;

  function safeReload() {
    if (_reloading) return;
    _reloading = true;
    window.location.reload();
  }

  function showUpdateBanner() {
    if (_reloading) return;
    if (document.getElementById('_sw_update_banner')) return;

    const b = document.createElement('div');
    b.id = '_sw_update_banner';
    b.style.cssText = [
      'position:fixed', 'bottom:20px', 'left:50%', 'transform:translateX(-50%)',
      'background:#2A241C', 'color:#EFE9DE', 'padding:13px 20px',
      'border-radius:10px', 'z-index:99999',
      'display:flex', 'align-items:center', 'gap:12px',
      'box-shadow:0 4px 24px rgba(0,0,0,.6)',
      'font-size:14px', 'font-family:sans-serif',
      'white-space:nowrap', 'max-width:90vw'
    ].join(';');
    b.innerHTML = '🔄 Nova versão disponível! '
      + '<button onclick="window.location.reload()" style="'
      + 'background:#F2C265;color:#2A1B03;border:none;padding:7px 16px;'
      + 'border-radius:6px;font-weight:700;cursor:pointer;font-size:13px">'
      + 'Atualizar</button>';
    document.body?.appendChild(b);
  }

  navigator.serviceWorker.register(swPath, { updateViaCache: 'none' })
    .then(reg => {
      reg.update().catch(() => {});
      setInterval(() => reg.update().catch(() => {}), 5 * 60 * 1000);

      reg.addEventListener('updatefound', () => {
        const newSW = reg.installing;
        if (!newSW) return;

        newSW.addEventListener('statechange', () => {
          if (newSW.state === 'installed') {
            newSW.postMessage({ type: 'SKIP_WAITING' });
          }
          // NÃO recarrega em 'activated' — o reload correto é disparado
          // pelo evento 'controllerchange' abaixo.
        });
      });

      if (reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    })
    .catch(() => {});

  navigator.serviceWorker.addEventListener('controllerchange', safeReload);

  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'SW_UPDATED') {
      safeReload();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    navigator.serviceWorker.ready
      .then(reg => reg.update())
      .catch(() => {});
  });

  // Helper global: garante que não há atualização pendente antes de navegar
  // (usado por doLogout() e outras navegações programáticas).
  window.ensureSWReady = async function () {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (reg.waiting) {
        await new Promise(resolve => {
          const onChange = () => {
            navigator.serviceWorker.removeEventListener('controllerchange', onChange);
            resolve();
          };
          navigator.serviceWorker.addEventListener('controllerchange', onChange);
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          setTimeout(resolve, 1500);
        });
      }
    } catch (e) {}
  };

})();
