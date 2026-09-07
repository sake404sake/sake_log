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
        // 画像データを安全に抽出・探索するヘルパー関数（1枚目を取りこぼさないよう改善）
        const extractThumbUrl = (obj) => {
          if (!obj) return null;
          
          const parseImageVal = (val) => {
            if (!val) return null;
            if (typeof val === 'string' && val.trim() !== '') {
              return val;
            }
            if (typeof val === 'object') {
              return val.url || val.src || val.data || val.path || null;
            }
            return null;
          };

          // よく使われるプロパティ名を優先順位順にチェック
          const candidateKeys = ['imageUrls', 'images', 'image', 'photos', 'photo', 'imageUrl', 'image_url', 'img', 'picture', 'file', 'files'];
          for (const key of candidateKeys) {
            const val = obj[key];
            if (Array.isArray(val) && val.length > 0) {
              const first = parseImageVal(val[0]);
              if (first) return first;
            } else {
              const parsed = parseImageVal(val);
              if (parsed) return parsed;
            }
          }

          // その他のプロパティを総当たりで走査
          for (const key in obj) {
            const val = obj[key];
            if (Array.isArray(val) && val.length > 0) {
              const first = parseImageVal(val[0]);
              if (first) return first;
            } else {
              const parsed = parseImageVal(val);
              if (parsed && typeof parsed === 'string' && parsed.length > 20) {
                return parsed;
              }
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

    .dashboard-header {
      margin-bottom: 20px;
    }

    .dashboard-header h2 {
      margin: 0;
      font-size: 1.5rem;
    }

    .brand-group-card {
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
      overflow: hidden;
      margin-bottom: 16px;
    }

    .brand-logs-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
      box-sizing: border-box;
      width: 100%;
      max-width: 100%;
    }

    .log-item-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
      gap: 10px;
      padding: 10px 12px;
      background: rgba(255, 255, 255, 0.03);
      border-radius: 8px;
      overflow: hidden;
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

    /* 情報コンテナ：幅を自動調整しつつ、必ず親の内側に収める */
    .row-info-container {
      flex: 1;
      min-width: 0;
      max-width: calc(100% - 78px);
      overflow: hidden;
      box-sizing: border-box;
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
      flex-wrap: wrap;
      align-items: baseline;
      gap: 2px 6px;
      margin-top: 4px;
      width: 100%;
      min-width: 0;
      box-sizing: border-box;
    }

    .row-product {
      word-break: break-all;
      overflow: hidden;
    }

    .row-brewery {
      word-break: break-all;
      color: #888;
    }

    .row-arrow {
      flex-shrink: 0;
      color: #666;
      padding-left: 4px;
    }

    .brand-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      overflow: hidden;
      margin-bottom: 8px;
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
