// src/store/state.js

export const state = {
  // 単体ログ編集用
  uploadedImages: [],
  activeThumbnailIndex: 0,
  backupFormData: {},
  currentEditingLogId: null,

  // 一括インポート用
  batchGroups: [],
  ungroupedImages: [],
  returnToBatchOnClose: false,
  currentBatchGroupIndex: null,
  draggedItemInfo: null,
  isPoolCollapsed: false,
  isBatchProcessing: false,

  // ライトボックス用
  activeLightboxCtx: null,

  // 詳細モーダル（スライドショー）用
  detailImages: [],
  detailActiveIndex: 0,

  // 現在アクティブなビュー名
  currentViewName: 'logList',
  logSearchQuery: '',
  logSortKey: 'date',
  logSortDirection: 'desc',

  // Googleアカウント同期ステータス
  googleAccessToken: null,
  googleUserSub: null,
  isGoogleLoggedIn: false,
  googleUserEmail: '',
  googleUserName: '',
  googleUserAvatar: '',
  isSyncing: false,
  googleAuthNeedsReauth: false,
  lastSyncedTime: '',
  lastSyncedAt: '',
  batchLocalUpdatedAt: ''
};

const SYNCED_LOG_VERSIONS_KEY = 'sella_synced_log_versions';

function getSyncedLogVersions() {
  try {
    const stored = JSON.parse(localStorage.getItem(SYNCED_LOG_VERSIONS_KEY) || '{}');
    return stored && typeof stored === 'object' ? stored : {};
  } catch (err) {
    return {};
  }
}

export function markSyncedLogVersions(logs) {
  const versions = getSyncedLogVersions();
  logs.forEach(log => {
    if (log?.id && log.updatedAt) versions[String(log.id)] = log.updatedAt;
  });
  localStorage.setItem(SYNCED_LOG_VERSIONS_KEY, JSON.stringify(versions));
}

export function renderSyncDot(updatedAt, label = '同期状態', imagesReady = true, logId = '') {
  const lastSyncedAt = localStorage.getItem('sella_last_synced_at') || state.lastSyncedAt;
  const updatedTime = Date.parse(updatedAt || '');
  const syncedTime = Date.parse(lastSyncedAt || '');
  const syncedVersion = logId ? getSyncedLogVersions()[String(logId)] : '';
  const isSynced = state.isGoogleLoggedIn && imagesReady && (
    syncedVersion === updatedAt
      || (!logId && !state.isSyncing && Number.isFinite(updatedTime) && Number.isFinite(syncedTime) && updatedTime <= syncedTime)
  );
  const status = isSynced ? 'synced' : 'local';
  const statusText = isSynced ? 'Google Driveに同期済み' : 'ローカル保存・未同期';
  return `<span class="sync-dot sync-dot-${status}" title="${statusText}" aria-label="${label}: ${statusText}"></span>`;
}

export function resetEditorState() {
  state.uploadedImages = [];
  state.activeThumbnailIndex = 0;
  state.backupFormData = {};
  state.currentEditingLogId = null;
  state.currentBatchGroupIndex = null;
}

export function base64ToBlob(base64, mimeType = 'image/jpeg') {
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

export function blobToBase64(blob) {
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
