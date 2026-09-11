// src/views/logList.js

import { getAllLogs } from '../store/db.js';
import { state, renderSyncDot } from '../store/state.js';

/**
 * 酒ログ一覧ビューのレンダリング
 * status: 'draft' のもの、および isDeleted: true のものは getAllLogs 内で自動的に除外されます
 */
export async function renderLogListView() {
  const logs = await getAllLogs(false, false); // 下書きと論理削除を除外
  const rawQuery = (state.logSearchQuery || '').trim();
  const query = rawQuery.toLocaleLowerCase();
  const normalizeDate = (value) => {
    const normalized = String(value || '')
      .replace(/[０-９]/g, digit => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
      .replace(/年|月/g, '-')
      .replace(/日/g, '')
      .replace(/[/.]/g, '-');
    const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : '';
  };
  const datePattern = '(?:\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}|\\d{4}年\\d{1,2}月\\d{1,2}日)';
  const rangeMatch = rawQuery.match(new RegExp(`(?:期間|日付)?\\s*[:：]?\\s*(${datePattern})\\s*(?:\\.\\.|~|〜|～|から|～)\\s*(${datePattern})`, 'i'));
  const singleDateMatch = rawQuery.match(new RegExp(`^(?:期間|日付)?\\s*[:：]?\\s*(${datePattern})$`, 'i'));
  const dateFrom = rangeMatch ? normalizeDate(rangeMatch[1]) : singleDateMatch ? normalizeDate(singleDateMatch[1]) : '';
  const dateTo = rangeMatch ? normalizeDate(rangeMatch[2]) : dateFrom;
  const dateQueryText = rangeMatch ? rangeMatch[0] : singleDateMatch ? singleDateMatch[0] : '';
  const textQuery = rawQuery.replace(dateQueryText, '').trim().toLocaleLowerCase();
  const queryTerms = textQuery.split(/\s+/).filter(Boolean);
  const nonSearchableFields = new Set([
    'id',
    'imageIds',
    'imageUrls',
    'images',
    'status',
    'isDeleted',
    'updatedAt',
    'createdAt',
    'backupFormData',
    'groupItemsMeta',
    'poolItemsMeta'
  ]);
  const getSearchText = (log) => Object.entries(log)
    .filter(([key]) => !nonSearchableFields.has(key))
    .flatMap(([, value]) => Array.isArray(value) ? value : [value])
    .filter(value => value !== null && value !== undefined && typeof value !== 'object')
    .join(' ')
    .toLocaleLowerCase();
  const filteredLogs = queryTerms.length > 0
    ? logs.filter(log => {
        const logDate = normalizeDate(log.date);
        if (dateFrom && (!logDate || logDate < dateFrom || logDate > dateTo)) return false;
        const searchText = getSearchText(log);
        return queryTerms.every(term => searchText.includes(term));
      })
    : dateFrom
      ? logs.filter(log => {
          const logDate = normalizeDate(log.date);
          return logDate && logDate >= dateFrom && logDate <= dateTo;
        })
      : logs;

  const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const suggestionValues = logs.flatMap(log => [
    log.category,
    log.brewery,
    log.region,
    log.type,
    ...(Array.isArray(log.tags) ? log.tags : [])
  ]);
  const searchSuggestions = [...new Set(suggestionValues
    .map(value => String(value || '').trim())
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'ja'))
    .slice(0, 24);

  const suggestionHTML = searchSuggestions.map(tag => {
    const isSelected = query.includes(tag.toLocaleLowerCase());
    return `<button type="button" class="log-search-tag${isSelected ? ' is-selected' : ''}" data-search-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`;
  }).join('');

  const sortKey = state.logSortKey === 'count' ? 'count' : 'date';
  const sortDirection = state.logSortDirection === 'asc' ? 'asc' : 'desc';
  const sortArrow = sortDirection === 'asc' ? '↑' : '↓';
  const sortControlsHTML = `
    <div class="log-sort-controls" aria-label="酒ログの並び替え">
      <span class="log-sort-label"><span aria-hidden="true">⇅</span> 並び替え</span>
      <button type="button" class="log-sort-button${sortKey === 'count' ? ' is-selected' : ''}" data-log-sort="count">呑んだ回数${sortKey === 'count' ? ` ${sortArrow}` : ''}</button>
      <button type="button" class="log-sort-button${sortKey === 'date' ? ' is-selected' : ''}" data-log-sort="date">呑んだ日${sortKey === 'date' ? ` ${sortArrow}` : ''}</button>
    </div>
  `;

  const escapedQuery = (state.logSearchQuery || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  
  const listHeaderHTML = `
    <div class="dashboard-list-header">
      <div class="dashboard-header">
        <h2>酒ログ一覧</h2>
      </div>
      <div class="log-search-bar">
        <span class="log-search-icon" aria-hidden="true">⌕</span>
        <input type="search" id="log-search-input" value="${escapedQuery}" placeholder="銘柄・酒蔵・メモ・期間(YYYY-MM-DD～YYYY-MM-DD)" autocomplete="off" aria-label="酒ログを検索">
      </div>
      ${suggestionHTML ? `<div class="log-search-suggestions" aria-label="検索タグ"><span class="log-suggestion-label">候補</span>${suggestionHTML}</div>` : ''}
      ${sortControlsHTML}
    </div>
  `;

  if (!filteredLogs || filteredLogs.length === 0) {
    return `
      <div class="dashboard-container">
        ${listHeaderHTML}
        <div class="empty-state" style="padding: 40px 20px; text-align: center;">
          <p style="color: var(--text-sub); margin-bottom: 16px;">${query ? '検索条件に一致する酒ログがありません。' : '登録されたお酒の記録がありません。'}</p>
          <button class="btn-primary" data-action="open-editor">最初の酒ログを登録する</button>
        </div>
      </div>
    `;
  }

  // 1. カテゴリ別にグループ化
  const categoryGroups = {};
  filteredLogs.forEach(log => {
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

    const brandNames = Object.keys(brandMap).sort((a, b) => {
      const aLogs = brandMap[a];
      const bLogs = brandMap[b];
      const aValue = sortKey === 'count' ? aLogs.length : Math.max(...aLogs.map(log => Date.parse(log.date || '') || 0));
      const bValue = sortKey === 'count' ? bLogs.length : Math.max(...bLogs.map(log => Date.parse(log.date || '') || 0));
      const difference = aValue - bValue;
      return sortDirection === 'asc' ? difference : -difference;
    });

    const brandsHTML = brandNames.map(brandName => {
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
            ${renderSyncDot(log.updatedAt, '酒ログ', !Array.isArray(log.imageIds) || log.imageIds.length === (log.imageUrls || []).length)}
            
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
      ${listHeaderHTML}
      <div class="categories-wrapper">
        ${categoriesHTML}
      </div>
    </div>
  `;
}
