const DB_NAME = 'SellaDB';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('logs')) {
        const logStore = db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
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

// IDから特定のログと画像データ(Blob)を取得する関数を追加
export async function getLogById(id) {
  const db = await openDB();
  const tx = db.transaction(['logs', 'images'], 'readonly');
  const logStore = tx.objectStore('logs');
  const imgStore = tx.objectStore('images');

  const log = await new Promise((res) => {
    const req = logStore.get(Number(id));
    req.onsuccess = () => res(req.result);
    req.onerror = () => res(null);
  });

  if (!log) return null;

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

// 新規作成と更新(put)の両方に対応する saveLog
export async function saveLog(logData, imageBlobs = []) {
  const db = await openDB();
  const tx = db.transaction(['logs', 'images'], 'readwrite');
  const logStore = tx.objectStore('logs');
  const imgStore = tx.objectStore('images');

  const isUpdate = Boolean(logData.id);
  const targetId = isUpdate ? Number(logData.id) : null;

  // 更新の場合は既存の画像レコードを一旦削除
  if (isUpdate) {
    const existingLog = await new Promise((res) => {
      const req = logStore.get(targetId);
      req.onsuccess = () => res(req.result);
      req.onerror = () => res(null);
    });
    if (existingLog && Array.isArray(existingLog.imageIds)) {
      existingLog.imageIds.forEach(imgId => imgStore.delete(imgId));
    }
  }

  // 新しい画像をすべてIndexedDBへ保存
  const imageIds = await Promise.all(
    imageBlobs.map(blob => new Promise((res, rej) => {
      const req = imgStore.add({ blob, createdAt: new Date() });
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    }))
  );

  const fullLog = {
    ...logData,
    imageIds,
    updatedAt: new Date()
  };

  if (isUpdate) {
    fullLog.id = targetId;
  } else {
    fullLog.createdAt = new Date();
  }

  return new Promise((res, rej) => {
    // 新規登録なら add、既存更新なら put を使う
    const req = isUpdate ? logStore.put(fullLog) : logStore.add(fullLog);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export async function getAllLogs() {
  const db = await openDB();
  const tx = db.transaction(['logs', 'images'], 'readonly');
  const logStore = tx.objectStore('logs');
  const imgStore = tx.objectStore('images');

  const logs = await new Promise((res) => {
    const req = logStore.getAll();
    req.onsuccess = () => res(req.result);
  });

  const logsWithImages = await Promise.all(logs.map(async (log) => {
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

  return logsWithImages.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

export async function getAllTags() {
  const logs = await getAllLogs();
  const tagSet = new Set();
  logs.forEach(log => {
    if (Array.isArray(log.tags)) log.tags.forEach(t => tagSet.add(t));
  });
  return Array.from(tagSet);
}

export async function deleteLog(id) {
  const db = await openDB();
  const tx = db.transaction(['logs', 'images'], 'readwrite');
  const logStore = tx.objectStore('logs');
  const imgStore = tx.objectStore('images');

  const log = await new Promise((res) => {
    const req = logStore.get(Number(id));
    req.onsuccess = () => res(req.result);
  });

  if (log && Array.isArray(log.imageIds)) {
    log.imageIds.forEach(imgId => imgStore.delete(imgId));
  }

  return new Promise((res) => {
    const req = logStore.delete(Number(id));
    req.onsuccess = () => res();
  });
}