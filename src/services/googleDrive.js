// src/services/googleDrive.js
import { state } from '../store/state.js';
import { openDB, getAllLogs, saveLog, permanentlyDeleteLog } from '../store/db.js';

// GISのクライアントスクリプトとDrive APIのURL定義
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/details?name=drive&version=v3';
// 🌟 Google Drive AppDataスコープ and ユーザーの表示名・アバター用のprofileスコープを統合
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.profile';

// ==========================================================================
// 🌟【デベロッパー向け】Google Cloud OAuthクライアントIDを設定
// ==========================================================================
export const GOOGLE_CLIENT_ID = '649730178066-ahldbjk9r9sn434u5hsgc9uhj96sllkv.apps.googleusercontent.com';

let tokenClient = null;
let resolveAuthPromise = null;

// ==========================================================================
// 🌟 Sella Settings Sync Protocol (V15 Specification) ゼロナレッジ暗号モジュール
// ==========================================================================
const CRYPTO_SALT = new TextEncoder().encode('SellaSakeLogCryptoSalt_9982');

/**
 * Google ID (sub) からメモリ上にAES-GCM 256bit鍵を動的導出する
 */
async function deriveKeyFromGoogleId(googleUserId) {
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(googleUserId),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: CRYPTO_SALT,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false, // 鍵のエクスポートを禁止（インメモリ保護）
    ['encrypt', 'decrypt']
  );
}

/**
 * 平文のAPIキーを暗号化
 */
export async function encryptApiKey(plainApiKey, googleUserId) {
  if (!plainApiKey) return { cipherText: '', iv: '' };
  
  const key = await deriveKeyFromGoogleId(googleUserId);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plainApiKey);

  const cipherBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );

  return {
    cipherText: btoa(String.fromCharCode(...new Uint8Array(cipherBuffer))),
    iv: btoa(String.fromCharCode(...iv))
  };
}

/**
 * 暗号化されたAPIキーを復号
 */
export async function decryptApiKey(cipherTextBase64, ivBase64, googleUserId) {
  if (!cipherTextBase64 || !ivBase64) return '';
  
  try {
    const key = await deriveKeyFromGoogleId(googleUserId);
    const cipherBuffer = new Uint8Array(atob(cipherTextBase64).split('').map(c => c.charCodeAt(0)));
    const iv = new Uint8Array(atob(ivBase64).split('').map(c => c.charCodeAt(0)));

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      cipherBuffer
    );

    return new TextDecoder().decode(decryptedBuffer);
  } catch (err) {
    console.error('[SyncCrypto] Decryption failed. Incorrect credentials or modified payload.', err);
    return '';
  }
}

// 同期から除外すべきローカル依存設定キー（デバイス特性依存）
const EXCLUDED_LOCAL_KEYS = [
  'sella_font_scale',
  'sella_auto_fullscreen',
  'sella_image_compress_quality',
  'sella_google_token',
  'sella_google_token_acquired_at',
  'sella_google_logged_in',
  'sella_google_user_name',
  'sella_google_user_avatar',
  'sella_google_user_sub',
  'sella_theme',
  'sella_settings_updated_at',
  'sella_last_synced_time',
  'sella_last_sync_theme',
  'sella_last_sync_apikey',
  'sella_last_sync_model',
  'sella_last_sync_bgimage',
  'sella_last_sync_custom',
  'gemini_api_key',
  'gemini_selected_model'
];

/**
 * localStorageから前方互換性のあるカスタム設定を抽出シリアライズ
 */
function serializeCustomSettings() {
  const custom = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith('sella_') && !EXCLUDED_LOCAL_KEYS.includes(key)) {
      custom[key] = localStorage.getItem(key);
    }
  }
  return custom;
}

/**
 * カスタム設定オブジェクトをlocalStorageへ書き戻し
 */
function deserializeCustomSettings(customObj) {
  if (!customObj) return;
  Object.keys(customObj).forEach(key => {
    if (!EXCLUDED_LOCAL_KEYS.includes(key)) {
      localStorage.setItem(key, customObj[key]);
    }
  });
}

/**
 * Google Identity Services のクライアントライブラリを動的ロード
 */
