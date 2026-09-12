// src/views/batchImport.js
import { state, renderSyncDot } from '../store/state.js';
import { compressImage, groupImagesByTime, extractPhotoDateObject } from '../utils/image.js';

/**
 * 🌟 安全画像URL取得ヘルパー (1枚目も2枚目以降も100%描画保証)
 */
function getSafeImgSrc(item) {
  if (!item) return '';
  if (item.previewUrl) return item.previewUrl;
  if (item.base64) {
    const mime = item.mimeType || 'image/jpeg';
    return `data:${mime};base64,${item.base64}`;
  }
  if (item.blob) {
    try {
      const url = URL.createObjectURL(item.blob);
      item.previewUrl = url;
      return url;
    } catch (e) {}
  }
  if (item.file instanceof Blob) {
    item.previewUrl = URL.createObjectURL(item.file);
    return item.previewUrl;
  }
  return '';
}

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
        ${state.ungroupedImages.map((item, idx) => {
          const imgSrc = getSafeImgSrc(item);
          return `
          <div class="draggable-thumb" draggable="true" data-source-type="pool" data-idx="${idx}"
               style="position:relative; width:90px; height:90px; border-radius:8px; overflow:visible; border:1px solid var(--border-color); box-shadow: none; box-sizing: border-box; touch-action: none;">
            <img src="${imgSrc}" data-action="enlarge-image" data-context-type="pool" data-pool-idx="${idx}" style="width:100%; height:100%; object-fit:cover; cursor:pointer;" />
            <button type="button" class="btn-ungrouped-remove" data-idx="${idx}" title="削除"
                    style="position:absolute; top:2px; right:2px; background:rgba(0,0,0,0.7); color:#fff; border:none; border-radius:50%; width:22px; height:22px; font-size:12px; cursor:pointer; z-index:10;">✕</button>
          </div>
        `;
        }).join('')}
      </div>
    `;

    ungroupedHTML = `
      <div id="ungrouped-pool-container" style="position: sticky; bottom: 16px; width: 100%; max-width: 720px; margin: 0 auto; z-index: 100; background: var(--card-bg); border: 2px dashed var(--accent-color); border-radius: 12px; padding: 12px 14px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); backdrop-filter: blur(10px); box-sizing: border-box;">
        ${renderSyncDot(state.batchLocalUpdatedAt, '未所属画像', state.ungroupedImages.every(item => item.blob instanceof Blob || item.previewUrl))}
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
            <button type="button" id="btn-toggle-pool-collapse" class="btn-secondary" style="font-size: 0.75rem; padding: 2px 6px; flex-shrink: 0;">${state.isPoolCollapsed ? '▶ 展開' : '▼ 畳む'}</button>
            <span style="font-weight: bold; color: var(--text-main); font-size: 0.88rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">📂 未所属プール (${state.ungroupedImages.length}枚)</span>
          </div>
          <button type="button" id="btn-create-group-from-ungrouped" class="btn-secondary" style="font-size: 0.75rem; padding: 4px 8px; white-space: nowrap; margin-left: auto;">✨ これらからグループを作成</button>
        </div>
        ${thumbs}
      </div>
    `;
  } else {
    ungroupedHTML = `<div id="ungrouped-pool-container" style="display:none;"></div>`;
  }

  const groupsHTML = state.batchGroups.map((group, gIdx) => {
    const mainImg = group[0];
    let dateStr = '日時不明';
    if (mainImg && mainImg.date) {
      const d = (mainImg.date instanceof Date) ? mainImg.date : new Date(mainImg.date);
      if (!isNaN(d.getTime())) {
        dateStr = d.toLocaleString();
      }
    }

    const thumbsHTML = group.map((item, iIdx) => {
      const imgSrc = getSafeImgSrc(item);
      return `
      <div class="draggable-thumb" draggable="true" data-source-type="group" data-gidx="${gIdx}" data-iidx="${iIdx}"
         style="position:relative; width:90px; height:90px; border-radius:8px; overflow:visible; border: ${iIdx === 0 ? '3px solid var(--accent-color)' : '2px solid color-mix(in srgb, var(--accent-color) 45%, var(--border-color))'}; box-shadow: ${iIdx === 0 ? '0 0 10px rgba(var(--accent-color-rgb, 16, 185, 129), 0.3)' : '0 0 5px color-mix(in srgb, var(--accent-color) 18%, transparent)'}; box-sizing: border-box; touch-action: none;">
        <img src="${imgSrc}" data-action="enlarge-image" data-context-type="batch-group" data-gidx="${gIdx}" data-iidx="${iIdx}" style="width:100%; height:100%; object-fit:cover; cursor:pointer;" />
        ${iIdx === 0 ? '<span style="position:absolute; bottom:2px; left:2px; background:rgba(16,185,129,0.85); color:#fff; font-size:9px; padding:1px 4px; border-radius:3px; font-weight:bold; z-index:5;">★メイン</span>' : ''}
        <button type="button" class="btn-batch-remove-img" data-gidx="${gIdx}" data-iidx="${iIdx}" title="この写真をグループから外す"
                style="position:absolute; top:2px; right:2px; background:rgba(0,0,0,0.7); color:#fff; border:none; border-radius:50%; width:22px; height:22px; font-size:12px; cursor:pointer; z-index:10;">✕</button>
      </div>
    `;
    }).join('');

    return `
      <div class="batch-group-card" style="background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 14px; transition: border-color 0.2s; margin-bottom: 12px; box-sizing: border-box;" data-gidx="${gIdx}">
        ${renderSyncDot(group._updatedAt || state.batchLocalUpdatedAt, '未保存グループ', group.every(item => item.blob instanceof Blob || item.previewUrl))}
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

  previewSection.querySelectorAll('img[data-context-type="pool"], img[data-context-type="batch-group"]').forEach((image) => {
    image.addEventListener('error', () => {
      const item = image.dataset.contextType === 'pool'
        ? state.ungroupedImages[Number(image.dataset.poolIdx)]
        : state.batchGroups[Number(image.dataset.gidx)]?.[Number(image.dataset.iidx)];
      if (item?.file && image.dataset.fallbackApplied !== 'true') {
        image.dataset.fallbackApplied = 'true';
        image.src = URL.createObjectURL(item.file);
      }
    });
  });
}

