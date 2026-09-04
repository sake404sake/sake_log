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