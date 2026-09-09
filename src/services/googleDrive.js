// src/services/googleDrive.js
import { state } from '../store/state.js';
import { openDB, getAllLogs, saveLog, permanentlyDeleteLog } from '../store/db.js';

// GISのクライアントスクリプトとDrive APIのURL定義
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/details?name=drive&version=v3';
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.profile';

// ==========================================================================
// 🌟 Google Cloud OAuthクライアントID
// ==========================================================================
export const GOOGLE_CLIENT_ID = '649730178066-ahldbjk9r9sn434u5hsgc9uhj96sllkv.apps.googleusercontent.com';

let tokenClient = null;

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
  'sella_google_sub',
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
    if (key && key.startsWith('sella_') && !EXCLUDED_LOCAL_KEYS.includes(key)) {
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

  if (localStorage.getItem('sella_google_logged_in') === 'true') {
    state.isGoogleLoggedIn = true;
    state.googleUserName = localStorage.getItem('sella_google_user_name') || 'Googleユーザー';
    state.googleUserAvatar = localStorage.getItem('sella_google_user_avatar') || '';
    state.googleUserSub = localStorage.getItem('sella_google_user_sub') || localStorage.getItem('sella_google_sub') || '';
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
        throw response;
      }
      state.googleAccessToken = response.access_token;
      localStorage.setItem('sella_google_token', response.access_token);
      localStorage.setItem('sella_google_token_acquired_at', Date.now().toString());

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
          if (userInfo.sub) {
            state.googleUserSub = userInfo.sub;
            localStorage.setItem('sella_google_user_sub', userInfo.sub);
            localStorage.setItem('sella_google_sub', userInfo.sub);
          }
        }
      } catch (err) {
        console.error('[GoogleDrive] Failed to fetch user profile info:', err);
      }

      state.isGoogleLoggedIn = true;
      state.googleUserEmail = 'Google Drive 同期有効';
      localStorage.setItem('sella_google_logged_in', 'true');
      
      console.log('[GoogleDrive] Auth Success. Token acquired.');
      document.dispatchEvent(new CustomEvent('google-login-success'));
      await syncAllData(true);
    },
  });
}

/**
 * ログイン画面を呼び出し (ポップアップ表示)
 */
export function loginGoogle() {
  const triggerAuth = () => {
    if (!tokenClient) {
      alert('Google OAuth クライアントIDが正しく設定されていないか、初期化に失敗しました。設定画面をご確認ください。');
      return;
    }
    tokenClient.requestAccessToken({ prompt: 'select_account' });
  };

  if (!tokenClient) {
    initGoogleAuth().then(triggerAuth);
  } else {
    triggerAuth();
  }
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
  localStorage.removeItem('sella_google_sub');
  localStorage.removeItem('sella_settings_updated_at');
  localStorage.removeItem('sella_last_sync_theme');
  localStorage.removeItem('sella_last_sync_apikey');
  localStorage.removeItem('sella_last_sync_model');
  localStorage.removeItem('sella_last_sync_bgimage');
  localStorage.removeItem('sella_last_sync_custom');

  document.dispatchEvent(new CustomEvent('google-logout-success'));

  if (clearLocal) {
    indexedDB.deleteDatabase('SellaDB');
    alert('ローカルデータをすべて消去してログアウトしました。アプリを再ロードします。');
    window.location.reload();
  } else {
    alert('ログアウトしました。お酒データはローカルに保持されています。');
    document.dispatchEvent(new CustomEvent('navigation-request', { detail: 'settings' }));
  }
}

/**
 * トークンの1時間経過判定
 */
export function isTokenExpired() {
  const acquiredAt = localStorage.getItem('sella_google_token_acquired_at');
  if (!acquiredAt) return true;
  
  const oneHourMs = 3600 * 1000;
  const timePassed = Date.now() - parseInt(acquiredAt, 10);
  return timePassed >= oneHourMs;
}

/**
 * 🌟【追加】完全に無音（サイレント）でトークンをバックグラウンド再取得・延命させる関数
 */
