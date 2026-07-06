/**
 * storage.js — Upload de imagens via IMGDB (api.imgbb.com)
 *
 * A chave de API NUNCA fica hardcoded no código: ela é lida do RTDB em
 * /settings/integrations/imgdbApiKey, um nó legível apenas por admin e
 * empresa (ver database.rules.json). Usuário final não tem acesso a essa
 * leitura, então nunca vê a chave.
 *
 * Uso:
 *   const url = await uploadImage(fileInputElement.files[0]);
 *   // url = link direto da imagem hospedada, pronto para salvar no RTDB
 *
 * Nota: se "IMGDB" no seu projeto se referir a um serviço diferente do
 * ImgBB (api.imgbb.com), só é preciso trocar a URL/formato do fetch abaixo —
 * o resto (onde a chave fica guardada, quem pode lê-la) continua igual.
 */

(function () {
  let _cachedKey = null;

  async function getImgdbKey() {
    if (_cachedKey) return _cachedKey;
    const snap = await db.ref('settings/integrations/imgdbApiKey').once('value');
    const key = snap.val();
    if (!key) throw new Error('Chave do IMGDB não configurada. Peça ao administrador para configurá-la em Configurações.');
    _cachedKey = key;
    return key;
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]); // remove "data:image/...;base64,"
      reader.onerror = () => reject(new Error('Falha ao ler o arquivo de imagem.'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Faz upload de um arquivo de imagem (File/Blob) e retorna a URL pública.
   * @param {File} file
   * @param {number} maxSizeMB - limite de tamanho antes de enviar (padrão 5MB)
   * @returns {Promise<string>} URL direta da imagem hospedada
   */
  window.uploadImage = async function (file, maxSizeMB = 5) {
    if (!file) throw new Error('Nenhum arquivo selecionado.');
    if (!file.type.startsWith('image/')) throw new Error('O arquivo precisa ser uma imagem.');
    if (file.size > maxSizeMB * 1024 * 1024) {
      throw new Error(`Imagem muito grande (máx. ${maxSizeMB}MB).`);
    }

    const key    = await getImgdbKey();
    const base64 = await fileToBase64(file);

    const form = new FormData();
    form.append('key', key);
    form.append('image', base64);

    const res = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: form });
    const data = await res.json();

    if (!data.success) {
      const msg = data?.error?.message || 'Falha no upload da imagem.';
      throw new Error(msg);
    }

    return data.data.display_url || data.data.url;
  };
})();

/**
 * Componente de upload com preview — usado em todo lugar que sobe imagem
 * (logo/banner de empresa, banner de temporada/campeonato, imagem de
 * recompensa). Precisa de 5 elementos com essa convenção de id:
 *   {baseId}-box, {baseId}-file, {baseId}-preview,
 *   {baseId}-placeholder, {baseId}-filename, {baseId}-remove
 *
 * setImageUploadPreview(baseId, urlExistente) → chama ao abrir o
 *   formulário (edição), com a URL já salva (ou null se for criação nova).
 * handleImagePreview(baseId) → conectado ao onchange do <input type=file>.
 * clearImageUpload(baseId) → conectado ao botão de remover; desfaz a seleção
 *   nova e volta a mostrar a imagem existente (se houver).
 */
function applyImagePreview(baseId, url) {
  const preview = document.getElementById(baseId + '-preview');
  const placeholder = document.getElementById(baseId + '-placeholder');
  const box = document.getElementById(baseId + '-box');
  if (url) {
    preview.src = url;
    preview.classList.add('show');
    placeholder.style.display = 'none';
    box.classList.add('has-image');
  } else {
    preview.classList.remove('show');
    preview.src = '';
    placeholder.style.display = 'flex';
    box.classList.remove('has-image');
  }
}

function setImageUploadPreview(baseId, url) {
  const box = document.getElementById(baseId + '-box');
  box.dataset.existingUrl = url || '';
  applyImagePreview(baseId, url || '');
  document.getElementById(baseId + '-filename').textContent = '';
  document.getElementById(baseId + '-remove').classList.add('hidden');
  document.getElementById(baseId + '-file').value = '';
}

function handleImagePreview(baseId) {
  const fileInput = document.getElementById(baseId + '-file');
  const file = fileInput.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('Selecione um arquivo de imagem.', 'error');
    fileInput.value = '';
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast('Imagem muito grande (máx. 5MB).', 'error');
    fileInput.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    applyImagePreview(baseId, e.target.result);
    document.getElementById(baseId + '-filename').textContent = file.name;
    document.getElementById(baseId + '-remove').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

function clearImageUpload(baseId) {
  document.getElementById(baseId + '-file').value = '';
  document.getElementById(baseId + '-filename').textContent = '';
  document.getElementById(baseId + '-remove').classList.add('hidden');
  const existing = document.getElementById(baseId + '-box').dataset.existingUrl || '';
  applyImagePreview(baseId, existing);
}
