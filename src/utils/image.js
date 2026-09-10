// src/utils/image.js

/**
 * 画像ファイルから撮影日時 (EXIF Tag 0x9003 / 0x0132 / 0x9004) を高精度に抽出する関数
 * - 1MB (1,048,576 バイト) ヘッダーパースによりスマホカメラの大きな埋め込みサムネイルによる打ち切りを完全防止
 * - HEIC / 大文字拡張子 (.JPG) / MIMEタイプ空文字等にも柔軟対応
 * - 抽出失敗時は file.lastModified へ安全にフォールバック
 */
export function extractPhotoDate(file) {
  return new Promise((resolve) => {
    if (!file) {
      resolve(null);
      return;
    }

    const fallback = () => {
      if (file.lastModified) {
        const photoDate = new Date(file.lastModified);
        if (!isNaN(photoDate.getTime())) {
          const year = photoDate.getFullYear();
          const month = String(photoDate.getMonth() + 1).padStart(2, '0');
          const day = String(photoDate.getDate()).padStart(2, '0');
          resolve(`${year}-${month}-${day}`);
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
    // 🌟 1024KB (1,048,576 bytes) ヘッダー読み込みで大きなAPP1ヘッダーでも読み切りを確実に防止
    const slice = file.slice(0, 1048576);
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
        let mainDateTimeOffset = 0;

        for (let i = 0; i < entriesCount; i++) {
          const entryOffset = ifdOffset + 2 + (i * 12);
          if (entryOffset + 12 > length) break;

          const tag = view.getUint16(entryOffset, isLittleEndian);
          if (tag === 0x8769) {
            exifSubIFDOffset = view.getUint32(entryOffset + 8, isLittleEndian);
          } else if (tag === 0x0132) {
            mainDateTimeOffset = view.getUint32(entryOffset + 8, isLittleEndian);
          }
        }

        let dateTimeOffset = 0;

        if (exifSubIFDOffset > 0) {
          let subIFDOffset = tiffOffset + exifSubIFDOffset;
          if (subIFDOffset + 2 <= length) {
            const subEntriesCount = view.getUint16(subIFDOffset, isLittleEndian);
            for (let i = 0; i < subEntriesCount; i++) {
              const entryOffset = subIFDOffset + 2 + (i * 12);
              if (entryOffset + 12 > length) break;

              const tag = view.getUint16(entryOffset, isLittleEndian);
              if (tag === 0x9003 || tag === 0x9004) { // DateTimeOriginal or DateTimeDigitized
                dateTimeOffset = view.getUint32(entryOffset + 8, isLittleEndian);
                if (tag === 0x9003) break; // 0x9003 最優先
              }
            }
          }
        }

        if (dateTimeOffset === 0) {
          dateTimeOffset = mainDateTimeOffset;
        }

        if (dateTimeOffset === 0) { fallback(); return; }

        const dateStrOffset = tiffOffset + dateTimeOffset;
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
          const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
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
    if (!file) {
      reject(new Error('No file provided'));
      return;
    }

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
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
              resolve({
                blob,
                base64: compressedBase64.split(',')[1],
                mimeType: 'image/jpeg'
              });
            } else {
              resolve({
                blob: file,
                base64: (e.target.result || '').split(',')[1] || '',
                mimeType: file.type || 'image/jpeg'
              });
            }
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
