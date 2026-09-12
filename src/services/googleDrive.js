// src/services/googleDrive.js
import { state } from '../store/state.js';
import { openDB, getAllLogs, saveLog, permanentlyDeleteLog } from '../store/db.js';

const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/details?name=drive&version=v3';
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.profile';
const DRIVE_REQUEST_TIMEOUT_MS = 60 * 1000;
const IMAGE_SYNC_CONCURRENCY = 4;

export const GOOGLE_CLIENT_ID = '649730178066-ahldbjk9r9sn434u5hsgc9uhj96sllkv.apps.googleusercontent.com';

let tokenClient = null;
let silentRefreshPromise = null;
let resolveSilentRefresh = null;
let rejectSilentRefresh = null;
let silentRefreshTimeoutId = null;
let syncQueued = false;
let syncPromise = null;

const CRYPTO_SALT = new TextEncoder().encode('SellaSakeLogCryptoSalt_9982');

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
    false,
    ['encrypt', 'decrypt']
  );
}

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

const EXCLUDED_LOCAL_KEYS = [
  'sella_font_scale',
  'sella_auto_fullscreen',
  'sella_image_compress_quality',
  'sella_google_token',
  'sella_google_token_acquired_at',
  'sella_google_token_expires_at',
  'sella_google_logged_in',
  'sella_google_user_name',
  'sella_google_user_avatar',
  'sella_google_user_sub',
  'sella_google_sub',
  'sella_theme',
  'sella_settings_updated_at',
  'sella_last_synced_time',
  'sella_last_synced_at',
  'sella_last_sync_theme',
  'sella_last_sync_apikey',
  'sella_last_sync_model',
  'sella_last_sync_bgimage',
  'sella_last_sync_custom',
  'sella_last_sync_google_sub',
  'gemini_api_key',
  'gemini_selected_model'
];

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

function deserializeCustomSettings(customObj) {
  if (!customObj) return;
  Object.keys(customObj).forEach(key => {
    if (!EXCLUDED_LOCAL_KEYS.includes(key)) {
      localStorage.setItem(key, customObj[key]);
    }
  });
}

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
        if (rejectSilentRefresh) {
          const reject = rejectSilentRefresh;
          clearTimeout(silentRefreshTimeoutId);
          silentRefreshTimeoutId = null;
          silentRefreshPromise = null;
          resolveSilentRefresh = null;
          rejectSilentRefresh = null;
          reject(response);
          return;
        }
        throw response;
      }
      state.googleAccessToken = response.access_token;
      localStorage.setItem('sella_google_token', response.access_token);
      localStorage.setItem('sella_google_token_acquired_at', Date.now().toString());
      const expiresInSeconds = Number(response.expires_in) || 3600;
      localStorage.setItem('sella_google_token_expires_at', String(Date.now() + Math.max(60, expiresInSeconds - 60) * 1000));
      state.googleAuthNeedsReauth = false;

      try {
        const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { 'Authorization': `Bearer ${response.access_token}` }
        });
        if (profileRes.ok) {
          const userInfo = await profileRes.json();
          const previousGoogleUserSub = localStorage.getItem('sella_google_user_sub') || localStorage.getItem('sella_google_sub') || localStorage.getItem('sella_last_sync_google_sub');
          const isDifferentGoogleAccount = previousGoogleUserSub && userInfo.sub && previousGoogleUserSub !== userInfo.sub;
          if (isDifferentGoogleAccount) {
            localStorage.removeItem('gemini_api_key');
            localStorage.removeItem('sella_settings_updated_at');
            localStorage.removeItem('sella_last_sync_theme');
            localStorage.removeItem('sella_last_sync_apikey');
            localStorage.removeItem('sella_last_sync_model');
            localStorage.removeItem('sella_last_sync_bgimage');
            localStorage.removeItem('sella_last_sync_custom');
            localStorage.removeItem('sella_last_sync_google_sub');
            localStorage.removeItem('sella_last_synced_at');
            console.log('[GoogleDrive] Google account changed. Cloud settings will be restored for the new account.');
          }
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

      if (resolveSilentRefresh) {
        const resolve = resolveSilentRefresh;
        clearTimeout(silentRefreshTimeoutId);
        silentRefreshTimeoutId = null;
        silentRefreshPromise = null;
        resolveSilentRefresh = null;
        rejectSilentRefresh = null;
        resolve();
        return;
      }

      await syncAllData(true);
    },
  });
}

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
  localStorage.removeItem('sella_google_token_expires_at');
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
  localStorage.removeItem('sella_last_synced_at');

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

