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
  `;
  document.head.appendChild(style);
}

export function setTheme(themeName) {
  const validThemes = ['dark', 'light', 'sakura', 'gaming', 'japan-modern'];
  let targetTheme = themeName;
  if (!targetTheme || !validThemes.includes(targetTheme)) {
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

function initApp() {
  ensureSpinnerStyles();
  initGoogleAuth();
  loadBatchStateFromDB();

  if (localStorage.getItem('sella_google_logged_in') === 'true') {
    state.isGoogleLoggedIn = true;
    syncAllData(true);
  }

  // ハンバーガーメニューとオーバーレイの設定
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
    // 同期完了時にモデルドロップダウンの表示を反映
    const savedModel = localStorage.getItem('gemini_selected_model');
    if (savedModel) {
      const globalSelect = document.getElementById('select-gemini-model');
      const modalSelect = document.getElementById('modal-model-select');
      if (globalSelect) globalSelect.value = savedModel;
      if (modalSelect) modalSelect.value = savedModel;
    }
  });

  document.addEventListener('click', async (e) => {
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
