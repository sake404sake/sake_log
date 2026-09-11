// src/utils/image.js

/**
 * Dateオブジェクトまたは日付表現からローカル時間の YYYY-MM-DD 文字列を正確にフォーマットする
 * (.toISOString() による時差ズレを完全回避)
 */
export function formatDateToLocalYYYYMMDD(date) {
  if (!date) return '';
  const d = (date instanceof Date) ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 画像ファイルから撮影日時 (EXIF / ファイル名 / lastModified) を高精度に抽出する関数
 */
export function extractPhotoDate(file) {
  return new Promise((resolve) => {
    if (!file) {
      resolve(null);
      return;
    }

    const fallback = () => {
      // 1. ファイル名からの日付パターン判定 (例: IMG_20241103_184512.jpg, 2025-01-15_photo.png 等)
      const name = file.name || '';
      const match = name.match(/(20\d{2})[-_\.]?([01]\d)[-_\.]?([0-3]\d)/);
      if (match) {
        const y = match[1];
        const m = match[2];
        const d = match[3];
        if (Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31) {
          resolve(`${y}-${m}-${d}`);
          return;
        }
      }

      // 2. file.lastModified によるフォールバック (ローカル時間フォーマット)
      if (file.lastModified) {
        const photoDate = new Date(file.lastModified);
        if (!isNaN(photoDate.getTime())) {
          resolve(formatDateToLocalYYYYMMDD(photoDate));
          return;
        }
      }

      resolve(null);
    };

    const nameLower = (file.name || '').toLowerCase();
    const isJpegCandidate = (file.type && file.type.startsWith('image/jpeg')) || 
                            nameLower.endsWith('.jpg') || 
                            nameLower.endsWith('.jpeg') ||
                            file.type === '' || 
                            nameLower.endsWith('.heic') || 
                            nameLower.endsWith('.heif');

    if (!isJpegCandidate) {
      fallback();
      return;
    }

    const reader = new FileReader();
    // 🌟 512KB -> 2MB (2097152 bytes) ヘッダー読み込みに拡張
    const slice = file.slice(0, 2097152);
    reader.readAsArrayBuffer(slice);

    reader.onload = (e) => {
      try {
        const buffer = e.target.result;
        const view = new DataView(buffer);
        const length = view.byteLength;
        
        if (length < 12 || view.getUint16(0, false) !== 0xFFD8) {
          fallback();
          return;
        }

        let offset = 2;
        let exifFound = false;
        let tiffOffset = 0;

        while (offset < length - 8) {
          const marker = view.getUint16(offset, false);
          if (offset + 4 > length) break;
          const segmentLength = view.getUint16(offset + 2, false);

          if (marker === 0xFFE1) {
            if (offset + 10 <= length &&
                view.getUint32(offset + 4, false) === 0x45786966 && 
                view.getUint16(offset + 8, false) === 0x0000) {
              exifFound = true;
              tiffOffset = offset + 10;
              break;
            }
          }
          if (segmentLength <= 0) break;
          offset += segmentLength + 2;
        }

        if (!exifFound || tiffOffset + 8 > length) {
          fallback();
          return;
        }

        const byteOrder = view.getUint16(tiffOffset, false);
        const isLittleEndian = (byteOrder === 0x4949);

        if (view.getUint16(tiffOffset + 2, isLittleEndian) !== 0x002A) {
          fallback();
          return;
        }

        const firstIFDOffset = view.getUint32(tiffOffset + 4, isLittleEndian);
        let ifdOffset = tiffOffset + firstIFDOffset;

        if (ifdOffset + 2 > length) { fallback(); return; }
        const entriesCount = view.getUint16(ifdOffset, isLittleEndian);
        let exifSubIFDOffset = 0;
        let ifd0DateOffset = 0;

        for (let i = 0; i < entriesCount; i++) {
          const entryOffset = ifdOffset + 2 + (i * 12);
          if (entryOffset + 12 > length) break;

          const tag = view.getUint16(entryOffset, isLittleEndian);
          if (tag === 0x8769) {
            exifSubIFDOffset = view.getUint32(entryOffset + 8, isLittleEndian);
          } else if (tag === 0x0132) { // IFD0 DateTime
            ifd0DateOffset = view.getUint32(entryOffset + 8, isLittleEndian);
          }
        }

        let targetDateOffset = 0;

        if (exifSubIFDOffset > 0) {
          let subIFDOffset = tiffOffset + exifSubIFDOffset;
          if (subIFDOffset + 2 <= length) {
            const subEntriesCount = view.getUint16(subIFDOffset, isLittleEndian);
            for (let i = 0; i < subEntriesCount; i++) {
              const entryOffset = subIFDOffset + 2 + (i * 12);
              if (entryOffset + 12 > length) break;

              const tag = view.getUint16(entryOffset, isLittleEndian);
              if (tag === 0x9003) { // DateTimeOriginal
                targetDateOffset = view.getUint32(entryOffset + 8, isLittleEndian);
                break;
              } else if (tag === 0x9004 && targetDateOffset === 0) { // DateTimeDigitized
                targetDateOffset = view.getUint32(entryOffset + 8, isLittleEndian);
              }
            }
          }
        }

        if (targetDateOffset === 0 && ifd0DateOffset > 0) {
          targetDateOffset = ifd0DateOffset;
        }

        if (targetDateOffset === 0) { fallback(); return; }

        const dateStrOffset = tiffOffset + targetDateOffset;
        if (dateStrOffset + 19 > length) { fallback(); return; }

        let dateCharCodes = [];
        for (let i = 0; i < 19; i++) {
          dateCharCodes.push(view.getUint8(dateStrOffset + i));
        }
        const dateStr = String.fromCharCode(...dateCharCodes);

        const match = dateStr.match(/(\d{4})[:\/\.-](\d{2})[:\/\.-](\d{2})/);
        if (match) {
          resolve(`${match[1]}-${match[2]}-${match[3]}`);
        } else {
          fallback();
        }
      } catch (err) {
        fallback();
      }
    };

    reader.onerror = () => fallback();
  });
}

/**
 * 撮影日時の Date オブジェクトを抽出する非同期関数 (一括インポート用)
 */
export function extractPhotoDateObject(file) {
  return new Promise((resolve) => {
    extractPhotoDate(file).then(dateStr => {
      if (dateStr) {
        const parts = dateStr.split('-');
        if (parts.length === 3) {
          // ローカル正午 (12:00:00) の Date オブジェクトを生成 (タイムゾーンズレ防止)
          const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0);
          if (!isNaN(d.getTime())) {
            resolve(d);
            return;
          }
        }
      }
      if (file && file.lastModified) {
        resolve(new Date(file.lastModified));
      } else {
        resolve(null);
      }
    }).catch(() => {
      if (file && file.lastModified) {
        resolve(new Date(file.lastModified));
      } else {
        resolve(null);
      }
    });
  });
}

