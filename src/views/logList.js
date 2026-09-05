import { getAllLogs } from '../store/db.js';

export async function renderLogListView() {
  const logs = await getAllLogs();
  console.log('取得したログ一覧（デバッグ）:', logs); // ブラウザのコンソールでデータ構造を確認できます

  if (!logs || logs.length === 0) {
    return `
      <div class="empty-state">
        <p>登録されたお酒の記録がありません。</p>
        <button class="btn-primary" data-action="open-editor" style="margin-top: 12px;">最初の酒ログを登録する</button>
      </div>
    `;
  }

  // 1. カテゴリ別にグループ化
  const categoryGroups = {};
  logs.forEach(log => {
    const cat = log.category || 'その他';
    if (!categoryGroups[cat]) categoryGroups[cat] = {};
    
    // 2. 銘柄名でグループ化
    const brand = log.name || '名称未設定';
    if (!categoryGroups[cat][brand]) categoryGroups[cat][brand] = [];
    
    categoryGroups[cat][brand].push(log);
  });

  // レンダリング処理
  const categoriesHTML = Object.keys(categoryGroups).map(catName => {
    const brandMap = categoryGroups[catName];
    const totalCount = Object.values(brandMap).reduce((acc, arr) => acc + arr.length, 0);

    const brandsHTML = Object.keys(brandMap).map(brandName => {
      const brandLogs = brandMap[brandName];
      // 日付の新しい順にソート
      brandLogs.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

      const rowsHTML = brandLogs.map(log => {
        let thumbUrl = null;
        // db_3.js の getAllLogs() が返す imageUrls に最初に対応させる
        if (Array.isArray(log.imageUrls) && log.imageUrls.length > 0) {
          thumbUrl = log.imageUrls[0];
        } else {
          // 従来のフォールバック（他の形式に対応）
          let imgData = null;
          const possibleImages = log.images || log.image || log.photos || log.photo;
          
          if (Array.isArray(possibleImages) && possibleImages.length > 0) {
            imgData = possibleImages[0];
          } else if (possibleImages) {
            imgData = possibleImages;
          }

          if (imgData) {
            if (imgData instanceof Blob) {
              thumbUrl = URL.createObjectURL(imgData);
            } else if (typeof imgData === 'string') {
              thumbUrl = imgData.startsWith('data:') ? imgData : `data:image/jpeg;base64,${imgData}`;
            } else if (imgData instanceof Uint8Array || imgData instanceof ArrayBuffer) {
              const blob = new Blob([imgData], { type: 'image/jpeg' });
              thumbUrl = URL.createObjectURL(blob);
            }
          }
        }

        return `
          <div class="log-row-item" data-action="open-detail" data-id="${log.id}">
            <div class="row-thumb-box">
              ${thumbUrl 
                ? `<img src="${thumbUrl}" class="row-thumb-img" alt="${log.name}" />` 
                : `<div class="row-thumb-placeholder">🍶</div>`}
            </div>
            <div class="row-main-info">
              <div class="row-date-line">
                <span class="row-date">📅 ${log.date || '日付未登録'}</span>
                <span class="row-rating">★ ${log.rating || '4.0'}</span>
              </div>
              <div class="row-sub-info">
                ${log.productName ? `<span class="row-product">${log.productName}</span>` : ''}
                ${log.brewery ? `<span class="row-brewery">(${log.brewery})</span>` : ''}
              </div>
            </div>
            <div class="row-arrow">❯</div>
          </div>
        `;
      }).join('');

      return `
        <div class="brand-group-card">
          <div class="brand-header">
            <span class="brand-title">🍶 ${brandName}</span>
            <span class="brand-badge">${brandLogs.length}回の記録</span>
          </div>
          <div class="brand-logs-list">
            ${rowsHTML}
          </div>
        </div>
      `;
    }).join('');

    return `
      <details class="category-accordion" open>
        <summary class="category-summary">
          <span class="category-title">${catName}</span>
          <span class="category-count">${Object.keys(brandMap).length} 銘柄 (${totalCount} 件)</span>
        </summary>
        <div class="category-content">
          ${brandsHTML}
        </div>
      </details>
    `;
  }).join('');

  return `
    <div class="dashboard-container">
      <div class="dashboard-header">
        <h2>酒ログ一覧</h2>
      </div>
      <div class="category-accordion-list">
        ${categoriesHTML}
      </div>
    </div>
  `;
}