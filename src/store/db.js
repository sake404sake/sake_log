// src/store/db.js

const DB_NAME = 'SellaDB';
const DB_VERSION = 2;

export function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    let wasBlocked = false;

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('logs')) {
        const logStore = db.createObjectStore('logs', { keyPath: 'id' });
        logStore.createIndex('date', 'date', { unique: false });
      }
      if (!db.objectStoreNames.contains('images')) {
        db.createObjectStore('images', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('breweryLocations')) {
        db.createObjectStore('breweryLocations', { keyPath: 'key' });
      }
    };

    request.onsuccess = () => {
      if (wasBlocked) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onblocked = () => {
      wasBlocked = true;
      reject(new Error('データベースを更新できません。開いているSakeLogのタブを閉じて再読み込みしてください。'));
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getBreweryMapLogs() {
  const db = await openDB();
  const tx = db.transaction(['logs'], 'readonly');
  return new Promise((resolve, reject) => {
    const request = tx.objectStore('logs').getAll();
    request.onsuccess = () => {
      resolve(request.result
        .filter(log => log && log.status !== 'draft' && !log.isDeleted && log.brewery)
        .map(log => ({
          id: log.id,
          name: log.name || '',
          brewery: log.brewery,
          region: log.region || '',
          date: log.date || ''
        })));
    };
    request.onerror = () => reject(request.error || new Error('酒造マップ用のログを読み込めませんでした。'));
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('酒造マップ用のログを読み込めませんでした。'));
    };
  });
}

export async function getBreweryLocations() {
  const db = await openDB();
  const tx = db.transaction(['breweryLocations'], 'readonly');
  return new Promise((resolve, reject) => {
    const request = tx.objectStore('breweryLocations').getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error('酒造の位置情報を読み込めませんでした。'));
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('酒造の位置情報を読み込めませんでした。'));
    };
  });
}

export async function saveBreweryLocation(location) {
  const db = await openDB();
  const tx = db.transaction(['breweryLocations'], 'readwrite');
  tx.objectStore('breweryLocations').put({
    ...location,
    updatedAt: new Date().toISOString()
  });
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('酒造の位置情報を保存できませんでした。'));
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error('酒造の位置情報の保存を中断しました。'));
    };
  });
}

/**
 * ログIDからログ(画像付き)を取得する
 * @param {string|number} id - ログID
 * @param {boolean} includeDeleted - 論理削除されたものも含めるか
 */
export async function getLogById(id, includeDeleted = false) {
  const db = await openDB();
  const tx = db.transaction(['logs', 'images'], 'readonly');
  const logStore = tx.objectStore('logs');
  const imgStore = tx.objectStore('images');

  const log = await new Promise((res) => {
    const req = logStore.get(!isNaN(Number(id)) ? Number(id) : String(id));
    req.onsuccess = () => res(req.result);
    req.onerror = () => res(null);
  });

  if (!log) return null;
  if (!includeDeleted && log.isDeleted) return null;

  const images = [];
  if (Array.isArray(log.imageIds) && log.imageIds.length > 0) {
    for (const imgId of log.imageIds) {
      const imgRecord = await new Promise((res) => {
        const req = imgStore.get(imgId);
        req.onsuccess = () => res(req.result);
        req.onerror = () => res(null);
      });
      images.push(imgRecord?.blob || null);
    }
  }
  return { ...log, images };
}

/**
 * 酒ログを新規追加または更新する
 */
