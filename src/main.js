// src/main.js
import { populateModelDropdown, hasApiKey, analyzeLabelImage, setSavedModel, saveApiKey } from './services/gemini.js';
import { renderSettingsView } from './views/settings.js';
import { renderLogEditorModal, openEditorModal, closeEditorModal, handleImageFiles, runAIAnalysis, updateFieldRevertUI, syncEditorFormToCurrentBatchGroup, renderImagePreviewList, TRACKED_FIELDS } from './views/logEditor.js';
import { renderLogDetailModal, openDetailModal, closeDetailModal } from './views/logDetail.js';
import { renderLogListView } from './views/logList.js';
import { renderAnalyticsView, runAnalyticsAI } from './views/analytics.js';
import { saveLog, deleteLog, clearAllDrafts, openDB, getDraftLogs, getAllLogs, getAllLogDates } from './store/db.js';
import { renderBatchImportView, renderBatchGroupsUI, processFilesForBatch } from './views/batchImport.js';
import { openLightbox, closeLightbox, triggerLightboxNext, triggerLightboxPrev } from './views/lightbox.js';
import { state, base64ToBlob, blobToBase64 } from './store/state.js';
import { syncAllData, loginGoogle, logoutGoogle, destroyAllSellaData, initGoogleAuth } from './services/googleDrive.js';
import { getApiKey, requestGeminiText } from './services/gemini.js';
import { formatDateToLocalYYYYMMDD } from './utils/image.js';

function moveArrayItem(items, sourceIndex, targetIndex) {
  if (sourceIndex === targetIndex || !items[sourceIndex]) return;
  const [movedItem] = items.splice(sourceIndex, 1);
  items.splice(Math.min(items.length, Math.max(0, targetIndex)), 0, movedItem);
}

function ensureSpinnerStyles() {
  if (document.getElementById('sella-spinner-style')) return;
  const style = document.createElement('style');
  style.id = 'sella-spinner-style';
  style.textContent = `
    @keyframes sellaSpin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    .sella-spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-radius: 50%; border-top-color: #fff; animation: sellaSpin 0.8s linear infinite; vertical-align: middle; margin-right: 6px; }
    .draggable-thumb, .preview-item { cursor: grab; transition: transform 0.15s, opacity 0.15s; touch-action: none; box-sizing: border-box; -webkit-touch-callout: none !important; -webkit-user-select: none !important; user-select: none !important; overflow: visible !important; }
    .pointer-dragging { transition: none !important; will-change: transform; }
    .draggable-thumb:active, .preview-item:active { cursor: grabbing; }
    .batch-group-card.drag-over, #ungrouped-pool-container.drag-over { border-color: var(--accent-color) !important; background: var(--card-hover-bg, rgba(255,255,255,0.06)) !important; }
  `;
  document.head.appendChild(style);
}

export function setTheme(themeName) {
  const validThemes = ['dark', 'light', 'sakura', 'moon', 'maple', 'nature', 'water', 'bar', 'kominka', 'gaming', 'japan-modern'];
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
  setting: renderSettingsView,
  analytics: renderAnalyticsView
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
  renderSidebarCalendar();
}

const sidebar = document.getElementById('sidebar');
const rightPanel = document.getElementById('right-panel');
const overlay = document.getElementById('drawer-overlay');
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

function getCalendarDateKey(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const normalized = value
      .replace(/[０-９]/g, digit => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
      .replace(/年|月/g, '-')
      .replace(/日/g, '')
      .replace(/[/.]/g, '-');
    const match = normalized.match(/^(\d{4}-\d{1,2}-\d{1,2})/);
    if (match) {
      const [year, month, day] = match[1].split('-');
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
  }
  const date = new Date(value);
  return isNaN(date.getTime()) ? '' : formatDateToLocalYYYYMMDD(date);
}

function getJapaneseHolidayName(date, includeCitizenHoliday = true) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const fixedHolidays = {
    '1-1': '元日',
    '2-11': '建国記念の日',
    '2-23': '天皇誕生日',
    '4-29': '昭和の日',
    '5-3': '憲法記念日',
    '5-4': 'みどりの日',
    '5-5': 'こどもの日',
    '8-11': '山の日',
    '11-3': '文化の日',
    '11-23': '勤労感謝の日'
  };
  const fixedName = fixedHolidays[`${month}-${day}`];
  if (fixedName) return fixedName;

  const mondayNumber = Math.floor((day - 1) / 7) + 1;
  if (date.getDay() === 1) {
    if (month === 1 && mondayNumber === 2) return '成人の日';
    if (month === 7 && mondayNumber === 3) return '海の日';
    if (month === 9 && mondayNumber === 3) return '敬老の日';
    if (month === 10 && mondayNumber === 2) return 'スポーツの日';
  }

  const equinoxDay = month === 3
    ? Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4))
    : month === 9
      ? Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4))
      : 0;
  if (equinoxDay === day) return month === 3 ? '春分の日' : '秋分の日';

  // 祝日と祝日に挟まれた平日は「国民の休日」
  if (includeCitizenHoliday && date.getDay() !== 0 && date.getDay() !== 6) {
    const previousDay = new Date(year, month - 1, day - 1);
    const nextDay = new Date(year, month - 1, day + 1);
    if (getJapaneseHolidayName(previousDay, false) && getJapaneseHolidayName(nextDay, false)) {
      return '国民の休日';
    }
  }

  return '';
}