export function isTokenExpired() {
  const expiresAt = Number(localStorage.getItem('sella_google_token_expires_at'));
  if (Number.isFinite(expiresAt) && expiresAt > 0) {
    return Date.now() >= expiresAt;
  }

  const acquiredAt = localStorage.getItem('sella_google_token_acquired_at');
  if (!acquiredAt) return true;
  
  const oneHourMs = 55 * 60 * 1000;
  const timePassed = Date.now() - parseInt(acquiredAt, 10);
  return timePassed >= oneHourMs;
}

function refreshTokenSilently() {
  if (!tokenClient) return Promise.reject(new Error('AUTH_CLIENT_UNAVAILABLE'));
  if (silentRefreshPromise) return silentRefreshPromise;

  silentRefreshPromise = new Promise((resolve, reject) => {
    resolveSilentRefresh = resolve;
    rejectSilentRefresh = reject;
    silentRefreshTimeoutId = setTimeout(() => {
      silentRefreshPromise = null;
      resolveSilentRefresh = null;
      rejectSilentRefresh = null;
      silentRefreshTimeoutId = null;
      reject(new Error('AUTH_REFRESH_TIMEOUT'));
    }, 15 * 1000);
    try {
      tokenClient.requestAccessToken({ prompt: 'none' });
    } catch (err) {
      clearTimeout(silentRefreshTimeoutId);
      silentRefreshTimeoutId = null;
      silentRefreshPromise = null;
      resolveSilentRefresh = null;
      rejectSilentRefresh = null;
      reject(err);
    }
  });

  return silentRefreshPromise;
}

function handleTokenExpired() {
  state.isGoogleLoggedIn = false;
  state.googleAuthNeedsReauth = true;
  state.googleAccessToken = null;
  localStorage.removeItem('sella_google_token');
  localStorage.removeItem('sella_google_token_acquired_at');
  localStorage.removeItem('sella_google_token_expires_at');
  localStorage.removeItem('sella_google_logged_in');
  
  state.isSyncing = false;
  document.dispatchEvent(new CustomEvent('google-logout-success'));
  document.dispatchEvent(new CustomEvent('sync-state-change', { detail: { syncing: false } }));

  alert('Google同期の認証が期限切れになりました。ローカルデータは保持されています。同期を再開するには、設定画面からGoogleに再接続してください。');
}

async function driveFetch(url, options = {}, allowTokenRefresh = true) {
  const token = state.googleAccessToken || localStorage.getItem('sella_google_token');
  if (!token) {
    throw new Error('Not authenticated with Google');
  }

  if (isTokenExpired()) {
    console.warn('[GoogleDrive] Token detected as expired before fetch request.');
    if (allowTokenRefresh) {
      try {
        await refreshTokenSilently();
        return driveFetch(url, options, false);
      } catch (err) {
        handleTokenExpired();
        throw new Error('AUTH_EXPIRED');
      }
    }
    handleTokenExpired();
    throw new Error('AUTH_EXPIRED');
  }

  options.headers = { ...options.headers, 'Authorization': `Bearer ${token}` };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DRIVE_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (response.status === 401) {
      console.error('[GoogleDrive] Unauthorized (401). Invalid token session.');
      if (allowTokenRefresh) {
        try {
          await refreshTokenSilently();
          return driveFetch(url, options, false);
        } catch (err) {
          handleTokenExpired();
          throw new Error('AUTH_EXPIRED');
        }
      }
      handleTokenExpired();
      throw new Error('AUTH_EXPIRED');
    }
    
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.warn('[GoogleDrive] Request timed out.');
      throw new Error('NETWORK_TIMEOUT');
    }
    if (err instanceof TypeError || err.message?.includes('fetch')) {
      console.warn('[GoogleDrive] Network error detected. App is likely offline. Login state is preserved.');
      throw new Error('OFFLINE_NETWORK_ERROR');
    }
    throw err;
  }
}

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