export function refreshTokenSilently() {
  return new Promise((resolve, reject) => {
    const doRequest = () => {
      if (!tokenClient) {
        reject(new Error('Token client not initialized'));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Silent token refresh timeout'));
      }, 8000);

      const previousCallback = tokenClient.callback;
      tokenClient.callback = async (response) => {
        clearTimeout(timeout);
        tokenClient.callback = previousCallback; // restore
        if (response && response.access_token) {
          state.googleAccessToken = response.access_token;
          localStorage.setItem('sella_google_token', response.access_token);
          localStorage.setItem('sella_google_token_acquired_at', Date.now().toString());
          state.isGoogleLoggedIn = true;
          localStorage.setItem('sella_google_logged_in', 'true');
          console.log('[GoogleDrive] Silent token refresh succeeded.');
          resolve(response.access_token);
        } else {
          reject(response?.error || new Error('Silent refresh failed'));
        }
      };

      try {
        // prompt: '' でダイアログを出さずにバックグラウンド認証
        tokenClient.requestAccessToken({ prompt: '' });
      } catch (err) {
        clearTimeout(timeout);
        tokenClient.callback = previousCallback;
        reject(err);
      }
    };

    if (!tokenClient) {
      initGoogleAuth().then(doRequest).catch(reject);
    } else {
      doRequest();
    }
  });
}

/**
 * セッション完全失効時のクリーンアップ処理
 */
function handleTokenExpired() {
  state.isGoogleLoggedIn = false;
  state.googleAccessToken = null;
  localStorage.removeItem('sella_google_token');
  localStorage.removeItem('sella_google_token_acquired_at');
  localStorage.removeItem('sella_google_logged_in');
  
  document.dispatchEvent(new CustomEvent('google-logout-success'));
  state.isSyncing = false;
  document.dispatchEvent(new CustomEvent('sync-state-change', { detail: { syncing: false } }));
  
  alert('Googleアカウントのセッション有効期限が切れました。安全な同期のため、お手数ですが再度ログインを行ってください。');
}

/**
 * 🌟【強化版】Google Drive API 通信ヘルパー (自動サイレントリフレッシュ対応)
 */
