import { 
  analyzeLabelImage, hasApiKey, saveApiKey, 
  fetchAvailableModels, getSavedModel, setSavedModel, autoSelectBestModel 
} from './services/gemini.js';
import { renderSettingsView } from './views/settings.js';
import { renderLogEditorModal } from './views/logEditor.js';
import { renderLogDetailModal } from './views/logDetail.js';
import { renderLogListView } from './views/logList.js';
import { saveLog, deleteLog, getLogById } from './store/db.js';
import { extractPhotoDate, compressImage } from './utils/image.js';

// テーマ適用と保存
export function setTheme(themeName) {
  if (!themeName) return;
  document.documentElement.setAttribute('data-theme', themeName);
  localStorage.setItem('sella_theme', themeName);

  const themeSelect = document.getElementById('theme-select');
  if (themeSelect && themeSelect.value !== themeName) {
    themeSelect.value = themeName;
  }
}

function initTheme() {
  const savedTheme = localStorage.getItem('sella_theme') || 'dark';
  setTheme(savedTheme);
}
initTheme();

// 設定画面のモデルドロップダウンを非同期更新
export async function updateModelDropdown() {
  const selectEl = document.getElementById('select-gemini-model');
  if (!selectEl) return;

  selectEl.innerHTML = '<option value="">モデルを取得中...</option>';
  const models = await fetchAvailableModels();

  if (models.length === 0) {
    selectEl.innerHTML = '<option value="">有効なAPIキーを設定してください</option>';
    return;
  }

  const currentSaved = getSavedModel() || autoSelectBestModel(models);

  selectEl.innerHTML = models.map(m => {
    const isSelected = (m.name === currentSaved) ? 'selected' : '';
    return `<option value="${m.name}" ${isSelected}>${m.displayName || m.name}</option>`;
  }).join('');

  setSavedModel(selectEl.value);
}

// 画面ビューの対応表
const views = {
  dashboard: renderLogListView,
  loglist: renderLogListView,
  'log-list': renderLogListView,
  logs: renderLogListView,
  settings: renderSettingsView,
  setting: renderSettingsView
};

export async function navigateTo(viewName) {
  const appContainer = document.getElementById('app');
  if (!appContainer) return;

  const key = viewName ? viewName.toLowerCase() : 'dashboard';
  const renderView = views[key] || views.dashboard;

  try {
    const content = await renderView();
    appContainer.innerHTML = content;

    if (key === 'settings' || key === 'setting') {
      const themeSelect = document.getElementById('theme-select');
      if (themeSelect) {
        themeSelect.value = localStorage.getItem('sella_theme') || 'dark';
      }
      updateModelDropdown();
    }
  } catch (err) {
    console.error('View Render Error:', err);
  }

  document.querySelectorAll('[data-view]').forEach(btn => {
    const btnView = btn.dataset.view ? btn.dataset.view.toLowerCase() : '';
    btn.classList.toggle('active', btnView === key || btn.dataset.view === viewName);
  });

  closeSidebar();
}

let uploadedImages = []; 
let activeThumbnailIndex = 0;
let backupFormData = {};
let currentEditingLogId = null;

const TRACKED_FIELDS = [
  'sake-category',
  'sake-name',
  'sake-product',
  'sake-brewery',
  'sake-region',
  'sake-type',
  'sake-abv',
  'sake-notes',
  'sake-ai-info'
];

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// 動的ライトボックス表示用ヘルパー関数
function openLightbox(imageSrc) {
  let lightbox = document.getElementById('lightbox-modal');
  if (!lightbox) {
    lightbox = document.createElement('div');
    lightbox.id = 'lightbox-modal';
    lightbox.className = 'lightbox-overlay';
    lightbox.innerHTML = `
      <div class="lightbox-content">
        <button type="button" class="lightbox-close">&times;</button>
        <img id="lightbox-img" src="" alt="拡大画像" />
      </div>
    `;
    document.body.appendChild(lightbox);
  }
  const img = lightbox.querySelector('#lightbox-img');
  if (img) img.src = imageSrc;
  lightbox.classList.add('active');
}