async function downloadJsonFile(fileId) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const res = await driveFetch(url);
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Failed to download JSON file (HTTP ${res.status}): ${errText}`);
  }
  return await res.json();
}

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

async function deleteCloudFile(fileId) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}`;
  const res = await driveFetch(url, { method: 'DELETE' });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Failed to delete cloud file ${fileId} (HTTP ${res.status}): ${errText}`);
  }
}

async function runWithConcurrency(items, worker, concurrency = IMAGE_SYNC_CONCURRENCY) {
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex++];
      await worker(item);
    }
  }));
}

function stripEmbeddedImageData(log) {
  const sanitizedLog = { ...log };
  for (const key of ['poolItemsMeta', 'groupItemsMeta']) {
    if (Array.isArray(sanitizedLog[key])) {
      sanitizedLog[key] = sanitizedLog[key].map(item => {
        const sanitizedItem = { ...item };
        delete sanitizedItem.base64;
        return sanitizedItem;
      });
    }
  }
  return sanitizedLog;
}

export async function syncAllData(silent = false) {
  const token = state.googleAccessToken || localStorage.getItem('sella_google_token');
  if (!token) return;

  if (state.isSyncing) {
    syncQueued = true;
    return syncPromise;
  }
  state.isSyncing = true;
  syncPromise = (async () => {
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

    const hasSyncCache = lastSavedTheme !== null || lastSavedApiKey !== null;
    const isCustomChanged = lastSavedCustomStr !== null && JSON.stringify(currentCustom) !== lastSavedCustomStr;

    // 🌟 キャッシュが存在し、かつ実際にローカルで値が変更された場合のみ更新日時を動かす
    const isRealUserSettingChange = hasSyncCache && (
      currentTheme !== lastSavedTheme || 
      currentApiKey !== lastSavedApiKey || 
      currentModel !== lastSavedModel ||
      currentBgImage !== lastSavedBgImage ||
      isCustomChanged
    );

    if (isRealUserSettingChange) {
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

        const isLocalUninitialized = !localSettingsUpdatedAt || !hasSyncCache;
        const isKeyMissingInLocal = !currentApiKey && cloudSettings.encryptedApiKey;

        // 🌟 クラウド優先復元条件: クラウドが新しい、またはローカル未初期化、またはローカルキー欠損
        if (cloudTime > localTime || isLocalUninitialized || isKeyMissingInLocal) {
          console.log('[GoogleDriveSync] Cloud settings are newer or local is uninitialized. Restoring cloud settings to local...');
          
          if (cloudSettings.theme) {
            localStorage.setItem('sella_theme', cloudSettings.theme);
            document.documentElement.setAttribute('data-theme', cloudSettings.theme);
            const themeSelect = document.getElementById('theme-select');
            if (themeSelect) themeSelect.value = cloudSettings.theme;
          }
          if (cloudSettings.selectedModel) {
            localStorage.setItem('gemini_selected_model', cloudSettings.selectedModel);
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
            } else {
              localStorage.removeItem('gemini_api_key');
            }
          } else {
            localStorage.removeItem('gemini_api_key');
          }

          localStorage.setItem('sella_last_sync_theme', cloudSettings.theme || 'dark');
          localStorage.setItem('sella_last_sync_apikey', decryptedKey);
          localStorage.setItem('sella_last_sync_model', cloudSettings.selectedModel || 'models/gemini-2.5-flash');
          localStorage.setItem('sella_last_sync_bgimage', cloudSettings.backgroundImage || '');
          localStorage.setItem('sella_last_sync_custom', JSON.stringify(cloudSettings.customSettings || {}));

        } else if (localTime > cloudTime || (localSettingsUpdatedAt && !cloudSettings)) {
          shouldUploadConfig = true;
        }
      } else {
        shouldUploadConfig = true;
      }

      localStorage.setItem('sella_last_sync_google_sub', googleUserId);

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

    const cloudImageFilesMap = new Map();
    cloudImageFiles.forEach(f => {
      const match = f.name.match(/^sella_img_(\d+)\.bin$/);
      if (match) {
        cloudImageFilesMap.set(Number(match[1]), f);
      }
    });

    const isCloudReady = (log) => !Array.isArray(log?.imageIds)
      || log.imageIds.every(imgId => cloudImageFilesMap.has(Number(imgId)));
    const completeCloudLogs = (cloudIndex.logs || []).filter(isCloudReady);
    const mergedLogsMap = new Map();
    const localLogsMap = new Map(localLogs.map(l => [l.id, l]));
    const cloudLogsMap = new Map(completeCloudLogs.map(l => [l.id, l]));

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
        logStore.put(log);
      }
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Failed to apply cloud logs to local DB'));
        tx.onabort = () => reject(tx.error || new Error('Cloud log transaction was aborted'));
      });
    }

    console.log('[GoogleDriveSync] Auditing and syncing image binaries...');
    const requiredImageIds = new Set();

    // 1. 保存済み・ドラフトログ内の全画像IDを追加
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

    const uploadTargets = [];
    for (const imgId of requiredImageIds) {
      if (localImageIdsSet.has(imgId) && !cloudImageFilesMap.has(imgId)) {
        uploadTargets.push(imgId);
      }
    }

    if (uploadTargets.length > 0) {
      console.log(`[GoogleDriveSync] Uploading ${uploadTargets.length} images...`);
      await runWithConcurrency(uploadTargets, async (imgId) => {
        const blobRecord = await new Promise((res) => {
          const tx = db.transaction(['images'], 'readonly');
          const req = tx.objectStore('images').get(imgId);
          req.onsuccess = () => res(req.result);
          req.onerror = () => res(null);
        });
        if (blobRecord && blobRecord.blob) {
          const uploadedFile = await uploadImageFile(imgId, blobRecord.blob);
          cloudImageFilesMap.set(imgId, uploadedFile);
        }
      });
    }

    const downloadTargets = [];
    for (const imgId of requiredImageIds) {
      if (!localImageIdsSet.has(imgId) && cloudImageFilesMap.has(imgId)) {
        downloadTargets.push(imgId);
      }
    }

    if (downloadTargets.length > 0) {
      console.log(`[GoogleDriveSync] Downloading ${downloadTargets.length} images...`);
      await runWithConcurrency(downloadTargets, async (imgId) => {
        const cloudFile = cloudImageFilesMap.get(imgId);
        await downloadImageFile(cloudFile.id, imgId);
      });
    }

    const publishableLogs = [];
    for (const [id, log] of mergedLogsMap) {
      if (isCloudReady(log)) {
        publishableLogs.push(log);
        continue;
      }

      const previousCloudLog = cloudLogsMap.get(id);
      if (previousCloudLog && isCloudReady(previousCloudLog)) {
        publishableLogs.push(previousCloudLog);
      }
    }

    const updatedIndex = {
      logs: publishableLogs.map(stripEmbeddedImageData),
      lastSynced: new Date().toISOString()
    };
    await uploadJsonFile('sella_index.json', updatedIndex, indexFile?.id);

    const draftLogsToMigrate = Array.from(mergedLogsMap.values())
      .filter(log => log.status === 'draft')
      .map(stripEmbeddedImageData);
    if (draftLogsToMigrate.length > 0) {
      const migrationTx = db.transaction(['logs'], 'readwrite');
      const migrationStore = migrationTx.objectStore('logs');
      draftLogsToMigrate.forEach(log => migrationStore.put(log));
      await new Promise((resolve, reject) => {
        migrationTx.oncomplete = resolve;
        migrationTx.onerror = () => reject(migrationTx.error || new Error('Failed to migrate draft image metadata'));
        migrationTx.onabort = () => reject(migrationTx.error || new Error('Draft metadata migration was aborted'));
      });
    }

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

    const syncedAt = new Date().toISOString();
    const timeStr = new Date(syncedAt).toLocaleTimeString();
    localStorage.setItem('sella_last_synced_time', timeStr);
    localStorage.setItem('sella_last_synced_at', syncedAt);
    state.lastSyncedTime = timeStr;
    state.lastSyncedAt = syncedAt;

    console.log('[GoogleDriveSync] Sync session completed successfully.');
    if (!silent) alert('Googleアカウント上のデータと正常に同期されました！');

    document.dispatchEvent(new CustomEvent('sync-completed'));

  } catch (err) {
    console.error('[GoogleDriveSync] Critical error during synchronization:', err);
    if (err.message === 'OFFLINE_NETWORK_ERROR') {
      if (!silent) {
        alert('現在オフラインです。ネットワーク接続が復旧した際に再度自動同期されます。');
      }
    } else if (err.message === 'NETWORK_TIMEOUT') {
      if (!silent) {
        alert('Google Driveからの応答がタイムアウトしました。ネットワーク接続を確認して再度お試しください。');
      }
    } else if (err.message !== 'AUTH_EXPIRED') {
      if (!silent) {
        alert(`データの同期中にエラーが発生しました。\n詳細エラー: ${err.message}`);
      }
    }
  } finally {
    state.isSyncing = false;
    document.dispatchEvent(new CustomEvent('sync-state-change', { detail: { syncing: false } }));
    if (syncQueued) {
      syncQueued = false;
      syncPromise = null;
      setTimeout(() => { syncAllData(true); }, 0);
    } else {
      syncPromise = null;
    }
  }
  })();
  return syncPromise;
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