async function driveFetch(url, options = {}) {
  let token = state.googleAccessToken || localStorage.getItem('sella_google_token');
  
  // トークンが無いがログインフラグがある場合、サイレントリフレッシュを試みる
  if (!token && localStorage.getItem('sella_google_logged_in') === 'true') {
    try {
      token = await refreshTokenSilently();
    } catch (e) {
      console.warn('[GoogleDrive] Silent refresh failed on missing token:', e);
    }
  }

  if (!token) {
    throw new Error('Not authenticated with Google');
  }

  // 1時間経過していた場合、サイレントリフレッシュを実行してトークンを自動延命
  if (isTokenExpired()) {
    console.warn('[GoogleDrive] Token detected as expired. Performing silent token refresh...');
    try {
      token = await refreshTokenSilently();
    } catch (err) {
      console.error('[GoogleDrive] Silent refresh failed:', err);
      handleTokenExpired();
      throw new Error('AUTH_EXPIRED');
    }
  }

  options.headers = { ...options.headers, 'Authorization': `Bearer ${token}` };

  try {
    let response = await fetch(url, options);
    
    // サーバーから 401（未認可）が返ってきた場合も1度だけサイレントリフレッシュして再試行
    if (response.status === 401) {
      console.warn('[GoogleDrive] Received 401 Unauthorized. Attempting silent refresh retry...');
      try {
        token = await refreshTokenSilently();
        options.headers['Authorization'] = `Bearer ${token}`;
        response = await fetch(url, options);
      } catch (refErr) {
        console.error('[GoogleDrive] Silent refresh on 401 failed:', refErr);
        handleTokenExpired();
        throw new Error('AUTH_EXPIRED');
      }
    }
    
    return response;
  } catch (err) {
    if (err instanceof TypeError || err.message?.includes('fetch')) {
      console.warn('[GoogleDrive] Network error detected. App is likely offline. Login state is preserved.');
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
  const metadata = { name: fileName };
  
  if (!existingFileId) {
    metadata.parents = ['appDataFolder'];
  }

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

  const arrayBuffer = await blob.arrayBuffer();
  const headersPart = delimiter + 
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' + 
    JSON.stringify(metadata) + 
    delimiter + 
    `Content-Type: ${blob.type || 'image/jpeg'}\r\n\r\n`;
  const footerPart = close_delim;

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
 * 🌟 双方向マージ・クラウド同期エンジン (設定・モデル・暗号キー・ログ・画像全対応)
 */
export async function syncAllData(silent = false) {
  const token = state.googleAccessToken || localStorage.getItem('sella_google_token');
  if (!token) return;

  if (state.isSyncing) return;
  state.isSyncing = true;
  document.dispatchEvent(new CustomEvent('sync-state-change', { detail: { syncing: true } }));

  try {
    console.log('[GoogleDriveSync] Starting sync session...');

    const currentTheme = localStorage.getItem('sella_theme') || 'dark';
    const currentApiKey = localStorage.getItem('gemini_api_key') || '';
    const currentModel = localStorage.getItem('gemini_selected_model') || 'models/gemini-2.5-flash';
    const currentBgImage = localStorage.getItem('sella_bg_image') || '';
    const currentCustom = serializeCustomSettings();

    const lastSavedTheme = localStorage.getItem('sella_last_sync_theme');
    const lastSavedApiKey = localStorage.getItem('sella_last_sync_apikey');
    const lastSavedModel = localStorage.getItem('sella_last_sync_model');
    const lastSavedBgImage = localStorage.getItem('sella_last_sync_bgimage');
    const lastSavedCustomStr = localStorage.getItem('sella_last_sync_custom');

    let localSettingsUpdatedAt = localStorage.getItem('sella_settings_updated_at');

    const isSettingsChanged = 
      lastSavedTheme === null ||
      lastSavedApiKey === null ||
      lastSavedModel === null ||
      currentTheme !== lastSavedTheme || 
      currentApiKey !== lastSavedApiKey || 
      currentModel !== lastSavedModel ||
      currentBgImage !== lastSavedBgImage ||
      (lastSavedCustomStr !== null && JSON.stringify(currentCustom) !== lastSavedCustomStr);

    if (isSettingsChanged && (currentApiKey || currentModel || currentTheme !== 'dark' || localSettingsUpdatedAt)) {
      localSettingsUpdatedAt = new Date().toISOString();
      localStorage.setItem('sella_settings_updated_at', localSettingsUpdatedAt);
      
      localStorage.setItem('sella_last_sync_theme', currentTheme);
      localStorage.setItem('sella_last_sync_apikey', currentApiKey);
      localStorage.setItem('sella_last_sync_model', currentModel);
      localStorage.setItem('sella_last_sync_bgimage', currentBgImage);
      localStorage.setItem('sella_last_sync_custom', JSON.stringify(currentCustom));
    }

    const cloudFiles = await listCloudFiles();
    const indexFile = cloudFiles.find(f => f.name === 'sella_index.json');
    const configFile = cloudFiles.find(f => f.name === 'sella_config.json');
    const cloudImageFiles = cloudFiles.filter(f => f.name.startsWith('sella_img_'));

    // ==========================================================================
    // 🌟 ゼロナレッジ暗号化 (Sella Settings Sync Protocol V15) 設定同期セクション
    // ==========================================================================
    const googleUserId = state.googleUserSub || localStorage.getItem('sella_google_user_sub') || localStorage.getItem('sella_google_sub');

    if (googleUserId) {
      console.log('[GoogleDriveSync] Initializing settings sync with Zero-Knowledge encryption...');

      let cloudSettings = null;
      if (configFile) {
        try {
          cloudSettings = await downloadJsonFile(configFile.id);
        } catch (err) {
          console.error('[GoogleDriveSync] Failed to parse sella_config.json, recreating...', err);
        }
      }

      let shouldUploadConfig = false;
      
      if (cloudSettings) {
        const localTime = localSettingsUpdatedAt ? new Date(localSettingsUpdatedAt).getTime() : 0;
        const cloudTime = new Date(cloudSettings.updatedAt || 0).getTime();

        const isLocalUninitializedAndEmpty = !localSettingsUpdatedAt && !currentApiKey;
        const isLocalKeyEmptyButCloudHas = !currentApiKey && cloudSettings.encryptedApiKey;

        if ((cloudTime > localTime) || isLocalUninitializedAndEmpty || isLocalKeyEmptyButCloudHas) {
          console.log('[GoogleDriveSync] Cloud settings are newer or local is uninitialized. Restoring cloud settings to local...');
          
          if (cloudSettings.theme) {
            localStorage.setItem('sella_theme', cloudSettings.theme);
            document.documentElement.setAttribute('data-theme', cloudSettings.theme);
            const themeSelect = document.getElementById('theme-select');
            if (themeSelect) themeSelect.value = cloudSettings.theme;
          }

          // 🌟【修復】モデル選択情報を復元し、DOM画面のセレクトボックスも即時更新！
          if (cloudSettings.selectedModel) {
            localStorage.setItem('gemini_selected_model', cloudSettings.selectedModel);
            const globalModelSelect = document.getElementById('select-gemini-model');
            const modalModelSelect = document.getElementById('modal-model-select');
            if (globalModelSelect) globalModelSelect.value = cloudSettings.selectedModel;
            if (modalModelSelect) modalModelSelect.value = cloudSettings.selectedModel;
          }

          if (cloudSettings.backgroundImage !== undefined) {
            localStorage.setItem('sella_bg_image', cloudSettings.backgroundImage || '');
          }
          if (cloudSettings.customSettings) {
            deserializeCustomSettings(cloudSettings.customSettings);
          }
          if (cloudSettings.updatedAt) {
            localStorage.setItem('sella_settings_updated_at', cloudSettings.updatedAt);
          }

          let decryptedKey = '';
          if (cloudSettings.encryptedApiKey && cloudSettings.encryptIv) {
            decryptedKey = await decryptApiKey(cloudSettings.encryptedApiKey, cloudSettings.encryptIv, googleUserId);
            if (decryptedKey) {
              localStorage.setItem('gemini_api_key', decryptedKey);
              const apiKeyInput = document.getElementById('gemini-api-key');
              if (apiKeyInput) apiKeyInput.value = decryptedKey;
            }
          }

          localStorage.setItem('sella_last_sync_theme', cloudSettings.theme || 'dark');
          localStorage.setItem('sella_last_sync_apikey', decryptedKey || currentApiKey || '');
          localStorage.setItem('sella_last_sync_model', cloudSettings.selectedModel || 'models/gemini-2.5-flash');
          localStorage.setItem('sella_last_sync_bgimage', cloudSettings.backgroundImage || '');
          localStorage.setItem('sella_last_sync_custom', JSON.stringify(cloudSettings.customSettings || {}));

        } else if (localTime > cloudTime || (localSettingsUpdatedAt && !cloudSettings)) {
          shouldUploadConfig = true;
        }
      } else {
        shouldUploadConfig = true;
      }

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

    const db = await openDB();
    const localLogs = await new Promise((res) => {
      const tx = db.transaction(['logs'], 'readonly');
      const req = tx.objectStore('logs').getAll();
      req.onsuccess = () => res(req.result || []);
      req.onerror = () => res([]);
    });

    let cloudIndex = { logs: [], lastSynced: '' };
    if (indexFile) {
      try {
        cloudIndex = await downloadJsonFile(indexFile.id);
      } catch (err) {
        console.error('[GoogleDriveSync] Failed to parse cloud index, recreating...', err);
      }
    }

    const mergedLogsMap = new Map();
    const localLogsMap = new Map(localLogs.map(l => [l.id, l]));
    const cloudLogsMap = new Map((cloudIndex.logs || []).map(l => [l.id, l]));

    const allIds = new Set([...localLogsMap.keys(), ...cloudLogsMap.keys()]);

    let hasLocalLogsChanges = false;
    let hasCloudLogsChanges = false;

    for (const id of allIds) {
      const local = localLogsMap.get(id);
      const cloud = cloudLogsMap.get(id);

      if (local && cloud) {
        const localTime = new Date(local.updatedAt || 0).getTime();
        const cloudTime = new Date(cloud.updatedAt || 0).getTime();

        if (localTime > cloudTime) {
          mergedLogsMap.set(id, local);
          hasLocalLogsChanges = true;
        } else if (cloudTime > localTime) {
          mergedLogsMap.set(id, cloud);
          hasCloudLogsChanges = true;
        } else {
          mergedLogsMap.set(id, local);
        }
      } else if (local) {
        mergedLogsMap.set(id, local);
        hasLocalLogsChanges = true;
      } else if (cloud) {
        mergedLogsMap.set(id, cloud);
        hasCloudLogsChanges = true;
      }
    }

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

    console.log('[GoogleDriveSync] Auditing and syncing image binaries...');
    const requiredImageIds = new Set();
    for (const log of mergedLogsMap.values()) {
      if (log.isDeleted) continue;
      if (Array.isArray(log.imageIds)) {
        log.imageIds.forEach(id => requiredImageIds.add(Number(id)));
      }
    }

    const localImageIds = await new Promise((res) => {
      const tx = db.transaction(['images'], 'readonly');
      const req = tx.objectStore('images').getAllKeys();
      req.onsuccess = () => res(req.result || []);
      req.onerror = () => res([]);
    });
    const localImageIdsSet = new Set(localImageIds.map(Number));

    const cloudImageFilesMap = new Map();
    cloudImageFiles.forEach(f => {
      const match = f.name.match(/^sella_img_(\d+)\.bin$/);
      if (match) {
        cloudImageFilesMap.set(Number(match[1]), f);
      }
    });

    const uploadTargets = [];
    for (const imgId of requiredImageIds) {
      if (localImageIdsSet.has(imgId) && !cloudImageFilesMap.has(imgId)) {
        uploadTargets.push(imgId);
      }
    }

    if (uploadTargets.length > 0) {
      console.log(`[GoogleDriveSync] Uploading ${uploadTargets.length} images...`);
      await Promise.all(uploadTargets.map(async (imgId) => {
        const blobRecord = await new Promise((res) => {
          const tx = db.transaction(['images'], 'readonly');
          const req = tx.objectStore('images').get(imgId);
          req.onsuccess = () => res(req.result);
          req.onerror = () => res(null);
        });
        if (blobRecord && blobRecord.blob) {
          await uploadImageFile(imgId, blobRecord.blob);
        }
      }));
    }

    const downloadTargets = [];
    for (const imgId of requiredImageIds) {
      if (!localImageIdsSet.has(imgId) && cloudImageFilesMap.has(imgId)) {
        downloadTargets.push(imgId);
      }
    }

    if (downloadTargets.length > 0) {
      console.log(`[GoogleDriveSync] Downloading ${downloadTargets.length} images...`);
      await Promise.all(downloadTargets.map(async (imgId) => {
        const cloudFile = cloudImageFilesMap.get(imgId);
        await downloadImageFile(cloudFile.id, imgId);
      }));
    }

    const deleteTargets = [];
    for (const [imgId, cloudFile] of cloudImageFilesMap.entries()) {
      if (!requiredImageIds.has(imgId)) {
        deleteTargets.push(cloudFile);
      }
    }

    if (deleteTargets.length > 0) {
      console.log(`[GoogleDriveSync] Purging ${deleteTargets.length} unused cloud images...`);
      await Promise.all(deleteTargets.map(async (cloudFile) => {
        await deleteCloudFile(cloudFile.id);
      }));
    }

    const updatedIndex = {
      logs: Array.from(mergedLogsMap.values()),
      lastSynced: new Date().toISOString()
    };
    await uploadJsonFile('sella_index.json', updatedIndex, indexFile?.id);

    const EXPIRE_LIMIT_MS = 30 * 24 * 60 * 60 * 1000;
    const nowTime = Date.now();
    for (const log of mergedLogsMap.values()) {
      if (log.isDeleted && log.deletedAt) {
        const deletedTime = new Date(log.deletedAt).getTime();
        if (nowTime - deletedTime > EXPIRE_LIMIT_MS) {
          console.log(`[GoogleDriveSync] Expired logic delete: Permanently deleting ${log.id}...`);
          await permanentlyDeleteLog(log.id);
          if (Array.isArray(log.imageIds)) {
            for (const imgId of log.imageIds) {
              const cloudImg = cloudImageFilesMap.get(Number(imgId));
              if (cloudImg) await deleteCloudFile(cloudImg.id);
            }
          }
        }
      }
    }

    const timeStr = new Date().toLocaleTimeString();
    localStorage.setItem('sella_last_synced_time', timeStr);
    state.lastSyncedTime = timeStr;

    console.log('[GoogleDriveSync] Sync session completed successfully.');
    if (!silent) alert('Googleアカウント上のデータと正常に同期されました！');

    document.dispatchEvent(new CustomEvent('sync-completed'));

  } catch (err) {
    console.error('[GoogleDriveSync] Critical error during synchronization:', err);
    if (err.message === 'OFFLINE_NETWORK_ERROR') {
      if (!silent) {
        alert('現在オフラインです。ネットワーク接続が復旧した際に再度自動同期されます。');
      }
    } else if (err.message !== 'AUTH_EXPIRED') {
      if (!silent) {
        alert(`データの同期中にエラーが発生しました。\n詳細エラー: ${err.message}`);
      }
    }
  } finally {
    state.isSyncing = false;
    document.dispatchEvent(new CustomEvent('sync-state-change', { detail: { syncing: false } }));
  }
}

export async function destroyAllSellaData() {
  const token = state.googleAccessToken || localStorage.getItem('sella_google_token');

  indexedDB.deleteDatabase('SellaDB');

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

  localStorage.clear();

  alert('すべての酒ログデータ、画像、およびクラウドバックアップを完全に消去しました。システムを初期状態から再起動します。');
  window.location.reload();
}