export async function saveLog(logData, imageBlobs = []) {
  const db = await openDB();
  const tx = db.transaction(['logs', 'images'], 'readwrite');
  const logStore = tx.objectStore('logs');
  const imgStore = tx.objectStore('images');
  const validImageBlobs = imageBlobs.filter(blob => blob instanceof Blob && blob.size > 0);

  // IDの自動決定・数値文字列対応
  const isUpdate = Boolean(logData.id);
  let targetId = logData.id;

  if (isUpdate) {
    // 数値型に変換可能なら変換
    if (!isNaN(Number(targetId)) && typeof targetId !== 'string') {
      targetId = Number(targetId);
    }
    
    // 既存画像の削除 (上書きリフレッシュ)
    const existingLog = await new Promise((res) => {
      const req = logStore.get(targetId);
      req.onsuccess = () => res(req.result);
      req.onerror = () => res(null);
    });
    if (existingLog && Array.isArray(existingLog.imageIds)) {
      existingLog.imageIds.forEach(imgId => imgStore.delete(imgId));
    }
  } else {
    // 新規登録時は文字列のミリ秒タイムスタンプ＋乱数をユニークキーとして採用 (同期競合を防ぐ)
    targetId = 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  // 画像Blobを格納
  const imageIds = await Promise.all(
    validImageBlobs.map(blob => new Promise((res, rej) => {
      const req = imgStore.add({ blob, createdAt: new Date().toISOString() });
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    }))
  );

  const fullLog = {
    ...logData,
    id: targetId,
    imageIds,
    status: logData.status || 'active',
    isDeleted: logData.isDeleted || false,
    updatedAt: logData.updatedAt || new Date().toISOString()
  };

  if (!isUpdate) {
    fullLog.createdAt = new Date().toISOString();
  } else {
    fullLog.createdAt = logData.createdAt || new Date().toISOString();
  }

  return new Promise((res, rej) => {
    const req = logStore.put(fullLog);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

/**
 * Persist the complete batch-draft snapshot, reusing image records for unchanged drafts.
 */
export async function saveDraftLogs(entries) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['logs', 'images'], 'readwrite');
    const logStore = tx.objectStore('logs');
    const imageStore = tx.objectStore('images');
    const request = logStore.getAll();
    let changed = false;

    request.onerror = () => reject(request.error || new Error('下書きの読み込みに失敗しました。'));
    request.onsuccess = () => {
      try {
        const existingDrafts = request.result.filter(log => log.status === 'draft');
        const existingById = new Map(existingDrafts.map(log => [log.id, log]));
        const retainedIds = new Set();

        for (const entry of entries) {
          const { logData, imageBlobs, signature } = entry;
          const blobs = imageBlobs.filter(blob => blob instanceof Blob && blob.size > 0);
          if (blobs.length === 0) continue;

          const id = logData.id;
          retainedIds.add(id);
          const existing = existingById.get(id);
          if (existing?.draftSignature === signature &&
              Array.isArray(existing.imageIds) &&
              existing.imageIds.length === blobs.length) {
            continue;
          }

          if (existing && Array.isArray(existing.imageIds)) {
            existing.imageIds.forEach(imageId => imageStore.delete(imageId));
          }
          const collectedImageIds = new Array(blobs.length);
          let completedImages = 0;
          blobs.forEach((blob, index) => {
            const imageRequest = imageStore.add({ blob, createdAt: new Date().toISOString() });
            imageRequest.onsuccess = () => {
              collectedImageIds[index] = imageRequest.result;
              completedImages += 1;
              if (completedImages === blobs.length) {
                logStore.put({
                  ...logData,
                  id,
                  imageIds: collectedImageIds,
                  status: 'draft',
                  isDeleted: false,
                  draftSignature: signature,
                  updatedAt: new Date().toISOString()
                });
              }
            };
          });
          changed = true;
        }

        for (const draft of existingDrafts) {
          if (retainedIds.has(draft.id)) continue;
          if (Array.isArray(draft.imageIds)) {
            draft.imageIds.forEach(imageId => imageStore.delete(imageId));
          }
          logStore.delete(draft.id);
          changed = true;
        }
      } catch (error) {
        reject(error);
        tx.abort();
      }
    };

    tx.oncomplete = () => {
      db.close();
      resolve(changed);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('下書きを保存できませんでした。'));
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error('下書きの保存を中断しました。'));
    };
  });
}

/**
 * 全てのログ(画像URL付き)を取得する
 */
