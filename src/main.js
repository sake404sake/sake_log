// src/main.js
import { populateModelDropdown, hasApiKey, analyzeLabelImage, setSavedModel, saveApiKey } from './services/gemini.js';
import { renderSettingsView } from './views/settings.js';
import { renderLogEditorModal, openEditorModal, closeEditorModal, handleImageFiles, runAIAnalysis, updateFieldRevertUI, syncEditorFormToCurrentBatchGroup, renderImagePreviewList, TRACKED_FIELDS } from './views/logEditor.js';
import { renderLogDetailModal, openDetailModal, closeDetailModal } from './views/logDetail.js';
import { renderLogListView } from './views/logList.js';
import { saveLog, deleteLog, clearAllDrafts, openDB, getDraftLogs } from './store/db.js';
import { renderBatchImportView, renderBatchGroupsUI, processFilesForBatch } from './views/batchImport.js';
import { openLightbox, closeLightbox, triggerLightboxNext, triggerLightboxPrev } from './views/lightbox.js';
import { state, base64ToBlob, blobToBase64 } from './store/state.js';
import { syncAllData, loginGoogle, logoutGoogle, destroyAllSellaData, initGoogleAuth } from './services/googleDrive.js';

function ensureSpinnerStyles() {
  if (document.getElementById('sella-spinner-style')) return;
  const style = document.createElement('style');
  style.id = 'sella-spinner-style';
  style.textContent = `
    @keyframes sellaSpin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    .sella-spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-radius: 50%; border-top-color: #fff; animation: sellaSpin 0.8s linear infinite; vertical-align: middle; margin-right: 6px; }
    .draggable-thumb { cursor: grab; transition: transform 0.15s, opacity 0.15s; touch-action: none; box-sizing: border-box; -webkit-touch-callout: none !important; -webkit-user-select: none !important; user-select: none !important; overflow: visible !important; }
    .draggable-thumb:active { cursor: grabbing; }
    .batch-group-card.drag-over, #ungrouped-pool-container.drag-over { border-color: var(--accent-color) !important; background: var(--card-hover-bg, rgba(255,255,255,0.06)) !important; }

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
    .batch-group-btn-container::-webkit-scrollbar { display: none !important; }
    .batch-group-btn-container button { flex-shrink: 0 !important; font-size: 0.72rem !important; padding: 6px 10px !important; }

    #batch-preview-section > div:first-child {
      display: flex !important;
      flex-direction: column !important;
      align-items: flex-start !important;
      gap: 12px !important;
      width: 100% !important;
      box-sizing: border-box !important;
    }
    #batch-group-count-title { font-size: 1.1rem !important; line-height: 1.4 !important; white-space: normal !important; width: 100% !important; }

    @media (max-width: 600px) {
      body, #app, #batch-preview-section, #batch-groups-container { max-width: 100% !important; box-sizing: border-box !important; overflow-x: hidden !important; }
      #ungrouped-pool-container {
        left: 8px !important; right: 8px !important; bottom: 8px !important;
        width: calc(100% - 16px) !important; max-width: calc(100% - 16px) !important;
        box-sizing: border-box !important; border-radius: 12px !important; padding: 10px 12px !important;
        box-shadow: 0 -8px 24px rgba(0,0,0,0.6) !important; position: fixed !important; z-index: 9999 !important;
      }
      #ungrouped-pool-container .thumbs-scroll-container { display: flex !important; flex-wrap: wrap !important; gap: 8px !important; padding-bottom: 4px !important; min-height: 80px !important; }
      #ungrouped-pool-container .draggable-thumb { width: 80px !important; height: 80px !important; min-height: 80px !important; flex-shrink: 0 !important; }
      .batch-group-card { width: 100% !important; max-width: 100% !important; padding: 12px !important; margin-bottom: 10px !important; box-sizing: border-box !important; overflow: visible !important; }
      .batch-group-card-header { flex-direction: column !important; align-items: flex-start !important; gap: 8px !important; width: 100% !important; box-sizing: border-box !important; }
      .batch-group-btn-container { width: 100% !important; justify-content: flex-start !important; }
      .batch-group-card .thumbs-scroll-container { display: flex !important; flex-wrap: wrap !important; gap: 8px !important; padding-bottom: 4px !important; max-width: 100% !important; box-sizing: border-box !important; }
      .batch-group-card .draggable-thumb { width: 80px !important; height: 80px !important; min-height: 80px !important; flex-shrink: 0 !important; }
      .batch-group-card .form-row { display: flex !important; flex-direction: column !important; gap: 8px !important; width: 100% !important; box-sizing: border-box !important; }
      .batch-group-card .form-row input { width: 100% !important; max-width: 100% !important; box-sizing: border-box !important; }
    }

    .preview-item, .add-more-item {
      width: 90px !important; height: 90px !important; min-height: 90px !important; position: relative !important;
      touch-action: none !important; box-sizing: border-box !important; -webkit-touch-callout: none !important;
      -webkit-user-select: none !important; user-select: none !important; overflow: visible !important;
    }
    .preview-item img, .draggable-thumb img {
      width: 100% !important; height: 100% !important; object-fit: cover !important; border-radius: 6px !important;
      cursor: grab !important; -webkit-touch-callout: none !important; -webkit-user-select: none !important;
      user-select: none !important; -webkit-user-drag: none !important;
    }
    .preview-item img:active, .draggable-thumb img:active { cursor: grabbing !important; }

    .btn-img-del, .btn-batch-remove-img, .btn-ungrouped-remove {
      position: absolute !important; top: -6px !important; right: -6px !important; background: #ef4444 !important;
      color: #fff !important; border: 1px solid rgba(255,255,255,0.2) !important; border-radius: 50% !important;
      width: 24px !important; height: 24px !important; font-size: 11px !important; font-weight: bold !important;
      cursor: pointer !important; display: flex !important; align-items: center !important; justify-content: center !important;
      z-index: 30 !important; pointer-events: auto !important; box-shadow: 0 2px 6px rgba(0,0,0,0.5) !important;
    }

    @media (min-width: 601px) {
      .btn-img-del { opacity: 0 !important; transition: opacity 0.2s ease !important; }
      .preview-item:hover .btn-img-del { opacity: 1 !important; }
    }
    @media (max-width: 600px) {
      .preview-item, .add-more-item { width: 85px !important; height: 85px !important; min-height: 85px !important; }
      .btn-img-del, .btn-batch-remove-img, .btn-ungrouped-remove { opacity: 1 !important; }
    }
  `;
  document.head.appendChild(style);
}