export function loadGoogleSDK() {
  return new Promise((resolve) => {
    if (window.google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    document.head.appendChild(script);
  });
}

/**
 * Google OAuth の初期化
 */
export async function initGoogleAuth() {
  await loadGoogleSDK();
  const clientId = GOOGLE_CLIENT_ID;
  if (!clientId || clientId.includes('YOUR_CLIENT_ID_HERE')) {
    console.warn('[GoogleDrive] Client ID is not configured. Google Drive Sync is disabled.');
    return;
  }

  // 起動時にログイン状態とユーザープロファイルキャッシュを復元
  if (localStorage.getItem('sella_google_logged_in') === 'true') {
    state.isGoogleLoggedIn = true;
    state.googleUserName = localStorage.getItem('sella_google_user_name') || 'Googleユーザー';
    state.googleUserAvatar = localStorage.getItem('sella_google_user_avatar') || '';
    state.googleUserSub = localStorage.getItem('sella_google_user_sub') || ''; // subの復元
  }

  if (!window.google?.accounts?.oauth2) {
    console.error('[GoogleDrive] Failed to access Google Accounts SDK. Delayed retrying inside login.');
    return;
  }

  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPES,
    callback: async (response) => {
      if (response.error !== undefined) {
        if (resolveAuthPromise) {
          resolveAuthPromise(false);
          resolveAuthPromise = null;
        }
        throw response;
      }
      state.googleAccessToken = response.access_token;
      localStorage.setItem('sella_google_token', response.access_token);
      localStorage.setItem('sella_google_token_acquired_at', Date.now().toString()); // トークン取得ミリ秒を記録

      // 🌟 Google API から実際の名前とプロフィールアバター画像を取得する
      try {
        const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { 'Authorization': `Bearer ${response.access_token}` }
        });
        if (profileRes.ok) {
          const userInfo = await profileRes.json();
          state.googleUserName = userInfo.name || 'Googleユーザー';
          state.googleUserAvatar = userInfo.picture || '';
          localStorage.setItem('sella_google_user_name', state.googleUserName);
          localStorage.setItem('sella_google_user_avatar', state.googleUserAvatar);
          if (userInfo.sub) { // subの保存 (ゼロナレッジ暗号鍵生成用)
            state.googleUserSub = userInfo.sub;
            localStorage.setItem('sella_google_user_sub', userInfo.sub);
          }
        }
      } catch (err) {
        console.error('[GoogleDrive] Failed to fetch user profile info:', err);
      }

      state.isGoogleLoggedIn = true;
      state.googleUserEmail = 'Google Drive 同期有効';
      localStorage.setItem('sella_google_logged_in', 'true');
      
      console.log('[GoogleDrive] Auth Success. Token acquired.');
      
      // ログイン成功時に自動同期トリガー
      document.dispatchEvent(new CustomEvent('google-login-success'));
      
      if (resolveAuthPromise) {
        resolveAuthPromise(true);
        resolveAuthPromise = null;
      }
    },
  });
}

/**
 * ログイン画面を呼び出し (Promise対応・手動ログイン用)
 * @param {boolean} isSilent - ポップアップを表示させないサイレントモードかどうか
 * @returns {Promise<boolean>} ログイン成功可否
 */
export function loginGoogle(isSilent = false) {
  return new Promise((resolve) => {
    const triggerAuth = () => {
      if (!tokenClient) {
        console.warn('Google SDK not initialized.');
        resolve(false);
        return;
      }
      resolveAuthPromise = resolve;
      if (isSilent) {
        console.log('[GoogleDrive] Attempting silent token refresh (prompt: none)...');
        // prompt: 'none' でGoogleにサイレント認証をリクエスト（ユーザー同意済みならポップアップが出ない）
        tokenClient.requestAccessToken({ prompt: 'none' });
      } else {
        // 通常の手動ログインは常にアカウント選択画面を表示させて安定させる
        tokenClient.requestAccessToken({ prompt: 'select_account' });
      }
    };

    if (!tokenClient) {
      initGoogleAuth().then(triggerAuth).catch(() => resolve(false));
    } else {
      triggerAuth();
    }
  });
}

/**
 * ログアウトを実行
 */
