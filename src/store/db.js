// src/store/db.js

const DB_NAME = 'SellaDB';
const DB_VERSION = 1;

export function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('logs')) {
        const logStore = db.createObjectStore('logs', { keyPath: 'id' });
        logStore.createIndex('date', 'date', { unique: false });
      }
      if (!db.objectStoreNames.contains('images')) {
        db.createObjectStore('images', { keyPath: 'id', autoIncrement: true });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
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
      if (imgRecord && imgRecord.blob) {
        images.push(imgRecord.blob);
      }
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
    imageBlobs.map(blob => new Promise((res, rej) => {
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
    updatedAt: new Date().toISOString()
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
    const imageUrls = [];
    if (Array.isArray(log.imageIds) && log.imageIds.length > 0) {
      for (const imgId of log.imageIds) {
        const imgRecord = await new Promise((res) => {
          const req = imgStore.get(imgId);
          req.onsuccess = () => res(req.result);
          req.onerror = () => res(null);
        });
        if (imgRecord && imgRecord.blob) {
          imageUrls.push(URL.createObjectURL(imgRecord.blob));
        }
      }
    }
    return { ...log, imageUrls };
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
