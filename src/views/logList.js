import { getAllLogs } from '../store/db.js';

export async function renderLogListView() {
  const logs = await getAllLogs();
  console.log('取得したログ一覧（デバッグ）:', logs);

  if (!logs || logs.length === 0) {
    return `<div class=\"empty-state\">
      <p>登録されたお酒の記録がありません。</p>
      <button class=\"btn-primary\" data-action=\"open-editor\" style=\"margin-top: 12px;\">最初の酒ログを登録する</button>
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
        return `
          <div class=\"log-item-row\" data-action=\"open-detail\" data-id=\"${log.id}\">
            <div class=\"row-info-container\">
              <div class=\"row-date-line\">
                <span class=\"row-date\">📅 ${log.date || '日付未登録'}</span>
                <span class=\"row-rating\">★ ${log.rating || '4.0'}</span>
              </div>
              <div class=\"row-sub-info\">
                ${log.productName ? `<span class=\"row-product\">${log.productName}</span>` : ''}
                ${log.brewery ? `<span class=\"row-brewery\">(${log.brewery})</span>` : ''}
              </div>
            </div>
            <div class=\"row-arrow\">❯</div>
          </div>
        `;
      }).join('');

      return `
        <div class=\"brand-group-card\">
          <div class=\"brand-header\">
            <span class=\"brand-title\">🍶 ${brandName}</span>
            <span class=\"brand-badge\">${brandLogs.length}回の記録</span>
          </div>
          <div class=\"brand-logs-list\">
            ${rowsHTML}
          </div>
        </div>
      `;
    }).join('');

    return `
      <details class=\"category-accordion\" open>
        <summary class=\"category-summary\">
          <span class=\"category-title\">${catName}</span>
          <span class=\"category-count\">${Object.keys(brandMap).length} 銘柄 (${totalCount} 件)</span>
        </summary>
        <div class=\"category-content\">
          ${brandsHTML}
        </div>
      </details>
    `;
  }).join('');

  return `<div class=\"dashboard-container\">
    <div class=\"dashboard-header\">
      <h2>酒ログ一覧</h2>
      <button class=\"btn-primary\" data-action=\"open-editor\">＋ 新規登録</button>
    </div>

    <div class=\"categories-wrapper\">
      ${categoriesHTML}
    </div>
  </div>

  <style>
    /* スマホ・狭い画面でのはみ出し・見切対策（他の機能に影響を与えない限定スタイル） */
    .dashboard-container {
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
      overflow-x: hidden;
      padding-bottom: 40px;
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
      gap: 8px;
    }

    .row-info-container {
      flex: 1;
      min-width: 0; /* Flexbox内でのテキスト省略を正常に機能させるための必須設定 */
      overflow: hidden;
    }

    .row-date-line {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 0.85rem;
      color: #666;
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
      color: #777;
    }

    .row-arrow {
      flex-shrink: 0; /* 矢印アイコンが潰れないように固定 */
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