export function logoutGoogle(clearLocal = false) {
  const token = state.googleAccessToken || localStorage.getItem('sella_google_token');
  if (token) {
    window.google?.accounts?.oauth2.revoke(token, () => {
      console.log('[GoogleDrive] Token revoked.');
    });
  }

  state.googleAccessToken = null;
  state.isGoogleLoggedIn = false;
  state.googleUserEmail = '';
  state.googleUserName = '';
  state.googleUserAvatar = '';
  state.googleUserSub = '';
  localStorage.removeItem('sella_google_token');
  localStorage.removeItem('sella_google_token_acquired_at');
  localStorage.removeItem('sella_google_logged_in');
  localStorage.removeItem('sella_google_user_name');
  localStorage.removeItem('sella_google_user_avatar');
  localStorage.removeItem('sella_google_user_sub');
  localStorage.removeItem('sella_settings_updated_at');
  localStorage.removeItem('sella_last_sync_theme');
  localStorage.removeItem('sella_last_sync_apikey');
  localStorage.removeItem('sella_last_sync_model');
  localStorage.removeItem('sella_last_sync_bgimage');
  localStorage.removeItem('sella_last_sync_custom');

  // プロフィール更新イベントを発火してUIを同期
  document.dispatchEvent(new CustomEvent('google-logout-success'));

  if (clearLocal) {
    // 共用PC用に IndexedDB を完全に初期化
    indexedDB.deleteDatabase('SellaDB');
    alert('ローカルデータをすべて消去してログアウトしました。アプリを再ロードします。');
    window.location.reload();
  } else {
    alert('ログアウトしました。お酒データはローカルに保持されています。');
    // 再レンダリング
    document.dispatchEvent(new CustomEvent('navigation-request', { detail: 'settings' }));
  }
}

/**
 * クライアントサイドでの事前トークン有効期限（1時間）チェック
 */
export function isTokenExpired() {
  const acquiredAt = localStorage.getItem('sella_google_token_acquired_at');
  if (!acquiredAt) return true;
  
  const oneHourMs = 3600 * 1000; // OAuth2トークンの標準的な寿命
  const timePassed = Date.now() - parseInt(acquiredAt, 10);
  return timePassed >= oneHourMs;
}

/**
 * 🌟【プロレベル改善】トークン期限切れが発生した際、手動ログアウトさせずに裏で自動復元（サイレントリフレッシュ）する
 * @returns {Promise<boolean>} リフレッシュに成功したか
 */
export async function refreshGoogleTokenIfNeeded() {
  // すでにログイン状態で、かつトークン期限が切れている場合のみ
  if (localStorage.getItem('sella_google_logged_in') === 'true' && isTokenExpired()) {
    console.log('[GoogleDrive] Access token expired. Triggering silent refresh in background...');
    const success = await loginGoogle(true); // silent: true
    if (success) {
      console.log('[GoogleDrive] Silent token refresh completed successfully.');
      return true;
    } else {
      console.warn('[GoogleDrive] Silent token refresh failed. User interaction might be required.');
      // サイレントリフレッシュが完全に失敗（CORS制限、サードパーティCookie拒否、同意撤回等）した時のみ、
      // ユーザーが何かしらの同期ボタンを押したタイミングで手動ログインにフォールバックさせるため
      // ログインフラグだけは維持しつつトークン切れ警告のみを出す
      return false;
    }
  }
  return true;
}

/**
 * Google Drive API 通信ヘルパー (認証ヘッダー付与)
 */
async function driveFetch(url, options = {}) {
  // 🌟 通信前にトークン期限をチェックし、切れていたら「サイレントリフレッシュ」を試みる
  await refreshGoogleTokenIfNeeded();

  let token = state.googleAccessToken || localStorage.getItem('sella_google_token');
  if (!token) {
    throw new Error('Not authenticated with Google');
  }

  options.headers = { ...options.headers, 'Authorization': `Bearer ${token}` };

  try {
    const response = await fetch(url, options);
    
    // サーバー側から401（未認可：無効なトークンなど）が返ってきた場合
    if (response.status === 401) {
      console.warn('[GoogleDrive] Token unauthorized by server (401). Retrying with force silent refresh...');
      // 1回だけサイレントリフレッシュを強制試行してリトライする
      localStorage.setItem('sella_google_token_acquired_at', '0'); // 強制的に期限切れ判定にする
      const refreshed = await refreshGoogleTokenIfNeeded();
      if (refreshed) {
        token = state.googleAccessToken || localStorage.getItem('sella_google_token');
        options.headers['Authorization'] = `Bearer ${token}`;
        const retryResponse = await fetch(url, options);
        if (retryResponse.ok) {
          return retryResponse;
        }
      }
      // リトライも失敗した場合はじめてエラーにする
      throw new Error('AUTH_EXPIRED');
    }
    
    return response;
  } catch (err) {
    // ネットワークエラー（オフライン、タイムアウト等）の場合
    if (err instanceof TypeError || err.message?.includes('fetch')) {
      console.warn('[GoogleDrive] Network error detected. App is likely offline.');
      throw new Error('OFFLINE_NETWORK_ERROR');
    }
    throw err;
  }
}