export function setTheme(themeName) {
  const validThemes = ['dark', 'light', 'sakura', 'gaming', 'japan-modern'];
  let targetTheme = themeName;
  if (!targetTheme || !validThemes.includes(targetTheme)) {
    console.warn(`無効なテーマ名 "${themeName}" が検出されたため、デフォルトの "dark" テーマに自己復旧しました。`);
    targetTheme = 'dark';
  }
  document.documentElement.setAttribute('data-theme', targetTheme);
  localStorage.setItem('sella_theme', targetTheme);

  const themeSelect = document.getElementById('theme-select');
  if (themeSelect && themeSelect.value !== targetTheme) {
    themeSelect.value = targetTheme;
  }
}

function initTheme() {
  const savedTheme = localStorage.getItem('sella_theme');
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

export async function navigateTo(viewName) {
  const appContainer = document.getElementById('app');
  if (!appContainer) return;

  const key = viewName ? viewName.toLowerCase() : 'dashboard';
  state.currentViewName = key;
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

export async function syncBatchStateToDB() {
  try {
    await clearAllDrafts();

    if (state.ungroupedImages.length > 0) {
      const poolBlobs = [];
      const poolItemsMeta = [];
      for (const item of state.ungroupedImages) {
        let blob = item.blob;
        if (!blob && item.base64) {
          blob = base64ToBlob(item.base64, item.mimeType || 'image/jpeg');
        }
        if (blob instanceof Blob) {
          poolBlobs.push(blob);
          poolItemsMeta.push({
            base64: item.base64,
            mimeType: item.mimeType || 'image/jpeg',
            date: item.date ? item.date.toISOString() : null
          });
        }
      }
      const poolLogData = { id: 'system_image_pool', status: 'draft', isPool: true, name: '画像プール', poolItemsMeta };
      await saveLog(poolLogData, poolBlobs);
    }

    for (let gIdx = 0; gIdx < state.batchGroups.length; gIdx++) {
      const group = state.batchGroups[gIdx];
      if (!group || group.length === 0) continue;

      const groupBlobs = [];
      const groupItemsMeta = [];
      for (const item of group) {
        let blob = item.blob;
        if (!blob && item.base64) {
          blob = base64ToBlob(item.base64, item.mimeType || 'image/jpeg');
        }
        if (blob instanceof Blob) {
          groupBlobs.push(blob);
          groupItemsMeta.push({
            base64: item.base64,
            mimeType: item.mimeType || 'image/jpeg',
            date: item.date ? item.date.toISOString() : null
          });
        }
      }
      const groupLogData = {
        id: 'draft_group_' + gIdx,
        status: 'draft',
        isGrouped: true,
        name: group.name || '',
        brewery: group.brewery || '',
        category: group.category || '日本酒',
        productName: group.productName || '',
        region: group.region || '',
        type: group.type || '',
        abv: group.abv || '',
        notes: group.notes || '',
        aiInfo: group.aiInfo || '',
        backupFormData: group.backupFormData ? { ...group.backupFormData } : null,
        groupItemsMeta
      };
      await saveLog(groupLogData, groupBlobs);
    }

    if (state.isGoogleLoggedIn) {
      syncAllData(true);
    }
  } catch (err) {
    console.error('[DraftSync] Autosave failed:', err);
  }
}

export async function loadBatchStateFromDB() {
  try {
    const drafts = await getDraftLogs();
    if (drafts.length === 0) return;

    state.batchGroups = [];
    state.ungroupedImages = [];

    const poolLog = drafts.find(d => d.isPool);
    if (poolLog && poolLog.imageUrls && poolLog.imageUrls.length > 0) {
      const poolImages = poolLog.images || [];
      const metaList = poolLog.poolItemsMeta || [];
      for (let i = 0; i < poolLog.imageUrls.length; i++) {
        const previewUrl = poolLog.imageUrls[i];
        const blob = poolImages[i];
        const meta = metaList[i] || {};
        state.ungroupedImages.push({
          blob,
          base64: meta.base64 || '',
          mimeType: meta.mimeType || 'image/jpeg',
          previewUrl,
          date: meta.date ? new Date(meta.date) : null
        });
      }
    }

    const groupLogs = drafts.filter(d => d.isGrouped);
    groupLogs.sort((a, b) => {
      const idxA = Number(a.id.replace('draft_group_', ''));
      const idxB = Number(b.id.replace('draft_group_', ''));
      return idxA - idxB;
    });

    for (const gLog of groupLogs) {
      const groupImages = gLog.images || [];
      const metaList = gLog.groupItemsMeta || [];
      const group = [];

      for (let i = 0; i < gLog.imageUrls.length; i++) {
        const previewUrl = gLog.imageUrls[i];
        const blob = groupImages[i];
        const meta = metaList[i] || {};
        group.push({
          blob,
          base64: meta.base64 || '',
          mimeType: meta.mimeType || 'image/jpeg',
          previewUrl,
          date: meta.date ? new Date(meta.date) : null
        });
      }

      group.name = gLog.name || '';
      group.brewery = gLog.brewery || '';
      group.category = gLog.category || '日本酒';
      group.productName = gLog.productName || '';
      group.region = gLog.region || '';
      group.type = gLog.type || '';
      group.abv = gLog.abv || '';
      group.notes = gLog.notes || '';
      group.aiInfo = gLog.aiInfo || '';
      if (gLog.backupFormData) {
        group.backupFormData = { ...gLog.backupFormData };
      }
      state.batchGroups.push(group);
    }
    renderBatchGroupsUI();
  } catch (err) {
    console.error('[DraftSync] Failed to restore drafts:', err);
  }
}

// --------------------------------------------------
// 📱💻 PointerEvents 2Dドラッグ＆ドロップ管理状態
// --------------------------------------------------
let pointerStartX = 0;
let pointerStartY = 0;
let pointerStartTime = 0;
let isDragging = false;
let activeSwipeThumb = null;
let isMoveTriggered = false;
let siblingPositions = [];
let initialSiblings = [];
let targetIdx = -1;

function initApp() {
  ensureSpinnerStyles();
  initGoogleAuth();
  loadBatchStateFromDB();

  if (localStorage.getItem('sella_google_logged_in') === 'true') {
    state.isGoogleLoggedIn = true;
    syncAllData(true);
  }

  document.getElementById('btn-menu-toggle')?.addEventListener('click', openSidebar);
  overlay?.addEventListener('click', closeSidebar);

  document.addEventListener('navigation-request', async (e) => {
    const detail = e.detail;
    const targetView = typeof detail === 'string' ? detail : detail.view;
    await navigateTo(targetView);
    if (detail && detail.renderBatch) {
      renderBatchGroupsUI();
    }
  });

  document.addEventListener('batch-state-modified', async () => {
    await syncBatchStateToDB();
  });

  document.addEventListener('input', async (e) => {
    if (TRACKED_FIELDS.includes(e.target.id)) {
      updateFieldRevertUI();
    }
    if (e.target.classList.contains('batch-name-input')) {
      const gIdx = Number(e.target.dataset.gidx);
      if (state.batchGroups[gIdx]) {
        state.batchGroups[gIdx].name = e.target.value;
        await syncBatchStateToDB();
      }
    }
    if (e.target.classList.contains('batch-brewery-input')) {
      const gIdx = Number(e.target.dataset.gidx);
      if (state.batchGroups[gIdx]) {
        state.batchGroups[gIdx].brewery = e.target.value;
        await syncBatchStateToDB();
      }
    }
    if (e.target && e.target.id === 'destroy-validation-input') {
      const btn = document.getElementById('btn-destroy-all-data');
      if (btn) {
        if (e.target.value.trim() === 'データをすべて消去する') {
          btn.disabled = false;
          btn.style.opacity = '1';
          btn.style.cursor = 'pointer';
        } else {
          btn.disabled = true;
          btn.style.opacity = '0.3';
          btn.style.cursor = 'not-allowed';
        }
      }
    }
  });

  document.addEventListener('change', async (e) => {
    if (e.target && e.target.id === 'theme-select') {
      setTheme(e.target.value);
      if (state.isGoogleLoggedIn) {
        await syncAllData(true);
      }
      return;
    }
    if (e.target && (e.target.id === 'select-gemini-model' || e.target.id === 'modal-model-select')) {
      setSavedModel(e.target.value);
      const globalSelect = document.getElementById('select-gemini-model');
      const modalSelect = document.getElementById('modal-model-select');
      if (globalSelect && globalSelect.value !== e.target.value) globalSelect.value = e.target.value;
      if (modalSelect && modalSelect.value !== e.target.value) modalSelect.value = e.target.value;
      if (state.isGoogleLoggedIn) {
        await syncAllData(true);
      }
      return;
    }
    if (e.target && e.target.id === 'file-input') {
      const files = e.target.files;
      if (files && files.length > 0) {
        await handleImageFiles(files);
      }
      e.target.value = '';
      return;
    }
    if (e.target && e.target.id === 'batch-file-input') {
      const files = e.target.files;
      if (files && files.length > 0) {
        await processFilesForBatch(files, true);
      }
      e.target.value = '';
      return;
    }
  });

  document.addEventListener('google-login-success', () => {
    updateSidebarProfile();
    if (state.currentViewName === 'settings' || state.currentViewName === 'setting') {
      navigateTo('settings');
    }
  });

  document.addEventListener('google-logout-success', () => {
    updateSidebarProfile();
  });

  document.addEventListener('sync-completed', () => {
    updateSidebarProfile();
    const lbl = document.getElementById('sync-time-lbl');
    if (lbl) {
      lbl.innerText = localStorage.getItem('sella_last_synced_time') || '未同期';
    }
    const savedModel = localStorage.getItem('gemini_selected_model');
    if (savedModel) {
      const globalSelect = document.getElementById('select-gemini-model');
      const modalSelect = document.getElementById('modal-model-select');
      if (globalSelect) globalSelect.value = savedModel;
      if (modalSelect) modalSelect.value = savedModel;
    }
  });

  // --------------------------------------------------
  // 📱💻 PointerEvents 2Dドラッグ＆ドロップ イベント制御
  // --------------------------------------------------
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (e.target.closest('button, input, select, textarea, .lightbox-close')) return;

    const lightbox = document.getElementById('lightbox-modal');
    if (lightbox && lightbox.classList.contains('active')) {
      const img = lightbox.querySelector('#lightbox-img');
      const closeBtn = lightbox.querySelector('.lightbox-close');
      const ctrlBtn = e.target.closest('.lightbox-ctrl-btn, .lightbox-arrow-btn');

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
      if (thumb) {
        activeSwipeThumb = thumb;
        pointerStartX = e.clientX;
        pointerStartY = e.clientY;
        pointerStartTime = Date.now();
        isDragging = true;
        isMoveTriggered = false;
        activeSwipeThumb.style.transition = 'none';
        try {
          activeSwipeThumb.setPointerCapture(e.pointerId);
        } catch (err) {}
      }
    }
  });

  document.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    const diffX = e.clientX - pointerStartX;
    const diffY = e.clientY - pointerStartY;

    const lightbox = document.getElementById('lightbox-modal');
    if (lightbox && lightbox.classList.contains('active')) {
      const img = lightbox.querySelector('#lightbox-img');
      if (img && img.hasPointerCapture(e.pointerId)) {
        e.preventDefault();
        if (Math.abs(diffX) > 8) {
          isMoveTriggered = true;
          img.style.transform = `translateX(${diffX}px) scale(0.98)`;
        }
      }
    } else if (activeSwipeThumb && activeSwipeThumb.hasPointerCapture(e.pointerId)) {
      if (Math.abs(diffX) > 15 || Math.abs(diffY) > 15) {
        e.preventDefault();

        const isEditor = activeSwipeThumb.classList.contains('preview-item');
        const isBatch = activeSwipeThumb.classList.contains('draggable-thumb') && activeSwipeThumb.dataset.sourceType === 'group';
        const isPool = activeSwipeThumb.classList.contains('draggable-thumb') && activeSwipeThumb.dataset.sourceType === 'pool';

        let curIdx = -1;
        if (isEditor) {
          curIdx = Number(activeSwipeThumb.dataset.idx);
        } else if (isBatch) {
          curIdx = Number(activeSwipeThumb.dataset.iidx);
        } else if (isPool) {
          curIdx = Number(activeSwipeThumb.dataset.idx);
        }

        if (!isMoveTriggered) {
          isMoveTriggered = true;
          targetIdx = curIdx;

          if (isEditor) {
            initialSiblings = Array.from(document.querySelectorAll('#image-preview-list .preview-item:not(.add-more-item)'));
          } else if (isBatch) {
            const gIdx = Number(activeSwipeThumb.dataset.gidx);
            initialSiblings = Array.from(document.querySelectorAll(`.batch-group-card[data-gidx="${gIdx}"] .draggable-thumb`));
          } else if (isPool) {
            initialSiblings = Array.from(document.querySelectorAll('#ungrouped-pool-container .draggable-thumb'));
          }

          siblingPositions = initialSiblings.map(sib => ({
            left: sib.offsetLeft,
            top: sib.offsetTop
          }));

          activeSwipeThumb.style.outline = '3px solid var(--accent-color) !important';
          activeSwipeThumb.style.outlineOffset = '-3px';
          activeSwipeThumb.style.borderRadius = '8px';
          activeSwipeThumb.style.zIndex = '99999';
        }

        activeSwipeThumb.style.transform = `translate(${diffX}px, ${diffY}px) scale(1.08) rotate(${diffX * 0.03}deg)`;
        activeSwipeThumb.style.boxShadow = '0 12px 30px rgba(0,0,0,0.5)';

        activeSwipeThumb.style.pointerEvents = 'none';
        const hoveredEl = document.elementFromPoint(e.clientX, e.clientY);
        activeSwipeThumb.style.pointerEvents = 'auto';

        const targetCard = hoveredEl ? hoveredEl.closest('.batch-group-card') : null;
        const targetPool = hoveredEl ? hoveredEl.closest('#ungrouped-pool-container') : null;

        document.querySelectorAll('.batch-group-card').forEach(c => c.classList.remove('drag-over'));
        const poolContainer = document.getElementById('ungrouped-pool-container');
        if (poolContainer) poolContainer.classList.remove('drag-over');

        let isCrossContainerDrag = false;
        if (!isEditor) {
          if (targetCard) {
            const targetGIdx = Number(targetCard.dataset.gidx);
            const isSelf = isBatch && Number(activeSwipeThumb.dataset.gidx) === targetGIdx;
            if (!isSelf) {
              targetCard.classList.add('drag-over');
              isCrossContainerDrag = true;
            }
          } else if (targetPool) {
            const isSelf = isPool;
            if (!isSelf) {
              targetPool.classList.add('drag-over');
              isCrossContainerDrag = true;
            }
          }
        }

        let shouldCancelGap = isCrossContainerDrag;
        if (isEditor && Math.abs(diffY) > 80) {
          shouldCancelGap = true;
        }

        if (shouldCancelGap) {
          initialSiblings.forEach(sib => {
            if (sib !== activeSwipeThumb) sib.style.transform = 'none';
          });
          targetIdx = curIdx;
        } else if (curIdx !== -1 && !isNaN(curIdx) && siblingPositions.length > 0) {
          const curLeft = siblingPositions[curIdx].left + diffX;
          const curTop = siblingPositions[curIdx].top + diffY;

          let newTargetIdx = curIdx;
          let minDistance = Infinity;

          siblingPositions.forEach((pos, sIdx) => {
            const dist = Math.pow(curLeft - pos.left, 2) + Math.pow(curTop - pos.top, 2);
            if (dist < minDistance) {
              minDistance = dist;
              newTargetIdx = sIdx;
            }
          });

          targetIdx = Math.max(0, Math.min(initialSiblings.length - 1, newTargetIdx));

          const virtualSiblings = [...initialSiblings];
          const [movedItem] = virtualSiblings.splice(curIdx, 1);
          virtualSiblings.splice(targetIdx, 0, movedItem);

          initialSiblings.forEach((sib, oldIdx) => {
            if (sib === activeSwipeThumb) return;

            const newIdx = virtualSiblings.indexOf(sib);
            const dx = siblingPositions[newIdx].left - siblingPositions[oldIdx].left;
            const dy = siblingPositions[newIdx].top - siblingPositions[oldIdx].top;

            sib.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)';
            sib.style.transform = `translate(${dx}px, ${dy}px)`;
          });
        }
      }
    }
  }, { passive: false });

  document.addEventListener('pointerup', async (e) => {
    if (!isDragging) return;
    isDragging = false;

    const diffX = e.clientX - pointerStartX;
    const diffY = e.clientY - pointerStartY;
    const duration = Date.now() - pointerStartTime;

    const lightbox = document.getElementById('lightbox-modal');
    if (lightbox && lightbox.classList.contains('active')) {
      const img = lightbox.querySelector('#lightbox-img');
      if (img && img.hasPointerCapture(e.pointerId)) {
        try { img.releasePointerCapture(e.pointerId); } catch(err){}
        img.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)';

        if (!isMoveTriggered) {
          img.style.transform = 'translateX(0) scale(1)';
          return;
        }

        if (Math.abs(diffX) > 55 || (duration < 300 && Math.abs(diffX) > 30)) {
          if (diffX < 0) {
            img.style.transform = 'translateX(-120%) scale(0.9)';
            setTimeout(() => {
              triggerLightboxNext();
              const updatedImg = document.getElementById('lightbox-img');
              if (updatedImg) {
                updatedImg.style.transition = 'none';
                updatedImg.style.transform = 'translateX(120%) scale(0.9)';
                updatedImg.offsetHeight;
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
                updatedImg.offsetHeight;
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
        try { thumb.releasePointerCapture(e.pointerId); } catch(err){}
      }

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
        sib.style.outline = 'none';
        sib.style.outlineOffset = '0';
        sib.style.boxShadow = 'none';
      });

      let isContainerMoved = false;
      if (!isEditor && isMoveTriggered) {
        thumb.style.pointerEvents = 'none';
        const droppedEl = document.elementFromPoint(e.clientX, e.clientY);
        thumb.style.pointerEvents = '';

        const targetCard = droppedEl ? droppedEl.closest('.batch-group-card') : null;
        const targetPool = droppedEl ? droppedEl.closest('#ungrouped-pool-container') : null;

        document.querySelectorAll('.batch-group-card').forEach(c => c.classList.remove('drag-over'));
        const poolContainer = document.getElementById('ungrouped-pool-container');
        if (poolContainer) poolContainer.classList.remove('drag-over');

        if (targetCard) {
          const targetGIdx = Number(targetCard.dataset.gidx);
          if (!isNaN(targetGIdx) && state.batchGroups[targetGIdx]) {
            if (isPool) {
              const idx = Number(thumb.dataset.idx);
              if (!isNaN(idx) && state.ungroupedImages[idx]) {
                const [movedItem] = state.ungroupedImages.splice(idx, 1);
                state.batchGroups[targetGIdx].push(movedItem);
                isContainerMoved = true;
              }
            } else if (isBatch) {
              const srcGIdx = Number(thumb.dataset.gidx);
              const srcIIdx = Number(thumb.dataset.iidx);
              if (srcGIdx !== targetGIdx && !isNaN(srcGIdx) && !isNaN(srcIIdx) && state.batchGroups[srcGIdx] && state.batchGroups[srcGIdx][srcIIdx]) {
                const [movedItem] = state.batchGroups[srcGIdx].splice(srcIIdx, 1);
                state.batchGroups[targetGIdx].push(movedItem);
                if (state.batchGroups[srcGIdx].length === 0) {
                  state.batchGroups.splice(srcGIdx, 1);
                }
                isContainerMoved = true;
              }
            }
          }
        } else if (targetPool && isBatch) {
          const srcGIdx = Number(thumb.dataset.gidx);
          const srcIIdx = Number(thumb.dataset.iidx);
          if (!isNaN(srcGIdx) && !isNaN(srcIIdx) && state.batchGroups[srcGIdx] && state.batchGroups[srcGIdx][srcIIdx]) {
            const [movedItem] = state.batchGroups[srcGIdx].splice(srcIIdx, 1);
            state.ungroupedImages.push(movedItem);
            if (state.batchGroups[srcGIdx].length === 0) {
              state.batchGroups.splice(srcGIdx, 1);
            }
            isContainerMoved = true;
          }
        }
      }

      if (isContainerMoved) {
        renderBatchGroupsUI();
        await syncBatchStateToDB();
        return;
      }

      thumb.style.transition = 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.15)';

      if (!isMoveTriggered && Math.abs(diffX) < 15 && Math.abs(diffY) < 15 && duration < 350) {
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

      if (isMoveTriggered && targetIdx !== -1) {
        if (isEditor) {
          const imgEl = thumb.querySelector('img');
          if (imgEl && imgEl.dataset.idx !== undefined) {
            const idx = Number(imgEl.dataset.idx);
            if (!isNaN(idx) && targetIdx !== idx) {
              const [movedItem] = state.uploadedImages.splice(idx, 1);
              state.uploadedImages.splice(targetIdx, 0, movedItem);
              state.activeThumbnailIndex = 0;
              renderImagePreviewList();
              return;
            }
          }
        } else if (isBatch) {
          const gIdx = Number(thumb.dataset.gidx);
          const iIdx = Number(thumb.dataset.iidx);
          if (!isNaN(gIdx) && !isNaN(iIdx) && state.batchGroups[gIdx]) {
            const group = state.batchGroups[gIdx];
            if (targetIdx !== iIdx) {
              const [movedItem] = group.splice(iIdx, 1);
              group.splice(targetIdx, 0, movedItem);
              renderBatchGroupsUI();
              await syncBatchStateToDB();
              return;
            }
          }
        } else if (isPool) {
          const idx = Number(thumb.dataset.idx);
          if (!isNaN(idx) && targetIdx !== idx) {
            const [movedItem] = state.ungroupedImages.splice(idx, 1);
            state.ungroupedImages.splice(targetIdx, 0, movedItem);
            renderBatchGroupsUI();
            await syncBatchStateToDB();
            return;
          }
        }
      }

      thumb.style.transform = 'none';
      thumb.style.zIndex = '';
      thumb.style.boxShadow = 'none';
    }
  });

  // --------------------------------------------------
  // 🖱️ グローバルクリックイベント委譲
  // --------------------------------------------------
  document.addEventListener('click', async (e) => {
    if (e.target && e.target.id === 'btn-toggle-pool-collapse') {
      e.stopPropagation();
      e.preventDefault();
      state.isPoolCollapsed = !state.isPoolCollapsed;
      renderBatchGroupsUI();
      return;
    }

    if (e.target && e.target.id === 'btn-save-api-key') {
      const apiKeyEl = document.getElementById('gemini-api-key');
      const apiKey = apiKeyEl ? apiKeyEl.value.trim() : '';
      if (!apiKey) {
        alert('APIキーを入力してください。');
        return;
      }
      saveApiKey(apiKey);
      const msgEl = document.getElementById('api-key-msg');
      if (msgEl) {
        msgEl.style.display = 'block';
        setTimeout(() => { msgEl.style.display = 'none'; }, 3000);
      }
      await updateModelDropdown(true);
      if (state.isGoogleLoggedIn) {
        await syncAllData(true);
      }
      return;
    }

    if (e.target && e.target.id === 'btn-reload-models') {
      const originalText = e.target.innerText;
      e.target.innerText = '取得中...';
      e.target.disabled = true;
      try {
        await updateModelDropdown(true);
        alert('モデルリストを更新しました！');
      } catch (err) {
        console.error(err);
        alert('モデルリストの取得に失敗しました。APIキーに誤りがないかご確認ください。');
      } finally {
        e.target.innerText = originalText;
        e.target.disabled = false;
      }
      return;
    }

    if (e.target && e.target.id === 'btn-reload-modal-models') {
      const modalModelSelect = document.getElementById('modal-model-select');
      if (modalModelSelect) {
        modalModelSelect.innerHTML = '<option value="">モデルを取得中...</option>';
        await populateModelDropdown(modalModelSelect, true);
      }
      return;
    }

    if (e.target && e.target.id === 'btn-google-login') {
      loginGoogle();
      return;
    }
    if (e.target && e.target.id === 'btn-google-logout') {
      const choice = confirm("Googleアカウント同期を切断しますか？\n\n[OK]: 共有端末等のため、ローカルブラウザのデータも完全に消去してログアウトする\n[キャンセル]: ローカルにデータは残したまま安全にログアウトする");
      logoutGoogle(choice);
      return;
    }
    if (e.target && e.target.id === 'btn-trigger-sync') {
      await syncAllData(false);
      return;
    }

    if (e.target && e.target.id === 'btn-destroy-all-data') {
      const input = document.getElementById('destroy-validation-input')?.value.trim();
      if (input === 'データをすべて消去する') {
        if (confirm('本当に実行しますか？この操作によりクラウド・ローカル双方の全ての酒ログと写真が永久に消滅します。')) {
          await destroyAllSellaData();
        }
      }
      return;
    }

    // ✕ ボタン操作 (カード上の✕)
    const batchRemoveImgBtn = e.target.closest('.btn-batch-remove-img');
    if (batchRemoveImgBtn) {
      e.stopPropagation();
      const gIdx = Number(batchRemoveImgBtn.dataset.gidx);
      const iIdx = Number(batchRemoveImgBtn.dataset.iidx);
      if (state.batchGroups[gIdx]) {
        const detached = state.batchGroups[gIdx].splice(iIdx, 1)[0];
        if (detached) {
          state.ungroupedImages.push(detached);
        }
        if (state.batchGroups[gIdx].length === 0) {
          state.batchGroups.splice(gIdx, 1);
        }
        renderBatchGroupsUI();
        await syncBatchStateToDB();
      }
      return;
    }

    // ✕ ボタン操作 (未所属プール上の✕)
    const ungroupedRemoveBtn = e.target.closest('.btn-ungrouped-remove');
    if (ungroupedRemoveBtn) {
      e.stopPropagation();
      const idx = Number(ungroupedRemoveBtn.dataset.idx);
      state.ungroupedImages.splice(idx, 1);
      renderBatchGroupsUI();
      await syncBatchStateToDB();
      return;
    }

    // ✨ 未所属プールからグループ作成
    if (e.target && e.target.id === 'btn-create-group-from-ungrouped') {
      if (state.ungroupedImages.length > 0) {
        state.batchGroups.push([...state.ungroupedImages]);
        state.ungroupedImages = [];
        renderBatchGroupsUI();
        await syncBatchStateToDB();
      }
      return;
    }

    // ライトボックス
    const enlargeTarget = e.target.closest('[data-action="enlarge-image"]') || (e.target.tagName === 'IMG' && !e.target.closest('button, nav, header, aside, .lightbox-overlay, #sidebar') && (e.target.closest('#app') || e.target.closest('#detail-modal-overlay')) ? e.target : null);
    if (enlargeTarget) {
      const contextType = enlargeTarget.dataset.contextType;
      let ctxData = null;
      if (contextType === 'editor-preview') {
        ctxData = { type: 'editor-preview', idx: Number(enlargeTarget.dataset.idx) };
      } else if (contextType === 'batch-group') {
        ctxData = { type: 'batch-group', gidx: Number(enlargeTarget.dataset.gidx), iidx: Number(enlargeTarget.dataset.iidx) };
      } else if (contextType === 'pool') {
        ctxData = { type: 'pool', poolIdx: Number(enlargeTarget.dataset.poolIdx) };
      } else if (contextType === 'detail-preview') {
        ctxData = { type: 'detail-preview', idx: Number(enlargeTarget.dataset.idx) };
      } else if (e.target.closest('#detail-modal-overlay')) {
        ctxData = { type: 'detail-preview', idx: state.detailActiveIndex };
      }
      openLightbox(enlargeTarget.src, ctxData);
      return;
    }

    if (e.target.id === 'lightbox-modal' || e.target.classList.contains('lightbox-close') || e.target.closest('.lightbox-close')) {
      closeLightbox();
      return;
    }

    const lbBtn = e.target.closest('.lightbox-ctrl-btn');
    if (lbBtn) {
      e.stopPropagation();
      e.preventDefault();

      if (lbBtn.classList.contains('btn-main-unset')) {
        state.activeThumbnailIndex = Number(lbBtn.dataset.idx);
        renderImagePreviewList();
        if (state.activeLightboxCtx) {
          openLightbox(state.uploadedImages[state.activeThumbnailIndex].previewUrl, state.activeLightboxCtx);
        }
        return;
      }

      if (lbBtn.classList.contains('btn-delete-img')) {
        const idx = Number(lbBtn.dataset.idx);
        state.uploadedImages.splice(idx, 1);
        if (state.activeThumbnailIndex >= state.uploadedImages.length) {
          state.activeThumbnailIndex = Math.max(0, state.uploadedImages.length - 1);
        }
        renderImagePreviewList();
        closeLightbox();
        return;
      }

      if (lbBtn.classList.contains('btn-batch-main-unset')) {
        const gIdx = Number(lbBtn.dataset.gidx);
        const iIdx = Number(lbBtn.dataset.iidx);
        if (state.batchGroups[gIdx] && iIdx > 0) {
          const item = state.batchGroups[gIdx].splice(iIdx, 1)[0];
          state.batchGroups[gIdx].unshift(item);
          renderBatchGroupsUI();
          state.activeLightboxCtx.iidx = 0;
          openLightbox(state.batchGroups[gIdx][0].previewUrl, state.activeLightboxCtx);
          await syncBatchStateToDB();
        }
        return;
      }

      if (lbBtn.classList.contains('btn-batch-remove-img')) {
        const gIdx = Number(lbBtn.dataset.gidx);
        const iIdx = Number(lbBtn.dataset.iidx);
        if (state.batchGroups[gIdx]) {
          const detached = state.batchGroups[gIdx].splice(iIdx, 1)[0];
          if (detached) {
            state.ungroupedImages.push(detached);
          }
          if (state.batchGroups[gIdx].length === 0) {
            state.batchGroups.splice(gIdx, 1);
          }
          renderBatchGroupsUI();
          closeLightbox();
          await syncBatchStateToDB();
        }
        return;
      }

      if (lbBtn.classList.contains('btn-pool-delete-img')) {
        const idx = Number(lbBtn.dataset.idx);
        state.ungroupedImages.splice(idx, 1);
        renderBatchGroupsUI();
        closeLightbox();
        await syncBatchStateToDB();
        return;
      }

      if (lbBtn.classList.contains('btn-pool-create-group')) {
        const idx = Number(lbBtn.dataset.idx);
        const item = state.ungroupedImages.splice(idx, 1)[0];
        if (item) {
          state.batchGroups.push([item]);
          renderBatchGroupsUI();
        }
        closeLightbox();
        await syncBatchStateToDB();
        return;
      }

      if (lbBtn.classList.contains('btn-pool-add-to-group')) {
        const idx = Number(lbBtn.dataset.idx);
        const selector = document.querySelector('.lightbox-group-selector');
        const gIdx = selector ? Number(selector.value) : -1;
        if (!isNaN(gIdx) && gIdx >= 0 && gIdx < state.batchGroups.length) {
          const item = state.ungroupedImages.splice(idx, 1)[0];
          if (item) {
            state.batchGroups[gIdx].push(item);
            renderBatchGroupsUI();
          }
        }
        closeLightbox();
        await syncBatchStateToDB();
        return;
      }
    }

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

    if (e.target.closest('#batch-upload-zone') || e.target.closest('#btn-add-more-batch')) {
      e.preventDefault();
      const batchInput = document.getElementById('batch-file-input');
      if (batchInput) batchInput.click();
      return;
    }

    // --- 一括まとめて保存処理 ---
    const saveAllBtn = e.target.closest('#btn-save-all-batches');
    if (saveAllBtn) {
      if (state.batchGroups.length === 0) {
        alert('登録するグループがありません。');
        return;
      }
      if (!confirm(`${state.batchGroups.length}件のお酒を一括登録しますか？`)) return;

      saveAllBtn.disabled = true;
      const originalBtnText = saveAllBtn.innerHTML;
      saveAllBtn.innerHTML = `<span class="sella-spinner"></span>一括登録中... (${state.batchGroups.length}件)`;

      try {
        for (let gIdx = 0; gIdx < state.batchGroups.length; gIdx++) {
          const group = state.batchGroups[gIdx];
          if (!group || group.length === 0) continue;

          const card = document.querySelector(`.batch-group-card[data-gidx="${gIdx}"]`);
          const nameInput = card?.querySelector('.batch-name-input');
          const breweryInput = card?.querySelector('.batch-brewery-input');

          const cardName = nameInput ? nameInput.value.trim() : '';
          const cardBrewery = breweryInput ? breweryInput.value.trim() : '';

          const name = cardName !== '' ? cardName : (group.name || `お酒グループ #${gIdx + 1}`);
          const brewery = cardBrewery !== '' ? cardBrewery : (group.brewery || '');

          const orderedBlobs = group.map(img => {
            if (!img.blob && img.base64) {
              img.blob = base64ToBlob(img.base64, img.mimeType || 'image/jpeg');
            }
            return img.blob;
          }).filter(blob => blob instanceof Blob);

          let mainDate = '';
          const rawDate = group[0]?.date;
          if (rawDate) {
            const dateObj = (rawDate instanceof Date) ? rawDate : new Date(rawDate);
            if (!isNaN(dateObj.getTime())) {
              const y = dateObj.getFullYear();
              const m = String(dateObj.getMonth() + 1).padStart(2, '0');
              const d = String(dateObj.getDate()).padStart(2, '0');
              mainDate = `${y}-${m}-${d}`;
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
            aiInfo: group.aiInfo || '',
            status: 'active'
          };
          await saveLog(logData, orderedBlobs);
        }

        alert('すべてのグループの登録が完了しました！');
        state.batchGroups = [];
        state.ungroupedImages = [];
        await clearAllDrafts();
        renderBatchGroupsUI();

        if (state.isGoogleLoggedIn) {
          syncAllData(true);
        }
        navigateTo('logList');
      } catch (err) {
        console.error('一括登録エラー:', err);
        alert('一括登録中にエラーが発生しました。');
        saveAllBtn.disabled = false;
        saveAllBtn.innerHTML = originalBtnText;
      }
      return;
    }

    // 一括AI解析実行
    const batchAnalyzeBtn = e.target.closest('.btn-batch-analyze');
    if (batchAnalyzeBtn) {
      e.stopPropagation();
      const gIdx = Number(batchAnalyzeBtn.dataset.gidx);
      const group = state.batchGroups[gIdx];
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
            group.notes = '';
            group.aiInfo = result.aiInfo || group.aiInfo || '';
          }
        } catch (err) {
          console.error('Batch AI Analysis Error:', err);
          alert('AI解析中にエラーが発生しました。');
        } finally {
          batchAnalyzeBtn.innerHTML = originalText;
          batchAnalyzeBtn.disabled = false;
          renderBatchGroupsUI();
          await syncBatchStateToDB();
        }
      } else if (!hasApiKey()) {
        alert('APIキーが設定されていません。設定画面から登録してください。');
      }
      return;
    }

    // 分割
    const batchSplitBtn = e.target.closest('.btn-batch-split');
    if (batchSplitBtn) {
      e.stopPropagation();
      const gIdx = Number(batchSplitBtn.dataset.gidx);
      const group = state.batchGroups[gIdx];
      if (group && group.length > 1) {
        const mid = Math.ceil(group.length / 2);
        const firstHalf = group.slice(0, mid);
        const secondHalf = group.slice(mid);
        state.batchGroups.splice(gIdx, 1, firstHalf, secondHalf);
        renderBatchGroupsUI();
        await syncBatchStateToDB();
      } else {
        alert('これ以上分割できません（1枚のみです）。');
      }
      return;
    }

    // 削除
    const batchDeleteGroupBtn = e.target.closest('.btn-batch-delete-group');
    if (batchDeleteGroupBtn) {
      e.stopPropagation();
      const gIdx = Number(batchDeleteGroupBtn.dataset.gidx);
      const choice = confirm(`お酒グループ #${gIdx + 1} を削除しますか？\n\n[OK]: グループ内の写真も含めて完全に削除する\n[キャンセル]: 写真を「未所属の画像プール」に戻す`);
      const removed = state.batchGroups.splice(gIdx, 1)[0];
      if (!choice && removed && removed.length > 0) {
        state.ungroupedImages = state.ungroupedImages.concat(removed);
      }
      renderBatchGroupsUI();
      await syncBatchStateToDB();
      return;
    }

    // エディタ
    const batchOpenEditorBtn = e.target.closest('.btn-batch-open-editor');
    if (batchOpenEditorBtn) {
      e.stopPropagation();
      const gIdx = Number(batchOpenEditorBtn.dataset.gidx);
      const group = state.batchGroups[gIdx];
      if (group) {
        const card = batchOpenEditorBtn.closest('.batch-group-card');
        const nameInput = card?.querySelector('.batch-name-input');
        const breweryInput = card?.querySelector('.batch-brewery-input');

        const nameVal = nameInput ? nameInput.value.trim() : '';
        const breweryVal = breweryInput ? breweryInput.value.trim() : '';
        if (nameVal !== '') group.name = nameVal;
        if (breweryVal !== '') group.brewery = breweryVal;

        state.returnToBatchOnClose = true;
        await openEditorModal(null, group, gIdx);
      }
      return;
    }

    // ログ詳細
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

    // スライドショーコントロール
    const detailArrow = e.target.closest('.carousel-btn');
    if (detailArrow && (detailArrow.id === 'btn-detail-prev' || detailArrow.id === 'btn-detail-next')) {
      e.stopPropagation();
      e.preventDefault();

      const total = state.detailImages.length;
      if (total <= 1) return;

      const scrollContainer = document.getElementById('detail-carousel-scroll');
      if (scrollContainer) {
        const width = scrollContainer.clientWidth;
        if (detailArrow.id === 'btn-detail-next') {
          state.detailActiveIndex = (state.detailActiveIndex + 1) % total;
        } else {
          state.detailActiveIndex = (state.detailActiveIndex - 1 + total) % total;
        }
        scrollContainer.scrollTo({
          left: state.detailActiveIndex * width,
          behavior: 'smooth'
        });
      }
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
        if (state.isGoogleLoggedIn) {
          syncAllData(true);
        }
        navigateTo('logList');
      }
      return;
    }

    if (e.target.id === 'btn-delete-log-editor') {
      const id = e.target.dataset.id;
      if (confirm('この酒ログを完全に削除してもよろしいですか？')) {
        await deleteLog(id);
        closeEditorModal();
        if (state.isGoogleLoggedIn) {
          syncAllData(true);
        }
        navigateTo('logList');
      }
      return;
    }

    if (e.target.closest('#fab-add') || e.target.closest('[data-action="open-editor"]')) {
      e.preventDefault();
      state.returnToBatchOnClose = false;
      await openEditorModal();
      return;
    }

    const targetBtn = e.target.closest('[data-view]');
    if (targetBtn) {
      e.preventDefault();
      const viewName = targetBtn.dataset.view;
      if (viewName === 'logEditor') {
        state.returnToBatchOnClose = false;
        await openEditorModal();
      } else {
        state.returnToBatchOnClose = false;
        navigateTo(viewName);
      }
      return;
    }

    if (e.target.id === 'btn-close-modal' || e.target.id === 'btn-cancel-modal' || e.target.id === 'modal-overlay') {
      closeEditorModal();
      return;
    }

    if (e.target.id === 'btn-analyze') {
      runAIAnalysis(state.uploadedImages[state.activeThumbnailIndex]);
      return;
    }

    const revertBtn = e.target.closest('.btn-revert-field');
    if (revertBtn) {
      const fieldId = revertBtn.dataset.fieldId;
      const inputEl = document.getElementById(fieldId);
      if (inputEl && state.backupFormData[fieldId] !== undefined) {
        inputEl.value = state.backupFormData[fieldId];
        updateFieldRevertUI();
      }
      return;
    }

    const delImgBtn = e.target.closest('.btn-img-del');
    if (delImgBtn) {
      const idx = Number(delImgBtn.dataset.idx);
      state.uploadedImages.splice(idx, 1);
      if (state.activeThumbnailIndex >= state.uploadedImages.length) {
        state.activeThumbnailIndex = Math.max(0, state.uploadedImages.length - 1);
      }
      renderImagePreviewList();
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

    if (e.target && e.target.id === 'btn-save-log') {
      const name = document.getElementById('sake-name')?.value.trim();
      if (!name) {
        alert('銘柄名を入力してください。');
        return;
      }

      syncEditorFormToCurrentBatchGroup();

      const rawTags = document.getElementById('sake-tags')?.value.trim() || '';
      const tags = rawTags ? rawTags.split(/\s+/).filter(Boolean) : [];

      let orderedBlobs = state.uploadedImages.map(img => {
        if (!img.blob && img.base64) {
          img.blob = base64ToBlob(img.base64, img.mimeType || 'image/jpeg');
        }
        return img.blob;
      }).filter(blob => blob instanceof Blob);

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
        aiInfo: document.getElementById('sake-ai-info')?.value.trim() || '',
        status: 'active'
      };

      if (state.currentEditingLogId) {
        logData.id = state.currentEditingLogId;
      }

      await saveLog(logData, orderedBlobs);

      if (state.currentBatchGroupIndex !== null && state.currentBatchGroupIndex >= 0 && state.currentBatchGroupIndex < state.batchGroups.length) {
        state.batchGroups.splice(state.currentBatchGroupIndex, 1);
        state.currentBatchGroupIndex = null;
        await syncBatchStateToDB();
      }

      closeEditorModal();

      if (state.isGoogleLoggedIn) {
        syncAllData(true);
      }

      if (!state.returnToBatchOnClose) {
        navigateTo(state.currentViewName);
      }
      return;
    }
  });
}

