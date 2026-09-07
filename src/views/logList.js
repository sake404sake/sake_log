// src/views/logList.js

import { getAllLogs } from '../store/db.js';

/**
 * 安全に画像URLを抽出・探索するプロフェッショナルなヘルパー関数
 */
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

  // その他のプロパティを走査
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

/**
 * 酒ログ一覧ビューのレンダリング（スマホ表示対応・はみ出し完全防止版）
 */
export async function renderLogListView() {
  const logs = await getAllLogs();
  
  if (!logs || logs.length === 0) {
    return `
      <div class="empty-state" style="padding: 40px 20px; text-align: center;">
        <p style="color: var(--text-sub); margin-bottom: 16px;">登録されたお酒の記録がありません。</p>
        <button class="btn-primary" data-action="open-editor" style="margin-top: 12px;">最初の酒ログを登録する</button>
      </div>
    `;
  }

  // 1. カテゴリ別にグループ化
  const categoryGroups = {};
  logs.forEach(log => {
    const cat = log.category || 'その他';
    if (!categoryGroups[cat]) categoryGroups[cat] = {};
    
    // 2. 銘柄名でグループ化（元の素晴らしい設計を維持）
    const brand = log.name || '名称未設定';
    if (!categoryGroups[cat][brand]) categoryGroups[cat][brand] = [];
    categoryGroups[cat][brand].push(log);
  });

  // 3. レンダリング処理
  const categoriesHTML = Object.keys(categoryGroups).map(catName => {
    const brandMap = categoryGroups[catName];
    const totalCount = Object.values(brandMap).reduce((acc, arr) => acc + arr.length, 0);

    const brandsHTML = Object.keys(brandMap).map(brandName => {
      const brandLogs = brandMap[brandName];
      
      // 日付の新しい順にソート
      brandLogs.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

      const rowsHTML = brandLogs.map(log => {
        const thumbUrl = extractThumbUrl(log);

        return `
          <div class="log-row-item" data-action="open-detail" data-id="${log.id}"
               style="display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: 8px; background: rgba(255, 255, 255, 0.02); cursor: pointer; transition: background 0.2s; margin-bottom: 6px; box-sizing: border-box; width: 100%; overflow: hidden;">
            
            <!-- サムネイル画像エリア -->
            <div class="row-thumb-box" style="width: 44px; height: 44px; min-width: 44px; min-height: 44px; flex-shrink: 0; border-radius: 6px; overflow: hidden; background: #000; display: flex; align-items: center; justify-content: center;">
              ${thumbUrl ? `<img src="${thumbUrl}" class="row-thumb-img" style="width: 100%; height: 100%; object-fit: cover;">` : `<span style="font-size: 1.2rem;">🍶</span>`}
            </div>

            <!-- テキスト情報エリア（はみ出し防止のための flex と min-width 指定） -->
            <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px;">
              <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 6px;">
                <span style="font-size: 0.82rem; font-weight: bold; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">📅 ${log.date || '日付未登録'}</span>
                <span style="font-size: 0.8rem; color: var(--accent-color); white-space: nowrap; flex-shrink: 0;">★ ${log.rating || '4.0'}</span>
              </div>
              
              <!-- 商品名・酒蔵（折り返しを許可し、長い文字列でも横揺れを100%防ぐ） -->
              ${(log.productName || log.brewery) ? `
                <div style="font-size: 0.78rem; color: var(--text-sub); display: flex; flex-wrap: wrap; gap: 4px; word-break: break-all; line-height: 1.3;">
                  ${log.productName ? `<span style="color: var(--text-main); font-weight: 500;">${log.productName}</span>` : ''}
                  ${log.brewery ? `<span>(${log.brewery})</span>` : ''}
                </div>
              ` : ''}
            </div>

            <!-- 矢印マーク -->
            <div class="row-arrow" style="color: var(--text-sub); font-size: 0.8rem; flex-shrink: 0; margin-left: 2px;">❯</div>
          </div>
        `;
      }).join('');

      return `
        <div class="brand-group-card" style="background: rgba(0, 0, 0, 0.2); border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.05); padding: 12px; margin-bottom: 12px; box-sizing: border-box; width: 100%; overflow: hidden;">
          <div class="brand-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px dashed rgba(255, 255, 255, 0.1); width: 100%; box-sizing: border-box;">
            <span class="brand-title" style="font-weight: bold; font-size: 0.95rem; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 75%;">🍶 ${brandName}</span>
            <span class="brand-badge" style="font-size: 0.72rem; background: rgba(255, 255, 255, 0.08); padding: 2px 8px; border-radius: 12px; color: var(--text-sub); white-space: nowrap; flex-shrink: 0;">${brandLogs.length}回の記録</span>
          </div>
          <div class="brand-logs-list" style="display: flex; flex-direction: column; width: 100%; box-sizing: border-box;">
            ${rowsHTML}
          </div>
        </div>
      `;
    }).join('');

    return `
      <details class="category-accordion" open style="background: var(--card-bg, #1a1e29); border-radius: 12px; margin-bottom: 16px; border: 1px solid var(--border-color, #2d3243); overflow: hidden; box-sizing: border-box; width: 100%;">
        <summary class="category-summary" style="padding: 14px 16px; font-weight: bold; cursor: pointer; display: flex; justify-content: space-between; align-items: center; background: rgba(255, 255, 255, 0.03); user-select: none;">
          <span class="category-title" style="font-size: 1.05rem; color: var(--accent-color, #d4a359); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 70%;">${catName}</span>
          <span class="category-count" style="font-size: 0.85rem; color: var(--text-sub, #8e929e); white-space: nowrap; flex-shrink: 0;">${Object.keys(brandMap).length} 銘柄 (${totalCount} 件)</span>
        </summary>
        <div class="category-content" style="padding: 12px; display: flex; flex-direction: column; gap: 10px; box-sizing: border-box; width: 100%;">
          ${brandsHTML}
        </div>
      </details>
    `;
  }).join('');

  return `
    <div class="dashboard-container" style="max-width: 100%; box-sizing: border-box; overflow-x: hidden;">
      <div class="dashboard-header" style="margin-bottom: 16px;">
        <h2 style="font-size: 1.4rem; font-weight: bold; color: var(--text-main);">酒ログ一覧</h2>
      </div>
      <div class="categories-wrapper" style="display: flex; flex-direction: column; width: 100%; box-sizing: border-box;">
        ${categoriesHTML}
      </div>
    </div>
  `;
}