/**
 * AppData内のファイル一覧を取得
 */
async function listCloudFiles() {
  const url = 'https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,name,mimeType)';
  const res = await driveFetch(url);
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Failed to list cloud files (HTTP ${res.status}): ${errText}`);
  }
  const data = await res.json();
  return data.files || [];
}

/**
 * クラウドにJSONファイルを新規アップロード / 上書き保存する
 */
async function uploadJsonFile(fileName, dataObj, existingFileId = null) {
  const metadata = { name: fileName, parents: ['appDataFolder'] };
  const boundary = 'sella_multipart_boundary';
  const delimiter = `\r\n--${boundary}\r\n`;
  const close_delim = `\r\n--${boundary}--`;

  const multipartBody = delimiter + 
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' + 
    JSON.stringify(metadata) + 
    delimiter + 
    'Content-Type: application/json\r\n\r\n' + 
    JSON.stringify(dataObj) + 
    close_delim;

  let url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
  let method = 'POST';

  if (existingFileId) {
    url = `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`;
    method = 'PATCH';
  }

  const res = await driveFetch(url, {
    method,
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipartBody
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Failed to upload ${fileName} (HTTP ${res.status}): ${errText}`);
  }
  return await res.json();
}

/**
 * クラウドのJSONファイルをダウンロード
 */
async function downloadJsonFile(fileId) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const res = await driveFetch(url);
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Failed to download JSON file (HTTP ${res.status}): ${errText}`);
  }
  return await res.json();
}

/**
 * クラウドにバイナリ画像Blobをアップロードする
 */
async function uploadImageFile(imgId, blob) {
  const fileName = `sella_img_${imgId}.bin`;
  const metadata = { name: fileName, parents: ['appDataFolder'] };
  const boundary = 'sella_img_multipart_boundary';
  const delimiter = `\r\n--${boundary}\r\n`;
  const close_delim = `\r\n--${boundary}--`;

  // ArrayBufferを読み込んでマルチパート送信
  const arrayBuffer = await blob.arrayBuffer();
  const headersPart = delimiter + 
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' + 
    JSON.stringify(metadata) + 
    delimiter + 
    `Content-Type: ${blob.type || 'image/jpeg'}\r\n\r\n`;
  const footerPart = close_delim;

  // Blobの再結合により安全にバイナリとJSONメタデータを多重送信
  const bodyBlob = new Blob([
    headersPart,
    new Uint8Array(arrayBuffer),
    footerPart
  ], { type: `multipart/related; boundary=${boundary}` });

  const url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
  const res = await driveFetch(url, { method: 'POST', body: bodyBlob });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Failed to upload image ${imgId} (HTTP ${res.status}): ${errText}`);
  }
  return await res.json();
}

/**
 * クラウドからバイナリ画像ファイルをダウンロードしてIndexedDBに同期
 */
