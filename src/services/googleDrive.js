// src/services/googleDrive.js
import { state } from '../store/state.js';
import { openDB, getAllLogs, saveLog, permanentlyDeleteLog } from '../store/db.js';

export const GOOGLE_CLIENT_ID = '649730178066-ahldbjk9r9sn434u5hsgc9uhj96sllkv.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.profile';

let tokenClient = null;

async function deriveEncryptionKey(googleUserId) {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(googleUserId),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode('SellaSalt_' + googleUserId),
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
  if (!plainApiKey || !googleUserId) return { cipherText: '', iv: '' };
  try {
    const key = await deriveEncryptionKey(googleUserId);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const cipherBuffer = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      enc.encode(plainApiKey)
    );
    return {
      cipherText: btoa(String.fromCharCode(...new Uint8Array(cipherBuffer))),
      iv: btoa(String.fromCharCode(...iv))
    };
  } catch (err) {
    console.error('API Key Encryption Failed:', err);
    return { cipherText: '', iv: '' };
  }
}

export async function decryptApiKey(cipherTextBase64, ivBase64, googleUserId) {
  if (!cipherTextBase64 || !ivBase64 || !googleUserId) return '';
  try {
    const key = await deriveEncryptionKey(googleUserId);
    const cipherBuffer = Uint8Array.from(atob(cipherTextBase64), c => c.charCodeAt(0));
    const iv = Uint8Array.from(atob(ivBase64), c => c.charCodeAt(0));
    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      cipherBuffer
    );
    return new TextDecoder().decode(decryptedBuffer);
  } catch (err) {
    console.error('API Key Decryption Failed:', err);
    return '';
  }
}

export function loadGoogleSDK() {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = (err) => reject(err);
    document.head.appendChild(script);
  });
}

