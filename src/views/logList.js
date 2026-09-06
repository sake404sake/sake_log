import { getAllLogs } from '../store/db.js';

export async function renderLogListView() {
  const logs = await getAllLogs();
  console.log('取得したログ一覧（デバッグ）:', logs);

  if (!logs || logs.length === 0) {
    return `<div class="empty-state">
      <p>登録されたお酒の記録がありません。</p>
      <button class="btn-primary" data-action="open-editor" style="margin-top: 12px;">最初の酒ログを登録する</button>
    </div>`;
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
        // 画像データを安全に抽出・探索するヘルパー関数
        const extractThumbUrl = (obj) => {
          if (!obj) return null;
          
          // よく使われるプロパティ名を優先順位順にチェック
          const candidateKeys = ['images', 'image', 'photos', 'photo', 'imageUrl', 'image_url', 'img', 'picture', 'file', 'files'];
          for (const key of candidateKeys) {
            const val = obj[key];
            if (val) {
              if (typeof val === 'string' && (val.startsWith('data:image') || val.startsWith('http') || val.startsWith('blob:'))) {
                return val;
              }
              if (Array.isArray(val) && val.length > 0) {
                const first = val[0];
                if (typeof first === 'string' && (first.startsWith('data:image') || first.startsWith('http') || first.startsWith('blob:'))) {
                  return first;
                }
                if (first && typeof first === 'object' && (first.url || first.src)) {
                  return first.url || first.src;
                }
              }
              if (typeof val === 'object' && (val.url || val.src)) {
                return val.url || val.src;
              }
            }
          }

          // その他のプロパティを総当たりで走査
          for (const key in obj) {
            const val = obj[key];
            if (typeof val === 'string' && (val.startsWith('data:image') || val.startsWith('http') || val.startsWith('blob:'))) {
              return val;
            }
            if (Array.isArray(val) && val.length > 0) {
              const first = val[0];
              if (typeof first === 'string' && (first.startsWith('data:image') || first.startsWith('http') || first.startsWith('blob:'))) {
                return first;
              }
            }
            if (val && typeof val === 'object' && (val.url || val.src)) {
              return val.url || val.src;
            }
          }
          return null;
        };

        const thumbUrl = extractThumbUrl(log);

        return `
          <div class="log-item-row" data-action="open-detail" data-id="${log.id}">
            ${thumbUrl ? `
              <div class="row-thumb-container">
                <img src="${thumbUrl}" alt="サムネイル" class="row-thumb">
              </div>
            ` : `
              <div class="row-thumb-container empty-thumb">
                <span>🍶</span>
              </div>
            `}
            <div class="row-info-container">
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

  return `<div class="dashboard-container">
    <div class="dashboard-header">
      <h2>酒ログ一覧</h2>
    </div>

    <div class="categories-wrapper">
      ${categoriesHTML}
    </div>
  </div>

  <style>
    .dashboard-container {
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
      overflow-x: hidden;
      padding-bottom: 40px;
    }

    /* タイトル下のスペース（余白）を確保 */
    .dashboard-header {
      margin-bottom: 20px;
    }

    .dashboard-header h2 {
      margin: 0;
      font-size: 1.5rem;
    }

    .brand-group-card {
      width: 100%;
      box-sizing: border-box;
      overflow: hidden;
    }

    .log-item-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      box-sizing: border-box;
      gap: 10px;
    }

    /* サムネイル画像のスタイル */
    .row-thumb-container {
      flex-shrink: 0;
      width: 44px;
      height: 44px;
      border-radius: 6px;
      overflow: hidden;
      background: #222;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .empty-thumb {
      font-size: 1.2rem;
      background: #333;
    }

    .row-thumb {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .row-info-container {
      flex: 1;
      min-width: 0; /* はみ出し防止 */
      overflow: hidden;
    }

    .row-date-line {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 0.85rem;
      color: #aaa;
    }

    .row-sub-info {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 2px;
      width: 100%;
      box-sizing: border-box;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .row-product {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .row-brewery {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #888;
    }

    .row-arrow {
      flex-shrink: 0;
      color: #666;
    }

    .brand-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      overflow: hidden;
    }

    .brand-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .category-summary {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      overflow: hidden;
    }

    .category-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  </style>`;
}