function closeLightbox() {
  const lightbox = document.getElementById('lightbox-modal');
  if (lightbox) {
    lightbox.classList.remove('active');
  }
}

// 詳細カードを表示するモーダル
async function openDetailModal(logId) {
  closeDetailModal();
  const detailHTML = await renderLogDetailModal(logId);
  if (detailHTML) {
    document.body.insertAdjacentHTML('beforeend', detailHTML);
  }
}

function closeDetailModal() {
  const modal = document.getElementById('detail-modal-overlay');
  if (modal) modal.remove();
}

// 編集モーダルを開く
async function openEditorModal(logId = null) {
  closeEditorModal();
  closeDetailModal();
  
  // モーダルオープン時に配列・状態を確実に初期化
  uploadedImages = [];
  activeThumbnailIndex = 0;
  backupFormData = {};
  currentEditingLogId = logId;

  const modalHTML = await renderLogEditorModal();
  document.body.insertAdjacentHTML('beforeend', modalHTML);

  if (logId) {
    const log = await getLogById(logId);
    if (log) {
      const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val || '';
      };

      setVal('sake-category', log.category || '日本酒');
      setVal('sake-name', log.name);
      setVal('sake-product', log.productName);
      setVal('sake-brewery', log.brewery);
      setVal('sake-region', log.region);
      setVal('sake-type', log.type);
      setVal('sake-abv', log.abv);
      setVal('sake-date', log.date);
      setVal('sake-rating', log.rating || '4');
      setVal('sake-tags', (log.tags || []).join(' '));
      setVal('sake-notes', log.notes);
      setVal('sake-ai-info', log.aiInfo);

      if (log.images && log.images.length > 0) {
        for (const blob of log.images) {
          try {
            const base64 = await blobToBase64(blob);
            uploadedImages.push({
              blob,
              base64,
              mimeType: blob.type || 'image/jpeg',
              previewUrl: URL.createObjectURL(blob)
            });
          } catch (e) {
            console.error('Base64変換エラー:', e);
          }
        }
        renderImagePreviewList();
      }
    }
  }
}

function closeEditorModal() {
  const modal = document.getElementById('modal-overlay');
  if (modal) modal.remove();
  uploadedImages = [];
  activeThumbnailIndex = 0;
  backupFormData = {};
  currentEditingLogId = null;
}

const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('drawer-overlay');

function openSidebar() {
  sidebar?.classList.add('open');
  overlay?.classList.add('active');
}

function closeSidebar() {
  sidebar?.classList.remove('open');
  overlay?.classList.remove('active');
}

function renderImagePreviewList() {
  const container = document.getElementById('image-preview-list');
  const btnAnalyze = document.getElementById('btn-analyze');
  const uploadZone = document.getElementById('upload-zone');

  if (!container) return;

  if (uploadedImages.length === 0) {
    container.innerHTML = '';
    if (uploadZone) uploadZone.style.display = 'block';
    if (btnAnalyze) btnAnalyze.style.display = 'none';
    return;
  }

  if (uploadZone) uploadZone.style.display = 'none';

  if (btnAnalyze) {
    btnAnalyze.style.display = (hasApiKey() && uploadedImages.length > 0) ? 'inline-flex' : 'none';
  }

  const itemsHTML = uploadedImages.map((img, idx) => `
    <div class="preview-item ${idx === activeThumbnailIndex ? 'is-thumb' : ''}">
      <img src="${img.previewUrl}" alt="Preview" />
      <div class="preview-actions">
        <button type="button" class="btn-thumb-set" data-idx="${idx}">${idx === activeThumbnailIndex ? '★メイン' : '☆選択'}</button>
        <button type="button" class="btn-img-move" data-idx="${idx}" data-dir="-1" ${idx === 0 ? 'disabled' : ''}>◄</button>
        <button type="button" class="btn-img-move" data-idx="${idx}" data-dir="1" ${idx === uploadedImages.length - 1 ? 'disabled' : ''}>►</button>
        <button type="button" class="btn-img-del" data-idx="${idx}">✕</button>
      </div>
    </div>
  `).join('');

  const addMoreHTML = `
    <div class="preview-item add-more-item" id="btn-trigger-upload">
      <div class="add-more-content">
        <span class="add-icon">＋</span>
        <span class="add-text">追加</span>
      </div>
    </div>
  `;

  container.innerHTML = itemsHTML + addMoreHTML;
}