async function downloadImageFile(fileId, imgId) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const res = await driveFetch(url);
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Failed to download image ${imgId} (HTTP ${res.status}): ${errText}`);
  }
  const blob = await res.blob();

  // IndexedDBに直接そのIDでインサート (autoIncrementを上書き)
  const db = await openDB();
  const tx = db.transaction(['images'], 'readwrite');
  const imgStore = tx.objectStore('images');
  await new Promise((resolve, reject) => {
    const req = imgStore.put({ id: imgId, blob, createdAt: new Date().toISOString() });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * クラウド上のファイルを物理削除
 */
async function deleteCloudFile(fileId) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}`;
  const res = await driveFetch(url, { method: 'DELETE' });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Failed to delete cloud file ${fileId} (HTTP ${res.status}): ${errText}`);
  }
}

/**
 * ★★★ 双方向マージ・クラウド同期エンジン ★★★
 * @param {boolean} silent - アラート等の表示を省略するか
 */
export async function syncAllData(silent = false) {
  const token = state.googleAccessToken || localStorage.getItem('sella_google_token');
  if (!token) return;

  if (state.isSyncing) return;
  state.isSyncing = true;
  document.dispatchEvent(new CustomEvent('sync-state-change', { detail: { syncing: true } }));

  try {
    console.log('[GoogleDriveSync] Starting sync session...');

    // 1. クラウド上のファイル一覧を取得
    const cloudFiles = await listCloudFiles();
    const indexFile = cloudFiles.find(f => f.name === 'sella_index.json');
    const configFile = cloudFiles.find(f => f.name === 'sella_config.json'); // 🌟 Sella Settings Sync Protocol専用設定ファイル
    const cloudImageFiles = cloudFiles.filter(f => f.name.startsWith('sella_img_'));

    // ==========================================================================
    // 🌟 ゼロナレッジ暗号化 (Sella Settings Sync Protocol V15) 設定同期セクション
    // ==========================================================================
    const googleUserId = state.googleUserSub || localStorage.getItem('sella_google_sub') || localStorage.getItem('sella_google_user_sub');
    
    if (googleUserId) {
      console.log('[GoogleDriveSync] Initializing settings sync with Zero-Knowledge encryption...');
      
      const currentTheme = localStorage.getItem('sella_theme') || 'dark';
      const currentApiKey = localStorage.getItem('gemini_api_key') || '';
      const currentModel = localStorage.getItem('gemini_selected_model') || 'models/gemini-2.5-flash';
      const currentBgImage = localStorage.getItem('sella_bg_image') || '';
      const currentCustom = serializeCustomSettings();

      const lastSavedTheme = localStorage.getItem('sella_last_sync_theme') || '';
      const lastSavedApiKey = localStorage.getItem('sella_last_sync_apikey') || '';
      const lastSavedModel = localStorage.getItem('sella_last_sync_model') || '';
      const lastSavedBgImage = localStorage.getItem('sella_last_sync_bgimage') || '';
      const lastSavedCustomStr = localStorage.getItem('sella_last_sync_custom') || '{}';
      
      let localSettingsUpdatedAt = localStorage.getItem('sella_settings_updated_at');

      const isCustomChanged = JSON.stringify(currentCustom) !== lastSavedCustomStr;

      if (currentTheme !== lastSavedTheme || 
          currentApiKey !== lastSavedApiKey || 
          currentModel !== lastSavedModel ||
          currentBgImage !== lastSavedBgImage ||
          isCustomChanged) {
        
        // ユーザーが前回同期以降に設定を変更した
        localSettingsUpdatedAt = new Date().toISOString();
        localStorage.setItem('sella_settings_updated_at', localSettingsUpdatedAt);
        
        localStorage.setItem('sella_last_sync_theme', currentTheme);
        localStorage.setItem('sella_last_sync_apikey', currentApiKey);
        localStorage.setItem('sella_last_sync_model', currentModel);
        localStorage.setItem('sella_last_sync_bgimage', currentBgImage);
        localStorage.setItem('sella_last_sync_custom', JSON.stringify(currentCustom));
      } else if (!localSettingsUpdatedAt) {
        localSettingsUpdatedAt = new Date().toISOString();
        localStorage.setItem('sella_settings_updated_at', localSettingsUpdatedAt);
      }

      // クラウド設定ファイルのフェッチとパース
      let cloudSettings = null;
      if (configFile) {
        try {
          cloudSettings = await downloadJsonFile(configFile.id);
        } catch (err) {
          console.error('[GoogleDriveSync] Failed to parse sella_config.json, recreating...', err);
        }
      }

      // 双方向マージ (LWW方式)
      let shouldUploadConfig = false;
      
      if (cloudSettings) {
        const localTime = new Date(localSettingsUpdatedAt || 0).getTime();
        const cloudTime = new Date(cloudSettings.updatedAt || 0).getTime();

        if (cloudTime > localTime) {
          console.log('[GoogleDriveSync] Cloud settings are newer. Overwriting local settings.');
          
          // クラウドが新しい場合はローカルに引き込み復号
          localStorage.setItem('sella_theme', cloudSettings.theme || 'dark');
          localStorage.setItem('gemini_selected_model', cloudSettings.selectedModel || 'models/gemini-2.5-flash');
          localStorage.setItem('sella_bg_image', cloudSettings.backgroundImage || '');
          deserializeCustomSettings(cloudSettings.customSettings);
          localStorage.setItem('sella_settings_updated_at', cloudSettings.updatedAt);

          let decryptedKey = '';
          if (cloudSettings.encryptedApiKey && cloudSettings.encryptIv) {
            decryptedKey = await decryptApiKey(cloudSettings.encryptedApiKey, cloudSettings.encryptIv, googleUserId);
            // 👑 超堅牢ガード: 復号に成功した（空でない）場合のみローカルキーを上書き
            if (decryptedKey) {
              localStorage.setItem('gemini_api_key', decryptedKey);
            }
          }

          // キャッシュ同期
          localStorage.setItem('sella_last_sync_theme', cloudSettings.theme || 'dark');
          localStorage.setItem('sella_last_sync_apikey', decryptedKey || localStorage.getItem('gemini_api_key') || '');
          localStorage.setItem('sella_last_sync_model', cloudSettings.selectedModel || 'models/gemini-2.5-flash');
          localStorage.setItem('sella_last_sync_bgimage', cloudSettings.backgroundImage || '');
          localStorage.setItem('sella_last_sync_custom', JSON.stringify(cloudSettings.customSettings || {}));

          // 即時適用
          document.documentElement.setAttribute('data-theme', cloudSettings.theme || 'dark');
          const themeSelect = document.getElementById('theme-select');
          if (themeSelect) {
            themeSelect.value = cloudSettings.theme || 'dark';
          }
        } else if (localTime > cloudTime) {
          shouldUploadConfig = true;
        }
      } else {
        // クラウドに設定ファイルが存在しない場合
        shouldUploadConfig = true;
      }

      // ローカルが新しい場合は暗号化してアップロード
      if (shouldUploadConfig) {
        console.log('[GoogleDriveSync] Local settings are newer. Encrypting and uploading...');
        const encrypted = await encryptApiKey(currentApiKey, googleUserId);
        
        const configPayload = {
          theme: currentTheme,
          selectedModel: currentModel,
          encryptedApiKey: encrypted.cipherText,
          encryptIv: encrypted.iv,
          backgroundImage: currentBgImage,
          customSettings: currentCustom,
          updatedAt: localSettingsUpdatedAt || new Date().toISOString()
        };

        await uploadJsonFile('sella_config.json', configPayload, configFile?.id);
        console.log('[GoogleDriveSync] Settings encrypted and synced successfully.');
      }
    } else {
      console.warn('[GoogleDriveSync] Google User sub (ID) not found. Settings sync skipped for security.');
    }

    // ==========================================================================
    // 📊 お酒ログ & 画像データ 同期セクション (sella_index.json)
    // ==========================================================================
    
    // 2. ローカル上のすべてのログを取得 (下書き、論理削除含む)
    const db = await openDB();
    const localLogs = await new Promise((res) => {
      const tx = db.transaction(['logs'], 'readonly');
      const req = tx.objectStore('logs').getAll();
      req.onsuccess = () => res(req.result || []);
      req.onerror = () => res([]);
    });

    // 3. クラウドインデックスをパース
    let cloudIndex = { logs: [], lastSynced: '' };
    if (indexFile) {
      try {
        cloudIndex = await downloadJsonFile(indexFile.id);
      } catch (err) {
        console.error('[GoogleDriveSync] Failed to parse cloud index, recreating...', err);
      }
    }

    // 4. ログデータの双方向タイムスタンプマージの実行
    const mergedLogsMap = new Map();
    const localLogsMap = new Map(localLogs.map(l => [l.id, l]));
    const cloudLogsMap = new Map((cloudIndex.logs || []).map(l => [l.id, l]));

    // 全てのユニークなIDのセット
    const allIds = new Set([...localLogsMap.keys(), ...cloudLogsMap.keys()]);

    let hasLocalLogsChanges = false;
    let hasCloudLogsChanges = false;

    for (const id of allIds) {
      const local = localLogsMap.get(id);
      const cloud = cloudLogsMap.get(id);

      if (local && cloud) {
        // 両方に存在：更新タイムスタンプを比較
        const localTime = new Date(local.updatedAt || 0).getTime();
        const cloudTime = new Date(cloud.updatedAt || 0).getTime();

        if (localTime > cloudTime) {
          mergedLogsMap.set(id, local);
          hasLocalLogsChanges = true; // ローカルが新しいため、クラウドを更新する必要あり
        } else if (cloudTime > localTime) {
          mergedLogsMap.set(id, cloud);
          hasCloudLogsChanges = true; // クラウドが新しいため、ローカルを更新する必要あり
        } else {
          mergedLogsMap.set(id, local); // 同一
        }
      } else if (local) {
        // ローカルにのみ存在：クラウドへアップロード対象
        mergedLogsMap.set(id, local);
        hasLocalLogsChanges = true;
      } else if (cloud) {
        // クラウドにのみ存在：ローカルへ取り込み対象
        mergedLogsMap.set(id, cloud);
        hasCloudLogsChanges = true;
      }
    }

    // 5. マージ結果をローカル IndexedDB に書き戻し
    if (hasCloudLogsChanges) {
      console.log('[GoogleDriveSync] Applying cloud updates to Local DB...');
      const tx = db.transaction(['logs'], 'readwrite');
      const logStore = tx.objectStore('logs');
      for (const log of mergedLogsMap.values()) {
        await new Promise((resolve) => {
          const req = logStore.put(log);
          req.onsuccess = () => resolve();
        });
      }
    }

    // 6. 画像ファイルの完全同期判定（★ Promise.all 並列化：ハングやデッドロックを完全に防ぎ超爆速化）
    console.log('[GoogleDriveSync] Auditing and syncing image binaries...');
    const requiredImageIds = new Set();
    for (const log of mergedLogsMap.values()) {
      if (log.isDeleted) continue;
      if (Array.isArray(log.imageIds)) {
        log.imageIds.forEach(id => requiredImageIds.add(Number(id)));
      }
    }

    // ローカル IndexedDB の images ストアにある画像ID一覧を精査
    const localImageIds = await new Promise((res) => {
      const tx = db.transaction(['images'], 'readonly');
      const req = tx.objectStore('images').getAllKeys();
      req.onsuccess = () => res(req.result || []);
      req.onerror = () => res([]);
    });
    const localImageIdsSet = new Set(localImageIds.map(Number));

    // クラウド上の sella_img_*.bin ファイル一覧を精査
    const cloudImageFilesMap = new Map(); // imgId -> cloudFile
    cloudImageFiles.forEach(f => {
      const match = f.name.match(/^sella_img_(\d+)\.bin$/);
      if (match) {
        cloudImageFilesMap.set(Number(match[1]), f);
      }
    });

    // A. 【アップロード】ローカルに存在し、クラウドにない画像の一括並行転送
    const uploadPromises = [];
    for (const imgId of requiredImageIds) {
      if (localImageIdsSet.has(imgId) && !cloudImageFilesMap.has(imgId)) {
        console.log(`[GoogleDriveSync] Queueing upload for image ${imgId}...`);
        uploadPromises.push((async () => {
          const blobRecord = await new Promise((res) => {
            const tx = db.transaction(['images'], 'readonly');
            const req = tx.objectStore('images').get(imgId);
            req.onsuccess = () => res(req.result);
            req.onerror = () => res(null);
          });
          if (blobRecord && blobRecord.blob) {
            await uploadImageFile(imgId, blobRecord.blob);
          }
        })());
      }
    }
    if (uploadPromises.length > 0) {
      await Promise.all(uploadPromises);
    }

    // B. 【ダウンロード】クラウドに存在し、ローカルにない画像の一括並行取り込み
    const downloadPromises = [];
    for (const imgId of requiredImageIds) {
      if (!localImageIdsSet.has(imgId) && cloudImageFilesMap.has(imgId)) {
        console.log(`[GoogleDriveSync] Queueing download for image ${imgId}...`);
        const cloudFile = cloudImageFilesMap.get(imgId);
        downloadPromises.push(downloadImageFile(cloudFile.id, imgId));
      }
    }
    if (downloadPromises.length > 0) {
      await Promise.all(downloadPromises);
    }

    // C. 【クリーンアップ】どこからも参照されなくなったクラウド上の孤立画像の一括並行消去
    const deletePromises = [];
    for (const [imgId, cloudFile] of cloudImageFilesMap.entries()) {
      if (!requiredImageIds.has(imgId)) {
        console.log(`[GoogleDriveSync] Queueing purge for unused cloud image: ${cloudFile.name}`);
        deletePromises.push(deleteCloudFile(cloudFile.id));
      }
    }
    if (deletePromises.length > 0) {
      await Promise.all(deletePromises);
    }

    // 7. 最新のインデックスファイル sella_index.json をクラウドに書き出し
    const updatedIndex = {
      logs: Array.from(mergedLogsMap.values()),
      lastSynced: new Date().toISOString()
    };
    await uploadJsonFile('sella_index.json', updatedIndex, indexFile?.id);

    // 8. ゴミ箱（論理削除）から30日以上経過したアイテムをローカル・クラウド双方から「物理完全消去」
    const EXPIRE_LIMIT_MS = 30 * 24 * 60 * 60 * 1000;
    const nowTime = Date.now();
    for (const log of mergedLogsMap.values()) {
      if (log.isDeleted && log.deletedAt) {
        const deletedTime = new Date(log.deletedAt).getTime();
        if (nowTime - deletedTime > EXPIRE_LIMIT_MS) {
          console.log(`[GoogleDriveSync] Expired logic delete: Permanently deleting ${log.id}...`);
          await permanentlyDeleteLog(log.id);
          // クラウドの該当画像も物理消去
          if (Array.isArray(log.imageIds)) {
            for (const imgId of log.imageIds) {
              const cloudImg = cloudImageFilesMap.get(Number(imgId));
              if (cloudImg) await deleteCloudFile(cloudImg.id);
            }
          }
        }
      }
    }

    // 最終同期ステータス更新
    const timeStr = new Date().toLocaleTimeString();
    localStorage.setItem('sella_last_synced_time', timeStr);
    state.lastSyncedTime = timeStr;

    console.log('[GoogleDriveSync] Sync session completed successfully.');
    if (!silent) alert('Googleアカウント上のデータと正常に同期されました！');

    // UIの強制再レンダリングをトリガー
    document.dispatchEvent(new CustomEvent('sync-completed'));

  } catch (err) {
    console.error('[GoogleDriveSync] Critical error during synchronization:', err);
    if (err.message === 'OFFLINE_NETWORK_ERROR') {
      if (!silent) {
        alert('現在オフラインです。ネットワーク接続が復旧した際に再度自動同期されます。');
      }
    } else if (err.message !== 'AUTH_EXPIRED') {
      if (!silent) {
        // 🌟 生のエラーメッセージをダイアログ内に詳細出力するよう改良（デバッグ効率の劇的向上）
        alert(`データの同期中にエラーが発生しました。\n\n詳細エラー: ${err.message}\n\n※Google Cloud Consoleで「Google Drive API」が有効になっていないか、テストユーザー制限、スコープ不足の可能性があります。`);
      }
    }
  } finally {
    state.isSyncing = false;
    document.dispatchEvent(new CustomEvent('sync-state-change', { detail: { syncing: false } }));
  }
}

/**
 * Googleアカウントおよびローカル上のすべてのデータを「完全消去・初期化」する
 */
export async function destroyAllSellaData() {
  const token = state.googleAccessToken || localStorage.getItem('sella_google_token');

  // 1. ローカルIndexedDBの消去
  indexedDB.deleteDatabase('SellaDB');

  // 2. クラウドデータの消去
  if (token) {
    try {
      const files = await listCloudFiles();
      for (const f of files) {
        console.log(`[GoogleDrive] Purging cloud file on destroy: ${f.name}`);
        await deleteCloudFile(f.id);
      }
    } catch (err) {
      console.error('[GoogleDrive] Failed to clean cloud data:', err);
    }
  }

  // 3. ローカルストレージのクリア
  localStorage.clear();

  alert('すべての酒ログデータ、画像、およびクラウドバックアップを完全に消去しました。システムを初期状態から再起動します。');
  window.location.reload();
}