async function renderSidebarCalendar() {
  const calendar = document.getElementById('sidebar-calendar');
  if (!calendar) return;

  try {
    let logs = [];
    try {
      const logDates = await getAllLogDates();
      logs = logDates.map(date => ({ date }));
    } catch (err) {
      console.error('[Calendar] Failed to load log dates:', err);
      try {
        logs = await getAllLogs(false, false);
      } catch (fallbackErr) {
        console.error('[Calendar] Fallback log loading failed:', fallbackErr);
      }
    }
    if (!Array.isArray(logs)) logs = [];

  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const monthStart = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = monthStart.getDay();
  const logDates = new Set(logs.map(log => getCalendarDateKey(log.date)).filter(Boolean));
  const todayKey = getCalendarDateKey(new Date());
  const monthLabel = `${year}年${month + 1}月`;
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];

  let daysHTML = '';
  for (let i = 0; i < firstDay; i++) {
    daysHTML += '<span class="calendar-day calendar-day-empty" aria-hidden="true"></span>';
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const hasLog = logDates.has(dateKey);
    const isToday = dateKey === todayKey;
    const date = new Date(year, month, day);
    const holidayName = getJapaneseHolidayName(date);
    const dayClass = date.getDay() === 0 ? ' is-sunday' : date.getDay() === 6 ? ' is-saturday' : '';
    const dayContent = `
      <span class="calendar-day-number">${day}</span>
      ${hasLog ? '<span class="calendar-day-dot" aria-hidden="true"></span>' : ''}`;
    const dayTitle = holidayName || (hasLog ? '酒ログを表示' : '');
    daysHTML += hasLog
      ? `<button type="button" class="calendar-day calendar-day-button${dayClass}${holidayName ? ' is-holiday' : ''}${isToday ? ' is-today' : ''}" data-calendar-date="${dateKey}" title="${dayTitle}">${dayContent}</button>`
      : `<span class="calendar-day${dayClass}${holidayName ? ' is-holiday' : ''}${isToday ? ' is-today' : ''}" title="${dayTitle}">${dayContent}</span>`;
  }

  calendar.innerHTML = `
    <div class="calendar-header">
      <h3>カレンダー</h3>
      <div class="calendar-month-controls">
        <button type="button" data-calendar-nav="prev" title="前の月" aria-label="前の月">‹</button>
        <input type="month" class="calendar-month-picker" id="calendar-month-input" value="${year}-${String(month + 1).padStart(2, '0')}" aria-label="表示する年月" title="年月を選択">
        <button type="button" data-calendar-nav="next" title="次の月" aria-label="次の月">›</button>
      </div>
    </div>
    <div class="calendar-weekdays">${weekdays.map(day => `<span>${day}</span>`).join('')}</div>
    <div class="calendar-grid">${daysHTML}</div>
  `;
  } catch (err) {
    console.error('[Calendar] Failed to render calendar:', err);
    if (!calendar.dataset.calendarRetry) {
      calendar.dataset.calendarRetry = 'true';
      setTimeout(() => {
        calendar.dataset.calendarRetry = '';
        renderSidebarCalendar();
      }, 200);
    }
    calendar.innerHTML = '<div class="calendar-loading">カレンダーを表示できませんでした</div>';
  }
}

function openSidebar() {
  rightPanel?.classList.remove('open');
  sidebar?.classList.add('open');
  overlay?.classList.add('active');
}

function openRightPanel() {
  sidebar?.classList.remove('open');
  rightPanel?.classList.add('open');
  overlay?.classList.add('active');
}

function closeDrawers() {
  sidebar?.classList.remove('open');
  rightPanel?.classList.remove('open');
  overlay?.classList.remove('active');
}

function closeSidebar() {
  closeDrawers();
}

function renderAiChatControls() {
  const controls = document.getElementById('ai-chat-controls');
  if (!controls) return;

  if (!getApiKey()) {
    controls.innerHTML = `
      <div class="ai-unavailable-box">
        <strong>AI機能の利用にはAPIキーが必要です</strong>
        <span>APIキーの設定後、質問可能になります。</span>
        <button type="button" id="btn-open-api-settings" class="btn-secondary">APIキーの設定へ</button>
      </div>`;
    return;
  }

  controls.innerHTML = `
    <input type="text" id="ai-chat-input" placeholder="AIに質問・検索..." aria-label="AIに質問・検索">
    <button type="button" class="send-btn" title="送信" aria-label="送信">➔</button>`;
  document.getElementById('ai-chat-input')?.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      await sendAiChatMessage();
    }
  });
}

