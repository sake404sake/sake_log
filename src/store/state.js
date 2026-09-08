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

  // ライトボックス用
  activeLightboxCtx: null,

  // ★詳細モーダル（スライドショー）用
  detailImages: [],
  detailActiveIndex: 0,

  // 現在アクティブなビュー名
  currentViewName: 'logList',

  // ★Googleアカウント同期ステータス
  googleAccessToken: null,
  isGoogleLoggedIn: false,
  googleUserEmail: '',
  googleUserName: '',     // 🌟追加: ログインユーザーの表示名
  googleUserAvatar: '',   // 🌟追加: ログインユーザーのプロフィール画像URL
  isSyncing: false,
  lastSyncedTime: ''
};

// 状態リセット用ヘルパー
export function resetEditorState() {
  state.uploadedImages = [];
  state.activeThumbnailIndex = 0;
  state.backupFormData = {};
  state.currentEditingLogId = null;
  state.currentBatchGroupIndex = null;
}

// Base64-Blob相互変換ユーティリティ
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