export async function getAllLogs(includeDrafts = false, includeDeleted = false) {
  const db = await openDB();
  const tx = db.transaction(['logs', 'images'], 'readonly');
  const logStore = tx.objectStore('logs');
  const imgStore = tx.objectStore('images');

  const logs = await new Promise((res) => {
    const req = logStore.getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = () => res([]);
  });

  const filteredLogs = logs.filter(log => {
    if (!includeDrafts && log.status === 'draft') return false;
    if (!includeDeleted && log.isDeleted) return false;
    return true;
  });

  const logsWithImages = await Promise.all(filteredLogs.map(async (log) => {
    const imageRecords = await Promise.all((Array.isArray(log.imageIds) ? log.imageIds : []).map(imgId =>
      new Promise((res) => {
        const req = imgStore.get(imgId);
        req.onsuccess = () => res(req.result);
        req.onerror = () => res(null);
      })
    ));
    const images = imageRecords.map(record => record?.blob || null);
    const imageUrls = images.map(blob =>
      blob && log.status !== 'draft' ? URL.createObjectURL(blob) : ''
    );
    return { ...log, images, imageUrls };
  }));

  // 日付順にソートして返却
  return logsWithImages.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

export async function getAllLogDates() {
  const db = await openDB();
  const tx = db.transaction(['logs'], 'readonly');
  const logStore = tx.objectStore('logs');
  return new Promise((resolve) => {
    const req = logStore.getAll();
    req.onsuccess = () => {
      const logs = Array.isArray(req.result) ? req.result : [];
      resolve(logs
      .filter(log => log && log.status !== 'draft' && !log.isDeleted)
      .map(log => log.date)
      .filter(Boolean));
    };
    req.onerror = () => resolve([]);
  });
}

/**
 * 下書き(未分類プール、未保存グループ)のログのみを全取得
 */
export async function getDraftLogs() {
  return getAllLogs(true, false).then(logs => logs.filter(log => log.status === 'draft'));
}

/**
 * 過去に登録された全てのタグを取得する
 */
export async function getAllTags() {
  const logs = await getAllLogs(false, false);
  const tagSet = new Set();
  logs.forEach(log => {
    if (Array.isArray(log.tags)) log.tags.forEach(t => tagSet.add(t));
  });
  return Array.from(tagSet);
}

/**
 * 酒ログを論理削除(ゴミ箱行き)にする
 */
export async function deleteLog(id) {
  const db = await openDB();
  const tx = db.transaction(['logs'], 'readwrite');
  const logStore = tx.objectStore('logs');

  const log = await new Promise((res) => {
    const req = logStore.get(!isNaN(Number(id)) ? Number(id) : String(id));
    req.onsuccess = () => res(req.result);
    req.onerror = () => res(null);
  });

  if (log) {
    log.isDeleted = true;
    log.deletedAt = new Date().toISOString();
    log.updatedAt = new Date().toISOString();
    return new Promise((res) => {
      const req = logStore.put(log);
      req.onsuccess = () => res();
    });
  }
}

/**
 * 酒ログおよび紐づく画像を完全に「物理削除」する (完全消去用)
 */
export async function permanentlyDeleteLog(id) {
  const db = await openDB();
  const tx = db.transaction(['logs', 'images'], 'readwrite');
  const logStore = tx.objectStore('logs');
  const imgStore = tx.objectStore('images');

  const log = await new Promise((res) => {
    const req = logStore.get(!isNaN(Number(id)) ? Number(id) : String(id));
    req.onsuccess = () => res(req.result);
    req.onerror = () => res(null);
  });

  if (log && Array.isArray(log.imageIds)) {
    log.imageIds.forEach(imgId => imgStore.delete(imgId));
  }

  return new Promise((res) => {
    const req = logStore.delete(!isNaN(Number(id)) ? Number(id) : String(id));
    req.onsuccess = () => res();
  });
}

/**
 * 一括インポートの下書き・プールデータをIndexedDBからすべて物理削除してクリアする
 */
export async function clearAllDrafts() {
  const db = await openDB();
  const tx = db.transaction(['logs', 'images'], 'readwrite');
  const logStore = tx.objectStore('logs');
  const imgStore = tx.objectStore('images');

  const logs = await new Promise((res) => {
    const req = logStore.getAll();
    req.onsuccess = () => res(req.result);
  });

  const drafts = logs.filter(log => log.status === 'draft');
  for (const draft of drafts) {
    if (Array.isArray(draft.imageIds)) {
      draft.imageIds.forEach(imgId => imgStore.delete(imgId));
    }
    logStore.delete(draft.id);
  }
}
