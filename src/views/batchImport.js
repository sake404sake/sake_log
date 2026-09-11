// src/views/batchImport.js
import { state } from '../store/state.js';
import { compressImage, groupImagesByTime, extractPhotoDateObject } from '../utils/image.js';

export function renderBatchImportView() {
  return `
    <div class="batch-import-container">
      <div class="settings-card">
        <div class="card-title card-title-bulk">
          <span style="font-size: 1.25rem;">📦</span>
          <h3>一括画像解析（複数ボトルを自動認識）</h3>
        </div>
        <p class="card-desc bulk-desc">
          複数のボトル写真を一度にアップロードできます。撮影時間からお酒を自動でグルーピングし、一括で解析・登録が完了します。
        </p>

        <!-- アップロードゾーン -->
        <div class="image-upload-zone" id="batch-upload-zone" style="height: 180px;">
          <div class="upload-placeholder">
            <span class="upload-icon">📁</span>
            <p class="upload-text">ここに複数の写真ファイルをドロップ、またはタップして選択<br><small style="color:var(--text-sub)">(撮影日時・順序自動解析)</small></p>
          </div>
        </div>
        <input type="file" id="batch-file-input" style="display: none;" multiple accept="image/*" />
      </div>

      <!-- プレビューと未保存グルーピングUI -->
      <div id="batch-preview-section" style="margin-top: 24px; display: none;"></div>
    </div>
  `;
}

