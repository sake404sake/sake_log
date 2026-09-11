// src/utils/image.js

/**
 * Date オブジェクトまたはタイムスタンプからローカル時刻の "YYYY-MM-DD" 文字列を正確に生描画する
 * (.toISOString() による UTC 時差ズレ -1日バグを完全防止)
 */
export function formatDateToLocalYYYYMMDD(d) {
  if (!d) return '';
  const dateObj = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dateObj.getTime())) return '';
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 画像ファイルから撮影日時 (EXIF / ファイル名 / 更新日時) を高精度に抽出する関数
 * - 2MB ヘッダーパースによりスマホカメラの大きな埋め込みサムネイルによる打ち切りを防止
 * - IFD0 (0x0132) および Exif SubIFD (0x9003 / 0x9004) を探索
 * - ファイル名パターン (IMG_20241103_... 等) からの抽出にも対応
 * - 抽出失敗時は file.lastModified へローカル日付形式で安全にフォールバック
 */
export function extractPhotoDate(file) {
  return new Promise((resolve) => {
    if (!file) {
      resolve(null);
      return;
    }

    const fallback = () => {
      // 1. ファイル名からの日付パターンマッチ (例: IMG_20241103_184512.jpg, 2025-01-15_photo.png)
      const name = file.name || '';
      const match = name.match(/(20\d{2})[:/._-]?(0[1-9]|1[0-2])[:/._-]?(0[1-9]|[12]\d|3[01])/);
      if (match) {
        const y = match[1], m = match[2], d = match[3];
        if (parseInt(y, 10) >= 2000 && parseInt(y, 10) <= 2099) {
          resolve(`${y}-${m}-${d}`);
          return;
        }
      }

      // 2. file.lastModified (ローカルタイムゾーンで YYYY-MM-DD 化)
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
    // 🌟 大きな APP1 ヘッダー(埋め込みサムネイル等)でも読み切れるよう 2MB パース
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
        
        let ifd0DateTimeOffset = 0;
        let exifSubIFDOffset = 0;

        for (let i = 0; i < entriesCount; i++) {
          const entryOffset = ifdOffset + 2 + (i * 12);
          if (entryOffset + 12 > length) break;

          const tag = view.getUint16(entryOffset, isLittleEndian);
          if (tag === 0x0132) { // DateTime in IFD0
            ifd0DateTimeOffset = view.getUint32(entryOffset + 8, isLittleEndian);
          } else if (tag === 0x8769) { // Exif SubIFD Pointer
            exifSubIFDOffset = view.getUint32(entryOffset + 8, isLittleEndian);
          }
        }

        let foundDateStr = null;

        // 1. まず Exif SubIFD (0x9003 DateTimeOriginal / 0x9004 DateTimeDigitized) を優先探索
        if (exifSubIFDOffset > 0) {
          let subIFDOffset = tiffOffset + exifSubIFDOffset;
          if (subIFDOffset + 2 <= length) {
            const subEntriesCount = view.getUint16(subIFDOffset, isLittleEndian);
            let originalOffset = 0;
            let digitizedOffset = 0;

            for (let i = 0; i < subEntriesCount; i++) {
              const entryOffset = subIFDOffset + 2 + (i * 12);
              if (entryOffset + 12 > length) break;

              const tag = view.getUint16(entryOffset, isLittleEndian);
              if (tag === 0x9003) {
                originalOffset = view.getUint32(entryOffset + 8, isLittleEndian);
              } else if (tag === 0x9004) {
                digitizedOffset = view.getUint32(entryOffset + 8, isLittleEndian);
              }
            }

            const targetValOffset = originalOffset || digitizedOffset;
            if (targetValOffset > 0) {
              const dateStrOffset = tiffOffset + targetValOffset;
              if (dateStrOffset + 19 <= length) {
                let dateCharCodes = [];
                for (let i = 0; i < 19; i++) {
                  dateCharCodes.push(view.getUint8(dateStrOffset + i));
                }
                foundDateStr = String.fromCharCode(...dateCharCodes);
              }
            }
          }
        }

        // 2. SubIFD で見つからなければ IFD0 (0x0132 DateTime) を試行
        if (!foundDateStr && ifd0DateTimeOffset > 0) {
          const dateStrOffset = tiffOffset + ifd0DateTimeOffset;
          if (dateStrOffset + 19 <= length) {
            let dateCharCodes = [];
            for (let i = 0; i < 19; i++) {
              dateCharCodes.push(view.getUint8(dateStrOffset + i));
            }
            foundDateStr = String.fromCharCode(...dateCharCodes);
          }
        }

        if (foundDateStr) {
          const match = foundDateStr.match(/(\d{4})[:\/\.-](\d{2})[:\/\.-](\d{2})/);
          if (match) {
            const y = match[1], m = match[2], d = match[3];
            if (parseInt(y, 10) >= 2000 && parseInt(y, 10) <= 2099) {
              resolve(`${y}-${m}-${d}`);
              return;
            }
          }
        }

        fallback();
      } catch (err) {
        fallback();
      }
    };

    reader.onerror = () => fallback();
  });
}

/**
 * 撮影日時の Date オブジェクトを抽出する非同期関数 (一括インポート用)
 * - 時差による日付ズレを防ぐため、ローカル時間の「12:00:00 (正午)」でインスタンス化
 */
export function extractPhotoDateObject(file) {
  return new Promise((resolve) => {
    extractPhotoDate(file).then(dateStr => {
      if (dateStr) {
        const parts = dateStr.split('-');
        if (parts.length === 3) {
          const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0);
          if (!isNaN(d.getTime())) {
            resolve(d);
            return;
          }
        }
      }
      if (file.lastModified) {
        resolve(new Date(file.lastModified));
      } else {
        resolve(null);
      }
    }).catch(() => {
      if (file.lastModified) {
        resolve(new Date(file.lastModified));
      } else {
        resolve(null);
      }
    });
  });
}

/**
 * 銘柄の文字が読める解像度を保ちつつ軽量化圧縮
 */
export function compressImage(file, maxWidth = 1600, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
      const img = new Image();
      img.src = e.target.result;
      img.onload = () => {
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

        // 🌟 白背景でキャンバスを塗りつぶし (透過画像の黒塗り化を防止)
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);

        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve({ blob: file, base64: '', mimeType: file.type || 'image/jpeg' });
              return;
            }
            const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
            resolve({
              blob,
              base64: compressedBase64.split(',')[1] || '',
              mimeType: 'image/jpeg'
            });
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
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
