// src/services/googleDrive.js
import { state } from '../store/state.js';
import { openDB, getAllLogs, saveLog, permanentlyDeleteLog } from '../store/db.js';

// GISのクライアントスクリプトとDrive APIのURL定義
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/details?name=drive&version=v3';
// 🌟 Google Drive AppDataスコープと、ユーザーの表示名・アバター用のprofileスコープを統合
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.profile';

// ==========================================================================
// 🌟【デベロッパー向け】ここにあなたのGoogle Cloud OAuthクライアントIDを設定・編集してください
// ==========================================================================
export const GOOGLE_CLIENT_ID = '649730178066-ahldbjk9r9sn434u5hsgc9uhj96sllkv.apps.googleusercontent.com';

let tokenClient = null;

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
      await syncAllData(true);
    },
  });
}

/**
 * ログイン画面を呼び出し
 */
export function loginGoogle() {
  const triggerAuth = () => {
    if (!tokenClient) {
      alert('Google OAuth クライアントIDが正しく設定されていないか、初期化に失敗しました。設定画面をご確認ください。');
      return;
    }
    // ★重要: prompt を 'select_account' に固定し、複数端末・複数アカウントでのハングアップを確実に防ぐ
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
  localStorage.removeItem('sella_google_token');
  localStorage.removeItem('sella_google_token_acquired_at');
  localStorage.removeItem('sella_google_logged_in');
  localStorage.removeItem('sella_google_user_name');
  localStorage.removeItem('sella_google_user_avatar');

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
 * ★新規追加: クライアントサイドでの事前トークン有効期限（1時間）チェック
 */
export function isTokenExpired() {
  const acquiredAt = localStorage.getItem('sella_google_token_acquired_at');
  if (!acquiredAt) return true;
  
  const oneHourMs = 3600 * 1000; // OAuth2トークンの標準的な寿命
  const timePassed = Date.now() - parseInt(acquiredAt, 10);
  return timePassed >= oneHourMs;
}

/**
 * ★改善版: トークン期限切れ（401）が確定した際の後処理
 */
function handleTokenExpired() {
  state.isGoogleLoggedIn = false;
  state.googleAccessToken = null;
  localStorage.removeItem('sella_google_token');
  localStorage.removeItem('sella_google_token_acquired_at');
  localStorage.removeItem('sella_google_logged_in');
  
  // UI描画をログイン前の表示に切り替えるためのイベント
  document.dispatchEvent(new CustomEvent('google-logout-success'));
  
  // 同期中のインジケーターを解除
  state.isSyncing = false;
  document.dispatchEvent(new CustomEvent('sync-state-change', { detail: { syncing: false } }));
  
  alert('Googleアカウントのセッション有効期限が切れました。安全な同期のため、お手数ですが再度ログインを行ってください。');
}

/**
 * Google Drive API 通信ヘルパー (認証ヘッダー付与)
 */
async function driveFetch(url, options = {}) {
  const token = state.googleAccessToken || localStorage.getItem('sella_google_token');
  if (!token) {
    throw new Error('Not authenticated with Google');
  }

  // 1. クライアント側で事前に1時間を超えているか判定
  if (isTokenExpired()) {
    console.warn('[GoogleDrive] Token detected as expired before fetch request.');
    handleTokenExpired();
    throw new Error('AUTH_EXPIRED');
  }

  options.headers = { ...options.headers, 'Authorization': `Bearer ${token}` };

  try {
    const response = await fetch(url, options);
    
    // 2. サーバー側から401（未認可）が返ってきた場合
    if (response.status === 401) {
      console.error('[GoogleDrive] Unauthorized (401). Invalid token session.');
      handleTokenExpired();
      throw new Error('AUTH_EXPIRED');
    }
    
    return response;
  } catch (err) {
    // ★重要: ネットワークエラー（オフライン、タイムアウト等）の場合
    // fetch失敗による例外を検知し、ログインフラグを「破壊しない」ようにスルーさせる
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
  if (!res.ok) throw new Error('Failed to list cloud files');
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

  if (!res.ok) throw new Error(`Failed to upload JSON file ${fileName}`);
  return await res.json();
}

/**
 * クラウドのJSONファイルをダウンロード
 */
async function downloadJsonFile(fileId) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const res = await driveFetch(url);
  if (!res.ok) throw new Error('Failed to download JSON file');
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

  if (!res.ok) throw new Error(`Failed to upload image file ${fileName}`);
  return await res.json();
}

/**
 * クラウドからバイナリ画像ファイルをダウンロードしてIndexedDBに同期
 */
async function downloadImageFile(fileId, imgId) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const res = await driveFetch(url);
  if (!res.ok) throw new Error(`Failed to download image ${imgId}`);
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
  await driveFetch(url, { method: 'DELETE' });
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
    const cloudImageFiles = cloudFiles.filter(f => f.name.startsWith('sella_img_'));

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

    // 4. 双方向タイムスタンプマージの実行
    const mergedLogsMap = new Map();
    const localLogsMap = new Map(localLogs.map(l => [l.id, l]));
    const cloudLogsMap = new Map((cloudIndex.logs || []).map(l => [l.id, l]));

    // 全てのユニークなIDのセット
    const allIds = new Set([...localLogsMap.keys(), ...cloudLogsMap.keys()]);

    let hasLocalChanges = false;
    let hasCloudChanges = false;

    for (const id of allIds) {
      const local = localLogsMap.get(id);
      const cloud = cloudLogsMap.get(id);

      if (local && cloud) {
        // 両方に存在：更新タイムスタンプを比較
        const localTime = new Date(local.updatedAt || 0).getTime();
        const cloudTime = new Date(cloud.updatedAt || 0).getTime();

        if (localTime > cloudTime) {
          mergedLogsMap.set(id, local);
          hasLocalChanges = true; // ローカルが新しいため、クラウドを更新する必要あり
        } else if (cloudTime > localTime) {
          mergedLogsMap.set(id, cloud);
          hasCloudChanges = true; // クラウドが新しいため、ローカルを更新する必要あり
        } else {
          mergedLogsMap.set(id, local); // 同一
        }
      } else if (local) {
        // ローカルにのみ存在：クラウドへアップロード対象
        mergedLogsMap.set(id, local);
        hasLocalChanges = true;
      } else if (cloud) {
        // クラウドにのみ存在：ローカルへ取り込み対象
        mergedLogsMap.set(id, cloud);
        hasCloudChanges = true;
      }
    }

    // 5. マージ結果をローカル IndexedDB に書き戻し
    if (hasCloudChanges) {
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

    // 6. 画像ファイルの完全同期判定
    console.log('[GoogleDriveSync] Auditing and syncing image binaries...');
    const requiredImageIds = new Set();
    for (const log of mergedLogsMap.values()) {
      // 物理削除された画像、および未登録でかつ削除フラグがあるものは画像同期対象外
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

    // A. 【アップロード】ローカルに存在し、クラウドにない画像を転送
    for (const imgId of requiredImageIds) {
      if (localImageIdsSet.has(imgId) && !cloudImageFilesMap.has(imgId)) {
        console.log(`[GoogleDriveSync] Uploading image ${imgId} to cloud...`);
        // Blobの取得
        const blobRecord = await new Promise((res) => {
          const tx = db.transaction(['images'], 'readonly');
          const req = tx.objectStore('images').get(imgId);
          req.onsuccess = () => res(req.result);
          req.onerror = () => res(null);
        });
        if (blobRecord && blobRecord.blob) {
          await uploadImageFile(imgId, blobRecord.blob);
        }
      }
    }

    // B. 【ダウンロード】クラウドに存在し、ローカルにない画像を取り込み
    for (const imgId of requiredImageIds) {
      if (!localImageIdsSet.has(imgId) && cloudImageFilesMap.has(imgId)) {
        console.log(`[GoogleDriveSync] Downloading image ${imgId} from cloud...`);
        const cloudFile = cloudImageFilesMap.get(imgId);
        await downloadImageFile(cloudFile.id, imgId);
      }
    }

    // C. 【クリーンアップ】論理削除等により、どこからも参照されなくなったクラウド上の孤立した画像をガベージコレクト
    for (const [imgId, cloudFile] of cloudImageFilesMap.entries()) {
      if (!requiredImageIds.has(imgId)) {
        console.log(`[GoogleDriveSync] Purging unused cloud image: ${cloudFile.name}`);
        await deleteCloudFile(cloudFile.id);
      }
    }

    // 7. 最新のインデックスファイル sella_index.json をクラウドに書き出し
    const updatedIndex = {
      logs: Array.from(mergedLogsMap.values()),
      lastSynced: new Date().toISOString()
    };
    await uploadJsonFile('sella_index.json', updatedIndex, indexFile?.id);

    // 8. ゴミ箱（論理削除）から30日以上経過したアイテムをローカル・クラウド双方から「物理完全消去」
    const EXPIRE_LIMIT_MS = 30 * 24 * 60 * 60 * 1000; // 30日
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
      // ネットワークオフライン時は静かに無視するか、手動時のみ通知する
      if (!silent) {
        alert('現在オフラインです。ネットワーク接続が復旧した際に再度自動同期されます。');
      }
    } else if (err.message !== 'AUTH_EXPIRED') {
      // セッション切れ（AUTH_EXPIRED）以外の例外の場合のみ警告ダイアログを表示
      if (!silent) {
        alert('データの同期中にエラーが発生しました。インターネット接続やGoogleの権限設定をご確認ください。');
      }
    }
  } finally {
    state.isSyncing = false;
    document.dispatchEvent(new CustomEvent('sync-state-change', { detail: { syncing: false } }));
  }
}

/**
 * Googleアカウントおよびローカル上のすべてのデータを「完全消去・初期化」する (GitHub安全ロック式)
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