function saveCurrentFormBackup() {
  TRACKED_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      backupFormData[id] = el.value || '';
    }
  });
}

function updateFieldRevertUI() {
  TRACKED_FIELDS.forEach(id => {
    const inputEl = document.getElementById(id);
    if (!inputEl) return;

    const origVal = backupFormData[id] ?? '';
    const currentVal = inputEl.value || '';
    const groupEl = inputEl.closest('.form-group');
    let revertBtn = groupEl?.querySelector('.btn-revert-field');

    if (currentVal !== origVal) {
      inputEl.classList.add('ai-preview-active');
      const displayLabel = origVal ? `"${origVal}"` : '未入力';

      if (!revertBtn) {
        revertBtn = document.createElement('button');
        revertBtn.type = 'button';
        revertBtn.className = 'btn-revert-field';
        revertBtn.dataset.fieldId = id;
        
        const labelEl = groupEl.querySelector('label');
        if (labelEl) {
          labelEl.appendChild(revertBtn);
        }
      }
      revertBtn.innerHTML = `↩️ 元に戻す (${displayLabel})`;
      revertBtn.style.display = 'inline-block';
    } else {
      inputEl.classList.remove('ai-preview-active');
      if (revertBtn) {
        revertBtn.style.display = 'none';
      }
    }
  });
}

async function handleImageFiles(files) {
  if (!files || files.length === 0) return;

  const analyzingStatus = document.getElementById('analyzing-status');
  if (analyzingStatus) analyzingStatus.style.display = 'flex';

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file.type.startsWith('image/')) continue;

    if (i === 0 && uploadedImages.length === 0) {
      const extractedDate = extractPhotoDate(file);
      if (extractedDate) {
        const dateInput = document.getElementById('sake-date');
        if (dateInput) dateInput.value = extractedDate;
      }
    }

    const compressed = await compressImage(file);
    const previewUrl = URL.createObjectURL(compressed.blob);

    uploadedImages.push({
      blob: compressed.blob,
      base64: compressed.base64,
      mimeType: compressed.mimeType,
      previewUrl
    });
  }

  if (analyzingStatus) analyzingStatus.style.display = 'none';
  renderImagePreviewList();

  if (hasApiKey() && uploadedImages.length === files.length) {
    runAIAnalysis(uploadedImages[activeThumbnailIndex]);
  }
}

async function runAIAnalysis(targetImg) {
  if (!targetImg || !hasApiKey()) return;

  saveCurrentFormBackup();

  const analyzingStatus = document.getElementById('analyzing-status');
  if (analyzingStatus) analyzingStatus.style.display = 'flex';

  const result = await analyzeLabelImage(targetImg.base64, targetImg.mimeType);
  if (analyzingStatus) analyzingStatus.style.display = 'none';

  if (result) {
    const fieldMapping = {
      'sake-category': result.category,
      'sake-name': result.name,
      'sake-product': result.productName,
      'sake-brewery': result.brewery,
      'sake-region': result.region,
      'sake-type': result.type,
      'sake-abv': result.abv,
      'sake-ai-info': result.aiInfo
    };

    Object.keys(fieldMapping).forEach(id => {
      const val = fieldMapping[id];
      const el = document.getElementById(id);
      if (el && val !== undefined && val !== null && val !== '') {
        el.value = val;
      }
    });

    updateFieldRevertUI();
  }
}