export function initGoogleAuth(onSuccessCallback, onErrorCallback) {
  if (!window.google || !window.google.accounts) return;

  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: SCOPES,
    callback: async (response) => {
      if (response.error) {
        console.error('Google Auth Error:', response);
        if (onErrorCallback) onErrorCallback(response.error);
        return;
      }
      state.googleAccessToken = response.access_token;
      localStorage.setItem('sella_google_token', response.access_token);
      localStorage.setItem('sella_google_logged_in', 'true');
      localStorage.setItem('sella_google_token_time', Date.now().toString());

      try {
        const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${response.access_token}` }
        });
        if (profileRes.ok) {
          const userInfo = await profileRes.json();
          state.googleUserProfile = userInfo;
          localStorage.setItem('sella_google_user_profile', JSON.stringify(userInfo));
          if (userInfo.sub) {
            state.googleUserSub = userInfo.sub;
            localStorage.setItem('sella_google_user_sub', userInfo.sub);
          }
        }
      } catch (e) {
        console.warn('Google Profile Fetch Warning:', e);
      }

      document.dispatchEvent(new CustomEvent('google-login-success'));
      if (onSuccessCallback) onSuccessCallback(response);
      syncAllData(false);
    }
  });

  const savedToken = localStorage.getItem('sella_google_token');
  const loggedIn = localStorage.getItem('sella_google_logged_in') === 'true';
  if (savedToken && loggedIn) {
    state.googleAccessToken = savedToken;
    state.googleUserSub = localStorage.getItem('sella_google_user_sub') || '';
    const profileStr = localStorage.getItem('sella_google_user_profile');
    if (profileStr) {
      try {
        state.googleUserProfile = JSON.parse(profileStr);
      } catch (e) {}
    }
  }
}

export function isTokenExpired() {
  const tokenTime = localStorage.getItem('sella_google_token_time');
  if (!tokenTime) return true;
  const elapsedSeconds = (Date.now() - parseInt(tokenTime, 10)) / 1000;
  return elapsedSeconds >= 3500;
}

export function loginGoogle() {
  if (tokenClient) {
    tokenClient.requestAccessToken({ prompt: 'consent' });
  } else {
    console.error('Google Auth not initialized.');
  }
}

export function logoutGoogle() {
  if (state.googleAccessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(state.googleAccessToken, () => {});
  }
  state.googleAccessToken = null;
  state.googleUserProfile = null;
  state.googleUserSub = '';
  localStorage.removeItem('sella_google_token');
  localStorage.removeItem('sella_google_logged_in');
  localStorage.removeItem('sella_google_token_time');
  localStorage.removeItem('sella_google_user_profile');
  localStorage.removeItem('sella_google_user_sub');

  document.dispatchEvent(new CustomEvent('google-logout-success'));
}

function handleTokenExpired() {
  logoutGoogle();
  alert('Googleアカウントのセッション有効期限が切れました。再度ログインしてください。');
}

async function driveFetch(url, options = {}) {
  const token = state.googleAccessToken || localStorage.getItem('sella_google_token');
  if (!token) {
    throw new Error('Not authenticated with Google');
  }

  if (isTokenExpired()) {
    console.warn('[GoogleDrive] Token detected as expired before fetch request.');
    handleTokenExpired();
    throw new Error('AUTH_EXPIRED');
  }

  options.headers = { ...options.headers, 'Authorization': `Bearer ${token}` };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  options.signal = controller.signal;

  try {
    const response = await fetch(url, options);
    clearTimeout(timeoutId);

    if (response.status === 401) {
      console.error('[GoogleDrive] Unauthorized (401). Invalid token session.');
      handleTokenExpired();
      throw new Error('AUTH_EXPIRED');
    }

    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.warn('[GoogleDrive] Request timed out (15s). Preserving session.');
      throw new Error('TIMEOUT');
    }
    if (err instanceof TypeError || err.message?.includes('fetch')) {
      console.warn('[GoogleDrive] Network error detected. Preserving session.');
      throw new Error('OFFLINE_NETWORK_ERROR');
    }
    throw err;
  }
}

async function listCloudFiles() {
  const query = encodeURIComponent("name starting with 'sella_' and trashed = false");
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${query}&spaces=appDataFolder&fields=files(id,name,modifiedTime)`);
  if (!res.ok) throw new Error(`Failed to list files: ${res.statusText}`);
  const data = await res.json();
  return data.files || [];
}

async function downloadJsonFile(fileId) {
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  if (!res.ok) throw new Error(`Failed to download JSON file: ${res.statusText}`);
  return await res.json();
}

async function uploadJsonFile(filename, jsonData, fileId = null) {
  const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
  const metadata = { name: filename, mimeTypes: 'application/json' };
  if (!fileId) metadata.parents = ['appDataFolder'];

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);

  let url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
  let method = 'POST';
  if (fileId) {
    url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`;
    method = 'PATCH';
  }

  const res = await driveFetch(url, { method, body: form });
  if (!res.ok) throw new Error(`Failed to upload JSON file (${filename}): ${res.statusText}`);
  return await res.json();
}

serializeCustomSettings = function() { return {}; };
deserializeCustomSettings = function() {};

function serializeCustomSettings() {
  return {
    customHeaderTitle: localStorage.getItem('sella_custom_header_title') || '',
    customAccentColor: localStorage.getItem('sella_custom_accent_color') || ''
  };
}

function deserializeCustomSettings(customObj) {
  if (!customObj) return;
  if (customObj.customHeaderTitle !== undefined) {
    localStorage.setItem('sella_custom_header_title', customObj.customHeaderTitle);
  }
  if (customObj.customAccentColor !== undefined) {
    localStorage.setItem('sella_custom_accent_color', customObj.customAccentColor);
  }
}

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

    const lastSavedTheme = localStorage.getItem('sella_last_sync_theme') || '';
    const lastSavedApiKey = localStorage.getItem('sella_last_sync_apikey') || '';
    const lastSavedModel = localStorage.getItem('sella_last_sync_model') || '';
    const lastSavedBgImage = localStorage.getItem('sella_last_sync_bgimage') || '';
    const lastSavedCustomStr = localStorage.getItem('sella_last_sync_custom') || '{}';

    let localSettingsUpdatedAt = localStorage.getItem('sella_settings_updated_at');
    const isCustomChanged = JSON.stringify(currentCustom) !== lastSavedCustomStr;

    let userModifiedSettingsLocally = false;
    if (lastSavedTheme || lastSavedApiKey) {
      if (currentTheme !== lastSavedTheme || 
          currentApiKey !== lastSavedApiKey || 
          currentModel !== lastSavedModel ||
          currentBgImage !== lastSavedBgImage ||
          isCustomChanged) {
        userModifiedSettingsLocally = true;
        localSettingsUpdatedAt = new Date().toISOString();
        localStorage.setItem('sella_settings_updated_at', localSettingsUpdatedAt);
        
        localStorage.setItem('sella_last_sync_theme', currentTheme);
        localStorage.setItem('sella_last_sync_apikey', currentApiKey);
        localStorage.setItem('sella_last_sync_model', currentModel);
        localStorage.setItem('sella_last_sync_bgimage', currentBgImage);
        localStorage.setItem('sella_last_sync_custom', JSON.stringify(currentCustom));
      }
    }

    const cloudFiles = await listCloudFiles();
    const indexFile = cloudFiles.find(f => f.name === 'sella_index.json');
    const configFile = cloudFiles.find(f => f.name === 'sella_config.json');
    const cloudImageFiles = cloudFiles.filter(f => f.name.startsWith('sella_img_'));

    let googleUserId = state.googleUserSub || localStorage.getItem('sella_google_sub') || localStorage.getItem('sella_google_user_sub');

    if (!googleUserId) {
      try {
        const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (profileRes.ok) {
          const userInfo = await profileRes.json();
          if (userInfo.sub) {
            googleUserId = userInfo.sub;
            state.googleUserSub = userInfo.sub;
            localStorage.setItem('sella_google_user_sub', userInfo.sub);
          }
        }
      } catch (e) {
        console.warn('User sub fetch failed during sync:', e);
      }
    }

    if (googleUserId) {
      console.log('[GoogleDriveSync] Initializing settings sync...');

      let cloudSettings = null;
      if (configFile) {
        try {
          cloudSettings = await downloadJsonFile(configFile.id);
        } catch (err) {
          console.error('[GoogleDriveSync] Failed to parse sella_config.json:', err);
        }
      }

      let shouldUploadConfig = false;

      if (cloudSettings) {
        const localTime = new Date(localSettingsUpdatedAt || 0).getTime();
        const cloudTime = new Date(cloudSettings.updatedAt || 0).getTime();

        if (!userModifiedSettingsLocally || cloudTime > localTime || !lastSavedApiKey) {
          console.log('[GoogleDriveSync] Pulling cloud settings...');
          
          localStorage.setItem('sella_theme', cloudSettings.theme || 'dark');
          localStorage.setItem('gemini_selected_model', cloudSettings.selectedModel || 'models/gemini-2.5-flash');
          localStorage.setItem('sella_bg_image', cloudSettings.backgroundImage || '');
          deserializeCustomSettings(cloudSettings.customSettings);
          localStorage.setItem('sella_settings_updated_at', cloudSettings.updatedAt || new Date().toISOString());

          let decryptedKey = '';
          if (cloudSettings.encryptedApiKey && cloudSettings.encryptIv) {
            decryptedKey = await decryptApiKey(cloudSettings.encryptedApiKey, cloudSettings.encryptIv, googleUserId);
            if (decryptedKey) {
              localStorage.setItem('gemini_api_key', decryptedKey);
            }
          }

          localStorage.setItem('sella_last_sync_theme', cloudSettings.theme || 'dark');
          localStorage.setItem('sella_last_sync_apikey', decryptedKey || '');
          localStorage.setItem('sella_last_sync_model', cloudSettings.selectedModel || 'models/gemini-2.5-flash');
          localStorage.setItem('sella_last_sync_bgimage', cloudSettings.backgroundImage || '');
          localStorage.setItem('sella_last_sync_custom', JSON.stringify(cloudSettings.customSettings || {}));

          document.documentElement.setAttribute('data-theme', cloudSettings.theme || 'dark');
          const themeSelect = document.getElementById('theme-select');
          if (themeSelect) themeSelect.value = cloudSettings.theme || 'dark';

          const apiKeyInput = document.getElementById('gemini-api-key');
          if (apiKeyInput && decryptedKey) apiKeyInput.value = decryptedKey;

        } else if (localTime > cloudTime && userModifiedSettingsLocally) {
          shouldUploadConfig = true;
        }
      } else {
        shouldUploadConfig = true;
      }

      if (shouldUploadConfig && (currentApiKey || currentTheme !== 'dark')) {
        console.log('[GoogleDriveSync] Local settings modified. Uploading config...');
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
        console.log('[GoogleDriveSync] Settings encrypted and uploaded.');
      }
    }

    const db = await openDB();
    const localLogs = await getAllLogs();

    let cloudIndex = { logs: [], updatedAt: new Date(0).toISOString() };
    if (indexFile) {
      try {
        cloudIndex = await downloadJsonFile(indexFile.id);
      } catch (err) {
        console.error('[GoogleDriveSync] Index file corrupt, recreating...', err);
      }
    }

    const localLogMap = new Map(localLogs.map(l => [l.id, l]));
    const cloudLogMap = new Map((cloudIndex.logs || []).map(l => [l.id, l]));

    let mergedLogs = [];
    let updatedLocalLogs = [];

    const allLogIds = new Set([...localLogMap.keys(), ...cloudLogMap.keys()]);

    for (const id of allLogIds) {
      const local = localLogMap.get(id);
      const cloud = cloudLogMap.get(id);

      if (local && !cloud) {
        mergedLogs.push(local);
      } else if (!local && cloud) {
        mergedLogs.push(cloud);
        updatedLocalLogs.push(cloud);
      } else if (local && cloud) {
        const localTime = new Date(local.updatedAt || local.createdAt || 0).getTime();
        const cloudTime = new Date(cloud.updatedAt || cloud.createdAt || 0).getTime();

        if (localTime >= cloudTime) {
          mergedLogs.push(local);
        } else {
          mergedLogs.push(cloud);
          updatedLocalLogs.push(cloud);
        }
      }
    }

    for (const logToSave of updatedLocalLogs) {
      await saveLog(logToSave);
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const purgeTime = thirtyDaysAgo.getTime();

    const activeMergedLogs = [];
    for (const log of mergedLogs) {
      if (log.deletedAt) {
        const deletedTime = new Date(log.deletedAt).getTime();
        if (deletedTime < purgeTime) {
          await permanentlyDeleteLog(log.id);
          continue;
        }
      }
      activeMergedLogs.push(log);
    }

    const indexPayload = {
      logs: activeMergedLogs,
      updatedAt: new Date().toISOString()
    };

    await uploadJsonFile('sella_index.json', indexPayload, indexFile?.id);

    localStorage.setItem('sella_last_synced_time', new Date().toLocaleString());
    console.log('[GoogleDriveSync] Sync session completed successfully.');

    document.dispatchEvent(new CustomEvent('sync-completed'));
  } catch (err) {
    console.error('[GoogleDriveSync] Sync Error:', err);
  } finally {
    state.isSyncing = false;
    document.dispatchEvent(new CustomEvent('sync-state-change', { detail: { syncing: false } }));
  }
}

export async function destroyAllSellaData() {
  if (!confirm('【警告】ローカル IndexedDB データおよび Google Drive 上のバックアップ設定・ログを完全に永久削除します。元に戻すことはできません。本当に行着しますか？')) {
    return;
  }

  try {
    const cloudFiles = await listCloudFiles();
    for (const file of cloudFiles) {
      await driveFetch(`https://www.googleapis.com/drive/v3/files/${file.id}`, { method: 'DELETE' });
    }

    const db = await openDB();
    const tx = db.transaction(['logs', 'images'], 'readwrite');
    await tx.objectStore('logs').clear();
    await tx.objectStore('images').clear();

    localStorage.clear();
    alert('すべてのデータを削除しました。');
    window.location.reload();
  } catch (err) {
    console.error('Data destruction failed:', err);
    alert('データ削除中にエラーが発生しました: ' + err.message);
  }
}
