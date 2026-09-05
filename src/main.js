import { analyzeLabelImage, hasApiKey, saveApiKey, getSavedModel, setSavedModel, populateModelDropdown } from './services/gemini.js';
import { renderSettingsView } from './views/settings.js';
import { renderLogEditorModal } from './views/logEditor.js';
import { renderLogDetailModal } from './views/logDetail.js';
import { renderLogListView } from './views/logList.js';
import { saveLog, deleteLog, getLogById } from './store/db.js';
import { extractPhotoDate, compressImage, groupImagesByTime } from './utils/image.js';
import { renderBatchImportView } from './views/batchImport.js';

// --- スピナー用CSSおよびプレビュー拡大・ライトボックス用CSSの動的注入 ---
function ensureSpinnerStyles() {
  if (document.getElementById('sella-spinner-style')) return;
  const style = document.createElement('style');
  style.id = 'sella-spinner-style';
  style.textContent = `
    @keyframes sellaSpin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    .sella-spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255,255,255,0.3);
      border-radius: 50%;
      border-top-color: #fff;
      animation: sellaSpin 0.8s linear infinite;
      vertical-align: middle;
      margin-right: 6px;
    }
    .draggable-thumb {
      cursor: grab;
      transition: transform 0.15s, opacity 0.15s;
    }
    .draggable-thumb:active {
      cursor: grabbing;
    }
    .batch-group-card.drag-over {
      border-color: var(--accent-color) !important;
      background: var(--card-hover-bg, rgba(255,255,255,0.03));
    }
    /* 登録時の画像プレビュー枠をスマホでも押しやすいように調整 */
    .preview-item, .add-more-item {
      width: 90px !important;
      height: 90px !important;
    }
    .preview-item img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      cursor: pointer;
    }
    /* スマホで画像が覆われてタップできなくなるのを防ぐため、元々のCSSホバーのみに限定する */
    .preview-actions {
      display: none;
    }
    @media (min-width: 601px) {
      .preview-item:hover .preview-actions {
        display: flex;
        position: absolute;
        inset: 0;
        background: rgba(0,0,0,0.6);
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: 2px;
        opacity: 1;
        pointer-events: auto;
      }
    }
    /* ライトボックス本体のスタイル */
    .lightbox-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.92);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 99999;
      backdrop-filter: blur(8px);
    }
    .lightbox-overlay.active {
      display: flex;
    }
    .lightbox-content {
      position: relative;
      max-width: 95%;
      max-height: 95%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .lightbox-content img {
      max-width: 100%;
      max-height: 65vh;
      border-radius: 12px;
      object-fit: contain;
      box-shadow: 0 10px 30px rgba(0,0,0,0.6);
    }
    .lightbox-close {
      position: absolute;
      top: -45px;
      right: 0;
      background: none;
      border: none;
      color: #fff;
      font-size: 2.5rem;
      cursor: pointer;
      line-height: 1;
      padding: 4px 8px;
    }
    .lightbox-ctrl-btn {
      transition: all 0.2s;
    }
    .lightbox-ctrl-btn:active {
      transform: scale(0.95);
    }
  `;
  document.head.appendChild(style);
}
ensureSpinnerStyles();

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

export async function updateModelDropdown(forceRefresh = false) {
  const selectEl = document.getElementById('select-gemini-model');
  if (selectEl) {
    await populateModelDropdown(selectEl, forceRefresh);
  }
}

const views = {
  dashboard: renderLogListView,
  loglist: renderLogListView,
  'log-list': renderLogListView,
  logs: renderLogListView,
  batchimport: renderBatchImportView,
  settings: renderSettingsView,
  setting: renderSettingsView
};

let currentViewName = 'logList';