function initApp() {
  document.addEventListener('click', async (e) => {
    // APIキー保存
    if (e.target && e.target.id === 'btn-save-api-key') {
      const keyInput = document.getElementById('gemini-api-key');
      if (keyInput) {
        const val = keyInput.value.trim();
        saveApiKey(val);
        const msg = document.getElementById('api-key-msg');
        if (msg) {
          msg.style.display = 'block';
          setTimeout(() => { msg.style.display = 'none'; }, 3000);
        }
        updateModelDropdown();
      }
      return;
    }

    // モデル再取得
    if (e.target && e.target.id === 'btn-reload-models') {
      updateModelDropdown();
      return;
    }

    // 行タップで閲覧専用詳細カードを開く
    const rowItem = e.target.closest('[data-action="open-detail"]');
    if (rowItem) {
      const id = rowItem.dataset.id;
      await openDetailModal(id);
      return;
    }

    // 詳細カードを閉じる
    if (e.target.id === 'btn-close-detail' || e.target.id === 'btn-close-detail-footer' || e.target.id === 'detail-modal-overlay') {
      closeDetailModal();
      return;
    }

    // 詳細カードから編集画面を開く
    if (e.target.id === 'btn-edit-from-detail') {
      const id = e.target.dataset.id;
      await openEditorModal(id);
      return;
    }

    // 詳細カードから削除
    if (e.target.id === 'btn-delete-from-detail') {
      const id = e.target.dataset.id;
      if (confirm('この酒ログを削除してもよろしいですか？')) {
        await deleteLog(id);
        closeDetailModal();
        navigateTo('logList');
      }
      return;
    }

    // 新規登録ボタン
    if (e.target.closest('#fab-add') || e.target.closest('[data-action="open-editor"]')) {
      e.preventDefault();
      await openEditorModal();
      return;
    }

    // ナビゲーション切り替え
    const targetBtn = e.target.closest('[data-view]');
    if (targetBtn) {
      e.preventDefault();
      const viewName = targetBtn.dataset.view;
      if (viewName === 'logEditor') {
        await openEditorModal();
      } else {
        navigateTo(viewName);
      }
      return;
    }

    // 編集モーダルを閉じる
    if (e.target.id === 'btn-close-modal' || e.target.id === 'btn-cancel-modal' || e.target.id === 'modal-overlay') {
      closeEditorModal();
      return;
    }

    // AI解析実行
    if (e.target.id === 'btn-analyze') {
      runAIAnalysis(uploadedImages[activeThumbnailIndex]);
      return;
    }

    // 項目リセット
    const revertBtn = e.target.closest('.btn-revert-field');
    if (revertBtn) {
      const fieldId = revertBtn.dataset.fieldId;
      const inputEl = document.getElementById(fieldId);
      if (inputEl && backupFormData[fieldId] !== undefined) {
        inputEl.value = backupFormData[fieldId];
        updateFieldRevertUI();
      }
      return;
    }

    // 画像サムネイル指定
    const thumbBtn = e.target.closest('.btn-thumb-set');
    if (thumbBtn) {
      activeThumbnailIndex = Number(thumbBtn.dataset.idx);
      renderImagePreviewList();
      return;
    }

    // 画像並び替え
    const moveBtn = e.target.closest('.btn-img-move');
    if (moveBtn) {
      const idx = Number(moveBtn.dataset.idx);
      const dir = Number(moveBtn.dataset.dir);
      const targetIdx = idx + dir;
      if (targetIdx >= 0 && targetIdx < uploadedImages.length) {
        const temp = uploadedImages[idx];
        uploadedImages[idx] = uploadedImages[targetIdx];
        uploadedImages[targetIdx] = temp;
        if (activeThumbnailIndex === idx) activeThumbnailIndex = targetIdx;
        else if (activeThumbnailIndex === targetIdx) activeThumbnailIndex = idx;
        renderImagePreviewList();
      }
      return;
    }

    // 画像削除
    const delImgBtn = e.target.closest('.btn-img-del');
    if (delImgBtn) {
      const idx = Number(delImgBtn.dataset.idx);
      uploadedImages.splice(idx, 1);
      if (activeThumbnailIndex >= uploadedImages.length) {
        activeThumbnailIndex = Math.max(0, uploadedImages.length - 1);
      }
      renderImagePreviewList();
      return;
    }

    // 全画面画像拡大（ライトボックス）
    if (e.target.dataset.action === 'enlarge-image') {
      openLightbox(e.target.src);
      return;
    }

    if (e.target.closest('#lightbox-modal')) {
      closeLightbox();
      return;
    }

    // タグチップ追加
    const tagBtn = e.target.closest('.tag-chip-btn');
    if (tagBtn) {
      const tagText = tagBtn.dataset.tag;
      const tagsInput = document.getElementById('sake-tags');
      if (tagsInput) {
        const currentTags = tagsInput.value.split(/\s+/).filter(Boolean);
        if (!currentTags.includes(tagText)) {
          currentTags.push(tagText);
          tagsInput.value = currentTags.join(' ');
        }
      }
      return;
    }

    // 画像選択トリガー
    if (e.target.closest('#upload-zone') || e.target.closest('#btn-trigger-upload')) {
      document.getElementById('file-input')?.click();
      return;
    }

    // 保存処理
    if (e.target && e.target.id === 'btn-save-log') {
      const name = document.getElementById('sake-name')?.value.trim();
      if (!name) {
        alert('銘柄名を入力してください。');
        return;
      }

      const rawTags = document.getElementById('sake-tags')?.value.trim() || '';
      const tags = rawTags ? rawTags.split(/\s+/).filter(Boolean) : [];

      let orderedBlobs = uploadedImages.map(img => img.blob);
      if (activeThumbnailIndex > 0 && activeThumbnailIndex < orderedBlobs.length) {
        const mainBlob = orderedBlobs.splice(activeThumbnailIndex, 1)[0];
        orderedBlobs.unshift(mainBlob);
      }

      const logData = {
        category: document.getElementById('sake-category')?.value || 'その他',
        name,
        productName: document.getElementById('sake-product')?.value.trim() || '',
        brewery: document.getElementById('sake-brewery')?.value.trim() || '',
        region: document.getElementById('sake-region')?.value.trim() || '',
        type: document.getElementById('sake-type')?.value.trim() || '',
        abv: document.getElementById('sake-abv')?.value || '',
        date: document.getElementById('sake-date')?.value || '',
        rating: document.getElementById('sake-rating')?.value || '4',
        tags,
        notes: document.getElementById('sake-notes')?.value.trim() || '',
        aiInfo: document.getElementById('sake-ai-info')?.value.trim() || ''
      };

      if (currentEditingLogId) {
        logData.id = currentEditingLogId;
      }

      await saveLog(logData, orderedBlobs);
      closeEditorModal();
      navigateTo('logList');
      return;
    }
  });

  document.addEventListener('input', (e) => {
    if (TRACKED_FIELDS.includes(e.target.id)) {
      updateFieldRevertUI();
    }
  });

  document.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'theme-select') {
      setTheme(e.target.value);
    }
    if (e.target && e.target.id === 'select-gemini-model') {
      setSavedModel(e.target.value);
    }
    if (e.target && e.target.id === 'file-input') {
      handleImageFiles(e.target.files);
    }
    if (TRACKED_FIELDS.includes(e.target.id)) {
      updateFieldRevertUI();
    }
  });

  document.getElementById('btn-menu-toggle')?.addEventListener('click', openSidebar);
  overlay?.addEventListener('click', closeSidebar);

  navigateTo('logList');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}