export function renderBatchGroupsUI() {
  const previewSection = document.getElementById('batch-preview-section');
  if (!previewSection) return;

  const uploadZone = document.getElementById('batch-upload-zone');
  if (uploadZone) {
    uploadZone.innerHTML = `
      <div style="padding: 30px; text-align: center; border: 2px dashed var(--border-color); border-radius: 12px; cursor: pointer; background: var(--card-bg);">
        <div style="font-size: 1.8rem; margin-bottom: 6px;">📁</div>
        <div style="font-weight: bold; color: var(--text-main); font-size: 0.9rem;">さらに写真を追加する</div>
      </div>`;
  }

  const hasItems = state.batchGroups.length > 0 || state.ungroupedImages.length > 0;
  if (!hasItems) {
    previewSection.style.display = 'none';
    return;
  }
  previewSection.style.display = 'block';

  let ungroupedHTML = '';
  if (state.ungroupedImages.length > 0) {
    const thumbs = state.isPoolCollapsed ? '' : `
      <div style="display: flex; gap: 10px; flex-wrap: wrap; min-height: 40px; margin-top: 10px;" class="thumbs-scroll-container">
        ${state.ungroupedImages.map((item, idx) => `
          <div class="draggable-thumb" draggable="true" data-source-type="pool" data-idx="${idx}"
               style="position:relative; width:90px; height:90px; border-radius:8px; overflow:visible; border:1px solid var(--border-color); box-shadow: none; box-sizing: border-box; touch-action: none;">
            <img src="${item.previewUrl || ''}" data-action="enlarge-image" data-context-type="pool" data-pool-idx="${idx}" style="width:100%; height:100%; object-fit:cover; cursor:pointer;" />
            <button type="button" class="btn-ungrouped-remove" data-idx="${idx}" title="削除"
                    style="position:absolute; top:2px; right:2px; background:rgba(0,0,0,0.7); color:#fff; border:none; border-radius:50%; width:22px; height:22px; font-size:12px; cursor:pointer; z-index:10;">✕</button>
          </div>
        `).join('')}
      </div>
    `;

    ungroupedHTML = `
      <div id="ungrouped-pool-container" style="position: fixed; bottom: 16px; left: 16px; right: 80px; max-width: 720px; margin: 0 auto; z-index: 100; background: var(--card-bg); border: 2px dashed var(--accent-color); border-radius: 12px; padding: 14px 16px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); backdrop-filter: blur(10px);">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <button type="button" id="btn-toggle-pool-collapse" class="btn-secondary" style="font-size: 0.75rem; padding: 2px 6px;">${state.isPoolCollapsed ? '▶ 展開' : '▼ 畳む'}</button>
            <span style="font-weight: bold; color: var(--text-main); font-size: 0.9rem;">📂 未所属の画像プール (${state.ungroupedImages.length}枚)</span>
          </div>
          <button type="button" id="btn-create-group-from-ungrouped" class="btn-secondary" style="font-size: 0.75rem; padding: 4px 8px;">✨ これらからグループを作成</button>
        </div>
        ${thumbs}
      </div>
    `;
  } else {
    ungroupedHTML = `<div id="ungrouped-pool-container" style="display:none;"></div>`;
  }

  const groupsHTML = state.batchGroups.map((group, gIdx) => {
    const mainImg = group[0];
    const dateStr = mainImg && mainImg.date ? new Date(mainImg.date).toLocaleString() : '日時不明';

    const thumbsHTML = group.map((item, iIdx) => `
      <div class="draggable-thumb" draggable="true" data-source-type="group" data-gidx="${gIdx}" data-iidx="${iIdx}"
           style="position:relative; width:90px; height:90px; border-radius:8px; overflow:visible; border: ${iIdx === 0 ? '3px solid var(--accent-color)' : '1px solid var(--border-color)'}; box-shadow: ${iIdx === 0 ? '0 0 10px rgba(var(--accent-color-rgb, 16, 185, 129), 0.3)' : 'none'}; box-sizing: border-box; touch-action: none;">
        <img src="${item.previewUrl || ''}" data-action="enlarge-image" data-context-type="batch-group" data-gidx="${gIdx}" data-iidx="${iIdx}" style="width:100%; height:100%; object-fit:cover; cursor:pointer;" />
        ${iIdx === 0 ? '<span style="position:absolute; bottom:2px; left:2px; background:rgba(16,185,129,0.85); color:#fff; font-size:9px; padding:1px 4px; border-radius:3px; font-weight:bold; z-index:5;">★メイン</span>' : ''}
        <button type="button" class="btn-batch-remove-img" data-gidx="${gIdx}" data-iidx="${iIdx}" title="この写真をグループから外す"
                style="position:absolute; top:2px; right:2px; background:rgba(0,0,0,0.7); color:#fff; border:none; border-radius:50%; width:22px; height:22px; font-size:12px; cursor:pointer; z-index:10;">✕</button>
      </div>
    `).join('');

    return `
      <div class="batch-group-card" style="background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 14px; transition: border-color 0.2s; margin-bottom: 12px; box-sizing: border-box;" data-gidx="${gIdx}">
        <div class="batch-group-card-header" style="display: flex; flex-direction: column; align-items: flex-start; gap: 8px; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid var(--border-color); width: 100%; box-sizing: border-box;">
          <div style="width: 100%; display: flex; flex-direction: column; gap: 4px;">
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
              <span style="font-weight: bold; color: var(--accent-color); font-size: 0.95rem;">🍶 未保存お酒グループ #${gIdx + 1}</span>
              <span style="font-size: 0.75rem; color: var(--text-sub);">(${group.length}枚)</span>
            </div>
            <div style="font-size: 0.75rem; color: var(--text-sub); display: flex; align-items: center; gap: 4px; margin-top: 2px;">
              <span>📅 撮影日時:</span>
              <span style="color: var(--text-main); font-weight: 500;">${dateStr}</span>
            </div>
          </div>
          
          <div class="batch-group-btn-container" style="display: flex; gap: 6px; width: 100%; justify-content: space-between; margin-top: 4px; box-sizing: border-box;">
            <button type="button" class="btn-secondary btn-batch-open-editor" data-gidx="${gIdx}" style="flex: 1; font-size: 0.72rem; padding: 6px 2px; font-weight: bold; justify-content: center; display: inline-flex; align-items: center; min-width: 0;">✏️ 詳細編集</button>
            <button type="button" class="btn-secondary btn-batch-analyze" data-gidx="${gIdx}" style="flex: 1; font-size: 0.72rem; padding: 6px 2px; font-weight: bold; justify-content: center; display: inline-flex; align-items: center; min-width: 0;">🤖 AI解析</button>
            <button type="button" class="btn-secondary btn-batch-split" data-gidx="${gIdx}" style="flex: 1; font-size: 0.72rem; padding: 6px 2px; font-weight: bold; justify-content: center; display: inline-flex; align-items: center; min-width: 0;" title="分割">✂️ 分割</button>
            <button type="button" class="btn-secondary btn-batch-delete-group" data-gidx="${gIdx}" style="flex: 1; font-size: 0.72rem; padding: 6px 2px; font-weight: bold; justify-content: center; display: inline-flex; align-items: center; color: #ef4444; border-color: #ef4444; min-width: 0;" title="グループごと削除">🗑️ 削除</button>
          </div>
        </div>

        <div style="font-size: 0.75rem; color: var(--text-sub); margin-bottom: 6px;">💡 写真をタップすると拡大操作メニューが開きます。ドラッグ＆ドロップでも並び替えできます。</div>
        <div class="thumbs-scroll-container" style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; min-height: 50px;">
          ${thumbsHTML}
        </div>

        <div class="form-row" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <input type="text" class="input-dark batch-name-input" data-gidx="${gIdx}" value="${group.name || ''}" placeholder="銘柄名 (例: 寫樂)" style="font-size: 0.85rem;" />
          <input type="text" class="input-dark batch-brewery-input" data-gidx="${gIdx}" value="${group.brewery || ''}" placeholder="酒蔵・メーカー" style="font-size: 0.85rem;" />
        </div>
      </div>
    `;
  }).join('');

  previewSection.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: flex-start; margin-bottom: 16px; gap: 12px; width: 100%; box-sizing: border-box;">
      <h3 id="batch-group-count-title" style="margin: 0; font-size: 1.1rem; font-weight: bold; color: var(--text-main); line-height: 1.4;">✨ 未保存の酒ログアイテム (${state.batchGroups.length} 件)</h3>
      <div style="display: flex; gap: 8px; width: 100%; box-sizing: border-box; flex-wrap: wrap;">
        <button type="button" id="btn-add-more-batch" class="btn-secondary" style="flex: 1; font-size: 0.85rem; padding: 10px 16px; font-weight: bold; justify-content: center; display: inline-flex; align-items: center; min-width: 140px; box-sizing: border-box;">➕ 写真を追加する</button>
        ${state.batchGroups.length > 0 ? `<button type="button" id="btn-save-all-batches" class="btn-primary" style="flex: 1.5; background: #10b981; color: #fff; border: none; padding: 10px 16px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 0.85rem; justify-content: center; display: inline-flex; align-items: center; min-width: 180px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.25); box-sizing: border-box;">🚀 すべてまとめて登録する</button>` : ''}
      </div>
    </div>
    <div id="batch-groups-container" style="display: flex; flex-direction: column; gap: 16px; padding-bottom: ${state.ungroupedImages.length > 0 ? '120px' : '20px'};">
      ${groupsHTML}
    </div>
    ${ungroupedHTML}
  `;
}

/**
 * 🌟【完全修復・並列高速処理版】一括画像投入・自動グルーピング処理
 */
export async function processFilesForBatch(files, append = true) {
  if (!files || files.length === 0) return;

  const batchUploadZone = document.getElementById('batch-upload-zone');
  if (batchUploadZone) {
    batchUploadZone.innerHTML = `
      <div style="padding: 40px; text-align: center; color: var(--text-main);">
        <div class="sella-spinner" style="width: 32px; height: 32px; border-width: 4px; margin-bottom: 12px; border-top-color: var(--accent-color);"></div>
        <div style="font-weight: bold; font-size: 1.1rem;">写真を解析・グルーピング中...</div>
        <div style="font-size: 0.85rem; color: var(--text-sub); margin-top: 4px;">(${files.length}枚の画像を処理しています)</div>
      </div>`;
  }

  const items = [];
  const failedFiles = [];

  const imageFiles = Array.from(files).filter(file => {
    return (file.type && file.type.startsWith('image/')) ||
           /\.(heic|heif|png|jpe?g|webp|gif)$/i.test(file.name || '');
  });

  if (imageFiles.length === 0) {
    alert('有効な画像ファイルが見つかりませんでした。');
    renderBatchGroupsUI();
    return;
  }

  // 🌟 Promise.all により全画像を並列超高速処理（ハング防止タイムアウト・フォールバック適用）
  const processPromises = imageFiles.map(async (file) => {
    try {
      const [compressed, date] = await Promise.all([
        compressImage(file),
        extractPhotoDateObject(file)
      ]);

      const blob = compressed.blob || file;
      const previewUrl = URL.createObjectURL(blob);

      return {
        file,
        date: (date && !isNaN(date.getTime())) ? date : (file.lastModified ? new Date(file.lastModified) : null),
        blob,
        base64: compressed.base64 || '',
        mimeType: compressed.mimeType || file.type || 'image/jpeg',
        previewUrl
      };
    } catch (e) {
      console.error(`ファイル ${file.name} の処理に失敗しました:`, e);
      failedFiles.push(file.name);
      return null;
    }
  });

  try {
    const results = await Promise.all(processPromises);
    for (const item of results) {
      if (item) items.push(item);
    }

    if (items.length > 0) {
      const cleansedItems = items.map(item => ({
        ...item,
        date: (item.date && !isNaN(item.date.getTime())) ? item.date : null
      }));

      const newGroups = groupImagesByTime(cleansedItems, 3 * 60 * 1000, 5);
      if (append) {
        state.batchGroups = state.batchGroups.concat(newGroups);
      } else {
        state.batchGroups = newGroups;
      }

      if (failedFiles.length > 0) {
        alert(`一部の画像（${failedFiles.length}枚）の読み込みに失敗しました。：\n\n・ ` + failedFiles.join('\n・ '));
      }
    } else {
      alert('画像の読み込みに失敗しました。対応していない形式の可能性があります。');
    }
  } catch (err) {
    console.error('Batch Grouping Error:', err);
    alert('画像の自動グルーピング処理中に予期せぬエラーが発生しました。');
  } finally {
    renderBatchGroupsUI();
    document.dispatchEvent(new CustomEvent('batch-state-modified'));
  }
}
