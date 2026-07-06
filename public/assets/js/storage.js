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
