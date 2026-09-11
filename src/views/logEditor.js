// src/views/logEditor.js
import { getAllTags, getLogById } from '../store/db.js';
import { getApiKey, getSavedModel, populateModelDropdown, hasApiKey, analyzeLabelImage } from '../services/gemini.js';
import { state, resetEditorState, blobToBase64, base64ToBlob } from '../store/state.js';
import { compressImage, extractPhotoDate } from '../utils/image.js';

export const TRACKED_FIELDS = [
  'sake-category',
  'sake-name',
  'sake-product',
  'sake-brewery',
  'sake-region',
  'sake-type',
  'sake-abv',
  'sake-notes',
  'sake-ai-info'
];

export async function renderLogEditorModal(logId = null) {
  const today = new Date().toISOString().split('T')[0];
  const existingTags = await getAllTags();
  const tagChipsHTML = existingTags.map(tag => `<button type="button" class="tag-chip-btn" data-tag="${tag}">+ ${tag}</button>`).join('');

  const apiKey = getApiKey();
  const savedModel = getSavedModel();
  let initialOptionHTML = '<option value="">APIキーを入力してください</option>';
  if (apiKey) {
    if (savedModel) {
      initialOptionHTML = `<option value="${savedModel}" selected>${savedModel}</option>`;
    } else {
      initialOptionHTML = '<option value="">モデルを読み込み中...</option>';
    }
  }

  return `
    <div id="modal-overlay" class="modal-overlay">
      <div class="modal-card">
        <div class="modal-header">
          <h3>${logId ? '酒ログを編集' : '新しい酒ログを登録'}</h3>
          <button type="button" class="modal-close-btn" id="btn-close-modal">&times;</button>
        </div>

        <div class="modal-body">
          <!-- 左側：画像アップロード・プレビュー領域 -->
          <div class="modal-image-col">
            <div id="image-preview-list" class="image-preview-grid"></div>

            <div class="image-upload-zone" id="upload-zone">
              <div class="upload-placeholder">
                <span class="upload-icon">📷</span>
                <p class="upload-text">タップまたはドラッグ＆ドロップで写真を追加<br><small style="color:var(--text-sub)">(複数枚選択可能)</small></p>
              </div>
            </div>
            <input type="file" id="file-input" style="display: none;" multiple accept="image/*" />
          </div>

          <!-- 右側：入力フォーム -->
          <div class="modal-form-col">
            <div class="form-row">
              <div class="form-group">
                <label for="sake-category">酒の種類 <span class="required">*</span></label>
                <select id="sake-category" class="input-dark">
                  <option value="日本酒">日本酒</option>
                  <option value="ウイスキー">ウイスキー</option>
                  <option value="ワイン">ワイン</option>
                  <option value="ビール">ビール</option>
                  <option value="焼酎">焼酎</option>
                  <option value="ジン・スピリッツ">ジン・スピリッツ</option>
                  <option value="ブランデー">ブランデー</option>
                  <option value="果実酒・梅酒">果実酒・梅酒</option>
                  <option value="その他">その他</option>
                </select>
              </div>
              <div class="form-group">
                <label for="sake-name">銘柄 <span class="required">*</span></label>
                <input type="text" id="sake-name" class="input-dark" placeholder="例: 寫樂 / 山崎" />
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label for="sake-product">商品名</label>
                <input type="text" id="sake-product" class="input-dark" placeholder="例: 酒未来 / 12年" />
              </div>
              <div class="form-group">
                <label for="sake-brewery">酒蔵・メーカー</label>
                <input type="text" id="sake-brewery" class="input-dark" placeholder="例: 宮泉銘醸 / サントリー" />
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label for="sake-region">産地</label>
                <input type="text" id="sake-region" class="input-dark" placeholder="例: 福島県 / スコットランド" />
              </div>
              <div class="form-group">
                <label for="sake-type">特定名称・格付</label>
                <input type="text" id="sake-type" class="input-dark" placeholder="例: 純米吟醸 / シングルモルト" />
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label for="sake-abv">度数 (%)</label>
                <input type="number" id="sake-abv" class="input-dark" placeholder="16" step="0.1" />
              </div>
              <div class="form-group">
                <label for="sake-date">呑んだ日 🍶</label>
                <input type="date" id="sake-date" class="input-dark" value="${today}" />
              </div>
            </div>

            <div class="form-group">
              <label for="sake-rating">評価</label>
              <select id="sake-rating" class="input-dark">
                <option value="5">⭐⭐⭐⭐⭐ 5.0</option>
                <option value="4" selected>⭐⭐⭐⭐☆ 4.0</option>
                <option value="3">⭐⭐⭐☆☆ 3.0</option>
                <option value="2">⭐⭐☆☆☆ 2.0</option>
                <option value="1">⭐☆☆☆☆ 1.0</option>
              </select>
            </div>

            <div class="form-group">
              <label for="sake-tags">タグ (スペース区切り)</label>
              <input type="text" id="sake-tags" class="input-dark" placeholder="例: フルーティー 家飲み 贈答用" />
              ${existingTags.length > 0 ? `
                <div class="tag-selector-wrapper">
                  <span class="tag-selector-label">過去のタグから選択:</span>
                  <div class="tag-chips-container">${tagChipsHTML}</div>
                </div>
              ` : ''}
            </div>

            <div class="form-group">
              <label for="sake-notes">メモ・感想（自分用）</label>
              <textarea id="sake-notes" class="input-dark" rows="2" placeholder="香りの特徴や味わい、合わせ料理など"></textarea>
            </div>

            <div class="form-group">
              <label for="sake-ai-info" style="color: var(--accent-color); font-weight: bold;">🤖 AIによる情報・補足</label>
              <textarea id="sake-ai-info" class="input-dark ai-info-input" rows="2" placeholder="AI解析結果やおすすめの飲み方"></textarea>
            </div>
          </div>
        </div>

        <!-- フッター -->
        <div class="modal-footer" style="display: flex; flex-wrap: wrap; gap: 15px; align-items: flex-end; justify-content: space-between; padding-top: 10px;">
          <div style="display: flex; flex-direction: column; gap: 8px; flex: 1; min-width: 260px;">
            <div style="display: flex; gap: 6px; align-items: center; width: 100%;">
              <select id="modal-model-select" class="input-dark model-select" title="使用するAIモデルを選択" style="flex: 1; min-width: 0; text-overflow: ellipsis; white-space: nowrap; overflow: hidden;">
                ${initialOptionHTML}
              </select>
              <button type="button" id="btn-reload-modal-models" class="btn-secondary" style="padding: 4px 12px; font-size: 1.2rem; line-height: 1; flex-shrink: 0;" title="モデルリストを更新">↺</button>
            </div>
            <button type="button" id="btn-analyze" class="btn-ai-action" style="width: fit-content;">🤖 AI解析実行</button>
          </div>
          <div style="display: flex; gap: 10px; margin-left: auto; width: 100%; justify-content: flex-end; align-items: center; flex-wrap: wrap;">
            ${logId ? `<button type="button" id="btn-delete-log-editor" data-id="${logId}" class="btn-secondary" style="color: #ff4d4f; border-color: #ff4d4f; font-weight: bold; margin-right: auto; padding: 10px 20px; border-radius: 8px;">🗑️ 削除</button>` : ''}
            <button type="button" id="btn-cancel-modal" class="btn-sub" style="padding: 10px 20px; border-radius: 8px;">キャンセル</button>
            <button type="button" id="btn-save-log" class="btn-primary" style="padding: 10px 20px; border-radius: 8px;">保存</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function syncEditorFormToCurrentBatchGroup() {
  if (state.currentBatchGroupIndex !== null && state.batchGroups[state.currentBatchGroupIndex]) {
    const group = state.batchGroups[state.currentBatchGroupIndex];
    const getVal = (id) => document.getElementById(id)?.value || '';
    group.category = getVal('sake-category');
    group.name = getVal('sake-name');
    group.productName = getVal('sake-product');
    group.brewery = getVal('sake-brewery');
    group.region = getVal('sake-region');
    group.type = getVal('sake-type');
    group.abv = getVal('sake-abv');
    group.notes = getVal('sake-notes');
    group.aiInfo = getVal('sake-ai-info');
    group.backupFormData = { ...state.backupFormData };
  }
}

export async function openEditorModal(logId = null, initialBatchGroup = null, batchIdx = null) {
  closeEditorModal();
  resetEditorState();
  state.currentEditingLogId = logId;
  state.currentBatchGroupIndex = batchIdx !== undefined ? batchIdx : null;

  const modalHTML = await renderLogEditorModal(logId);
  document.body.insertAdjacentHTML('beforeend', modalHTML);

  const modalModelSelect = document.getElementById('modal-model-select');
  if (modalModelSelect) {
    await populateModelDropdown(modalModelSelect);
  }

  if (logId) {
    const log = await getLogById(logId);
    if (log) {
      fillEditorForm(log);
      if (log.images && log.images.length > 0) {
        for (const blob of log.images) {
          try {
            const base64 = await blobToBase64(blob);
            state.uploadedImages.push({
              blob,
              base64,
              mimeType: blob.type || 'image/jpeg',
              previewUrl: URL.createObjectURL(blob)
            });
          } catch (e) {
            console.error('Base64変換エラー:', e);
          }
        }
        renderImagePreviewList();
      }
    }
  } else if (initialBatchGroup) {
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val || '';
    };
    setVal('sake-category', initialBatchGroup.category || '日本酒');
    setVal('sake-name', initialBatchGroup.name || '');
    setVal('sake-product', initialBatchGroup.productName || '');
    setVal('sake-brewery', initialBatchGroup.brewery || '');
    setVal('sake-region', initialBatchGroup.region || '');
    setVal('sake-type', initialBatchGroup.type || '');
    setVal('sake-abv', initialBatchGroup.abv || '');
    if (initialBatchGroup[0] && initialBatchGroup[0].date) {
      const d = initialBatchGroup[0].date instanceof Date ? initialBatchGroup[0].date : new Date(initialBatchGroup[0].date);
      setVal('sake-date', !isNaN(d) ? d.toISOString().split('T')[0] : '');
    }
    setVal('sake-notes', initialBatchGroup.notes || '');
    setVal('sake-ai-info', initialBatchGroup.aiInfo || '');

    if (initialBatchGroup.backupFormData) {
      state.backupFormData = { ...initialBatchGroup.backupFormData };
      updateFieldRevertUI();
    } else {
      saveCurrentFormBackup();
    }

    for (const item of initialBatchGroup) {
      try {
        let blob = item.blob;
        if (!blob && item.base64) {
          blob = base64ToBlob(item.base64, item.mimeType || 'image/jpeg');
          item.blob = blob;
        }
        let previewUrl = item.previewUrl;
        if (!previewUrl && blob) {
          previewUrl = URL.createObjectURL(blob);
          item.previewUrl = previewUrl;
        }
        state.uploadedImages.push({
          blob: blob,
          base64: item.base64,
          mimeType: item.mimeType || 'image/jpeg',
          previewUrl: previewUrl
        });
      } catch (e) {
        console.error('バッチ画像ロードエラー:', e);
      }
    }
    renderImagePreviewList();
  }
}

export function fillEditorForm(log) {
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
  };
  setVal('sake-category', log.category || '日本酒');
  setVal('sake-name', log.name);
  setVal('sake-product', log.productName);
  setVal('sake-brewery', log.brewery);
  setVal('sake-region', log.region);
  setVal('sake-type', log.type);
  setVal('sake-abv', log.abv);
  setVal('sake-date', log.date);
  setVal('sake-rating', log.rating || '4');
  setVal('sake-tags', (log.tags || []).join(' '));
  setVal('sake-notes', log.notes);
  setVal('sake-ai-info', log.aiInfo);
}

export function closeEditorModal() {
  syncEditorFormToCurrentBatchGroup();
  const modal = document.getElementById('modal-overlay');
  if (modal) modal.remove();
  resetEditorState();

  if (state.returnToBatchOnClose) {
    state.returnToBatchOnClose = false;
    document.dispatchEvent(new CustomEvent('navigation-request', { detail: { view: 'batchImport', renderBatch: true } }));
  }
}

export function renderImagePreviewList() {
  const container = document.getElementById('image-preview-list');
  const btnAnalyze = document.getElementById('btn-analyze');
  const uploadZone = document.getElementById('upload-zone');

  if (!container) return;

  if (state.uploadedImages.length === 0) {
    container.innerHTML = '';
    if (uploadZone) uploadZone.style.display = 'block';
    if (btnAnalyze) btnAnalyze.style.display = 'none';
    return;
  }

  if (uploadZone) uploadZone.style.display = 'none';
  if (btnAnalyze) {
    btnAnalyze.style.display = (hasApiKey() && state.uploadedImages.length > 0) ? 'inline-flex' : 'none';
  }

  const itemsHTML = state.uploadedImages.map((img, idx) => {
    const src = img.previewUrl || (img.base64 ? `data:${img.mimeType || 'image/jpeg'};base64,${img.base64}` : '');
    return `
    <div class="preview-item ${idx === state.activeThumbnailIndex ? 'is-thumb' : ''}" data-idx="${idx}" style="position: relative; overflow: hidden; user-select: none; touch-action: none;">
      <img src="${src}" alt="Preview" data-action="enlarge-image" data-context-type="editor-preview" data-idx="${idx}" style="user-drag: none; -webkit-user-drag: none;" onerror="this.onerror=null; this.style.display='none';" />
      <div class="preview-actions">
        <button type="button" class="btn-img-del" data-idx="${idx}" title="削除">✕</button>
      </div>
    </div>
  `;
  }).join('');

  const addMoreHTML = `
    <div class="preview-item add-more-item" id="btn-trigger-upload">
      <div class="add-more-content">
        <span class="add-icon">＋</span>
        <span class="add-text">追加</span>
      </div>
    </div>
  `;

  container.innerHTML = itemsHTML + addMoreHTML;
}

export function saveCurrentFormBackup() {
  TRACKED_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      state.backupFormData[id] = el.value || '';
    }
  });
}

export function updateFieldRevertUI() {
  TRACKED_FIELDS.forEach(id => {
    const inputEl = document.getElementById(id);
    if (!inputEl) return;

    const origVal = state.backupFormData[id] ?? '';
    const currentVal = inputEl.value || '';
    const groupEl = inputEl.closest('.form-group');
    let revertBtn = groupEl?.querySelector('.btn-revert-field');

    if (currentVal !== origVal) {
      inputEl.classList.add('ai-preview-active');
      const displayLabel = origVal ? `"${origVal}"` : '未入力';

      if (!revertBtn) {
        revertBtn = document.createElement('button');
        revertBtn.type = 'button';
        revertBtn.className = 'btn-revert-field';
        revertBtn.dataset.fieldId = id;
        
        const labelEl = groupEl.querySelector('label');
        if (labelEl) {
          labelEl.appendChild(revertBtn);
        }
      }
      revertBtn.innerHTML = `↩️ 元に戻す (${displayLabel})`;
      revertBtn.style.display = 'inline-block';
    } else {
      inputEl.classList.remove('ai-preview-active');
      if (revertBtn) {
        revertBtn.style.display = 'none';
      }
    }
  });
}

export async function runAIAnalysis(imageItem) {
  if (!imageItem) {
    alert('解析する画像を選択してください。');
    return;
  }
  if (!hasApiKey()) {
    alert('APIキーが設定されていません。設定画面でAPIキーを登録してください。');
    return;
  }

  const btnAnalyze = document.getElementById('btn-analyze');
  const overlay = document.getElementById('analyzing-status');
  const originalText = btnAnalyze ? btnAnalyze.innerHTML : '';

  if (btnAnalyze) {
    btnAnalyze.disabled = true;
    btnAnalyze.innerHTML = '<span class="spinner"></span> 解析中...';
  }
  if (overlay) overlay.style.display = 'flex';

  saveCurrentFormBackup();

  try {
    let base64 = imageItem.base64;
    let mimeType = imageItem.mimeType || 'image/jpeg';

    if (!base64 && imageItem.blob) {
      base64 = await blobToBase64(imageItem.blob);
      imageItem.base64 = base64;
    }

    if (!base64) {
      throw new Error('画像のデータが存在しません。');
    }

    const selectedModel = document.getElementById('modal-model-select')?.value || null;
    const result = await analyzeLabelImage(base64, mimeType, selectedModel);

    if (result) {
      const setFieldIfVal = (id, val) => {
        const el = document.getElementById(id);
        if (el && val) el.value = val;
      };

      if (result.category) setFieldIfVal('sake-category', result.category);
      if (result.name || result.productName) setFieldIfVal('sake-name', result.name || result.productName);
      if (result.productName) setFieldIfVal('sake-product', result.productName);
      if (result.brewery) setFieldIfVal('sake-brewery', result.brewery);
      if (result.region) setFieldIfVal('sake-region', result.region);
      if (result.type) setFieldIfVal('sake-type', result.type);
      if (result.abv) setFieldIfVal('sake-abv', result.abv);
      if (result.aiInfo) setFieldIfVal('sake-ai-info', result.aiInfo);

      updateFieldRevertUI();
    }
  } catch (err) {
    console.error('AI解析エラー:', err);
    alert('AI解析中にエラーが発生しました: ' + (err.message || err));
  } finally {
    if (btnAnalyze) {
      btnAnalyze.disabled = false;
      btnAnalyze.innerHTML = originalText;
    }
    if (overlay) overlay.style.display = 'none';
  }
}

export async function handleImageFiles(files) {
  if (!files || files.length === 0) return;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    const isImage = (file.type && file.type.startsWith('image/')) || 
                    /\.(heic|heif|png|jpe?g|webp|gif)$/i.test(file.name || '');
    if (!isImage) continue;

    if (i === 0 && state.uploadedImages.length === 0) {
      try {
        const extractedDate = await extractPhotoDate(file);
        if (extractedDate) {
          const dateInput = document.getElementById('sake-date');
          if (dateInput) dateInput.value = extractedDate;
        }
      } catch (err) {
        console.warn('1枚目の写真からのEXIF撮影日時抽出をスキップしました (圧縮処理へ続行):', err);
      }
    }

    try {
      const compressed = await compressImage(file);
      const previewUrl = compressed.blob ? URL.createObjectURL(compressed.blob) : '';

      state.uploadedImages.push({
        blob: compressed.blob || file,
        base64: compressed.base64 || '',
        mimeType: compressed.mimeType || file.type || 'image/jpeg',
        previewUrl: previewUrl
      });
    } catch (e) {
      console.error(`画像 [${file.name || i}] の圧縮・登録に失敗しました:`, e);
      try {
        const previewUrl = URL.createObjectURL(file);
        const base64 = await blobToBase64(file).catch(() => '');
        state.uploadedImages.push({
          blob: file,
          base64: base64,
          mimeType: file.type || 'image/jpeg',
          previewUrl: previewUrl
        });
      } catch (err2) {
        console.error('フォールバック登録エラー:', err2);
      }
    }
  }

  if (state.uploadedImages.length > 0 && (state.activeThumbnailIndex === null || state.activeThumbnailIndex === undefined)) {
    state.activeThumbnailIndex = 0;
  }

  renderImagePreviewList();
}