async function openApiSettings() {
  await navigateTo('settings');
  requestAnimationFrame(() => {
    document.getElementById('gemini-api-settings-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('gemini-api-key')?.focus();
  });
}

async function sendAiChatMessage() {
  const input = document.getElementById('ai-chat-input');
  const body = document.getElementById('ai-chat-body');
  if (!input || !body) return;
  const question = input.value.trim();
  if (!question) return;
  if (!getApiKey()) {
    body.insertAdjacentHTML('beforeend', '<div class="chat-bubble ai">APIキーがないためAI質問は利用できません。設定画面でAPIキーを登録してください。</div>');
    return;
  }
  const logs = await getAllLogs(false, false);
  const safeQuestion = question.replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
  body.insertAdjacentHTML('beforeend', `<div class="chat-bubble user">${safeQuestion}</div><div class="chat-bubble ai" id="ai-chat-pending"><span class="sella-spinner"></span>回答中...</div>`);
  input.value = '';
  try {
    const context = logs.slice(0, 50).map(log => ({ name: log.name, category: log.category, brewery: log.brewery, region: log.region, type: log.type, date: log.date, rating: log.rating, notes: log.notes }));
    const answer = await requestGeminiText(`あなたは酒ログアプリのアシスタントです。登録ログを参考に質問へ日本語で簡潔に答えてください。\n質問: ${question}\n登録ログ: ${JSON.stringify(context)}`);
    const pending = document.getElementById('ai-chat-pending');
    if (pending) pending.textContent = answer;
  } catch (error) {
    const pending = document.getElementById('ai-chat-pending');
    if (pending) pending.textContent = `回答できませんでした: ${error.message}`;
  }
  body.scrollTop = body.scrollHeight;
}

export async function syncBatchStateToDB() {
  try {
    const localUpdatedAt = new Date().toISOString();
    state.batchLocalUpdatedAt = localUpdatedAt;
    state.batchGroups.forEach(group => { group._updatedAt = localUpdatedAt; });
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
            mimeType: item.mimeType || 'image/jpeg',
            metadata: item.metadata || {},
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
            mimeType: item.mimeType || 'image/jpeg',
            metadata: item.metadata || {},
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

    if (state.isGoogleLoggedIn && !state.isBatchProcessing) {
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
          metadata: meta.metadata || {},
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
          metadata: meta.metadata || {},
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
      group._updatedAt = gLog.updatedAt || '';
      if (gLog.backupFormData) {
        group.backupFormData = { ...gLog.backupFormData };
      }
      state.batchGroups.push(group);
    }
    state.batchLocalUpdatedAt = drafts.reduce((latest, draft) => {
      return draft.updatedAt && (!latest || draft.updatedAt > latest) ? draft.updatedAt : latest;
    }, '');
    renderBatchGroupsUI();
  } catch (err) {
    console.error('[DraftSync] Failed to restore drafts:', err);
  }
}

function initApp() {
  ensureSpinnerStyles();
  initGoogleAuth().then(() => {
    updateSidebarProfile();
  }).catch(err => {
    console.error('[GoogleDrive] Auth initialization failed:', err);
  });
  loadBatchStateFromDB();
  updateSidebarProfile();

  if (localStorage.getItem('sella_google_logged_in') === 'true') {
    state.isGoogleLoggedIn = true;
    syncAllData(true);
  }

  const requestBackgroundSync = () => {
    if (state.isGoogleLoggedIn && !state.googleAuthNeedsReauth && navigator.onLine !== false) {
      syncAllData(true);
    }
  };
  window.addEventListener('online', requestBackgroundSync);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestBackgroundSync();
  });
  setInterval(requestBackgroundSync, 5 * 60 * 1000);

  document.getElementById('btn-menu-toggle')?.addEventListener('click', openSidebar);
  document.getElementById('btn-right-panel-toggle')?.addEventListener('click', openRightPanel);
  overlay?.addEventListener('click', closeDrawers);
  document.querySelector('.drawer-close-left')?.addEventListener('click', closeDrawers);
  document.querySelector('.drawer-close-right')?.addEventListener('click', closeDrawers);
  renderSidebarCalendar();

  renderAiChatControls();
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawers();
  });

  document.addEventListener('google-login-success', async () => {
    updateSidebarProfile();
    if (state.currentViewName === 'settings' || state.currentViewName === 'setting') {
      await navigateTo('settings');
    }
  });

  document.addEventListener('google-logout-success', async () => {
    updateSidebarProfile();
    if (state.currentViewName === 'settings' || state.currentViewName === 'setting') {
      await navigateTo('settings');
    }
  });

  document.addEventListener('sync-completed', async () => {
    if (state.currentViewName === 'batchimport') {
      renderBatchGroupsUI();
    } else if (state.currentViewName === 'loglist' || state.currentViewName === 'log-list' || state.currentViewName === 'dashboard') {
      await navigateTo(state.currentViewName);
    }
  });

  document.addEventListener('sync-state-change', async () => {
    if (state.currentViewName === 'batchimport') {
      renderBatchGroupsUI();
    } else if (state.currentViewName === 'loglist' || state.currentViewName === 'log-list' || state.currentViewName === 'dashboard') {
      await navigateTo(state.currentViewName);
    }
  });

  document.addEventListener('navigation-request', async (e) => {
    const detail = e.detail;
    const targetView = typeof detail === 'string' ? detail : detail.view;
    await navigateTo(targetView);
    if (detail && detail.renderBatch) {
      renderBatchGroupsUI();
    }
  });

  document.addEventListener('batch-state-modified', async (e) => {
    await syncBatchStateToDB();
    e.detail?.resolve?.();
  });

  let logSearchRenderTimer = null;
  let isLogSearchComposing = false;
  const scheduleLogSearchRender = () => {
    clearTimeout(logSearchRenderTimer);
    if (isLogSearchComposing) return;

    logSearchRenderTimer = setTimeout(async () => {
      await navigateTo('logList');
      const searchInput = document.getElementById('log-search-input');
      if (searchInput) {
        searchInput.focus();
        searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
      }
    }, 250);
  };

  document.addEventListener('compositionstart', (e) => {
    if (e.target.id === 'log-search-input') {
      isLogSearchComposing = true;
    }
  });

  document.addEventListener('compositionend', (e) => {
    if (e.target.id === 'log-search-input') {
      isLogSearchComposing = false;
      state.logSearchQuery = e.target.value;
      scheduleLogSearchRender();
    }
  });

  document.addEventListener('input', async (e) => {
    if (e.target.id === 'destroy-validation-input') {
      const destroyButton = document.getElementById('btn-destroy-all-data');
      const isConfirmed = e.target.value.trim() === 'データをすべて消去する';
      if (destroyButton) {
        destroyButton.disabled = !isConfirmed;
        destroyButton.style.opacity = isConfirmed ? '1' : '0.3';
        destroyButton.style.cursor = isConfirmed ? 'pointer' : 'not-allowed';
      }
      return;
    }

    if (e.target.id === 'log-search-input') {
      state.logSearchQuery = e.target.value;
      scheduleLogSearchRender();
      return;
    }

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
  });

  document.addEventListener('change', async (e) => {
    if (e.target && e.target.id === 'calendar-month-input') {
      const [year, month] = e.target.value.split('-').map(Number);
      if (year && month) {
        calendarMonth = new Date(year, month - 1, 1);
        await renderSidebarCalendar();
      }
      return;
    }

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

  // HTML5 Native Drag & Drop
  let activeFileDropTarget = null;
  let activeDragOverCard = null;
  let activeDragOverPool = null;
  let activeReorderTarget = null;
  let nativeDropHandled = false;
  let nativeDragSource = null;
  let nativeDropTarget = null;
  let shiftedReorderItems = [];
  let nativeDropInsertionIndex = null;

  const findGapTarget = (container, clientX, clientY, sourceThumb) => {
    if (!container) return null;
    const items = [...container.querySelectorAll('.draggable-thumb, .preview-item')]
      .filter(item => item !== sourceThumb);
    if (items.length === 0) return null;
    const candidates = items.map(item => {
      const rect = item.getBoundingClientRect();
      const verticalDistance = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
      return { item, distance: Math.hypot(Math.max(rect.left - clientX, clientX - rect.right, 0), verticalDistance), rect };
    }).sort((left, right) => left.distance - right.distance);
    const nearest = candidates[0];
    const itemsInContainer = [...container.querySelectorAll('.draggable-thumb, .preview-item')];
    const nearestIndex = itemsInContainer.indexOf(nearest.item);
    return {
      item: nearest.item,
      insertionIndex: nearestIndex + (clientX >= nearest.rect.left + nearest.rect.width / 2 ? 1 : 0)
    };
  };

  const resetReorderShifts = () => {
    shiftedReorderItems.forEach(item => item.classList.remove('reorder-shift-left', 'reorder-shift-right', 'reorder-gap-side', 'reorder-gap-left', 'reorder-gap-right'));
    shiftedReorderItems = [];
  };

  const updateReorderShifts = (sourceThumb, targetThumb, insertionIndex = null) => {
    resetReorderShifts();
    if (!sourceThumb || !targetThumb || sourceThumb === targetThumb || sourceThumb.parentElement !== targetThumb.parentElement) return;
    const items = [...sourceThumb.parentElement.querySelectorAll('.draggable-thumb, .preview-item')];
    const sourceIndex = items.indexOf(sourceThumb);
    const targetIndex = items.indexOf(targetThumb);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const rawInsertionIndex = insertionIndex ?? targetIndex + (sourceIndex < targetIndex ? 1 : 0);
    const itemsWithoutSource = items.filter(item => item !== sourceThumb);
    const adjustedInsertionIndex = rawInsertionIndex - (sourceIndex < rawInsertionIndex ? 1 : 0);
    const leftItem = itemsWithoutSource[adjustedInsertionIndex - 1];
    const rightItem = itemsWithoutSource[adjustedInsertionIndex];

    if (leftItem) {
      leftItem.classList.add('reorder-gap-left');
      shiftedReorderItems.push(leftItem);
    }
    if (rightItem && rightItem !== leftItem) {
      rightItem.classList.add('reorder-gap-right');
      shiftedReorderItems.push(rightItem);
    }
  };

  document.addEventListener('dragover', (e) => {
    e.preventDefault();

    const fileDropTarget = e.target.closest('#batch-upload-zone, #btn-add-more-batch, #upload-zone, #btn-trigger-upload');
    const isFileDrag = e.dataTransfer?.types?.includes('Files');
    const nextFileDropTarget = isFileDrag ? fileDropTarget : null;
    if (activeFileDropTarget !== nextFileDropTarget) {
      activeFileDropTarget?.classList.remove('file-drop-active');
      activeFileDropTarget = nextFileDropTarget;
      activeFileDropTarget?.classList.add('file-drop-active');
    }

    const card = e.target.closest('.batch-group-card');
    if (activeDragOverCard !== card) {
      activeDragOverCard?.classList.remove('drag-over');
      activeDragOverCard = card;
      activeDragOverCard?.classList.add('drag-over');
    }

    const pool = e.target.closest('#ungrouped-pool-container');
    if (activeDragOverPool !== pool) {
      activeDragOverPool?.classList.remove('drag-over');
      activeDragOverPool = pool;
      activeDragOverPool?.classList.add('drag-over');
    }

    const targetThumb = e.target.closest('#image-preview-list .preview-item, .batch-group-card .draggable-thumb, #ungrouped-pool-container .draggable-thumb');
    const gapTarget = state.draggedItemInfo && !targetThumb
      ? findGapTarget(nativeDragSource?.parentElement, e.clientX, e.clientY, nativeDragSource)
      : null;
    const nextReorderTarget = state.draggedItemInfo ? (targetThumb || gapTarget?.item || null) : null;
    nativeDropInsertionIndex = gapTarget?.insertionIndex ?? null;
    if (activeReorderTarget !== nextReorderTarget) {
      activeReorderTarget?.classList.remove('reorder-target');
      activeReorderTarget = nextReorderTarget;
      activeReorderTarget?.classList.add('reorder-target');
    }
    const targetRect = activeReorderTarget?.getBoundingClientRect();
    const targetIndex = activeReorderTarget ? [...activeReorderTarget.parentElement.querySelectorAll('.draggable-thumb, .preview-item')].indexOf(activeReorderTarget) : -1;
    const hoverInsertionIndex = targetRect && targetIndex >= 0
      ? targetIndex + (e.clientX >= targetRect.left + targetRect.width / 2 ? 1 : 0)
      : nativeDropInsertionIndex;
    updateReorderShifts(nativeDragSource, activeReorderTarget, hoverInsertionIndex);
    nativeDropTarget = targetThumb || card || pool;
  });

  document.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) {
      activeReorderTarget?.classList.remove('reorder-target');
      activeReorderTarget = null;
    }
    const fileDropTarget = e.target.closest('#batch-upload-zone, #btn-add-more-batch, #upload-zone, #btn-trigger-upload');
    if (fileDropTarget && !fileDropTarget.contains(e.relatedTarget)) {
      fileDropTarget.classList.remove('file-drop-active');
      if (activeFileDropTarget === fileDropTarget) activeFileDropTarget = null;
    }

    const card = e.target.closest('.batch-group-card');
    if (card && !card.contains(e.relatedTarget)) {
      card.classList.remove('drag-over');
      if (activeDragOverCard === card) activeDragOverCard = null;
    }
    const pool = e.target.closest('#ungrouped-pool-container');
    if (pool && !pool.contains(e.relatedTarget)) {
      pool.classList.remove('drag-over');
      if (activeDragOverPool === pool) activeDragOverPool = null;
    }
  });

  document.addEventListener('dragstart', (e) => {
    const thumb = e.target.closest('.preview-item, .draggable-thumb');
    if (thumb) {
      nativeDropHandled = false;
      nativeDragSource = thumb;
      const sourceType = thumb.dataset.sourceType;
      if (sourceType === 'group') {
        state.draggedItemInfo = { type: 'group', gIdx: Number(thumb.dataset.gidx), iIdx: Number(thumb.dataset.iidx) };
      } else if (sourceType === 'pool') {
        state.draggedItemInfo = { type: 'pool', idx: Number(thumb.dataset.idx) };
      } else if (thumb.classList.contains('preview-item')) {
        const imgEl = thumb.querySelector('img');
        const idx = imgEl ? Number(imgEl.dataset.idx) : Number(thumb.dataset.idx);
        state.draggedItemInfo = { type: 'editor', idx };
      }
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', JSON.stringify(state.draggedItemInfo));
    }
  });

  document.addEventListener('dragend', () => {
    if (!nativeDropHandled) {
      state.draggedItemInfo = null;
      nativeDragSource = null;
      nativeDropTarget = null;
    }
    activeFileDropTarget?.classList.remove('file-drop-active');
    activeDragOverCard?.classList.remove('drag-over');
    activeDragOverPool?.classList.remove('drag-over');
    activeReorderTarget?.classList.remove('reorder-target');
    resetReorderShifts();
    activeFileDropTarget = null;
    activeDragOverCard = null;
    activeDragOverPool = null;
    activeReorderTarget = null;
    nativeDropInsertionIndex = null;
  });

  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    nativeDropHandled = true;
    const lastDragOverCard = activeDragOverCard;
    const lastDragOverPool = activeDragOverPool;
    const lastReorderTarget = activeReorderTarget;
    const lastDropInsertionIndex = nativeDropInsertionIndex;
    activeFileDropTarget?.classList.remove('file-drop-active');
    activeDragOverCard?.classList.remove('drag-over');
    activeDragOverPool?.classList.remove('drag-over');
    activeReorderTarget?.classList.remove('reorder-target');
    resetReorderShifts();
    activeFileDropTarget = null;
    activeDragOverCard = null;
    activeDragOverPool = null;
    activeReorderTarget = null;

    const droppedFiles = e.dataTransfer?.files;
    const isInternalImageDrag = Boolean(nativeDragSource || state.draggedItemInfo);
    if (droppedFiles && droppedFiles.length > 0 && !isInternalImageDrag) {
      if (e.target.closest('#batch-upload-zone, #btn-add-more-batch')) {
        await processFilesForBatch(droppedFiles, true);
      } else if (e.target.closest('#upload-zone, #btn-trigger-upload')) {
        await handleImageFiles(droppedFiles);
      }
      state.draggedItemInfo = null;
      return;
    }

    let dragInfo = state.draggedItemInfo;
    if (nativeDragSource) {
      const sourceType = nativeDragSource.dataset.sourceType;
      if (sourceType === 'group') {
        dragInfo = { type: 'group', gIdx: Number(nativeDragSource.dataset.gidx), iIdx: Number(nativeDragSource.dataset.iidx) };
      } else if (sourceType === 'pool') {
        dragInfo = { type: 'pool', idx: Number(nativeDragSource.dataset.idx) };
      }
    }
    if (!dragInfo) {
      try {
        const serializedDragInfo = e.dataTransfer?.getData('text/plain');
        dragInfo = serializedDragInfo ? JSON.parse(serializedDragInfo) : null;
      } catch (err) {
        dragInfo = null;
      }
    }
    if (!dragInfo) return;

    // 1. 単体登録エディタ内のドロップ並び替え
    if (dragInfo.type === 'editor') {
      const targetThumb = e.target.closest('#image-preview-list .preview-item') || lastReorderTarget;
      if (targetThumb) {
        const targetImg = targetThumb.querySelector('img');
        const targetIdx = lastDropInsertionIndex ?? (targetImg ? Number(targetImg.dataset.idx) : Number(targetThumb.dataset.idx));
        const srcIdx = dragInfo.idx;
        if (!isNaN(srcIdx) && !isNaN(targetIdx) && srcIdx !== targetIdx && state.uploadedImages[srcIdx]) {
          moveArrayItem(state.uploadedImages, srcIdx, targetIdx);
          state.activeThumbnailIndex = 0;
          renderImagePreviewList();
        }
      }
      state.draggedItemInfo = null;
      return;
    }

    // 2. 一括インポート画面でのドロップ移動
    const targetGroupCard = e.target.closest('.batch-group-card') || lastDragOverCard;
    const targetPoolArea = e.target.closest('#ungrouped-pool-container') || lastDragOverPool;
    const eventTargetThumb = e.target.closest('.draggable-thumb');
    const targetThumb = eventTargetThumb || nativeDropTarget || (
      lastReorderTarget && (targetGroupCard?.contains(lastReorderTarget) || targetPoolArea?.contains(lastReorderTarget))
        ? lastReorderTarget
        : null
    );
    const sourceItems = dragInfo.type === 'group'
      ? state.batchGroups[dragInfo.gIdx]
      : state.ungroupedImages;

    if (!sourceItems || !sourceItems[dragInfo.type === 'group' ? dragInfo.iIdx : dragInfo.idx]) {
      state.draggedItemInfo = null;
      return;
    }

    let targetItems = null;
    let targetIndex = null;
    if (targetGroupCard) {
      const targetGroupIndex = Number(targetGroupCard.dataset.gidx);
      targetItems = state.batchGroups[targetGroupIndex] || null;
      if (targetThumb?.dataset.gidx !== undefined && Number(targetThumb.dataset.gidx) === targetGroupIndex) {
        targetIndex = lastDropInsertionIndex ?? Number(targetThumb.dataset.iidx);
      }
    } else if (targetPoolArea) {
      targetItems = state.ungroupedImages;
      if (targetThumb?.dataset.sourceType === 'pool') {
        targetIndex = Number(targetThumb.dataset.idx);
      }
    }

    if (!targetItems) {
      state.draggedItemInfo = null;
      return;
    }

    const sourceIndex = dragInfo.type === 'group' ? dragInfo.iIdx : dragInfo.idx;
    if (sourceItems === targetItems) {
      if (targetIndex === null) targetIndex = targetItems.length;
      if (targetIndex !== null && !isNaN(targetIndex) && sourceIndex !== targetIndex) {
        moveArrayItem(sourceItems, sourceIndex, targetIndex);
      }
    } else {
      const [movedImage] = sourceItems.splice(sourceIndex, 1);
      if (movedImage) {
        const insertionIndex = targetIndex === null || isNaN(targetIndex)
          ? targetItems.length
          : Math.min(targetItems.length, Math.max(0, targetIndex));
        targetItems.splice(insertionIndex, 0, movedImage);
        if (dragInfo.type === 'group' && sourceItems.length === 0) {
          const sourceGroupIndex = state.batchGroups.indexOf(sourceItems);
          if (sourceGroupIndex >= 0) state.batchGroups.splice(sourceGroupIndex, 1);
        }
      }
    }

    state.draggedItemInfo = null;
    nativeDragSource = null;
    nativeDropTarget = null;
    renderBatchGroupsUI();
    await syncBatchStateToDB();
  });

  // 🌟 素直で軽量な Touch/PointerEvents スワイプ・タッチドロップ制御
  let pointerStartX = 0;
  let pointerStartY = 0;
  let activeThumb = null;
  let isPointerMoving = false;
  let activePointerTarget = null;
  let activePointerPool = null;
  let activePointerCard = null;
  let activePointerInsertionIndex = null;
  let pointerFrameId = 0;
  let latestPointerEvent = null;

  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (e.target.closest('button, input, select, textarea, .lightbox-close')) return;

    const thumb = e.target.closest('.preview-item, .draggable-thumb');
    if (e.pointerType === 'mouse' && thumb?.draggable) return;
    if (thumb && !e.target.closest('#lightbox-modal')) {
      activeThumb = thumb;
      pointerStartX = e.clientX;
      pointerStartY = e.clientY;
      isPointerMoving = false;
      activeThumb.classList.add('pointer-dragging');
      try {
        activeThumb.setPointerCapture(e.pointerId);
      } catch (err) {}
    }
  });

  document.addEventListener('pointermove', (e) => {
    if (!activeThumb || !activeThumb.hasPointerCapture(e.pointerId)) return;
    latestPointerEvent = e;
    if (pointerFrameId) return;
    pointerFrameId = requestAnimationFrame(() => {
      pointerFrameId = 0;
      if (!activeThumb || !latestPointerEvent) return;
      const currentEvent = latestPointerEvent;
      const diffX = currentEvent.clientX - pointerStartX;
      const diffY = currentEvent.clientY - pointerStartY;

      if (Math.abs(diffX) > 12 || Math.abs(diffY) > 12) {
        isPointerMoving = true;
        activeThumb.style.transform = `translate3d(${diffX}px, ${diffY}px, 0)`;
        activeThumb.style.opacity = '0.8';
        activeThumb.style.zIndex = '999';

        activeThumb.style.pointerEvents = 'none';
        const droppedTarget = document.elementFromPoint(currentEvent.clientX, currentEvent.clientY);
        const targetThumb = droppedTarget?.closest('#image-preview-list .preview-item, .batch-group-card .draggable-thumb, #ungrouped-pool-container .draggable-thumb');
        const targetPool = droppedTarget?.closest('#ungrouped-pool-container');
        const targetCard = droppedTarget?.closest('.batch-group-card');
        activeThumb.style.pointerEvents = '';
        if (activePointerPool !== targetPool) {
          activePointerPool?.classList.remove('drag-over');
          activePointerPool = targetPool;
          activePointerPool?.classList.add('drag-over');
        }
        if (activePointerCard !== targetCard) {
          activePointerCard?.classList.remove('drag-over');
          activePointerCard = targetCard;
          activePointerCard?.classList.add('drag-over');
        }
        const pointerGapTarget = !targetThumb
          ? findGapTarget(activeThumb.parentElement, currentEvent.clientX, currentEvent.clientY, activeThumb)
          : null;
        const nextPointerTarget = targetThumb && targetThumb !== activeThumb
          ? targetThumb
          : pointerGapTarget?.item || null;
        activePointerInsertionIndex = pointerGapTarget?.insertionIndex ?? null;
        if (activePointerTarget !== nextPointerTarget) {
          activePointerTarget?.classList.remove('reorder-target');
          activePointerTarget = nextPointerTarget;
          activePointerTarget?.classList.add('reorder-target');
        }
        const targetRect = activePointerTarget?.getBoundingClientRect();
        const targetIndex = activePointerTarget ? [...activePointerTarget.parentElement.querySelectorAll('.draggable-thumb, .preview-item')].indexOf(activePointerTarget) : -1;
        const hoverInsertionIndex = targetRect && targetIndex >= 0
          ? targetIndex + (currentEvent.clientX >= targetRect.left + targetRect.width / 2 ? 1 : 0)
          : activePointerInsertionIndex;
        updateReorderShifts(activeThumb, activePointerTarget, hoverInsertionIndex);
      }
    });
  });

  document.addEventListener('pointerup', async (e) => {
    if (!activeThumb) return;
    const thumb = activeThumb;
    activeThumb = null;
    const lastPointerTarget = activePointerTarget;
    const lastPointerPool = activePointerPool;
    const lastPointerCard = activePointerCard;
    const lastPointerInsertionIndex = activePointerInsertionIndex;

    try {
      if (thumb.hasPointerCapture(e.pointerId)) {
        thumb.releasePointerCapture(e.pointerId);
      }
    } catch (err) {}

    thumb.style.transform = '';
    thumb.style.opacity = '';
    thumb.style.zIndex = '';
    thumb.classList.remove('pointer-dragging');
    latestPointerEvent = null;
    if (pointerFrameId) {
      cancelAnimationFrame(pointerFrameId);
      pointerFrameId = 0;
    }
    activePointerTarget?.classList.remove('reorder-target');
    resetReorderShifts();
    activePointerTarget = null;
    activePointerInsertionIndex = null;
    activePointerPool?.classList.remove('drag-over');
    activePointerPool = null;
    activePointerCard?.classList.remove('drag-over');
    activePointerCard = null;

    if (!isPointerMoving) return;

    // 指を離した位置にあるドロップ要素を取得。取得できない場合は最後の検出先を使う。
    thumb.style.pointerEvents = 'none';
    const droppedEl = document.elementFromPoint(e.clientX, e.clientY) || lastPointerTarget || lastPointerPool || lastPointerCard;
    thumb.style.pointerEvents = '';

    if (!droppedEl) return;

    // 1. 単体登録エディタ内のタッチ並び替え
    const isEditor = thumb.classList.contains('preview-item');
    if (isEditor) {
      const targetThumb = droppedEl.closest('#image-preview-list .preview-item');
      if (targetThumb) {
        const targetImg = targetThumb.querySelector('img');
        const targetIdx = lastPointerInsertionIndex ?? (targetImg ? Number(targetImg.dataset.idx) : Number(targetThumb.dataset.idx));
        const imgEl = thumb.querySelector('img');
        const srcIdx = imgEl ? Number(imgEl.dataset.idx) : Number(thumb.dataset.idx);

        if (!isNaN(srcIdx) && !isNaN(targetIdx) && srcIdx !== targetIdx && state.uploadedImages[srcIdx]) {
          moveArrayItem(state.uploadedImages, srcIdx, targetIdx);
          state.activeThumbnailIndex = 0;
          renderImagePreviewList();
        }
      }
      return;
    }

    // 2. 一括インポート画面でのタッチ移動
    const dragInfo = thumb.dataset.sourceType === 'group'
      ? { type: 'group', gIdx: Number(thumb.dataset.gidx), iIdx: Number(thumb.dataset.iidx) }
      : { type: 'pool', idx: Number(thumb.dataset.idx) };
    const sourceItems = dragInfo.type === 'group' ? state.batchGroups[dragInfo.gIdx] : state.ungroupedImages;
    const targetCard = droppedEl.closest('.batch-group-card');
    const targetPool = droppedEl.closest('#ungrouped-pool-container');
    const targetThumb = droppedEl.closest('.draggable-thumb') || lastPointerTarget;
    let targetItems = null;
    let targetIndex = null;

    if (targetCard) {
      const targetGIdx = Number(targetCard.dataset.gidx);
      targetItems = state.batchGroups[targetGIdx] || null;
      if (targetThumb?.dataset.gidx !== undefined && Number(targetThumb.dataset.gidx) === targetGIdx) {
        targetIndex = lastPointerInsertionIndex ?? Number(targetThumb.dataset.iidx);
      }
    } else if (targetPool) {
      targetItems = state.ungroupedImages;
      if (targetThumb?.dataset.sourceType === 'pool') targetIndex = Number(targetThumb.dataset.idx);
    }

    const sourceIndex = dragInfo.type === 'group' ? dragInfo.iIdx : dragInfo.idx;
    if (sourceItems && sourceItems[sourceIndex] && targetItems) {
      if (sourceItems === targetItems) {
        if (targetIndex === null) targetIndex = targetItems.length;
        if (!isNaN(targetIndex) && sourceIndex !== targetIndex) moveArrayItem(sourceItems, sourceIndex, targetIndex);
      } else {
        const [movedItem] = sourceItems.splice(sourceIndex, 1);
        const insertionIndex = targetIndex === null || isNaN(targetIndex)
          ? targetItems.length
          : Math.min(targetItems.length, Math.max(0, targetIndex));
        targetItems.splice(insertionIndex, 0, movedItem);
        if (dragInfo.type === 'group' && sourceItems.length === 0) {
          const sourceGroupIndex = state.batchGroups.indexOf(sourceItems);
          if (sourceGroupIndex >= 0) state.batchGroups.splice(sourceGroupIndex, 1);
        }
      }
      renderBatchGroupsUI();
      await syncBatchStateToDB();
    }
  });

  // グローバルクリックイベント委譲ハンドラー
  document.addEventListener('click', async (e) => {
    if (e.target.closest('#btn-open-gemini-api-key')) {
      window.open('https://aistudio.google.com/app/apikey', '_blank', 'noopener,noreferrer');
      return;
    }

    if (e.target.closest('#btn-paste-gemini-api-key')) {
      const apiKeyInput = document.getElementById('gemini-api-key');
      try {
        const clipboardText = await navigator.clipboard.readText();
        if (apiKeyInput && clipboardText) {
          apiKeyInput.value = clipboardText.trim();
          apiKeyInput.focus();
        }
      } catch (err) {
        alert('クリップボードを読み取れませんでした。APIキー欄へ貼り付けてください。');
      }
      return;
    }

    if (e.target.closest('#btn-open-api-settings')) {
      await openApiSettings();
      return;
    }

    const sortButton = e.target.closest('[data-log-sort]');
    if (sortButton) {
      const nextSortKey = sortButton.dataset.logSort;
      if (state.logSortKey === nextSortKey) {
        state.logSortDirection = state.logSortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        state.logSortKey = nextSortKey;
        state.logSortDirection = 'desc';
      }
      await navigateTo('logList');
      return;
    }

    const analyticsAIButton = e.target.closest('[data-analytics-ai]');
    if (analyticsAIButton) {
      analyticsAIButton.disabled = true;
      await runAnalyticsAI(analyticsAIButton.dataset.analyticsAi);
      analyticsAIButton.disabled = false;
      return;
    }

    if (e.target.closest('.send-btn')) {
      await sendAiChatMessage();
      return;
    }

    const calendarDate = e.target.closest('[data-calendar-date]');
    if (calendarDate) {
      e.preventDefault();
      state.logSearchQuery = `日付:${calendarDate.dataset.calendarDate}`;
      await navigateTo('logList');
      document.getElementById('log-search-input')?.focus();
      return;
    }

    const calendarNav = e.target.closest('[data-calendar-nav]');
    if (calendarNav) {
      e.preventDefault();
      calendarMonth.setMonth(calendarMonth.getMonth() + (calendarNav.dataset.calendarNav === 'next' ? 1 : -1));
      await renderSidebarCalendar();
      return;
    }

    const searchTag = e.target.closest('.log-search-tag');
    if (searchTag) {
      e.preventDefault();
      const tag = searchTag.dataset.searchTag || '';
      const currentQuery = state.logSearchQuery.trim();
      const queryLower = currentQuery.toLocaleLowerCase();
      const tagLower = tag.toLocaleLowerCase();
      const tagIndex = queryLower.indexOf(tagLower);
      if (tag && tagIndex >= 0) {
        state.logSearchQuery = `${currentQuery.slice(0, tagIndex)} ${currentQuery.slice(tagIndex + tag.length)}`
          .replace(/\s+/g, ' ')
          .trim();
      } else if (tag) {
        state.logSearchQuery = currentQuery ? `${currentQuery} ${tag}` : tag;
      }
      await navigateTo('logList');
      document.getElementById('log-search-input')?.focus();
      return;
    }

    if (e.target.closest('#btn-clear-log-search')) {
      state.logSearchQuery = '';
      await navigateTo('logList');
      document.getElementById('log-search-input')?.focus();
      return;
    }

    const sidebarProfile = e.target.closest('#sidebar-user-profile');
    if (sidebarProfile) {
      e.preventDefault();
      if (state.isGoogleLoggedIn || localStorage.getItem('sella_google_logged_in') === 'true') {
        await navigateTo('settings');
      } else {
        loginGoogle();
      }
      return;
    }

    if (e.target.closest('#btn-fullscreen')) {
      e.preventDefault();
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
        } else {
          await document.documentElement.requestFullscreen();
        }
      } catch (err) {
        console.error('[Fullscreen] Toggle failed:', err);
      }
      return;
    }

    if (e.target && e.target.id === 'btn-toggle-pool-collapse') {
      e.stopPropagation();
      e.preventDefault();
      state.isPoolCollapsed = !state.isPoolCollapsed;
      renderBatchGroupsUI();
      return;
    }

    // 🌟 カード上の「✕」ボタン (グループから外してプールへ移動)
    const batchRemoveBtn = e.target.closest('.btn-batch-remove-img');
    if (batchRemoveBtn && !e.target.closest('#lightbox-modal')) {
      e.stopPropagation();
      e.preventDefault();
      const gIdx = Number(batchRemoveBtn.dataset.gidx);
      const iIdx = Number(batchRemoveBtn.dataset.iidx);
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

    // 🌟 プール上の「✕」ボタン (完全削除)
    const ungroupedRemoveBtn = e.target.closest('.btn-ungrouped-remove');
    if (ungroupedRemoveBtn && !e.target.closest('#lightbox-modal')) {
      e.stopPropagation();
      e.preventDefault();
      const idx = Number(ungroupedRemoveBtn.dataset.idx);
      if (!isNaN(idx) && state.ungroupedImages[idx]) {
        state.ungroupedImages.splice(idx, 1);
        renderBatchGroupsUI();
        await syncBatchStateToDB();
      }
      return;
    }

    // 🌟 未所属プールから「✨ これらからグループを作成」
    const createGroupFromPoolBtn = e.target.closest('#btn-create-group-from-ungrouped');
    if (createGroupFromPoolBtn) {
      e.stopPropagation();
      e.preventDefault();
      if (state.ungroupedImages.length > 0) {
        const newGroup = [...state.ungroupedImages];
        state.ungroupedImages = [];
        state.batchGroups.push(newGroup);
        renderBatchGroupsUI();
        await syncBatchStateToDB();
      }
      return;
    }

    // APIキー保存
    if (e.target && e.target.id === 'btn-save-api-key') {
      const apiKeyEl = document.getElementById('gemini-api-key');
      const apiKey = apiKeyEl ? apiKeyEl.value.trim() : '';
      if (!apiKey) {
        alert('APIキーを入力してください。');
        return;
      }
      saveApiKey(apiKey);
      renderAiChatControls();
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
      await updateModelDropdown(true);
      const selectedModel = document.getElementById('select-gemini-model')?.value;
      if (selectedModel) setSavedModel(selectedModel);
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

    const triggerSyncBtn = e.target.closest('#btn-trigger-sync');
    if (triggerSyncBtn) {
      await syncAllData(false);
      return;
    }

    const destroyAllButton = e.target.closest('#btn-destroy-all-data');
    if (destroyAllButton) {
      const input = document.getElementById('destroy-validation-input')?.value.trim();
      if (input === 'データをすべて消去する') {
        if (confirm('本当に実行しますか？この操作によりクラウド・ローカル双方の全ての酒ログと写真が永久に消滅します。')) {
          await destroyAllSellaData();
        }
      }
      return;
    }

    // ライトボックス表示
    if (e.target.closest('#lightbox-img')) {
      return;
    }

    const enlargeTarget = e.target.closest('img[data-action="enlarge-image"]');
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

          const orderedImages = group.map(img => {
            if (!img.blob && img.base64) {
              img.blob = base64ToBlob(img.base64, img.mimeType || 'image/jpeg');
            }
            return img;
          }).filter(img => img.blob instanceof Blob);
          const orderedBlobs = orderedImages.map(img => img.blob);

          let mainDate = '';
          const rawDate = group[0]?.date;
          if (rawDate) {
            const dateObj = (rawDate instanceof Date) ? rawDate : new Date(rawDate);
            if (!isNaN(dateObj.getTime())) {
              mainDate = formatDateToLocalYYYYMMDD(dateObj);
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
            status: 'active',
            imageMetadata: orderedImages.map(img => img.metadata || {})
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

          const base64 = targetImg.base64 || (targetImg.blob ? await blobToBase64(targetImg.blob) : '');
          if (!base64) {
            throw new Error('解析する画像データを読み込めませんでした');
          }
          const result = await analyzeLabelImage(base64, targetImg.mimeType);

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
    const detailArrow = e.target.closest('.sella-btn-prev, .sella-btn-next');
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
    if (delImgBtn && !e.target.closest('#lightbox-modal')) {
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

      const orderedImages = state.uploadedImages.map(img => {
        if (!img.blob && img.base64) {
          img.blob = base64ToBlob(img.base64, img.mimeType || 'image/jpeg');
        }
        return img;
      }).filter(img => img.blob instanceof Blob);
      const orderedBlobs = orderedImages.map(img => img.blob);

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
        status: 'active',
        imageMetadata: orderedImages.map(img => img.metadata || {})
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
