// src/views/logList.js

import { getAllLogs } from '../store/db.js';

/**
 * 酒ログ一覧ビューのレンダリング
 * status: 'draft' のもの、および isDeleted: true のものは getAllLogs 内で自動的に除外されます
 */
export async function renderLogListView() {
  const logs = await getAllLogs(false, false); // 下書きと論理削除を除外
  
  if (!logs || logs.length === 0) {
    return `
      <div class="empty-state" style="padding: 40px 20px; text-align: center;">
        <p style="color: var(--text-sub); margin-bottom: 16px;">登録されたお酒の記録がありません。</p>
        <button class="btn-primary" data-action="open-editor">最初の酒ログを登録する</button>
      </div>
    `;
  }

  // 1. カテゴリ別にグループ化
  const categoryGroups = {};
  logs.forEach(log => {
    const cat = log.category || 'その他';
    if (!categoryGroups[cat]) categoryGroups[cat] = {};
    
    const brand = log.name || '名称未設定';
    if (!categoryGroups[cat][brand]) categoryGroups[cat][brand] = [];
    categoryGroups[cat][brand].push(log);
  });

  // 2. レンダリング処理
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
          if (Array.isArray(obj.imageUrls) && obj.imageUrls.length > 0) {
            return obj.imageUrls[0];
          }
          return null;
        };

        const thumbUrl = extractThumbUrl(log);

        return `
          <div class="log-row-item" data-action="open-detail" data-id="${log.id}" 
               style="display: flex; flex-direction: column; align-items: stretch; gap: 8px; padding: 12px; margin-bottom: 8px;">
            
            <!-- 上段：サムネイル、日付、評価、矢印 -->
            <div style="display: flex; align-items: center; gap: 12px; width: 100%;">
              <div class="row-thumb-box" style="width: 50px; height: 50px; border-radius: 8px; background: #000; flex-shrink: 0;">
                ${thumbUrl ? `<img src="${thumbUrl}" class="row-thumb-img">` : `<span style="font-size: 1.5rem;">🍶</span>`}
              </div>
              
              <div class="row-main-info" style="flex: 1; min-width: 0;">
                <div class="row-date-line" style="display: flex; justify-content: space-between; align-items: center;">
                  <span class="row-date" style="font-size: 0.85rem; font-weight: bold;">📅 ${log.date || '日付未登録'}</span>
                  <span class="row-rating" style="font-size: 0.85rem; color: var(--accent-color);">★ ${log.rating || '4.0'}</span>
                </div>
              </div>
              
              <div class="row-arrow" style="color: var(--text-sub); flex-shrink: 0;">❯</div>
            </div>

            <!-- 下段：銘柄・商品名（サムネの下に回り込むように配置し横揺れ・はみ出しを完全防止） -->
            <div class="row-sub-info" style="padding-left: 2px; white-space: normal; overflow: visible; text-overflow: unset; width: 100%;">
              <div style="font-size: 1rem; font-weight: bold; color: var(--text-main); margin-bottom: 2px; word-break: break-all;">
                ${log.name || '名称未設定'}
              </div>
              ${(log.productName || log.brewery) ? `
                <div style="font-size: 0.8rem; color: var(--text-sub); display: flex; flex-wrap: wrap; gap: 4px; word-break: break-all;">
                  ${log.productName ? `<span>${log.productName}</span>` : ''}
                  ${log.brewery ? `<span>(${log.brewery})</span>` : ''}
                </div>
              ` : ''}
            </div>
          </div>
        `;
      }).join('');

      return `
        <div class="brand-group-card" style="margin-bottom: 12px;">
          <div class="brand-header" style="padding-bottom: 8px; margin-bottom: 8px;">
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
      <details class="category-accordion" open style="margin-bottom: 16px;">
        <summary class="category-summary">
          <span class="category-title">${catName}</span>
          <span class="category-count">${Object.keys(brandMap).length} 銘柄 (${totalCount} 件)</span>
        </summary>
        <div class="category-content" style="padding: 10px;">
          ${brandsHTML}
        </div>
      </details>
    `;
  }).join('');

  return `
    <div class="dashboard-container">
      <div class="dashboard-header" style="margin-bottom: 16px;">
        <h2>酒ログ一覧</h2>
      </div>
      <div class="categories-wrapper">
        ${categoriesHTML}
      </div>
    </div>
  `;
}
