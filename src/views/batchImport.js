// src/views/batchImport.js
import { state, renderSyncDot } from '../store/state.js';
import { compressImage, groupImagesByTime, extractPhotoDateObject } from '../utils/image.js';

const GROUPS_PER_PAGE = 40;
const POOL_IMAGES_PER_PAGE = 80;
let visibleGroupCount = GROUPS_PER_PAGE;
let visiblePoolImageCount = POOL_IMAGES_PER_PAGE;
let cancelBatchRequested = false;
const escapeHtml = value => String(value || '').replace(/[&<>"']/g, char => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[char]));

function setBatchProgress(phase, completed, total, message = '') {
  state.batchProgress = { phase, completed, total, message };
  const container = document.getElementById('batch-progress-container');
  const status = document.getElementById('batch-progress-status');
  const bar = document.getElementById('batch-progress-bar');
  const details = document.getElementById('batch-progress-details');
  const cancelButton = document.getElementById('btn-cancel-batch-import');
  if (cancelButton) cancelButton.style.display = state.isBatchProcessing ? 'inline-flex' : 'none';
  if (!container || !status || !bar || !details) return;

  container.style.display = 'block';
  status.textContent = message || `${phase} (${completed.toLocaleString()} / ${total.toLocaleString()}枚)`;
  details.textContent = `${total ? Math.floor(completed / total * 100) : 0}%`;
  bar.style.width = `${total ? Math.min(100, completed / total * 100) : 0}%`;
}

export function cancelBatchImport() {
  if (!state.isBatchProcessing) return;
  cancelBatchRequested = true;
  const button = document.getElementById('btn-cancel-batch-import');
  if (button) {
    button.disabled = true;
    button.textContent = '中断処理中…';
  }
}

export function showMoreBatchGroups() {
  visibleGroupCount += GROUPS_PER_PAGE;
  renderBatchGroupsUI();
}

export function showMorePoolImages() {
  visiblePoolImageCount += POOL_IMAGES_PER_PAGE;
  renderBatchGroupsUI();
}

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
  const progress = state.batchProgress;
  const progressPercent = progress?.total ? Math.min(100, Math.floor(progress.completed / progress.total * 100)) : 0;
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
        <p id="batch-draft-save-error" role="alert" style="display:${state.batchDraftSaveError ? 'block' : 'none'}; color:#ef4444; margin:10px 0 0;">${escapeHtml(state.batchDraftSaveError)}</p>
        <div id="batch-progress-container" style="display:${progress ? 'block' : 'none'}; margin-top:12px; padding:12px; border:1px solid var(--border-color); border-radius:10px; background:var(--card-bg);">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
            <strong id="batch-progress-status">${progress?.message || (progress ? `${progress.phase} (${progress.completed.toLocaleString()} / ${progress.total.toLocaleString()}枚)` : '画像を準備中...')}</strong>
            <span id="batch-progress-details">${progressPercent}%</span>
          </div>
          <div style="height:6px; margin-top:10px; overflow:hidden; border-radius:4px; background:var(--border-color);">
            <div id="batch-progress-bar" style="height:100%; width:${progressPercent}%; background:var(--accent-color); transition:width 0.15s ease;"></div>
          </div>
          <button type="button" id="btn-cancel-batch-import" class="btn-secondary" style="display:${state.isBatchProcessing ? 'inline-flex' : 'none'}; margin-top:10px;">取り込みを中断</button>
        </div>
      </div>

      <!-- プレビューと未保存グルーピングUI -->
      <div id="batch-preview-section" style="margin-top: 24px; display: none;"></div>
    </div>
  `;
}

export function renderBatchGroupsUI() {
  const previewSection = document.getElementById('batch-preview-section');
  if (!previewSection) return;
  visibleGroupCount = Math.max(GROUPS_PER_PAGE, Math.min(visibleGroupCount, state.batchGroups.length || GROUPS_PER_PAGE));
  visiblePoolImageCount = Math.max(POOL_IMAGES_PER_PAGE, Math.min(visiblePoolImageCount, state.ungroupedImages.length || POOL_IMAGES_PER_PAGE));

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
        ${state.ungroupedImages.slice(0, visiblePoolImageCount).map((item, idx) => {
          const imgSrc = getSafeImgSrc(item);
          return `
          <div class="draggable-thumb" draggable="true" data-source-type="pool" data-idx="${idx}"
               style="position:relative; width:90px; height:90px; border-radius:8px; overflow:visible; border:1px solid var(--border-color); box-shadow: none; box-sizing: border-box; touch-action: none;">
            <img src="${imgSrc}" draggable="false" data-action="enlarge-image" data-context-type="pool" data-pool-idx="${idx}" style="width:100%; height:100%; object-fit:cover; cursor:pointer;" />
            <button type="button" class="btn-ungrouped-remove" data-idx="${idx}" title="削除"
                    style="position:absolute; top:2px; right:2px; background:rgba(0,0,0,0.7); color:#fff; border:none; border-radius:50%; width:22px; height:22px; font-size:12px; cursor:pointer; z-index:10;">✕</button>
          </div>
        `;
        }).join('')}
      </div>
      ${state.ungroupedImages.length > visiblePoolImageCount ? `<button type="button" id="btn-load-more-pool" class="btn-secondary" style="margin-top:10px;">プールの画像をさらに表示（${Math.min(POOL_IMAGES_PER_PAGE, state.ungroupedImages.length - visiblePoolImageCount)}枚 / 残り${state.ungroupedImages.length - visiblePoolImageCount}枚）</button>` : ''}
    `;

    ungroupedHTML = `
      <div id="ungrouped-pool-container" style="position: sticky; bottom: 16px; width: 100%; max-width: 720px; margin: 0 auto; z-index: 100; background: var(--card-bg); border: 2px dashed var(--accent-color); border-radius: 12px; padding: 12px 14px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); backdrop-filter: blur(10px); box-sizing: border-box;">
        ${renderSyncDot(state.batchLocalUpdatedAt, '未所属画像', state.ungroupedImages.every(item => item.blob instanceof Blob || item.previewUrl), 'system_image_pool')}
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

  const groupsHTML = state.batchGroups.slice(0, visibleGroupCount).map((group, gIdx) => {
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
        <img src="${imgSrc}" draggable="false" data-action="enlarge-image" data-context-type="batch-group" data-gidx="${gIdx}" data-iidx="${iIdx}" style="width:100%; height:100%; object-fit:cover; cursor:pointer;" />
        ${iIdx === 0 ? '<span style="position:absolute; bottom:2px; left:2px; background:rgba(16,185,129,0.85); color:#fff; font-size:9px; padding:1px 4px; border-radius:3px; font-weight:bold; z-index:5;">★メイン</span>' : ''}
        <button type="button" class="btn-batch-remove-img" data-gidx="${gIdx}" data-iidx="${iIdx}" title="この写真をグループから外す"
                style="position:absolute; top:2px; right:2px; background:rgba(0,0,0,0.7); color:#fff; border:none; border-radius:50%; width:22px; height:22px; font-size:12px; cursor:pointer; z-index:10;">✕</button>
      </div>
    `;
    }).join('');

    return `
      <div class="batch-group-card" style="background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 14px; transition: border-color 0.2s; margin-bottom: 12px; box-sizing: border-box;" data-gidx="${gIdx}">
        ${renderSyncDot(group._updatedAt || state.batchLocalUpdatedAt, '未保存グループ', group.every(item => item.blob instanceof Blob || item.previewUrl), `draft_group_${gIdx}`)}
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
        <button type="button" id="btn-add-more-batch" class="btn-secondary batch-add-button" style="flex: 1; font-size: 0.85rem; padding: 10px 16px; font-weight: bold; justify-content: center; display: inline-flex; align-items: center; min-width: 140px; box-sizing: border-box;"><span class="batch-add-icon" aria-hidden="true">＋</span><span>写真を追加する</span></button>
        ${state.batchGroups.length > 0 ? `<button type="button" id="btn-save-all-batches" class="btn-primary" style="flex: 1.5; background: #10b981; color: #fff; border: none; padding: 10px 16px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 0.85rem; justify-content: center; display: inline-flex; align-items: center; min-width: 180px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.25); box-sizing: border-box;">🚀 すべてまとめて登録する</button>` : ''}
      </div>
    </div>
    <div id="batch-groups-container" style="display: flex; flex-direction: column; gap: 16px; padding-bottom: ${state.ungroupedImages.length > 0 ? '120px' : '20px'};">
      ${groupsHTML}
    </div>
    ${state.batchGroups.length > visibleGroupCount ? `<div style="display:flex; justify-content:center; padding:12px;"><button type="button" id="btn-load-more-batch-groups" class="btn-secondary">さらに${Math.min(GROUPS_PER_PAGE, state.batchGroups.length - visibleGroupCount)}グループを表示（残り${state.batchGroups.length - visibleGroupCount}件）</button></div>` : ''}
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
  if (state.isBatchProcessing) {
    alert('別の一括取り込みを処理中です。完了または中断後にお試しください。');
    return;
  }

  const imageFiles = Array.from(files).filter(file =>
    (file.type && file.type.startsWith('image/')) ||
    /\.(heic|heif|png|jpe?g|webp|gif)$/i.test(file.name || '')
  );
  if (imageFiles.length === 0) {
    alert('有効な画像ファイルが見つかりませんでした。');
    return;
  }

  state.isBatchProcessing = true;
  cancelBatchRequested = false;
  const failedMetadataFiles = [];
  const failedCompressionFiles = [];
  const yieldToBrowser = () => new Promise(resolve => setTimeout(resolve, 0));
  const persistCheckpoint = () => new Promise((resolve, reject) => {
    document.dispatchEvent(new CustomEvent('batch-state-modified', { detail: { resolve, reject } }));
  });

  try {
    const results = new Array(imageFiles.length);
    let nextFileIndex = 0;
    let processedCount = 0;
    const metadataWorkerCount = Math.min(4, imageFiles.length);
    setBatchProgress('撮影情報を読み取り中', 0, imageFiles.length);

    await Promise.all(Array.from({ length: metadataWorkerCount }, async () => {
      while (!cancelBatchRequested && nextFileIndex < imageFiles.length) {
        const fileIndex = nextFileIndex++;
        const file = imageFiles[fileIndex];
        try {
          const date = await extractPhotoDateObject(file);
          const capturedDate = date && !isNaN(date.getTime())
            ? date
            : (file.lastModified ? new Date(file.lastModified) : null);
          results[fileIndex] = {
            file,
            date: capturedDate,
            blob: file,
            base64: '',
            mimeType: file.type || 'image/jpeg',
            contentRevision: `${Date.now()}-${Math.random()}`,
            metadata: {
              originalFileName: file.name || '',
              originalMimeType: file.type || '',
              originalLastModified: file.lastModified || 0,
              capturedAt: capturedDate ? capturedDate.toISOString() : null,
              capturedAtSource: date && !isNaN(date.getTime()) ? 'exif-or-file-date' : 'file-date'
            }
          };
        } catch (error) {
          console.error(`ファイル ${file.name} の処理に失敗しました:`, error);
          failedMetadataFiles.push(file.name || '名称未設定の画像');
        }
        processedCount += 1;
        if (processedCount % 10 === 0 || processedCount === imageFiles.length) {
          setBatchProgress('撮影情報を読み取り中', processedCount, imageFiles.length);
          await yieldToBrowser();
        }
      }
    }));

    const items = results.filter(Boolean);
    if (items.length > 0) {
      const groupStartIndex = append ? state.batchGroups.length : 0;
      const newGroups = groupImagesByTime(items, 3 * 60 * 1000, 5);
      if (append) {
        state.batchGroups = state.batchGroups.concat(newGroups);
      } else {
        state.batchGroups = newGroups;
      }
      visibleGroupCount = Math.max(visibleGroupCount, GROUPS_PER_PAGE);
      renderBatchGroupsUI();

      // Preserve the original blobs first so cancellation or reload cannot lose imported photos.
      await persistCheckpoint();

      const compressibleItems = newGroups.flatMap((group, groupIndex) =>
        group.map((item, itemIndex) => ({
          item,
          groupIndex: groupStartIndex + groupIndex,
          itemIndex
        }))
      );
      let compressedCount = 0;
      let nextCompressIndex = 0;
      const deviceMemory = typeof navigator !== 'undefined' ? navigator.deviceMemory : null;
      const compressionConcurrency = deviceMemory && deviceMemory <= 2
        ? 1
        : deviceMemory && deviceMemory <= 4 ? 2 : 4;
      const compressionWorkerCount = Math.min(compressionConcurrency, compressibleItems.length);
      setBatchProgress('画像を軽量化中', 0, compressibleItems.length);

      await Promise.all(Array.from({ length: compressionWorkerCount }, async () => {
        while (!cancelBatchRequested && nextCompressIndex < compressibleItems.length) {
          const task = compressibleItems[nextCompressIndex++];
          const { item } = task;
          const originalFile = item.file;
          try {
            const compressed = await compressImage(originalFile);
            const blobChanged = compressed.blob !== item.blob;
            item.blob = compressed.blob || item.blob;
            item.base64 = '';
            item.mimeType = compressed.mimeType || item.mimeType;
            item.metadata = { ...item.metadata, ...(compressed.metadata || {}) };
            if (blobChanged) item.contentRevision = `${Date.now()}-${Math.random()}`;
            item.file = null;
            if (blobChanged) {
              const imageElement = document.querySelector(
                `img[data-context-type="batch-group"][data-gidx="${task.groupIndex}"][data-iidx="${task.itemIndex}"]`
              );
              if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
              item.previewUrl = imageElement ? URL.createObjectURL(item.blob) : '';
              if (imageElement) imageElement.src = item.previewUrl;
            }
          } catch (error) {
            console.error(`[BatchImport] Image compression failed for ${originalFile?.name || 'image'}:`, error);
            failedCompressionFiles.push(originalFile?.name || '名称未設定の画像');
          }
          compressedCount += 1;
          if (compressedCount % 10 === 0 || compressedCount === compressibleItems.length) {
            setBatchProgress('画像を軽量化中', compressedCount, compressibleItems.length);
            await yieldToBrowser();
          }
        }
      }));

      if (failedMetadataFiles.length > 0 || failedCompressionFiles.length > 0) {
        const failures = [
          ...failedMetadataFiles.map(name => `読み込み失敗: ${name}`),
          ...failedCompressionFiles.map(name => `軽量化失敗（元画像を保持）: ${name}`)
        ];
        alert(`一部の画像を処理できませんでした。\n\n・${failures.join('\n・')}`);
      }
    } else if (failedMetadataFiles.length > 0) {
      alert(`画像の読み込みに失敗しました。対応していない形式の可能性があります。\n\n・${failedMetadataFiles.join('\n・')}`);
    }

    const wasCancelled = cancelBatchRequested;
    const lastProgress = state.batchProgress;
    setBatchProgress(
      wasCancelled ? '取り込みを中断しました' : '取り込み完了',
      wasCancelled ? (lastProgress?.completed ?? processedCount) : imageFiles.length,
      wasCancelled ? (lastProgress?.total ?? imageFiles.length) : imageFiles.length,
      wasCancelled
        ? `中断しました。処理済みの画像 ${items.length.toLocaleString()}枚を保存します。`
        : `取り込み完了。${items.length.toLocaleString()}枚を保存しました。`
    );
    const cancelButton = document.getElementById('btn-cancel-batch-import');
    if (cancelButton) cancelButton.style.display = 'none';
  } catch (error) {
    console.error('Batch Grouping Error:', error);
    setBatchProgress('取り込みエラー', 0, imageFiles.length, '取り込み中にエラーが発生しました。');
    alert(`一括取り込みを保存できませんでした: ${error.message}`);
  } finally {
    state.isBatchProcessing = false;
    const cancelButton = document.getElementById('btn-cancel-batch-import');
    if (cancelButton) {
      cancelButton.style.display = 'none';
      cancelButton.disabled = false;
      cancelButton.textContent = '取り込みを中断';
    }
    renderBatchGroupsUI();
    try {
      await persistCheckpoint();
    } catch (error) {
      console.error('[BatchImport] Final draft checkpoint failed:', error);
      setBatchProgress('保存エラー', 0, imageFiles.length, `下書きの保存に失敗しました: ${error.message}`);
      alert(`取り込み画像の下書きを保存できませんでした: ${error.message}`);
    }
  }
}