/**
 * 銘柄の文字が読める解像度を保ちつつ軽量化圧縮 (絶対に失敗・拒否しない安全設計)
 */
export function compressImage(file, maxWidth = 1600, quality = 0.75) {
  return new Promise((resolve) => {
    if (!file) {
      resolve({ blob: file, base64: '', mimeType: 'image/jpeg' });
      return;
    }

    const fallbackOriginal = () => {
      if (window.FileReader && file instanceof Blob) {
        const reader = new FileReader();
        reader.onloadend = () => {
          const res = reader.result || '';
          const b64 = res.split(',')[1] || '';
          resolve({ blob: file, base64: b64, mimeType: file.type || 'image/jpeg' });
        };
        reader.onerror = () => resolve({ blob: file, base64: '', mimeType: file.type || 'image/jpeg' });
        reader.readAsDataURL(file);
      } else {
        resolve({ blob: file, base64: '', mimeType: file.type || 'image/jpeg' });
      }
    };

    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (e) => {
        const img = new Image();
        img.src = e.target.result;
        img.onload = () => {
          try {
            let width = img.width;
            let height = img.height;

            if (width > maxWidth || height > maxWidth) {
              if (width > height) {
                height = Math.round((height * maxWidth) / width);
                width = maxWidth;
              } else {
                width = Math.round((width * maxWidth) / height);
                height = maxWidth;
              }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');

            // 🌟 透過画像の黒塗り化防止 (白背景固定)
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);

            canvas.toBlob(
              (blob) => {
                if (blob) {
                  const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
                  resolve({
                    blob,
                    base64: compressedBase64.split(',')[1] || '',
                    mimeType: 'image/jpeg'
                  });
                } else {
                  fallbackOriginal();
                }
              },
              'image/jpeg',
              quality
            );
          } catch (err) {
            fallbackOriginal();
          }
        };
        img.onerror = () => fallbackOriginal();
      };
      reader.onerror = () => fallbackOriginal();
    } catch (e) {
      fallbackOriginal();
    }
  });
}

/**
 * 画像配列を撮影時間ベースで2段階スマート・グルーピングする
 */
export function groupImagesByTime(imageItems, maxTimeGapMs = 3 * 60 * 1000, maxGroupSize = 5) {
  if (!imageItems || imageItems.length === 0) return [];

  const sortedItems = [...imageItems].sort((a, b) => {
    const timeA = a.date ? a.date.getTime() : 0;
    const timeB = b.date ? b.date.getTime() : 0;
    return timeA - timeB;
  });

  let initialGroups = [];
  let currentGroup = [];

  for (let i = 0; i < sortedItems.length; i++) {
    const item = sortedItems[i];
    if (currentGroup.length === 0) {
      currentGroup.push(item);
    } else {
      const prevItem = currentGroup[currentGroup.length - 1];
      const timeA = prevItem.date ? prevItem.date.getTime() : 0;
      const timeB = item.date ? item.date.getTime() : 0;
      const gap = Math.abs(timeB - timeA);

      if (gap >= maxTimeGapMs && timeA !== 0 && timeB !== 0) {
        initialGroups.push(currentGroup);
        currentGroup = [item];
      } else {
        currentGroup.push(item);
      }
    }
  }

  if (currentGroup.length > 0) {
    initialGroups.push(currentGroup);
  }

  let finalGroups = [];

  const splitGroupIfNeeded = (group) => {
    if (group.length <= maxGroupSize) {
      finalGroups.push(group);
      return;
    }

    let maxGap = -1;
    let splitIndex = -1;

    for (let i = 1; i < group.length; i++) {
      const timeA = group[i - 1].date ? group[i - 1].date.getTime() : 0;
      const timeB = group[i].date ? group[i].date.getTime() : 0;
      const gap = Math.abs(timeB - timeA);

      if (gap > maxGap) {
        maxGap = gap;
        splitIndex = i;
      }
    }

    if (splitIndex === -1 || maxGap === 0) {
      splitIndex = maxGroupSize;
    }

    const group1 = group.slice(0, splitIndex);
    const group2 = group.slice(splitIndex);

    splitGroupIfNeeded(group1);
    splitGroupIfNeeded(group2);
  };

  initialGroups.forEach(group => {
    splitGroupIfNeeded(group);
  });

  return finalGroups;
}