export async function navigateTo(viewName) {
  const appContainer = document.getElementById('app');
  if (!appContainer) return;

  const key = viewName ? viewName.toLowerCase() : 'dashboard';
  currentViewName = key;
  const renderView = views[key] || views.dashboard;

  try {
    const content = await renderView();
    appContainer.innerHTML = content;

    if (key === 'batchimport') {
      renderBatchGroupsUI(); 
    }

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

// --------------------------------------------------
// グローバル管理状態
// --------------------------------------------------
let uploadedImages = [];
let activeThumbnailIndex = 0;
let backupFormData = {};
let currentEditingLogId = null;

let batchGroups = [];
let ungroupedImages = [];
let returnToBatchOnClose = false;
let currentBatchGroupIndex = null;
let draggedItemInfo = null;
let isPoolCollapsed = false;

// ライトボックス用のコンテキスト
let activeLightboxCtx = null; 

function base64ToBlob(base64, mimeType = 'image/jpeg') {
  if (!base64) return null;
  try {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
  } catch (e) {
    console.error('Base64デコードに失敗しました:', e);
    return null;
  }
}

function renderBatchGroupsUI() {
  const previewSection = document.getElementById('batch-preview-section');
  if (!previewSection) return;

  const uploadZone = document.getElementById('batch-upload-zone');
  if (uploadZone) {
    uploadZone.innerHTML = `
      <div style="padding: 30px; text-align: center; border: 2px dashed var(--border-color); border-radius: 12px; cursor: pointer; background: var(--card-bg);">
        <div style="font-size: 1.8rem; margin-bottom: 6px;">📁</div>
        <div style="font-weight: bold; color: var(--text-main);">さらに写真を追加する</div>
      </div>
    `;
  }

  const hasItems = batchGroups.length > 0 || ungroupedImages.length > 0;
  if (!hasItems) {
    previewSection.style.display = 'none';
    return;
  }
  previewSection.style.display = 'block';

  let ungroupedHTML = '';
  if (ungroupedImages.length > 0) {
    const thumbs = isPoolCollapsed ? '' : `
      <div style="display: flex; gap: 10px; flex-wrap: wrap; min-height: 40px; margin-top: 10px;">
        ${ungroupedImages.map((item, idx) => `
          <div class="draggable-thumb" draggable="true" data-source-type="pool" data-idx="${idx}"
               style="position:relative; width:90px; height:90px; border-radius:6px; overflow:hidden; border:1px solid var(--border-color);">
            <img src="${item.previewUrl}" data-action="enlarge-image" data-context-type="pool" data-pool-idx="${idx}" style="width:100%; height:100%; object-fit:cover; cursor:pointer;" />
            <button type="button" class="btn-ungrouped-remove" data-idx="${idx}" title="削除"
                    style="position:absolute; top:2px; right:2px; background:rgba(0,0,0,0.7); color:#fff; border:none; border-radius:50%; width:22px; height:22px; font-size:12px; cursor:pointer; z-index:10;">✕</button>
          </div>
        `).join('')}
      </div>
    `;

    ungroupedHTML = `
      <div id="ungrouped-pool-container" style="position: fixed; bottom: 16px; left: 16px; right: 80px; max-width: 720px; margin: 0 auto; z-index: 100; background: var(--card-bg); border: 2px dashed var(--accent-color); border-radius: 12px; padding: 14px 16px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); backdrop-filter: blur(10px);">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <button type="button" id="btn-toggle-pool-collapse" class="btn-secondary" style="font-size: 0.75rem; padding: 2px 6px;">${isPoolCollapsed ? '▶ 展開' : '▼ 畳む'}</button>
            <span style="font-weight: bold; color: var(--text-main); font-size: 0.9rem;">📂 未所属の画像プール (${ungroupedImages.length}枚)</span>
          </div>
          <button type="button" id="btn-create-group-from-ungrouped" class="btn-secondary" style="font-size: 0.75rem; padding: 4px 8px;">✨ これらからグループを作成</button>
        </div>
        ${thumbs}
      </div>
    `;
  } else {
    ungroupedHTML = `<div id="ungrouped-pool-container" style="display:none;"></div>`;
  }

  const groupsHTML = batchGroups.map((group, gIdx) => {
    const mainImg = group[0];
    const dateStr = mainImg && mainImg.date ? new Date(mainImg.date).toLocaleString() : '日時不明';

    const thumbsHTML = group.map((item, iIdx) => `
      <div class="draggable-thumb" draggable="true" data-source-type="group" data-gidx="${gIdx}" data-iidx="${iIdx}"
           style="position:relative; width:90px; height:90px; border-radius:6px; overflow:hidden; border:1px solid var(--border-color);">
        <img src="${item.previewUrl}" data-action="enlarge-image" data-context-type="batch-group" data-gidx="${gIdx}" data-iidx="${iIdx}" style="width:100%; height:100%; object-fit:cover; cursor:pointer;" />
        ${iIdx === 0 ? '<span style="position:absolute; bottom:2px; left:2px; background:rgba(16,185,129,0.85); color:#fff; font-size:9px; padding:1px 4px; border-radius:3px; font-weight:bold; z-index:5;">★メイン</span>' : ''}
        <button type="button" class="btn-batch-remove-img" data-gidx="${gIdx}" data-iidx="${iIdx}" title="この写真をグループから外す"
                style="position:absolute; top:2px; right:2px; background:rgba(0,0,0,0.7); color:#fff; border:none; border-radius:50%; width:22px; height:22px; font-size:12px; cursor:pointer; z-index:10;">✕</button>
      </div>
    `).join('');

    return `
      <div class="batch-group-card" style="background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 16px; transition: border-color 0.2s; margin-bottom: 12px;" data-gidx="${gIdx}">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border-color);">
          <div>
            <span style="font-weight: bold; color: var(--accent-color);">🍶 未保存お酒グループ #${gIdx + 1}</span>
            <span style="font-size: 0.8rem; color: var(--text-sub); margin-left: 8px;">目安: ${dateStr} (${group.length}枚)</span>
          </div>
          <div style="display: flex; gap: 6px;">
            <button type="button" class="btn-secondary btn-batch-open-editor" data-gidx="${gIdx}" style="font-size: 0.75rem; padding: 4px 8px;">✏️ 詳細編集</button>
            <button type="button" class="btn-secondary btn-batch-analyze" data-gidx="${gIdx}" style="font-size: 0.75rem; padding: 4px 8px;">🤖 AI解析</button>
            <button type="button" class="btn-secondary btn-batch-split" data-gidx="${gIdx}" style="font-size: 0.75rem; padding: 4px 8px;" title="分割">✂️ 分割</button>
            <button type="button" class="btn-secondary btn-batch-delete-group" data-gidx="${gIdx}" style="font-size: 0.75rem; padding: 4px 8px; color: #ef4444; border-color: #ef4444;" title="グループごと削除">🗑️ 削除</button>
          </div>
        </div>

        <div style="font-size: 0.75rem; color: var(--text-sub); margin-bottom: 6px;">💡 写真をタップすると拡大操作メニューが開きます。ドラッグ＆ドロップでも並び替えできます。</div>
        <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; min-height: 50px;">
          ${thumbsHTML}
        </div>

        <div class="form-row" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <input type="text" class="input-dark batch-name-input" data-gidx="${gIdx}" value="${group.name || ''}" placeholder="銘柄名 (例: 寫樂)" style="font-size: 0.85rem;" />
          <input type="text" class="input-dark batch-brewery-input" data-gidx="${gIdx}" value="${group.brewery || ''}" placeholder="酒蔵・メーカー" style="font-size: 0.85rem;" />
        </div>
      </div>
    `;
  }).join('');

  previewSection.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <h3 id="batch-group-count-title" style="margin: 0; font-size: 1.1rem; color: var(--text-main);">✨ 未保存の酒ログアイテム (${batchGroups.length} 件)</h3>
      <div style="display: flex; gap: 8px;">
        <button type="button" id="btn-add-more-batch" class="btn-secondary" style="font-size: 0.85rem; padding: 6px 12px;">➕ 写真を追加する</button>
        ${batchGroups.length > 0 ? `<button type="button" id="btn-save-all-batches" class="btn-primary" style="background: #10b981; color: #fff; border: none; padding: 8px 16px; border-radius: 8px; font-weight: bold; cursor: pointer;">🚀 すべてまとめて登録する</button>` : ''}
      </div>
    </div>
    <div id="batch-groups-container" style="display: flex; flex-direction: column; gap: 16px; padding-bottom: ${ungroupedImages.length > 0 ? '120px' : '20px'};">
      ${groupsHTML}
    </div>
    ${ungroupedHTML}
  `;
}

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
      const base64 = reader.result.split(',');
      resolve(base64[1] || base64[0]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// 📸 【超強化】スマホでも圧倒的に使いやすい、操作コントロール内蔵型ライトボックス
function openLightbox(imageSrc, ctx) {
  let lightbox = document.getElementById('lightbox-modal');
  if (!lightbox) {
    lightbox = document.createElement('div');
    lightbox.id = 'lightbox-modal';
    lightbox.className = 'lightbox-overlay';
    document.body.appendChild(lightbox);
  }

  activeLightboxCtx = ctx;

  let controlsHTML = '';
  if (ctx) {
    if (ctx.type === 'editor-preview') {
      const idx = ctx.idx;
      const isMain = idx === activeThumbnailIndex;
      controlsHTML = `
        <div class="lightbox-controls" style="display: flex; gap: 8px; justify-content: center; margin-top: 16px; flex-wrap: wrap; width: 100%; max-width: 480px; pointer-events: auto;">
          <button type="button" class="lightbox-ctrl-btn btn-main-set" data-idx="${idx}" style="background: ${isMain ? '#10b981' : '#1e293b'}; color: #fff; border: 1px solid var(--border-color); padding: 10px 16px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 0.9rem;">
            ${isMain ? '★ メイン画像です' : '☆ メインに設定'}
          </button>
          <button type="button" class="lightbox-ctrl-btn btn-move-left" data-idx="${idx}" ${idx === 0 ? 'disabled style="opacity: 0.5; cursor: not-allowed; background: #0f172a;"' : 'style="background: #1e293b; color: #fff;"'} style="border: 1px solid var(--border-color); padding: 10px 16px; border-radius: 8px; cursor: pointer; font-size: 0.9rem;">
            ◄ 前へ
          </button>
          <button type="button" class="lightbox-ctrl-btn btn-move-right" data-idx="${idx}" ${idx === uploadedImages.length - 1 ? 'disabled style="opacity: 0.5; cursor: not-allowed; background: #0f172a;"' : 'style="background: #1e293b; color: #fff;"'} style="border: 1px solid var(--border-color); padding: 10px 16px; border-radius: 8px; cursor: pointer; font-size: 0.9rem;">
            ► 次へ
          </button>
          <button type="button" class="lightbox-ctrl-btn btn-delete-img" data-idx="${idx}" style="background: #ef4444; color: #fff; border: none; padding: 10px 16px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 0.9rem;">
            🗑️ 削除
          </button>
        </div>
      `;
    } else if (ctx.type === 'batch-group') {
      const gIdx = ctx.gidx;
      const iIdx = ctx.iidx;
      const group = batchGroups[gIdx];
      const isMain = iIdx === 0;
      controlsHTML = `
        <div class="lightbox-controls" style="display: flex; gap: 8px; justify-content: center; margin-top: 16px; flex-wrap: wrap; width: 100%; max-width: 480px; pointer-events: auto;">
          <button type="button" class="lightbox-ctrl-btn btn-batch-main-set" data-gidx="${gIdx}" data-iidx="${iIdx}" style="background: ${isMain ? '#10b981' : '#1e293b'}; color: #fff; border: 1px solid var(--border-color); padding: 10px 16px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 0.9rem;">
            ${isMain ? '★ メイン画像です' : '☆ メインに設定'}
          </button>
          <button type="button" class="lightbox-ctrl-btn btn-batch-move-left" data-gidx="${gIdx}" data-iidx="${iIdx}" ${iIdx === 0 ? 'disabled style="opacity: 0.5; cursor: not-allowed; background: #0f172a;"' : 'style="background: #1e293b; color: #fff;"'} style="border: 1px solid var(--border-color); padding: 10px 16px; border-radius: 8px; cursor: pointer; font-size: 0.9rem;">
            ◄ 前へ
          </button>
          <button type="button" class="lightbox-ctrl-btn btn-batch-move-right" data-gidx="${gIdx}" data-iidx="${iIdx}" ${group && iIdx === group.length - 1 ? 'disabled style="opacity: 0.5; cursor: not-allowed; background: #0f172a;"' : 'style="background: #1e293b; color: #fff;"'} style="border: 1px solid var(--border-color); padding: 10px 16px; border-radius: 8px; cursor: pointer; font-size: 0.9rem;">
            ► 次へ
          </button>
          <button type="button" class="lightbox-ctrl-btn btn-batch-remove-img" data-gidx="${gIdx}" data-iidx="${iIdx}" style="background: #ef4444; color: #fff; border: none; padding: 10px 16px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 0.9rem;">
            📤 プールへ外す
          </button>
        </div>
      `;
    } else if (ctx.type === 'pool') {
      const idx = ctx.poolIdx;
      controlsHTML = `
        <div class="lightbox-controls" style="display: flex; gap: 8px; justify-content: center; margin-top: 16px; width: 100%; max-width: 480px; pointer-events: auto;">
          <button type="button" class="lightbox-ctrl-btn btn-pool-delete-img" data-idx="${idx}" style="background: #ef4444; color: #fff; border: none; padding: 10px 24px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 0.9rem;">
            🗑️ この未所属写真を完全に削除する
          </button>
        </div>
      `;
    }
  }

  lightbox.innerHTML = `
    <div class="lightbox-content" style="display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; width: 100%;">
      <button type="button" class="lightbox-close" style="pointer-events: auto;">&times;</button>
      <img id="lightbox-img" src="${imageSrc}" alt="拡大画像" style="max-height: 60vh !important; pointer-events: auto; cursor: zoom-out;" />
      ${controlsHTML}
    </div>
  `;

  lightbox.classList.add('active');
}

function closeLightbox() {
  const lightbox = document.getElementById('lightbox-modal');
  if (lightbox) {
    lightbox.classList.remove('active');
  }
  activeLightboxCtx = null;
}

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

function syncEditorFormToCurrentBatchGroup() {
  if (currentBatchGroupIndex !== null && batchGroups[currentBatchGroupIndex]) {
    const group = batchGroups[currentBatchGroupIndex];
    const getVal = (id) => document.getElementById(id)?.value || '';

    group.category = getVal('sake-category');
    group.name = getVal('sake-name');
    group.productName = getVal('sake-product');
    group.brewery = getVal('sake-brewery');
    group.region = getVal('sake-region');
    group.type = getVal('sake-type');
    group.abv = getVal('sake-abv');
    group.notes = getVal('sake-notes');
    group.aiInfo = getVal('sake-ai-info');
    group.backupFormData = { ...backupFormData };
  }
}

async function openEditorModal(logId = null, initialBatchGroup = null, batchIdx = null) {
  closeEditorModal();
  closeDetailModal();

  uploadedImages = [];
  activeThumbnailIndex = 0;
  backupFormData = {};
  currentEditingLogId = logId;
  currentBatchGroupIndex = batchIdx !== undefined ? batchIdx : null;

  const modalHTML = await renderLogEditorModal();
  document.body.insertAdjacentHTML('beforeend', modalHTML);

  const modalModelSelect = document.getElementById('modal-model-select');
  if (modalModelSelect) {
    await populateModelDropdown(modalModelSelect);
  }

  if (logId) {
    const log = await getLogById(logId);
    if (log) {
      fillEditorForm(log);
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
  } else if (initialBatchGroup) {
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val || '';
    };

    setVal('sake-category', initialBatchGroup.category || '日本酒');
    setVal('sake-name', initialBatchGroup.name || '');
    setVal('sake-product', initialBatchGroup.productName || '');
    setVal('sake-brewery', initialBatchGroup.brewery || '');
    setVal('sake-region', initialBatchGroup.region || '');
    setVal('sake-type', initialBatchGroup.type || '');
    setVal('sake-abv', initialBatchGroup.abv || '');
    if (initialBatchGroup[0] && initialBatchGroup[0].date) {
      const d = initialBatchGroup[0].date instanceof Date ? initialBatchGroup[0].date : new Date(initialBatchGroup[0].date);
      setVal('sake-date', !isNaN(d) ? d.toISOString().split('T')[0] : '');
    }
    setVal('sake-notes', initialBatchGroup.notes || '');
    setVal('sake-ai-info', initialBatchGroup.aiInfo || '');

    if (initialBatchGroup.backupFormData) {
      backupFormData = { ...initialBatchGroup.backupFormData };
      updateFieldRevertUI();
    } else {
      saveCurrentFormBackup();
    }

    for (const item of initialBatchGroup) {
      try {
        let blob = item.blob;
        if (!blob && item.base64) {
          blob = base64ToBlob(item.base64, item.mimeType || 'image/jpeg');
          item.blob = blob;
        }
        let previewUrl = item.previewUrl;
        if (!previewUrl && blob) {
          previewUrl = URL.createObjectURL(blob);
          item.previewUrl = previewUrl;
        }
        uploadedImages.push({
          blob: blob,
          base64: item.base64,
          mimeType: item.mimeType || 'image/jpeg',
          previewUrl: previewUrl
        });
      } catch (e) {
        console.error('バッチ画像ロードエラー:', e);
      }
    }
    renderImagePreviewList();
  }
}

function fillEditorForm(log) {
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
}

function closeEditorModal() {
  syncEditorFormToCurrentBatchGroup();

  const modal = document.getElementById('modal-overlay');
  if (modal) modal.remove();
  uploadedImages = [];
  activeThumbnailIndex = 0;
  backupFormData = {};
  currentEditingLogId = null;
  currentBatchGroupIndex = null;

  if (returnToBatchOnClose) {
    returnToBatchOnClose = false;
    navigateTo('batchImport').then(() => {
      renderBatchGroupsUI();
    });
  }
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
      <img src="${img.previewUrl}" alt="Preview" data-action="enlarge-image" data-context-type="editor-preview" data-idx="${idx}" />
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

    try {
      const compressed = await compressImage(file);
      const previewUrl = URL.createObjectURL(compressed.blob);

      uploadedImages.push({
        blob: compressed.blob,
        base64: compressed.base64,
        mimeType: compressed.mimeType,
        previewUrl
      });
    } catch (e) {
      console.error('画像圧縮に失敗しました:', e);
    }
  }

  renderImagePreviewList();
}

async function processFilesForBatch(files, append = true) {
  if (!files || files.length === 0) return;

  const batchUploadZone = document.getElementById('batch-upload-zone');
  if (batchUploadZone) {
    batchUploadZone.innerHTML = `
      <div style="padding: 40px; text-align: center; color: var(--text-main);">
        <div class="sella-spinner" style="width: 32px; height: 32px; border-width: 4px; margin-bottom: 12px; border-top-color: var(--accent-color);"></div>
        <div style="font-weight: bold; font-size: 1.1rem;">写真を解析・グルーピング中...</div>
        <div style="font-size: 0.85rem; color: var(--text-sub); margin-top: 4px;">(${files.length}枚の画像を処理しています)</div>
      </div>
    `;
  }

  try {
    const items = [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      const compressed = await compressImage(file);
      const date = file.lastModified ? new Date(file.lastModified) : null;
      items.push({
        file,
        date,
        blob: compressed.blob,
        base64: compressed.base64,
        mimeType: compressed.mimeType,
        previewUrl: URL.createObjectURL(compressed.blob)
      });
    }

    if (items.length > 0) {
      const newGroups = groupImagesByTime(items, 3 * 60 * 1000, 5);
      if (append) {
        batchGroups = batchGroups.concat(newGroups);
      } else {
        batchGroups = newGroups;
      }
    } else {
      alert('有効な画像ファイルが見つかりませんでした。');
    }
  } catch (err) {
    console.error('Batch Processing Error:', err);
    alert('画像の処理中にエラーが発生しました。');
  } finally {
    renderBatchGroupsUI();
  }
}

async function runAIAnalysis(targetImg) {
  if (!targetImg || !hasApiKey()) return;

  saveCurrentFormBackup();

  const analyzingStatus = document.getElementById('analyzing-status');
  if (analyzingStatus) analyzingStatus.style.display = 'flex';

  try {
    const result = await analyzeLabelImage(targetImg.base64, targetImg.mimeType);
    if (result) {
      const resolvedName = result.name || result.productName || '';
      const resolvedProduct = result.productName || '';
      const resolvedBrewery = result.brewery || '';

      const fieldMapping = {
        'sake-category': result.category,
        'sake-name': resolvedName,
        'sake-product': resolvedProduct,
        'sake-brewery': resolvedBrewery,
        'sake-region': result.region,
        'sake-type': result.type,
        'sake-abv': result.abv,
        'sake-notes': result.aiInfo
      };

      Object.keys(fieldMapping).forEach(id => {
        const val = fieldMapping[id];
        const el = document.getElementById(id);
        if (el && val !== undefined && val !== null && val !== '') {
          el.value = val;
        }
      });

      updateFieldRevertUI();
      syncEditorFormToCurrentBatchGroup();
    }
  } catch (err) {
    console.error('AI Analysis Error:', err);
    alert('AI解析中にエラーが発生しました。APIキーやモデル設定をご確認ください。');
  } finally {
    if (analyzingStatus) analyzingStatus.style.display = 'none';
  }
}

function initApp() {
  // 🌟【重要リファクタリング】グローバルなファイルチェンジイベント委譲
  // これにより、DOM置換によるイベントリスナーの消失や複数選択（multiple）のバグを完璧に解消する
  document.addEventListener('change', async (e) => {
    if (e.target && e.target.id === 'file-input') {
      const files = e.target.files;
      if (files && files.length > 0) {
        await handleImageFiles(files);
      }
      e.target.value = ''; 
    }
    if (e.target && e.target.id === 'batch-file-input') {
      const files = e.target.files;
      if (files && files.length > 0) {
        await processFilesForBatch(files, true);
      }
      e.target.value = ''; 
    }
  });

  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    const card = e.target.closest('.batch-group-card');
    document.querySelectorAll('.batch-group-card').forEach(c => c.classList.remove('drag-over'));
    if (card) card.classList.add('drag-over');
  });

  document.addEventListener('dragleave', (e) => {
    const card = e.target.closest('.batch-group-card');
    if (card && !card.contains(e.relatedTarget)) {
      card.classList.remove('drag-over');
    }
  });

  document.addEventListener('dragstart', (e) => {
    const thumb = e.target.closest('.draggable-thumb');
    if (thumb) {
      const sourceType = thumb.dataset.sourceType;
      if (sourceType === 'group') {
        draggedItemInfo = {
          type: 'group',
          gIdx: Number(thumb.dataset.gidx),
          iIdx: Number(thumb.dataset.iidx)
        };
      } else if (sourceType === 'pool') {
        draggedItemInfo = {
          type: 'pool',
          idx: Number(thumb.dataset.idx)
        };
      }
      e.dataTransfer.effectAllowed = 'move';
    }
  });

  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    document.querySelectorAll('.batch-group-card').forEach(c => c.classList.remove('drag-over'));

    const batchUploadZone = e.target.closest('#batch-upload-zone');
    if (batchUploadZone && !draggedItemInfo) {
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        await processFilesForBatch(files, true);
      }
      return;
    }

    const singleUploadZone = e.target.closest('#upload-zone');
    if (singleUploadZone && !draggedItemInfo) {
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        handleImageFiles(files);
      }
      return;
    }

    if (!draggedItemInfo) return;

    const targetGroupCard = e.target.closest('.batch-group-card');
    const targetThumb = e.target.closest('.draggable-thumb');
    const targetPoolArea = e.target.closest('#ungrouped-pool-container');

    let movedImage = null;

    if (draggedItemInfo.type === 'group') {
      const srcGroup = batchGroups[draggedItemInfo.gIdx];
      if (srcGroup) {
        movedImage = srcGroup.splice(draggedItemInfo.iIdx, 1)[0];
        if (srcGroup.length === 0) {
          batchGroups.splice(draggedItemInfo.gIdx, 1);
        }
      }
    } else if (draggedItemInfo.type === 'pool') {
      movedImage = ungroupedImages.splice(draggedItemInfo.idx, 1)[0];
    }

    if (!movedImage) {
      draggedItemInfo = null;
      return;
    }

    if (targetGroupCard) {
      const targetGIdx = Number(targetGroupCard.dataset.gidx);
      if (!isNaN(targetGIdx) && batchGroups[targetGIdx]) {
        const targetGroup = batchGroups[targetGIdx];
        
        if (targetThumb && targetThumb.dataset.gidx !== undefined && Number(targetThumb.dataset.gidx) === targetGIdx) {
          const targetIIdx = Number(targetThumb.dataset.iidx);
          targetGroup.splice(targetIIdx, 0, movedImage);
        } else {
          targetGroup.push(movedImage);
        }
      } else {
        batchGroups.push([movedImage]);
      }
    } else if (targetPoolArea) {
      ungroupedImages.push(movedImage);
    } else {
      batchGroups.push([movedImage]);
    }

    draggedItemInfo = null;
    renderBatchGroupsUI();
  });

  document.addEventListener('click', async (e) => {
    // --- 📸 操作型ライトボックス内ボタンの統合イベント処理 ---
    const lbBtn = e.target.closest('.lightbox-ctrl-btn');
    if (lbBtn) {
      e.stopPropagation();
      e.preventDefault();

      // [単体登録エディタ] メイン画像設定
      if (lbBtn.classList.contains('btn-main-set')) {
        activeThumbnailIndex = Number(lbBtn.dataset.idx);
        renderImagePreviewList();
        if (activeLightboxCtx) {
          openLightbox(uploadedImages[activeThumbnailIndex].previewUrl, activeLightboxCtx);
        }
        return;
      }

      // [単体登録エディタ] 画像の順序移動
      if (lbBtn.classList.contains('btn-move-left') || lbBtn.classList.contains('btn-move-right')) {
        const idx = Number(lbBtn.dataset.idx);
        const dir = lbBtn.classList.contains('btn-move-left') ? -1 : 1;
        const targetIdx = idx + dir;
        if (targetIdx >= 0 && targetIdx < uploadedImages.length) {
          const temp = uploadedImages[idx];
          uploadedImages[idx] = uploadedImages[targetIdx];
          uploadedImages[targetIdx] = temp;
          if (activeThumbnailIndex === idx) activeThumbnailIndex = targetIdx;
          else if (activeThumbnailIndex === targetIdx) activeThumbnailIndex = idx;
          
          renderImagePreviewList();
          
          activeLightboxCtx.idx = targetIdx;
          openLightbox(uploadedImages[targetIdx].previewUrl, activeLightboxCtx);
        }
        return;
      }

      // [単体登録エディタ] 画像の削除
      if (lbBtn.classList.contains('btn-delete-img')) {
        const idx = Number(lbBtn.dataset.idx);
        uploadedImages.splice(idx, 1);
        if (activeThumbnailIndex >= uploadedImages.length) {
          activeThumbnailIndex = Math.max(0, uploadedImages.length - 1);
        }
        renderImagePreviewList();
        closeLightbox();
        return;
      }

      // [一括登録グループ] メイン画像設定
      if (lbBtn.classList.contains('btn-batch-main-set')) {
        const gIdx = Number(lbBtn.dataset.gidx);
        const iIdx = Number(lbBtn.dataset.iidx);
        if (batchGroups[gIdx] && iIdx > 0) {
          const item = batchGroups[gIdx].splice(iIdx, 1)[0];
          batchGroups[gIdx].unshift(item);
          renderBatchGroupsUI();
          activeLightboxCtx.iidx = 0;
          openLightbox(batchGroups[gIdx][0].previewUrl, activeLightboxCtx);
        }
        return;
      }

      // [一括登録グループ] 画像の順序移動
      if (lbBtn.classList.contains('btn-batch-move-left') || lbBtn.classList.contains('btn-batch-move-right')) {
        const gIdx = Number(lbBtn.dataset.gidx);
        const iIdx = Number(lbBtn.dataset.iidx);
        const dir = lbBtn.classList.contains('btn-batch-move-left') ? -1 : 1;
        const targetIIdx = iIdx + dir;
        const group = batchGroups[gIdx];
        if (group && targetIIdx >= 0 && targetIIdx < group.length) {
          const temp = group[iIdx];
          group[iIdx] = group[targetIIdx];
          group[targetIIdx] = temp;
          renderBatchGroupsUI();
          
          activeLightboxCtx.iidx = targetIIdx;
          openLightbox(group[targetIIdx].previewUrl, activeLightboxCtx);
        }
        return;
      }

      // [一括登録グループ] 画像を未所属プールへ
      if (lbBtn.classList.contains('btn-batch-remove-img')) {
        const gIdx = Number(lbBtn.dataset.gidx);
        const iIdx = Number(lbBtn.dataset.iidx);
        if (batchGroups[gIdx]) {
          const detached = batchGroups[gIdx].splice(iIdx, 1)[0];
          if (detached) {
            ungroupedImages.push(detached);
          }
          if (batchGroups[gIdx].length === 0) {
            batchGroups.splice(gIdx, 1);
          }
          renderBatchGroupsUI();
          closeLightbox();
        }
        return;
      }

      // [プール] 画像の完全削除
      if (lbBtn.classList.contains('btn-pool-delete-img')) {
        const idx = Number(lbBtn.dataset.idx);
        ungroupedImages.splice(idx, 1);
        renderBatchGroupsUI();
        closeLightbox();
        return;
      }
    }

    if (e.target.id === 'btn-toggle-pool-collapse') {
      isPoolCollapsed = !isPoolCollapsed;
      renderBatchGroupsUI();
      return;
    }

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
        updateModelDropdown(true);
      }
      return;
    }

    if (e.target && e.target.id === 'btn-reload-models') {
      updateModelDropdown(true);
      return;
    }

    const reloadModalModelsBtn = e.target.closest('#btn-reload-modal-models');
    if (reloadModalModelsBtn) {
      if (!hasApiKey()) {
        alert('APIキーが設定されていません。設定画面から登録してください。');
        return;
      }
      reloadModalModelsBtn.textContent = '⏳';
      reloadModalModelsBtn.disabled = true;
      const modalSelect = document.getElementById('modal-model-select');
      if (modalSelect) {
        await populateModelDropdown(modalSelect, true);
      }
      reloadModalModelsBtn.textContent = '✅';
      setTimeout(() => {
        reloadModalModelsBtn.textContent = '↺';
        reloadModalModelsBtn.disabled = false;
      }, 1500);
      return;
    }

    // 各ファイル選択用のタップエミュレート
    if (e.target.closest('#batch-upload-zone') || e.target.closest('#btn-add-more-batch')) {
      e.preventDefault();
      const batchInput = document.getElementById('batch-file-input');
      if (batchInput) batchInput.click();
      return;
    }

    const saveAllBtn = e.target.closest('#btn-save-all-batches');
    if (saveAllBtn) {
      if (batchGroups.length === 0) {
        alert('登録するグループがありません。');
        return;
      }

      if (!confirm(`${batchGroups.length}件のお酒を一括登録しますか？`)) return;

      saveAllBtn.disabled = true;
      const originalBtnText = saveAllBtn.innerHTML;
      saveAllBtn.innerHTML = `<span class="sella-spinner"></span>一括登録中... (${batchGroups.length}件)`;

      try {
        for (let gIdx = 0; gIdx < batchGroups.length; gIdx++) {
          const group = batchGroups[gIdx];
          const card = document.querySelector(`.batch-group-card[data-gidx="${gIdx}"]`);
          const nameInput = card?.querySelector('.batch-name-input');
          const breweryInput = card?.querySelector('.batch-brewery-input');

          const cardName = nameInput ? nameInput.value.trim() : '';
          const cardBrewery = breweryInput ? breweryInput.value.trim() : '';

          const name = cardName !== '' ? cardName : (group.name || `お酒グループ #${gIdx + 1}`);
          const brewery = cardBrewery !== '' ? cardBrewery : (group.brewery || '');

          // スマホバグ治療: 順序変更やアップロードタイミングで Blob が欠落していた場合を検知して復元
          const orderedBlobs = group.map(img => {
            if (!img.blob && img.base64) {
              img.blob = base64ToBlob(img.base64, img.mimeType || 'image/jpeg');
            }
            return img.blob;
          }).filter(blob => blob instanceof Blob); // 🌟確実にBlobオブジェクトであるもののみに絞り込む！

          const mainDate = group[0]?.date ? (group[0].date instanceof Date ? group[0].date.toISOString().split('T')[0] : new Date(group[0].date).toISOString().split('T')[0]) : '';

          const logData = {
            category: group.category || '日本酒',
            name: name || '名称未設定',
            productName: group.productName || '',
            brewery: brewery || '',
            region: group.region || '',
            type: group.type || '',
            abv: group.abv || '',
            date: mainDate,
            rating: '4',
            tags: [],
            notes: group.notes || '',
            aiInfo: group.aiInfo || ''
          };

          await saveLog(logData, orderedBlobs);
        }

        alert('すべてのグループの登録が完了しました！');
        batchGroups = [];
        ungroupedImages = [];
        renderBatchGroupsUI();
        navigateTo('logList');
      } catch (err) {
        console.error('一括登録エラー:', err);
        alert('一括登録中にエラーが発生しました。');
        saveAllBtn.disabled = false;
        saveAllBtn.innerHTML = originalBtnText;
      }
      return;
    }

    const batchAnalyzeBtn = e.target.closest('.btn-batch-analyze');
    if (batchAnalyzeBtn) {
      e.stopPropagation(); 
      const gIdx = Number(batchAnalyzeBtn.dataset.gidx);
      const group = batchGroups[gIdx];
      if (group && group.length > 0 && hasApiKey()) {
        const originalText = batchAnalyzeBtn.innerHTML;
        batchAnalyzeBtn.innerHTML = '<span class="sella-spinner"></span>解析中...';
        batchAnalyzeBtn.disabled = true;

        try {
          const targetImg = group[0];
          if (!targetImg.blob && targetImg.base64) {
            targetImg.blob = base64ToBlob(targetImg.base64, targetImg.mimeType || 'image/jpeg');
          }

          const result = await analyzeLabelImage(targetImg.base64, targetImg.mimeType);

          if (result) {
            const resolvedName = result.name || result.productName || group.name || '';
            const resolvedBrewery = result.brewery || group.brewery || '';

            if (!group.backupFormData) {
              group.backupFormData = {
                'sake-category': group.category || '日本酒',
                'sake-name': group.name || '',
                'sake-product': group.productName || '',
                'sake-brewery': group.brewery || '',
                'sake-region': group.region || '',
                'sake-type': group.type || '',
                'sake-abv': group.abv || '',
                'sake-notes': group.notes || '',
                'sake-ai-info': group.aiInfo || ''
              };
            }

            group.name = resolvedName;
            group.brewery = resolvedBrewery;
            group.category = result.category || group.category || '日本酒';
            group.productName = result.productName || group.productName || '';
            group.region = result.region || group.region || '';
            group.type = result.type || group.type || '';
            group.abv = result.abv || group.abv || '';
            group.notes = result.aiInfo || group.notes || '';
            group.aiInfo = result.aiInfo || group.aiInfo || '';
          }
        } catch (err) {
          console.error('Batch AI Analysis Error:', err);
          alert('AI解析中にエラーが発生しました。');
        } finally {
          batchAnalyzeBtn.innerHTML = originalText;
          batchAnalyzeBtn.disabled = false;
          renderBatchGroupsUI();
        }
      } else if (!hasApiKey()) {
        alert('APIキーが設定されていません。設定画面から登録してください。');
      }
      return;
    }

    const batchSplitBtn = e.target.closest('.btn-batch-split');
    if (batchSplitBtn) {
      e.stopPropagation();
      const gIdx = Number(batchSplitBtn.dataset.gidx);
      const group = batchGroups[gIdx];
      if (group && group.length > 1) {
        const mid = Math.ceil(group.length / 2);
        const firstHalf = group.slice(0, mid);
        const secondHalf = group.slice(mid);
        batchGroups.splice(gIdx, 1, firstHalf, secondHalf);
        renderBatchGroupsUI();
      } else {
        alert('これ以上分割できません（1枚のみです）。');
      }
      return;
    }

    const batchDeleteGroupBtn = e.target.closest('.btn-batch-delete-group');
    if (batchDeleteGroupBtn) {
      e.stopPropagation();
      const gIdx = Number(batchDeleteGroupBtn.dataset.gidx);
      
      const choice = confirm(`お酒グループ #${gIdx + 1} を削除しますか？\n\n[OK]: グループ内の写真も含めて完全に削除する\n[キャンセル]: 写真を「未所属の画像プール」に戻す`);
      
      const removed = batchGroups.splice(gIdx, 1)[0];
      if (!choice && removed && removed.length > 0) {
        ungroupedImages = ungroupedImages.concat(removed);
      }
      renderBatchGroupsUI();
      return;
    }

    const batchRemoveImgBtn = e.target.closest('.btn-batch-remove-img');
    if (batchRemoveImgBtn) {
      e.stopPropagation();
      const gIdx = Number(batchRemoveImgBtn.dataset.gidx);
      const iIdx = Number(batchRemoveImgBtn.dataset.iidx);
      if (batchGroups[gIdx]) {
        const detached = batchGroups[gIdx].splice(iIdx, 1)[0];
        if (detached) {
          ungroupedImages.push(detached);
        }
        if (batchGroups[gIdx].length === 0) {
          batchGroups.splice(gIdx, 1);
        }
        renderBatchGroupsUI();
      }
      return;
    }

    const ungroupedRemoveBtn = e.target.closest('.btn-ungrouped-remove');
    if (ungroupedRemoveBtn) {
      e.stopPropagation();
      const idx = Number(ungroupedRemoveBtn.dataset.idx);
      ungroupedImages.splice(idx, 1);
      renderBatchGroupsUI();
      return;
    }

    if (e.target.id === 'btn-create-group-from-ungrouped') {
      if (ungroupedImages.length > 0) {
        batchGroups.push([...ungroupedImages]);
        ungroupedImages = [];
        renderBatchGroupsUI();
      }
      return;
    }

    const batchOpenEditorBtn = e.target.closest('.btn-batch-open-editor');
    if (batchOpenEditorBtn) {
      e.stopPropagation();
      const gIdx = Number(batchOpenEditorBtn.dataset.gidx);
      const group = batchGroups[gIdx];
      if (group) {
        const card = batchOpenEditorBtn.closest('.batch-group-card');
        const nameInput = card?.querySelector('.batch-name-input');
        const breweryInput = card?.querySelector('.batch-brewery-input');
        
        const nameVal = nameInput ? nameInput.value.trim() : '';
        const breweryVal = breweryInput ? breweryInput.value.trim() : '';
        if (nameVal !== '') group.name = nameVal;
        if (breweryVal !== '') group.brewery = breweryVal;

        returnToBatchOnClose = true; 
        await openEditorModal(null, group, gIdx);
      }
      return;
    }

    const rowItem = e.target.closest('[data-action="open-detail"]');
    if (rowItem) {
      const id = rowItem.dataset.id;
      await openDetailModal(id);
      return;
    }

    if (e.target.id === 'btn-close-detail' || e.target.id === 'btn-close-detail-footer' || e.target.id === 'detail-modal-overlay') {
      closeDetailModal();
      return;
    }

    if (e.target.id === 'btn-edit-from-detail') {
      const id = e.target.dataset.id;
      await openEditorModal(id);
      return;
    }

    if (e.target.id === 'btn-delete-from-detail') {
      const id = e.target.dataset.id;
      if (confirm('この酒ログを削除してもよろしいですか？')) {
        await deleteLog(id);
        closeDetailModal();
        navigateTo('logList');
      }
      return;
    }

    if (e.target.closest('#fab-add') || e.target.closest('[data-action="open-editor"]')) {
      e.preventDefault();
      returnToBatchOnClose = false;
      await openEditorModal();
      return;
    }

    const targetBtn = e.target.closest('[data-view]');
    if (targetBtn) {
      e.preventDefault();
      const viewName = targetBtn.dataset.view;
      if (viewName === 'logEditor') {
        returnToBatchOnClose = false;
        await openEditorModal();
      } else {
        returnToBatchOnClose = false;
        navigateTo(viewName);
      }
      return;
    }

    if (e.target.id === 'btn-close-modal' || e.target.id === 'btn-cancel-modal' || e.target.id === 'modal-overlay') {
      closeEditorModal();
      return;
    }

    if (e.target.id === 'btn-analyze') {
      runAIAnalysis(uploadedImages[activeThumbnailIndex]);
      return;
    }

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

    const thumbBtn = e.target.closest('.btn-thumb-set');
    if (thumbBtn) {
      activeThumbnailIndex = Number(thumbBtn.dataset.idx);
      renderImagePreviewList();
      return;
    }

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

    // --- プレビューサムネイル画像をタップして拡大するロジック ---
    const enlargeTarget = e.target.closest('[data-action="enlarge-image"]');
    if (enlargeTarget) {
      const contextType = enlargeTarget.dataset.contextType;
      let ctxData = null;

      if (contextType === 'editor-preview') {
        ctxData = { type: 'editor-preview', idx: Number(enlargeTarget.dataset.idx) };
      } else if (contextType === 'batch-group') {
        ctxData = { type: 'batch-group', gidx: Number(enlargeTarget.dataset.gidx), iidx: Number(enlargeTarget.dataset.iidx) };
      } else if (contextType === 'pool') {
        ctxData = { type: 'pool', poolIdx: Number(enlargeTarget.dataset.poolIdx) };
      }

      openLightbox(enlargeTarget.src, ctxData);
      return;
    }

    // --- ライトボックスをタップまたは✕ボタンで閉じる ---
    if (e.target.id === 'lightbox-modal' || e.target.classList.contains('lightbox-close') || e.target.closest('.lightbox-close')) {
      closeLightbox();
      return;
    }

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

    if (e.target.closest('#upload-zone') || e.target.closest('#btn-trigger-upload')) {
      e.preventDefault();
      const fileInput = document.getElementById('file-input');
      if (fileInput) fileInput.click();
      return;
    }

    // --- 単体酒ログの保存ロジック ---
    if (e.target && e.target.id === 'btn-save-log') {
      const name = document.getElementById('sake-name')?.value.trim();
      if (!name) {
        alert('銘柄名を入力してください。');
        return;
      }

      syncEditorFormToCurrentBatchGroup();

      const rawTags = document.getElementById('sake-tags')?.value.trim() || '';
      const tags = rawTags ? rawTags.split(/\s+/).filter(Boolean) : [];

      // スマホバグ治療: 順序変更やアップロードタイミングで Blob が欠落していた場合を検知して復元
      let orderedBlobs = uploadedImages.map(img => {
        if (!img.blob && img.base64) {
          img.blob = base64ToBlob(img.base64, img.mimeType || 'image/jpeg');
        }
        return img.blob;
      }).filter(blob => blob instanceof Blob); // 🌟確実にBlobオブジェクトであるもののみにクレンジング！

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

      if (currentBatchGroupIndex !== null && currentBatchGroupIndex >= 0 && currentBatchGroupIndex < batchGroups.length) {
        batchGroups.splice(currentBatchGroupIndex, 1);
        currentBatchGroupIndex = null;
      }

      closeEditorModal();
      
      if (!returnToBatchOnClose) {
        navigateTo(currentViewName);
      }
      return;
    }
  });

  document.addEventListener('input', (e) => {
    if (TRACKED_FIELDS.includes(e.target.id)) {
      updateFieldRevertUI();
    }
    if (e.target.classList.contains('batch-name-input')) {
      const gIdx = Number(e.target.dataset.gidx);
      if (batchGroups[gIdx]) {
        batchGroups[gIdx].name = e.target.value;
      }
    }
    if (e.target.classList.contains('batch-brewery-input')) {
      const gIdx = Number(e.target.dataset.gidx);
      if (batchGroups[gIdx]) {
        batchGroups[gIdx].brewery = e.target.value;
      }
    }
  });

  document.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'theme-select') {
      setTheme(e.target.value);
    }
    if (e.target && (e.target.id === 'select-gemini-model' || e.target.id === 'modal-model-select')) {
      setSavedModel(e.target.value);
      const globalSelect = document.getElementById('select-gemini-model');
      const modalSelect = document.getElementById('modal-model-select');
      if (globalSelect && globalSelect.value !== e.target.value) globalSelect.value = e.target.value;
      if (modalSelect && modalSelect.value !== e.target.value) modalSelect.value = e.target.value;
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
