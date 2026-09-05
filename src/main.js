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
    
    /* 📱 スマホ用一括インポート（batchImport）レイアウト崩れ防止と超絶最適化 */
    .batch-group-btn-container {
      display: flex !important;
      gap: 6px !important;
      overflow-x: auto !important;
      white-space: nowrap !important;
      -webkit-overflow-scrolling: touch !important;
      scrollbar-width: none !important;
      padding-bottom: 2px !important;
      width: auto !important;
    }
    .batch-group-btn-container::-webkit-scrollbar {
      display: none !important;
    }
    .batch-group-btn-container button {
      flex-shrink: 0 !important;
      font-size: 0.72rem !important;
      padding: 6px 10px !important;
    }

    @media (max-width: 600px) {
      #ungrouped-pool-container {
        left: 8px !important;
        right: 8px !important;
        bottom: 8px !important;
        width: calc(100% - 16px) !important;
        max-width: 100% !important;
        border-radius: 12px !important;
        padding: 10px 12px !important;
        box-shadow: 0 -8px 24px rgba(0,0,0,0.6) !important;
        position: fixed !important;
        z-index: 9999 !important; /* ライトボックスのすぐ下に配置 */
      }
      #ungrouped-pool-container .thumbs-scroll-container {
        display: flex !important;
        flex-wrap: nowrap !important;
        overflow-x: auto !important;
        -webkit-overflow-scrolling: touch !important;
        gap: 8px !important;
        padding-bottom: 4px !important;
        scrollbar-width: none !important;
        min-height: 80px !important;
      }
      #ungrouped-pool-container .thumbs-scroll-container::-webkit-scrollbar {
        display: none !important;
      }
      #ungrouped-pool-container .draggable-thumb {
        width: 80px !important;
        height: 80px !important;
        min-height: 80px !important;
        flex-shrink: 0 !important;
      }
      
      /* 一括インポートのカードレイアウト調整 */
      .batch-group-card {
        padding: 12px !important;
        margin-bottom: 10px !important;
      }
      .batch-group-card .thumbs-scroll-container {
        display: flex !important;
        flex-wrap: nowrap !important;
        overflow-x: auto !important;
        -webkit-overflow-scrolling: touch !important;
        gap: 8px !important;
        scrollbar-width: none !important;
        padding-bottom: 4px !important;
      }
      .batch-group-card .thumbs-scroll-container::-webkit-scrollbar {
        display: none !important;
      }
      .batch-group-card .draggable-thumb {
        width: 80px !important;
        height: 80px !important;
        min-height: 80px !important;
        flex-shrink: 0 !important;
      }
    }
    
    
    /* 登録時の画像プレビュー枠をスマホでも押しやすいように調整 */
    .preview-item, .add-more-item {
      width: 90px !important;
      height: 90px !important;
      min-height: 90px !important;
      position: relative !important;
    }
    .preview-item img {
      width: 100% !important;
      height: 100% !important;
      object-fit: cover !important;
      cursor: grab !important;
    }
    .preview-item img:active {
      cursor: grabbing !important;
    }

    /* プレビュー内の削除ボタンを右上に絶対配置 */
    .btn-img-del {
      position: absolute !important;
      top: 4px !important;
      right: 4px !important;
      background: rgba(0, 0, 0, 0.7) !important;
      color: #fff !important;
      border: none !important;
      border-radius: 50% !important;
      width: 22px !important;
      height: 22px !important;
      font-size: 11px !important;
      cursor: pointer !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      z-index: 15 !important;
      pointer-events: auto !important;
      box-shadow: 0 2px 5px rgba(0,0,0,0.3) !important;
    }

    /* ホバー時のみ削除ボタンを出す (PC) */
    @media (min-width: 601px) {
      .btn-img-del {
        opacity: 0 !important;
        transition: opacity 0.2s ease !important;
      }
      .preview-item:hover .btn-img-del {
        opacity: 1 !important;
      }
    }

    @media (max-width: 600px) {
      .preview-item, .add-more-item {
        width: 100px !important;
        height: 100px !important;
        min-height: 100px !important;
      }
      /* スマホでは誤爆を避けるため削除ボタンは常に表示しておく */
      .btn-img-del {
        opacity: 1 !important;
      }
    }

    /* ライトボックス本体のスタイル */
    .lightbox-overlay {
      touch-action: none !important; /* 🌟ブラウザのスワイプ妨害を完全にシャットアウト */
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.95);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 99999;
      backdrop-filter: blur(8px);
    }
    .lightbox-overlay.active {
      display: flex !important;
    }
    .lightbox-content {
      touch-action: none !important; /* 🌟ブラウザのスワイプ妨害を完全にシャットアウト */
      position: relative;
      max-width: 95%;
      max-height: 95%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .lightbox-content img {
      touch-action: none !important; /* 🌟画像引きずりジェスチャーを最優先 */
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
    /* 左右のめくり用アローボタン */
    .lightbox-arrow-btn {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      background: rgba(255, 255, 255, 0.08);
      color: rgba(255, 255, 255, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.1);
      font-size: 1.8rem;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
      z-index: 100000;
      pointer-events: auto;
      user-select: none;
    }
    .lightbox-arrow-btn:hover {
      background: rgba(255, 255, 255, 0.2);
      color: #fff;
      transform: translateY(-50%) scale(1.05);
    }
    .lightbox-arrow-btn:active {
      transform: translateY(-50%) scale(0.95);
    }
    .lightbox-arrow-btn.prev {
      left: 16px;
    }
    .lightbox-arrow-btn.next {
      right: 16px;
    }
    /* カルーセル用の分数インジケーター */
    .lightbox-indicator {
      background: rgba(0, 0, 0, 0.6);
      color: rgba(255, 255, 255, 0.9);
      border: 1px solid rgba(255, 255, 255, 0.15);
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.85rem;
      font-weight: bold;
      letter-spacing: 1px;
      margin-top: 12px;
      margin-bottom: 4px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      user-select: none;
    }
    .lightbox-indicator::before {
      content: '📖';
      font-size: 0.9rem;
    }
    /* 丸みのあるカプセル型のアクションコントロールボタン */
    .lightbox-ctrl-btn {
      border-radius: 24px !important;
      padding: 10px 20px !important;
      font-weight: bold !important;
      font-size: 0.85rem !important;
      display: inline-flex !important;
      align-items: center !important;
      gap: 6px !important;
      border: 1px solid var(--border-color) !important;
      transition: all 0.2s ease !important;
      cursor: pointer !important;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15) !important;
    }
    .lightbox-ctrl-btn:active {
      transform: scale(0.95);
    }
    .lightbox-ctrl-btn.btn-main-set, .lightbox-ctrl-btn.btn-batch-main-set {
      background: #10b981 !important;
      border-color: #10b981 !important;
      color: #fff !important;
    }
    .lightbox-ctrl-btn.btn-main-unset, .lightbox-ctrl-btn.btn-batch-main-unset {
      background: rgba(255, 255, 255, 0.08) !important;
      border-color: rgba(255, 255, 255, 0.15) !important;
      color: var(--text-main) !important;
    }
    .lightbox-ctrl-btn.btn-main-unset:hover, .lightbox-ctrl-btn.btn-batch-main-unset:hover {
      background: rgba(255, 255, 255, 0.15) !important;
      border-color: var(--accent-color) !important;
      color: var(--accent-color) !important;
    }
    .lightbox-ctrl-btn.btn-delete-img, .lightbox-ctrl-btn.btn-batch-remove-img, .lightbox-ctrl-btn.btn-pool-delete-img {
      background: rgba(239, 68, 68, 0.12) !important;
      border-color: rgba(239, 68, 68, 0.25) !important;
      color: #ef4444 !important;
    }
    .lightbox-ctrl-btn.btn-delete-img:hover, .lightbox-ctrl-btn.btn-batch-remove-img:hover, .lightbox-ctrl-btn.btn-pool-delete-img:hover {
      background: #ef4444 !important;
      border-color: #ef4444 !important;
      color: #fff !important;
    }
    /* スマホ表示ではさらにスッキリ */
    @media (max-width: 600px) {
      .lightbox-arrow-btn {
        width: 38px;
        height: 38px;
        font-size: 1.3rem;
        background: rgba(0, 0, 0, 0.4);
      }
      .lightbox-arrow-btn.prev {
        left: 8px;
      }
      .lightbox-arrow-btn.next {
        right: 8px;
      }
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
      <div style="display: flex; gap: 10px; flex-wrap: wrap; min-height: 40px; margin-top: 10px;" class="thumbs-scroll-container">
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
          <div class="batch-group-btn-container">
            <button type="button" class="btn-secondary btn-batch-open-editor" data-gidx="${gIdx}" style="font-size: 0.75rem; padding: 4px 8px;">✏️ 詳細編集</button>
            <button type="button" class="btn-secondary btn-batch-analyze" data-gidx="${gIdx}" style="font-size: 0.75rem; padding: 4px 8px;">🤖 AI解析</button>
            <button type="button" class="btn-secondary btn-batch-split" data-gidx="${gIdx}" style="font-size: 0.75rem; padding: 4px 8px;" title="分割">✂️ 分割</button>
            <button type="button" class="btn-secondary btn-batch-delete-group" data-gidx="${gIdx}" style="font-size: 0.75rem; padding: 4px 8px; color: #ef4444; border-color: #ef4444;" title="グループごと削除">🗑️ 削除</button>
          </div>
        </div>

        <div style="font-size: 0.75rem; color: var(--text-sub); margin-bottom: 6px;">💡 写真をタップすると拡大操作メニューが開きます。ドラッグ＆ドロップでも並び替えできます。</div>
        <div class="thumbs-scroll-container" style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; min-height: 50px;">
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
  let indicatorHTML = '';
  let arrowPrevHTML = '';
  let arrowNextHTML = '';
  let total = 0;

  if (ctx) {
    if (ctx.type === 'editor-preview') {
      const idx = ctx.idx;
      total = uploadedImages.length;
      const isMain = idx === activeThumbnailIndex;

      indicatorHTML = `<div class="lightbox-indicator">${idx + 1} / ${total}</div>`;

      // 左右の画像めくりアロー
      if (total > 1) {
        arrowPrevHTML = `<button type="button" class="lightbox-arrow-btn prev" ${idx > 0 ? '' : 'style="opacity: 0.15; cursor: not-allowed; pointer-events: none;"'} title="前の写真へ">‹</button>`;
        arrowNextHTML = `<button type="button" class="lightbox-arrow-btn next" ${idx < total - 1 ? '' : 'style="opacity: 0.15; cursor: not-allowed; pointer-events: none;"'} title="次の写真へ">›</button>`;
      }

      controlsHTML = `
        <div class="lightbox-controls" style="display: flex; gap: 10px; justify-content: center; margin-top: 16px; flex-wrap: wrap; width: 100%; max-width: 480px; pointer-events: auto;">
          ${isMain 
            ? `<button type="button" class="lightbox-ctrl-btn btn-main-set" disabled style="background: #10b981; border: none; color: #fff; cursor: default; pointer-events: none;">👑 代表メイン写真</button>` 
            : `<button type="button" class="lightbox-ctrl-btn btn-main-unset" data-idx="${idx}">☆ メインに設定</button>`
          }
          <button type="button" class="lightbox-ctrl-btn btn-delete-img" data-idx="${idx}">🗑️ 削除</button>
        </div>
      `;
    } else if (ctx.type === 'batch-group') {
      const gIdx = ctx.gidx;
      const iIdx = ctx.iidx;
      const group = batchGroups[gIdx];
      total = group ? group.length : 0;
      const isMain = iIdx === 0;

      indicatorHTML = `<div class="lightbox-indicator">${iIdx + 1} / ${total}</div>`;

      // 左右の画像めくりアロー
      if (total > 1) {
        arrowPrevHTML = `<button type="button" class="lightbox-arrow-btn prev" ${iIdx > 0 ? '' : 'style="opacity: 0.15; cursor: not-allowed; pointer-events: none;"'} title="前の写真へ">‹</button>`;
        arrowNextHTML = `<button type="button" class="lightbox-arrow-btn next" ${iIdx < total - 1 ? '' : 'style="opacity: 0.15; cursor: not-allowed; pointer-events: none;"'} title="次の写真へ">›</button>`;
      }

      controlsHTML = `
        <div class="lightbox-controls" style="display: flex; gap: 10px; justify-content: center; margin-top: 16px; flex-wrap: wrap; width: 100%; max-width: 480px; pointer-events: auto;">
          ${isMain 
            ? `<button type="button" class="lightbox-ctrl-btn btn-batch-main-set" disabled style="background: #10b981; border: none; color: #fff; cursor: default; pointer-events: none;">👑 代表メイン写真</button>` 
            : `<button type="button" class="lightbox-ctrl-btn btn-batch-main-unset" data-gidx="${gIdx}" data-iidx="${iIdx}">☆ メインに設定</button>`
          }
          <button type="button" class="lightbox-ctrl-btn btn-batch-remove-img" data-gidx="${gIdx}" data-iidx="${iIdx}">📤 プールへ外す</button>
        </div>
      `;
} else if (ctx.type === 'pool') {
      const idx = ctx.poolIdx;
      total = ungroupedImages.length;
      indicatorHTML = `<div class="lightbox-indicator">${idx + 1} / ${total}</div>`;

      // プール内の画像めくりアロー
      if (total > 1) {
        arrowPrevHTML = `<button type="button" class="lightbox-arrow-btn prev" ${idx > 0 ? '' : 'style="opacity: 0.15; cursor: not-allowed; pointer-events: none;"'} title="前の写真へ">‹</button>`;
        arrowNextHTML = `<button type="button" class="lightbox-arrow-btn next" ${idx < total - 1 ? '' : 'style="opacity: 0.15; cursor: not-allowed; pointer-events: none;"'} title="次の写真へ">›</button>`;
      }

      // 既存の未保存グループ一覧を選択できるセレクトドロップダウン
      let groupOptionsHTML = '';
      if (batchGroups.length > 0) {
        groupOptionsHTML = `
          <div style="display: flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.08); padding: 4px 10px; border-radius: 24px; border: 1px solid rgba(255,255,255,0.15); pointer-events: auto;">
            <select class="lightbox-group-selector" style="background: transparent; color: #fff; border: none; font-size: 0.8rem; outline: none; max-width: 140px; cursor: pointer; font-weight: bold;">
              ${batchGroups.map((g, i) => `<option value="${i}" style="background: #1e293b; color: #fff;">🍶 グループ #${i+1} (${g.length}枚)</option>`).join('')}
            </select>
            <button type="button" class="lightbox-ctrl-btn btn-pool-add-to-group" data-idx="${idx}" style="background: var(--accent-color) !important; color: #000 !important; border: none !important; padding: 6px 14px !important; font-size: 0.8rem !important; border-radius: 16px !important; height: auto !important; margin: 0 !important; box-shadow: none !important;">➕ 追加</button>
          </div>
        `;
      }

      controlsHTML = `
        <div class="lightbox-controls" style="display: flex; gap: 10px; justify-content: center; margin-top: 16px; flex-wrap: wrap; width: 100%; max-width: 480px; pointer-events: auto;">
          <button type="button" class="lightbox-ctrl-btn btn-pool-create-group" data-idx="${idx}" style="background: #10b981 !important; border-color: #10b981 !important; color: #fff !important;">✨ 新しいお酒にする</button>
          ${groupOptionsHTML}
          <button type="button" class="lightbox-ctrl-btn btn-pool-delete-img" data-idx="${idx}" style="background: rgba(239, 68, 68, 0.15) !important; border-color: rgba(239, 68, 68, 0.3) !important; color: #ef4444 !important;">🗑️ 完全に削除</button>
        </div>
      `;
    }
  }

  lightbox.innerHTML = `
    <div class="lightbox-content" style="display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; width: 100%;">
      <button type="button" class="lightbox-close" style="pointer-events: auto;">&times;</button>
      ${arrowPrevHTML}
      <img id="lightbox-img" src="${imageSrc}" alt="拡大画像" style="max-height: 60vh !important; pointer-events: auto; cursor: zoom-out;" />
      ${arrowNextHTML}
      ${indicatorHTML}
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

// 📸 ライトボックス内のスワイプ切替用ヘルパー関数
function triggerLightboxNext() {
  if (!activeLightboxCtx) return;
  const ctx = activeLightboxCtx;
  if (ctx.type === 'editor-preview') {
    const idx = ctx.idx;
    if (idx < uploadedImages.length - 1) {
      const nextIdx = idx + 1;
      ctx.idx = nextIdx;
      openLightbox(uploadedImages[nextIdx].previewUrl, ctx);
    }
  } else if (ctx.type === 'batch-group') {
    const gIdx = ctx.gidx;
    const iIdx = ctx.iidx;
    const group = batchGroups[gIdx];
    if (group && iIdx < group.length - 1) {
      const nextIIdx = iIdx + 1;
      ctx.iidx = nextIIdx;
      openLightbox(group[nextIIdx].previewUrl, ctx);
    }
  } else if (ctx.type === 'pool') {
    const idx = ctx.poolIdx;
    if (idx < ungroupedImages.length - 1) {
      const nextIdx = idx + 1;
      ctx.poolIdx = nextIdx;
      openLightbox(ungroupedImages[nextIdx].previewUrl, ctx);
    }
  }
}

function triggerLightboxPrev() {
  if (!activeLightboxCtx) return;
  const ctx = activeLightboxCtx;
  if (ctx.type === 'editor-preview') {
    const idx = ctx.idx;
    if (idx > 0) {
      const prevIdx = idx - 1;
      ctx.idx = prevIdx;
      openLightbox(uploadedImages[prevIdx].previewUrl, ctx);
    }
  } else if (ctx.type === 'batch-group') {
    const gIdx = ctx.gidx;
    const iIdx = ctx.iidx;
    const group = batchGroups[gIdx];
    if (group && iIdx > 0) {
      const prevIIdx = iIdx - 1;
      ctx.iidx = prevIIdx;
      openLightbox(group[prevIIdx].previewUrl, ctx);
    }
  } else if (ctx.type === 'pool') {
    const idx = ctx.poolIdx;
    if (idx > 0) {
      const prevIdx = idx - 1;
      ctx.poolIdx = prevIdx;
      openLightbox(ungroupedImages[prevIdx].previewUrl, ctx);
    }
  }
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
    <div class="preview-item ${idx === 0 ? 'is-thumb' : ''}" data-idx="${idx}" style="position: relative; overflow: hidden; user-select: none; touch-action: none;">
      <img src="${img.previewUrl}" alt="Preview" data-action="enlarge-image" data-context-type="editor-preview" data-idx="${idx}" style="user-drag: none; -webkit-user-drag: none;" />
      <div class="preview-actions">
        <button type="button" class="btn-img-del" data-idx="${idx}" title="削除">✕</button>
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

  const items = [];
  const failedFiles = [];

  for (const file of files) {
    // 拡張子やタイプから画像であることを判定 (HEIC等のタイプが空になるケースにも対応)
    const isImage = file.type.startsWith('image/') || /\.(heic|heif|png|jpe?g|webp|gif)$/i.test(file.name);
    if (!isImage) continue;

    try {
      const compressed = await compressImage(file);
      
      // 日付の安全な検証・取得 (Invalid Dateを完全に排除)
      let date = null;
      if (file.lastModified) {
        const d = new Date(file.lastModified);
        if (!isNaN(d.getTime())) {
          date = d;
        }
      }

      items.push({
        file,
        date,
        blob: compressed.blob,
        base64: compressed.base64,
        mimeType: compressed.mimeType,
        previewUrl: URL.createObjectURL(compressed.blob)
      });
    } catch (e) {
      console.error(`ファイル ${file.name} の処理に失敗しました:`, e);
      failedFiles.push(file.name);
    }
  }

  try {
    if (items.length > 0) {
      // 送信する items 内の日付データが確実に安全（Date または null）であることを保証
      const cleansedItems = items.map(item => ({
        ...item,
        date: (item.date && !isNaN(item.date.getTime())) ? item.date : null
      }));

      const newGroups = groupImagesByTime(cleansedItems, 3 * 60 * 1000, 5);
      if (append) {
        batchGroups = batchGroups.concat(newGroups);
      } else {
        batchGroups = newGroups;
      }

      if (failedFiles.length > 0) {
        alert(`一部の画像（${failedFiles.length}枚）の読み込みに失敗しました。HEIC形式や破損している可能性があります：
・` + failedFiles.join('
・'));
      }
    } else {
      if (failedFiles.length > 0) {
        alert(`画像の読み込みに失敗しました。対応していない形式（HEIC等）の可能性があります：
・` + failedFiles.join('
・'));
      } else {
        alert('有効な画像ファイルが見つかりませんでした。');
      }
    }
  } catch (err) {
    console.error('Batch Grouping Error:', err);
    alert('画像の自動グルーピング処理中に予期せぬエラーが発生しました。');
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

      // [単体登録エディタ] メイン画像設定（未設定状態から設定）
      if (lbBtn.classList.contains('btn-main-unset')) {
        activeThumbnailIndex = Number(lbBtn.dataset.idx);
        renderImagePreviewList();
        if (activeLightboxCtx) {
          openLightbox(uploadedImages[activeThumbnailIndex].previewUrl, activeLightboxCtx);
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

      // [一括登録グループ] メイン画像設定（未設定状態から設定）
      if (lbBtn.classList.contains('btn-batch-main-unset')) {
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

      // [プール] 新しいお酒グループとして独立登録
      if (lbBtn.classList.contains('btn-pool-create-group')) {
        const idx = Number(lbBtn.dataset.idx);
        const item = ungroupedImages.splice(idx, 1)[0];
        if (item) {
          batchGroups.push([item]);
          renderBatchGroupsUI();
        }
        closeLightbox();
        return;
      }

      // [プール] 既存の特定お酒グループに追加
      if (lbBtn.classList.contains('btn-pool-add-to-group')) {
        const idx = Number(lbBtn.dataset.idx);
        const selector = document.querySelector('.lightbox-group-selector');
        const gIdx = selector ? Number(selector.value) : -1;
        if (!isNaN(gIdx) && gIdx >= 0 && gIdx < batchGroups.length) {
          const item = ungroupedImages.splice(idx, 1)[0];
          if (item) {
            batchGroups[gIdx].push(item);
            renderBatchGroupsUI();
          }
        }
        closeLightbox();
        return;
      }
    }

    // 左右アローボタンによる画像閲覧・切り替えハンドラー
    const arrowBtn = e.target.closest('.lightbox-arrow-btn');
    if (arrowBtn) {
      e.stopPropagation();
      e.preventDefault();
      if (arrowBtn.classList.contains('prev')) {
        triggerLightboxPrev();
      } else if (arrowBtn.classList.contains('next')) {
        triggerLightboxNext();
      }
      return;
    }

    // 各ファイル選択用のタップエミュレート
    if (e.target.closest('#batch-upload-zone') || e.target.closest('#btn-add-more-batch')) {
      e.preventDefault();
      const batchInput = document.getElementById('batch-file-input');
      if (batchInput) batchInput.click();
      return;
    }    const saveAllBtn = e.target.closest('#btn-save-all-batches');
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
          
          // 🛡️ 【重大安全ガード1】写真が1枚もない空のグループは処理をスキップする
          if (!group || group.length === 0) {
            console.warn(`警告: 空のお酒グループ #${gIdx + 1} をスキップしました。`);
            continue;
          }
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

          // 🛡️ 【重大安全ガード2】無効な日付（Invalid Date）による toISOString() の停止バグを完全に回避する
          let mainDate = '';
          const rawDate = group[0]?.date;
          if (rawDate) {
            const dateObj = (rawDate instanceof Date) ? rawDate : new Date(rawDate);
            if (!isNaN(dateObj.getTime())) {
              mainDate = dateObj.toISOString().split('T')[0];
            }
          }

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

// 並び順は PointerEvents スワイプで並び替えられた orderedBlobs を100%そのまま保存する

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


    // ==========================================================================
  // 📱💻 スマホ・PC共通：【極上の操作感】PointerEvents「オートギャップ隙間空け並び替え」＆「スライド閲覧めくり」
  // ==========================================================================
  let pointerStartX = 0;
  let pointerStartY = 0;
  let pointerStartTime = 0;
  let isDragging = false;
  let activeSwipeThumb = null;
  let isMoveTriggered = false;

  document.addEventListener('pointerdown', (e) => {
    // 左クリックまたはタッチ開始のみを対象とする
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    const lightbox = document.getElementById('lightbox-modal');
    if (lightbox && lightbox.classList.contains('active')) {
      const img = lightbox.querySelector('#lightbox-img');
      const closeBtn = lightbox.querySelector('.lightbox-close');
      const ctrlBtn = e.target.closest('.lightbox-ctrl-btn, .lightbox-arrow-btn');
      
      // 閉じるボタンや操作ボタンの上ではドラッグを起動しない
      if (closeBtn && (e.target === closeBtn || closeBtn.contains(e.target))) return;
      if (ctrlBtn) return;

      pointerStartX = e.clientX;
      pointerStartY = e.clientY;
      pointerStartTime = Date.now();
      isDragging = true;
      isMoveTriggered = false;
      
      if (img) {
        img.style.transition = 'none';
        img.setPointerCapture(e.pointerId);
      }
    } else {
      const thumb = e.target.closest('.preview-item, .draggable-thumb');
      // ✕ボタン(btn-img-del, btn-batch-remove-img)の上ではドラッグを起動しない
      if (thumb && !e.target.closest('button')) {
        activeSwipeThumb = thumb;
        pointerStartX = e.clientX;
        pointerStartY = e.clientY;
        pointerStartTime = Date.now();
        isDragging = true;
        isMoveTriggered = false;
        activeSwipeThumb.style.transition = 'none';
        activeSwipeThumb.style.zIndex = '9999';
        activeSwipeThumb.setPointerCapture(e.pointerId);
      }
    }
  }, { passive: false });

  document.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    const diffX = e.clientX - pointerStartX;
    const diffY = e.clientY - pointerStartY;

    const lightbox = document.getElementById('lightbox-modal');
    if (lightbox && lightbox.classList.contains('active')) {
      const img = lightbox.querySelector('#lightbox-img');
      if (img && img.hasPointerCapture(e.pointerId)) {
        e.preventDefault();
        // わずかなブレ（8px）を排除して本格ドラッグ開始
        if (Math.abs(diffX) > 8) {
          isMoveTriggered = true;
          // 画像を指に吸いつかせて滑らかにスライド
          img.style.transform = `translateX(${diffX}px) scale(0.98)`;
        }
      }
    } else if (activeSwipeThumb && activeSwipeThumb.hasPointerCapture(e.pointerId)) {
      // 10px以上の移動でドラッグ開始
      if (Math.abs(diffX) > 10) {
        e.preventDefault();
        isMoveTriggered = true;

        // ドラッグ対象を指に吸いつかせる
        activeSwipeThumb.style.transform = `translateX(${diffX}px) scale(1.08) rotate(${diffX * 0.05}deg)`;
        activeSwipeThumb.style.boxShadow = '0 10px 25px rgba(0,0,0,0.35)';

        // 🌟【大本命】オートギャップ（隙間空け）アニメーションの実装 🌟
const isEditor = activeSwipeThumb.classList.contains('preview-item');
        const isBatch = activeSwipeThumb.classList.contains('draggable-thumb') && activeSwipeThumb.dataset.sourceType === 'group';
        const isPool = activeSwipeThumb.classList.contains('draggable-thumb') && activeSwipeThumb.dataset.sourceType === 'pool';
        
        let siblings = [];
        let curIdx = -1;
        if (isEditor) {
          siblings = Array.from(document.querySelectorAll('#image-preview-list .preview-item'));
          curIdx = Number(activeSwipeThumb.dataset.idx);
        } else if (isBatch) {
          const gIdx = Number(activeSwipeThumb.dataset.gidx);
          siblings = Array.from(document.querySelectorAll(`.batch-group-card[data-gidx="${gIdx}"] .draggable-thumb`));
          curIdx = Number(activeSwipeThumb.dataset.iidx);
        } else if (isPool) {
          siblings = Array.from(document.querySelectorAll('#ungrouped-pool-container .draggable-thumb'));
          curIdx = Number(activeSwipeThumb.dataset.idx);
        }

        if (curIdx !== -1 && !isNaN(curIdx)) {
          const itemWidth = activeSwipeThumb.offsetWidth || 90;
          const step = itemWidth + 10; // アイテム幅 + マージン（10px）
          
          // 掴んでいる要素が現在どのインデックスの位置まで侵入しているかを計算
          const offsetIndices = Math.round(diffX / step);
          let targetIdx = curIdx + offsetIndices;
          targetIdx = Math.max(0, Math.min(siblings.length - 1, targetIdx));

          siblings.forEach((sib, sIdx) => {
            if (sib === activeSwipeThumb) return;
            sib.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)';
            
            if (curIdx < targetIdx) {
              // 右方向にドラッグ中：curIdx より後ろで targetIdx 以下の要素は左にズレる
              if (sIdx > curIdx && sIdx <= targetIdx) {
                sib.style.transform = `translateX(${-step}px)`;
              } else {
                sib.style.transform = 'none';
              }
            } else if (curIdx > targetIdx) {
              // 左方向にドラッグ中：targetIdx 以上で curIdx より前の要素は右にズレる
              if (sIdx >= targetIdx && sIdx < curIdx) {
                sib.style.transform = `translateX(${step}px)`;
              } else {
                sib.style.transform = 'none';
              }
            } else {
              sib.style.transform = 'none';
            }
          });
        }
      }
    }
  }, { passive: false });

  document.addEventListener('pointerup', (e) => {
    if (!isDragging) return;
    isDragging = false;

    const diffX = e.clientX - pointerStartX;
    const diffY = e.clientY - pointerStartY;
    const duration = Date.now() - pointerStartTime;

    const lightbox = document.getElementById('lightbox-modal');
    if (lightbox && lightbox.classList.contains('active')) {
      const img = lightbox.querySelector('#lightbox-img');
      if (img && img.hasPointerCapture(e.pointerId)) {
        img.releasePointerCapture(e.pointerId);
        img.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)';

        // ほとんど動いていない(10px未満)、かつタップしただけなら何もしない
        if (!isMoveTriggered) {
          img.style.transform = 'translateX(0) scale(1)';
          return;
        }

        // 50px以上動かした、またはすばやいフリックの場合に画像をめくる
        if (Math.abs(diffX) > 55 || (duration < 300 && Math.abs(diffX) > 30)) {
          if (diffX < 0) {
            img.style.transform = 'translateX(-120%) scale(0.9)';
            setTimeout(() => {
              triggerLightboxNext();
              const updatedImg = document.getElementById('lightbox-img');
              if (updatedImg) {
                updatedImg.style.transition = 'none';
                updatedImg.style.transform = 'translateX(120%) scale(0.9)';
                updatedImg.offsetHeight; // リフロー
                updatedImg.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)';
                updatedImg.style.transform = 'translateX(0) scale(1)';
              }
            }, 180);
          } else {
            img.style.transform = 'translateX(120%) scale(0.9)';
            setTimeout(() => {
              triggerLightboxPrev();
              const updatedImg = document.getElementById('lightbox-img');
              if (updatedImg) {
                updatedImg.style.transition = 'none';
                updatedImg.style.transform = 'translateX(-120%) scale(0.9)';
                updatedImg.offsetHeight; // リフロー
                updatedImg.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)';
                updatedImg.style.transform = 'translateX(0) scale(1)';
              }
            }, 180);
          }
        } else {
          img.style.transform = 'translateX(0) scale(1)';
        }
      }
    } else if (activeSwipeThumb) {
      const thumb = activeSwipeThumb;
      activeSwipeThumb = null;
      if (thumb.hasPointerCapture(e.pointerId)) {
        thumb.releasePointerCapture(e.pointerId);
      }

// スライドされた周りの要素（siblings）のスタイルを綺麗にリセットする
      const isEditor = thumb.classList.contains('preview-item');
      const isBatch = thumb.classList.contains('draggable-thumb') && thumb.dataset.sourceType === 'group';
      const isPool = thumb.classList.contains('draggable-thumb') && thumb.dataset.sourceType === 'pool';
      
      let siblings = [];
      if (isEditor) {
        siblings = Array.from(document.querySelectorAll('#image-preview-list .preview-item'));
      } else if (isBatch) {
        const gIdx = Number(thumb.dataset.gidx);
        siblings = Array.from(document.querySelectorAll(`.batch-group-card[data-gidx="${gIdx}"] .draggable-thumb`));
      } else if (isPool) {
        siblings = Array.from(document.querySelectorAll('#ungrouped-pool-container .draggable-thumb'));
      }
      siblings.forEach(sib => {
        sib.style.transition = 'none';
        sib.style.transform = 'none';
      });

      thumb.style.transition = 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.15)';

      // 🌟 タップ操作（拡大起動）のインテリジェント検出
      if (!isMoveTriggered && Math.abs(diffX) < 10 && Math.abs(diffY) < 10 && duration < 250) {
        thumb.style.transform = 'none';
        thumb.style.zIndex = '';
        thumb.style.boxShadow = 'none';
        
        const imgEl = thumb.querySelector('img');
        if (imgEl) {
          const contextType = imgEl.dataset.contextType;
          let ctxData = null;
          if (contextType === 'editor-preview') {
            ctxData = { type: 'editor-preview', idx: Number(imgEl.dataset.idx) };
          } else if (contextType === 'batch-group') {
            ctxData = { type: 'batch-group', gidx: Number(imgEl.dataset.gidx), iidx: Number(imgEl.dataset.iidx) };
          } else if (contextType === 'pool') {
            ctxData = { type: 'pool', poolIdx: Number(imgEl.dataset.poolIdx) };
          }
          openLightbox(imgEl.src, ctxData);
        }
        return;
      }

      // 🌟【大進化】オートギャップに基づいた、多段階一括並び替え処理！
      const itemWidth = thumb.offsetWidth || 90;
      const step = itemWidth + 10;
      const offsetIndices = Math.round(diffX / step);

      if (Math.abs(offsetIndices) >= 1) {
        if (isEditor) {
          const imgEl = thumb.querySelector('img');
          if (imgEl && imgEl.dataset.idx !== undefined) {
            const idx = Number(imgEl.dataset.idx);
            if (!isNaN(idx)) {
              let targetIdx = idx + offsetIndices;
              targetIdx = Math.max(0, Math.min(uploadedImages.length - 1, targetIdx));
              
              if (targetIdx !== idx) {
                // 配列の安全な移動（挿入型入れ替え）
                const [movedItem] = uploadedImages.splice(idx, 1);
                uploadedImages.splice(targetIdx, 0, movedItem);
                
                // 0番目がメイン写真になる
                activeThumbnailIndex = 0;
                
                // 元のドラッグ要素をスライドバックするアニメーションを設定
                thumb.style.transform = `translateX(${-offsetIndices * step}px) scale(0.9)`;
                setTimeout(() => {
                  renderImagePreviewList();
                }, 120);
                return;
              }
            }
          }
} else if (isBatch) {
          const gIdx = Number(thumb.dataset.gidx);
          const iIdx = Number(thumb.dataset.iidx);
          if (!isNaN(gIdx) && !isNaN(iIdx) && batchGroups[gIdx]) {
            const group = batchGroups[gIdx];
            let targetIIdx = iIdx + offsetIndices;
            targetIIdx = Math.max(0, Math.min(group.length - 1, targetIIdx));
            
            if (targetIIdx !== iIdx) {
              const [movedItem] = group.splice(iIdx, 1);
              group.splice(targetIIdx, 0, movedItem);
              
              thumb.style.transform = `translateX(${-offsetIndices * step}px) scale(0.9)`;
              setTimeout(() => {
                renderBatchGroupsUI();
              }, 120);
              return;
            }
          }
        } else if (isPool) {
          const idx = Number(thumb.dataset.idx);
          if (!isNaN(idx)) {
            let targetIdx = idx + offsetIndices;
            targetIdx = Math.max(0, Math.min(ungroupedImages.length - 1, targetIdx));
            
            if (targetIdx !== idx) {
              const [movedItem] = ungroupedImages.splice(idx, 1);
              ungroupedImages.splice(targetIdx, 0, movedItem);
              
              thumb.style.transform = `translateX(${-offsetIndices * step}px) scale(0.9)`;
              setTimeout(() => {
                renderBatchGroupsUI();
              }, 120);
              return;
            }
          }
        }
      }
      
      // 移動が発生しなかった場合は元の位置に戻す
      thumb.style.transform = 'none';
      thumb.style.zIndex = '';
      thumb.style.boxShadow = 'none';
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
