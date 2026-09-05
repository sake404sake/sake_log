// 圧縮前に撮影日時（呑んだ日）を抽出
export function extractPhotoDate(file) {
  if (!file || !file.lastModified) return null;
  const photoDate = new Date(file.lastModified);
  const year = photoDate.getFullYear();
  const month = String(photoDate.getMonth() + 1).padStart(2, '0');
  const day = String(photoDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 銘柄の文字が読める解像度を保ちつつ軽量化圧縮 (Blob & Base64を返却)
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
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
            resolve({
              blob,
              base64: compressedBase64.split(',')[1],
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
 * 
 * @param {Array} imageItems - { file: File, date: Date, ... } の形式を持つオブジェクトの配列
 * @param {number} maxTimeGapMs - 第1段階の分割閾値（デフォルト: 3分 = 3 * 60 * 1000 ミリ秒）
 * @param {number} maxGroupSize - 1グループの最大許容枚数（デフォルト: 5枚）
 * @returns {Array<Array>} グルーピングされた2次元配列
 */
export function groupImagesByTime(imageItems, maxTimeGapMs = 3 * 60 * 1000, maxGroupSize = 5) {
  if (!imageItems || imageItems.length === 0) return [];

  // 1. 撮影日時（EXIF）順に昇順ソート
  // ※ dateプロパティが無い（EXIF取得不可など）場合は0として扱い先頭にまとめる
  const sortedItems = [...imageItems].sort((a, b) => {
    const timeA = a.date ? a.date.getTime() : 0;
    const timeB = b.date ? b.date.getTime() : 0;
    return timeA - timeB;
  });

  // --------------------------------------------------
  // 第1段階：絶対時間（大枠）による分割
  // --------------------------------------------------
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

      // EXIFが存在し、かつ設定時間（3分）を超える空白があればグループを区切る
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

  // --------------------------------------------------
  // 第2段階：枚数オーバー時の動的分割（再帰処理）
  // --------------------------------------------------
  let finalGroups = [];

  const splitGroupIfNeeded = (group) => {
    // グループが上限枚数（5枚）以下ならそのまま確定
    if (group.length <= maxGroupSize) {
      finalGroups.push(group);
      return;
    }

    // 上限を超えている場合、グループ内で最も時間が空いている「最大ギャップ」を探す
    let maxGap = -1;
    let splitIndex = -1;

    for (let i = 1; i < group.length; i++) {
      const timeA = group[i - 1].date ? group[i - 1].date.getTime() : 0;
      const timeB = group[i].date ? group[i].date.getTime() : 0;
      const gap = Math.abs(timeB - timeA);

      if (gap > maxGap) {
        maxGap = gap;
        splitIndex = i; // ギャップが最大の箇所で分割するインデックス
      }
    }

    // 全ての時間が全く同じ（連写でギャップ0）、またはEXIF無しで分割点が特定できない場合
    // 強制的に上限枚数（maxGroupSize）の位置で機械的にスライスする
    if (splitIndex === -1 || maxGap === 0) {
      splitIndex = maxGroupSize;
    }

    // グループを最大ギャップの箇所で2つに分割
    const group1 = group.slice(0, splitIndex);
    const group2 = group.slice(splitIndex);

    // 分割されたそれぞれのグループに対して、まだ上限を超えていないか再帰的にチェック
    splitGroupIfNeeded(group1);
    splitGroupIfNeeded(group2);
  };

  initialGroups.forEach(group => {
    splitGroupIfNeeded(group);
  });

  return finalGroups; // [ [画像1, 画像2], [画像3, 画像4, 画像5], [画像6]... ] のような2次元配列を返す
}