/**
 * 🌟【一括投入・自動グルーピング処理】
 */
export async function processFilesForBatch(files, append = true) {
  if (!files || files.length === 0) return;

  state.isBatchProcessing = true;

  const batchUploadZone = document.getElementById('batch-upload-zone');
  if (batchUploadZone) {
    batchUploadZone.innerHTML = `
      <div style="padding: 40px; text-align: center; color: var(--text-main);">
        <div class="sella-spinner" style="width: 32px; height: 32px; border-width: 4px; margin-bottom: 12px; border-top-color: var(--accent-color);"></div>
        <div class="batch-progress-status" style="font-weight: bold; font-size: 1.1rem;">撮影情報を読み取り中...</div>
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

  const readMetadata = async (file) => {
    try {
      const date = await extractPhotoDateObject(file);
      const capturedDate = date && !isNaN(date.getTime())
        ? date
        : (file.lastModified ? new Date(file.lastModified) : null);

      return {
        file,
        date: capturedDate,
        blob: file,
        base64: '',
        mimeType: file.type || 'image/jpeg',
        metadata: {
          originalFileName: file.name || '',
          originalMimeType: file.type || '',
          originalLastModified: file.lastModified || 0,
          capturedAt: capturedDate ? capturedDate.toISOString() : null,
          capturedAtSource: date && !isNaN(date.getTime()) ? 'exif-or-file-date' : 'file-date'
        },
        previewUrl: URL.createObjectURL(file)
      };
    } catch (e) {
      console.error(`ファイル ${file.name} の処理に失敗しました:`, e);
      failedFiles.push(file.name);
      return null;
    }
  };

  try {
    const results = new Array(imageFiles.length);
    let nextFileIndex = 0;
    let processedCount = 0;
    const metadataWorkerCount = Math.min(8, imageFiles.length);
    const updateProgress = () => {
      const status = batchUploadZone?.querySelector('.batch-progress-status');
      if (status) status.textContent = `撮影情報を読み取り中... (${processedCount}/${imageFiles.length}枚)`;
    };

    await Promise.all(Array.from({ length: metadataWorkerCount }, async () => {
      while (nextFileIndex < imageFiles.length) {
        const fileIndex = nextFileIndex++;
        results[fileIndex] = await readMetadata(imageFiles[fileIndex]);
        processedCount += 1;
        if (processedCount === imageFiles.length || processedCount % 10 === 0) updateProgress();
      }
    }));

    results.forEach(item => {
      if (item) items.push(item);
    });

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

      renderBatchGroupsUI();

      // 圧縮完了前でもリロードから復元できるよう、元画像をローカルへ先に退避する。
      await new Promise(resolve => {
        document.dispatchEvent(new CustomEvent('batch-state-modified', { detail: { resolve } }));
      });

      const compressibleItems = newGroups.flat();
      let compressedCount = 0;
      let nextCompressIndex = 0;
      const compressionWorkerCount = Math.min(4, compressibleItems.length);
      const updateCompressionProgress = () => {
        const status = batchUploadZone?.querySelector('.batch-progress-status');
        if (status) status.textContent = `画像を軽量化中... (${compressedCount}/${compressibleItems.length}枚)`;
      };

      await Promise.all(Array.from({ length: compressionWorkerCount }, async () => {
        while (nextCompressIndex < compressibleItems.length) {
          const item = compressibleItems[nextCompressIndex++];
          const oldPreviewUrl = item.previewUrl;
          try {
            const compressed = await compressImage(item.file);
            item.blob = compressed.blob || item.blob;
            item.base64 = '';
            item.mimeType = compressed.mimeType || item.mimeType;
            item.metadata = { ...item.metadata, ...(compressed.metadata || {}) };
            item.previewUrl = URL.createObjectURL(item.blob);
            if (oldPreviewUrl) URL.revokeObjectURL(oldPreviewUrl);
          } catch (err) {
            console.warn(`[BatchImport] Compression skipped for ${item.file?.name || 'image'}:`, err);
          }
          compressedCount += 1;
          if (compressedCount === compressibleItems.length || compressedCount % 10 === 0) updateCompressionProgress();
        }
      }));

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
    state.isBatchProcessing = false;
    renderBatchGroupsUI();
    document.dispatchEvent(new CustomEvent('batch-state-modified'));
  }
}
