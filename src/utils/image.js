// src/utils/image.js

/**
 * 画像ファイルから撮影日時 (EXIF Tag 0x9003 / ASCIIスキャン) を抽出する非同期関数
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
          const now = new Date();
          const isToday = photoDate.getFullYear() === now.getFullYear() &&
                          photoDate.getMonth() === now.getMonth() &&
                          photoDate.getDate() === now.getDate();
          if (!isToday) {
            const year = photoDate.getFullYear();
            const month = String(photoDate.getMonth() + 1).padStart(2, '0');
            const day = String(photoDate.getDate()).padStart(2, '0');
            resolve(`${year}-${month}-${day}`);
            return;
          }
        }
      }
      resolve(null);
    };

    const reader = new FileReader();
    const slice = file.slice(0, 1048576); // 1MB
    reader.readAsArrayBuffer(slice);

    reader.onload = (e) => {
      try {
        const buffer = e.target.result;
        const view = new DataView(buffer);
        const length = view.byteLength;

        // 1. TIFF / EXIF Header Check
        if (length >= 12 && view.getUint16(0, false) === 0xFFD8) {
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

          if (exifFound && tiffOffset + 8 <= length) {
            const byteOrder = view.getUint16(tiffOffset, false);
            const isLittleEndian = (byteOrder === 0x4949);

            if (view.getUint16(tiffOffset + 2, isLittleEndian) === 0x002A) {
              const firstIFDOffset = view.getUint32(tiffOffset + 4, isLittleEndian);
              let ifdOffset = tiffOffset + firstIFDOffset;

              if (ifdOffset + 2 <= length) {
                const entriesCount = view.getUint16(ifdOffset, isLittleEndian);
                let exifSubIFDOffset = 0;

                for (let i = 0; i < entriesCount; i++) {
                  const entryOffset = ifdOffset + 2 + (i * 12);
                  if (entryOffset + 12 > length) break;

                  const tag = view.getUint16(entryOffset, isLittleEndian);
                  if (tag === 0x8769) {
                    exifSubIFDOffset = view.getUint32(entryOffset + 8, isLittleEndian);
                    break;
                  }
                }

                if (exifSubIFDOffset > 0 && tiffOffset + exifSubIFDOffset + 2 <= length) {
                  let subIFDOffset = tiffOffset + exifSubIFDOffset;
                  const subEntriesCount = view.getUint16(subIFDOffset, isLittleEndian);
                  let dateTimeOriginalOffset = 0;

                  for (let i = 0; i < subEntriesCount; i++) {
                    const entryOffset = subIFDOffset + 2 + (i * 12);
                    if (entryOffset + 12 > length) break;

                    const tag = view.getUint16(entryOffset, isLittleEndian);
                    if (tag === 0x9003 || tag === 0x9004 || tag === 0x0132) {
                      dateTimeOriginalOffset = view.getUint32(entryOffset + 8, isLittleEndian);
                      break;
                    }
                  }

                  if (dateTimeOriginalOffset > 0 && tiffOffset + dateTimeOriginalOffset + 10 <= length) {
                    const dateStrOffset = tiffOffset + dateTimeOriginalOffset;
                    let dateCharCodes = [];
                    for (let i = 0; i < 19; i++) {
                      if (dateStrOffset + i < length) {
                        dateCharCodes.push(view.getUint8(dateStrOffset + i));
                      }
                    }
                    const dateStr = String.fromCharCode(...dateCharCodes);
                    const match = dateStr.match(/(\d{4})[:\/\.-](\d{2})[:\/\.-](\d{2})/);
                    if (match) {
                      resolve(`${match[1]}-${match[2]}-${match[3]}`);
                      return;
                    }
                  }
                }
              }
            }
          }
        }

        // 2. Binary ASCII Regex fallback for HEIC/PNG/WebP
        const bytes = new Uint8Array(buffer);
        let asciiStr = '';
        const maxScan = Math.min(bytes.length, 262144); // 256KB ASCII scan
        for (let i = 0; i < maxScan; i++) {
          const b = bytes[i];
          if (b >= 32 && b <= 126) {
            asciiStr += String.fromCharCode(b);
          } else {
            asciiStr += ' ';
          }
        }

        const matches = asciiStr.match(/(?:20[0-2][0-9])[:\/\.-](?:0[1-9]|1[0-2])[:\/\.-](?:0[1-9]|[12][0-9]|3[01])/g);
        if (matches && matches.length > 0) {
          const rawMatch = matches[0].replace(/[:\/\.]/g, '-');
          resolve(rawMatch);
          return;
        }

        fallback();
      } catch (err) {
        fallback();
      }
    };

    reader.onerror = () => fallback();
  });
}

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
 * 安全な画像圧縮関数 (絶対Rejectしないフォールバック保護付き)
 */
export function compressImage(file, maxWidth = 1600, quality = 0.75) {
  return new Promise((resolve) => {
    if (!file) {
      resolve({ blob: null, base64: '', mimeType: 'image/jpeg' });
      return;
    }

    const reader = new FileReader();
    reader.readAsDataURL(file);

    reader.onload = (e) => {
      const dataUrl = e.target.result;
      if (!dataUrl || typeof dataUrl !== 'string') {
        resolve({ blob: file, base64: '', mimeType: file.type || 'image/jpeg' });
        return;
      }

      const img = new Image();
      img.src = dataUrl;

      img.onload = () => {
        try {
          let width = img.width || 800;
          let height = img.height || 600;

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

          const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
          const base64 = compressedDataUrl.includes(',') ? compressedDataUrl.split(',')[1] : '';

          canvas.toBlob(
            (blob) => {
              resolve({
                blob: blob || file,
                base64: base64,
                mimeType: 'image/jpeg'
              });
            },
            'image/jpeg',
            quality
          );
        } catch (err) {
          const rawBase64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : '';
          resolve({ blob: file, base64: rawBase64, mimeType: file.type || 'image/jpeg' });
        }
      };

      img.onerror = () => {
        const rawBase64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : '';
        resolve({ blob: file, base64: rawBase64, mimeType: file.type || 'image/jpeg' });
      };
    };

    reader.onerror = () => {
      resolve({ blob: file, base64: '', mimeType: file.type || 'image/jpeg' });
    };
  });
}

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