export function updateSidebarProfile() {
  const avatarEl = document.getElementById('sidebar-avatar');
  const usernameEl = document.getElementById('sidebar-username');
  const statusEl = document.getElementById('sidebar-user-status');

  if (!avatarEl || !usernameEl) return;

  const isConnected = state.isGoogleLoggedIn || localStorage.getItem('sella_google_logged_in') === 'true';

  if (isConnected) {
    const name = state.googleUserName || localStorage.getItem('sella_google_user_name') || 'Googleユーザー';
    const avatarUrl = state.googleUserAvatar || localStorage.getItem('sella_google_user_avatar') || '';

    usernameEl.innerText = name;
    if (statusEl) {
      statusEl.innerText = 'Google同期 有効';
      statusEl.style.color = '#10b981';
    }

    if (avatarUrl) {
      avatarEl.innerHTML = `<img src="${avatarUrl}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;" alt="アバター">`;
    } else {
      avatarEl.innerHTML = `<span id="sidebar-avatar-text" style="color: #000;">${name.charAt(0).toUpperCase()}</span>`;
    }
  } else {
    usernameEl.innerText = '未ログイン';
    if (statusEl) {
      statusEl.innerText = 'タップしてログイン';
      statusEl.style.color = 'var(--text-sub)';
    }
    avatarEl.innerHTML = '<span id="sidebar-avatar-text" style="color: #000;">G</span>';
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initApp();
    navigateTo('logList');
  });
} else {
  initApp();
  navigateTo('logList');
}
