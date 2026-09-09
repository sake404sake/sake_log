// src/views/logEditor.js
import { state, base64ToBlob, blobToBase64 } from '../store/state.js';
import { getLogById, getImagesByLogId, openDB } from '../store/db.js';
import { analyzeLabelImage, hasApiKey, getSavedModel } from '../services/gemini.js';

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

/**
 * ログ編集/新規登録モーダルのHTML構造を出力
 */
export function renderLogEditorModal() {
  return `
    <div id="editor-modal-overlay" class="modal-overlay" style="display: none;">
      <div class="modal-card">
        <header class="modal-header">
          <h2 id="modal-title">酒ログ編集</h2>
          <button id="btn-close-modal" class="btn-icon" aria-label="閉じる">✕</button>
        </header>

        <div class="modal-body">
          <!-- 画像プレビュー・アップロードエリア -->
          <div class="image-upload-section">
            <div id="image-preview-list" class="image-preview-list">
              <!-- プレビューサムネイルがここに挿入されます -->
            </div>

            <div id="upload-zone" class="upload-zone">
              <input type="file" id="file-input" accept="image/*" multiple style="display: none;">
              <button type="button" id="btn-trigger-upload" class="btn-secondary">
                📷 写真を追加 / 撮影
              </button>
            </div>
          </div>

          <!-- AI解析・モデル選択ヘッダー -->
          <div class="ai-analysis-bar">
            <div class="ai-model-selector">
              <label for="modal-model-select">Geminiモデル:</label>
              <select id="modal-model-select" class="form-select-sm">
                <option value="">読込中...</option>
              </select>
              <button type="button" id="btn-reload-modal-models" class="btn-icon-sm" title="モデル一覧を更新">↺</button>
            </div>
            <button type="button" id="btn-analyze" class="btn-accent">
              ✨ AIラベル解析
            </button>
          </div>

          <!-- フォームフィールド -->
          <form id="log-form" onsubmit="return false;">
            <div class="form-group">
              <label for="sake-category">カテゴリ <span class="required">*</span></label>
              <select id="sake-category" class="form-control" required>
                <option value="日本酒">日本酒</option>
                <option value="焼酎">焼酎</option>
                <option value="ウイスキー">ウイスキー</option>
                <option value="ワイン">ワイン</option>
                <option value="クラフトビール">クラフトビール</option>
                <option value="果実酒・梅酒">果実酒・梅酒</option>
                <option value="その他">その他</option>
              </select>
            </div>

            <div class="form-group">
              <div class="field-header">
                <label for="sake-name">銘柄名 (ブランド) <span class="required">*</span></label>
                <button type="button" class="btn-revert-field" data-field-id="sake-name" style="display:none;">↩ 元に戻す</button>
              </div>
              <input type="text" id="sake-name" class="form-control" placeholder="例: 獺祭, 十四代, 響" required>
            </div>

            <div class="form-group">
              <div class="field-header">
                <label for="sake-product">商品名・特定名称</label>
                <button type="button" class="btn-revert-field" data-field-id="sake-product" style="display:none;">↩ 元に戻す</button>
              </div>
              <input type="text" id="sake-product" class="form-control" placeholder="例: 純米大吟醸 磨き三分九分">
            </div>

            <div class="form-row">
              <div class="form-group col">
                <div class="field-header">
                  <label for="sake-brewery">蔵元・メーカー</label>
                  <button type="button" class="btn-revert-field" data-field-id="sake-brewery" style="display:none;">↩ 元に戻す</button>
                </div>
                <input type="text" id="sake-brewery" class="form-control" placeholder="例: 旭酒造">
              </div>
              <div class="form-group col">
                <div class="field-header">
                  <label for="sake-region">都道府県・産地</label>
                  <button type="button" class="btn-revert-field" data-field-id="sake-region" style="display:none;">↩ 元に戻す</button>
                </div>
                <input type="text" id="sake-region" class="form-control" placeholder="例: 山口県">
              </div>
            </div>

            <div class="form-row">
              <div class="form-group col">
                <div class="field-header">
                  <label for="sake-type">特定名称/スタイル</label>
                  <button type="button" class="btn-revert-field" data-field-id="sake-type" style="display:none;">↩ 元に戻す</button>
                </div>
                <input type="text" id="sake-type" class="form-control" placeholder="例: 純米吟醸, IPA">
              </div>
              <div class="form-group col">
                <div class="field-header">
                  <label for="sake-abv">アルコール度数 (%)</label>
                  <button type="button" class="btn-revert-field" data-field-id="sake-abv" style="display:none;">↩ 元に戻す</button>
                </div>
                <input type="number" id="sake-abv" class="form-control" step="0.1" placeholder="例: 15.5">
              </div>
            </div>

            <div class="form-row">
              <div class="form-group col">
                <label for="sake-date">飲んだ日</label>
                <input type="date" id="sake-date" class="form-control">
              </div>
              <div class="form-group col">
                <label for="sake-rating">評価</label>
                <select id="sake-rating" class="form-control">
                  <option value="5">⭐⭐⭐⭐⭐ (5.0)</option>
                  <option value="4" selected>⭐⭐⭐⭐ (4.0)</option>
                  <option value="3">⭐⭐⭐ (3.0)</option>
                  <option value="2">⭐⭐ (2.0)</option>
                  <option value="1">⭐ (1.0)</option>
                </select>
              </div>
            </div>

            <div class="form-group">
              <label for="sake-tags">タグ (スペース区切り)</label>
              <input type="text" id="sake-tags" class="form-control" placeholder="例: 甘口 華やか フルーツ香 冷酒推奨">
              <div class="tag-chips-suggestion" style="margin-top: 6px;">
                <button type="button" class="tag-chip-btn" data-tag="甘口">#甘口</button>
                <button type="button" class="tag-chip-btn" data-tag="辛口">#辛口</button>
                <button type="button" class="tag-chip-btn" data-tag="フルーティ">#フルーティ</button>
                <button type="button" class="tag-chip-btn" data-tag="スッキリ">#スッキリ</button>
                <button type="button" class="tag-chip-btn" data-tag="濃厚">#濃厚</button>
              </div>
            </div>

            <div class="form-group">
              <div class="field-header">
                <label for="sake-notes">テイスティングメモ / 感想</label>
                <button type="button" class="btn-revert-field" data-field-id="sake-notes" style="display:none;">↩ 元に戻す</button>
              </div>
              <textarea id="sake-notes" class="form-control" rows="3" placeholder="香り、味わい、料理との相性など..."></textarea>
            </div>

            <div class="form-group">
              <div class="field-header">
                <label for="sake-ai-info">AI補足・詳細解説</label>
                <button type="button" class="btn-revert-field" data-field-id="sake-ai-info" style="display:none;">↩ 元に戻す</button>
              </div>
              <textarea id="sake-ai-info" class="form-control" rows="3" placeholder="AIによる酒蔵解説や味わいの特徴（自動入力）"></textarea>
            </div>
          </form>
        </div>

        <footer class="modal-footer">
          <button type="button" id="btn-delete-log-editor" class="btn-danger-outline" style="display:none;">削除</button>
          <div class="footer-right-btns">
            <button type="button" id="btn-cancel-modal" class="btn-secondary">キャンセル</button>
            <button type="button" id="btn-save-log" class="btn-primary">保存する</button>
          </div>
        </footer>
      </div>
    </div>
  `;
}

/**
 * プレビューサムネイル一覧を描画（★1枚目の画像を確実にアクティブ化）
 */
export function renderImagePreviewList() {
  const container = document.getElementById('image-preview-list');
  if (!container) return;

  if (!state.uploadedImages || state.uploadedImages.length === 0) {
    container.innerHTML = `<div class="no-images-placeholder">写真がありません</div>`;
    return;
  }

  // アクティブインデックスのガード処理
  if (state.activeThumbnailIndex < 0 || state.activeThumbnailIndex >= state.uploadedImages.length) {
    state.activeThumbnailIndex = 0;
  }

  container.innerHTML = state.uploadedImages.map((img, idx) => {
    const isActive = idx === state.activeThumbnailIndex;
    return `
      <div class="preview-item ${isActive ? 'active' : ''}" data-idx="${idx}" data-context-type="editor-preview">
        <img src="${img.previewUrl}" alt="プレビュー ${idx + 1}" data-action="enlarge-image" data-idx="${idx}" data-context-type="editor-preview">
        ${isActive ? '<span class="main-badge">メイン</span>' : ''}
        <button type="button" class="btn-img-del" data-idx="${idx}" title="削除">✕</button>
      </div>
    `;
  }).join('');
}

/**
 * フォーム変更・元に戻すボタンの表示切り替え
 */
export function updateFieldRevertUI() {
  TRACKED_FIELDS.forEach(fieldId => {
    const el = document.getElementById(fieldId);
    const revertBtn = document.querySelector(`.btn-revert-field[data-field-id="${fieldId}"]`);
    if (!el || !revertBtn) return;

    const backupVal = state.backupFormData[fieldId];
    if (backupVal !== undefined && el.value !== backupVal) {
      revertBtn.style.display = 'inline-block';
    } else {
      revertBtn.style.display = 'none';
    }
  });
}

/**
 * 編集モーダルを開く（新規 / 既存編集 / 一括グループ編集）
 */
export async function openEditorModal(logId = null, batchGroup = null, batchGroupIndex = null) {
  const overlay = document.getElementById('editor-modal-overlay');
  if (!overlay) return;

  // ステート初期化
  state.uploadedImages = [];
  state.activeThumbnailIndex = 0; // ★1枚目を確実にアクティブに設定
  state.backupFormData = {};
  state.currentEditingLogId = logId;
  state.currentBatchGroupIndex = batchGroupIndex;

  const modalTitle = document.getElementById('modal-title');
  const btnDelete = document.getElementById('btn-delete-log-editor');

  if (btnDelete) {
    btnDelete.style.display = logId ? 'inline-block' : 'none';
    if (logId) btnDelete.dataset.id = logId;
  }

  if (logId) {
    // 既存ログ編集
    if (modalTitle) modalTitle.innerText = '酒ログを編集';
    const log = await getLogById(logId);
    if (log) {
      document.getElementById('sake-category').value = log.category || '日本酒';
      document.getElementById('sake-name').value = log.name || '';
      document.getElementById('sake-product').value = log.productName || '';
      document.getElementById('sake-brewery').value = log.brewery || '';
      document.getElementById('sake-region').value = log.region || '';
      document.getElementById('sake-type').value = log.type || '';
      document.getElementById('sake-abv').value = log.abv || '';
      document.getElementById('sake-date').value = log.date || '';
      document.getElementById('sake-rating').value = log.rating || '4';
      document.getElementById('sake-tags').value = Array.isArray(log.tags) ? log.tags.join(' ') : '';
      document.getElementById('sake-notes').value = log.notes || '';
      document.getElementById('sake-ai-info').value = log.aiInfo || '';

      // 画像の取得とセット
      const imageRecords = await getImagesByLogId(logId);
      if (imageRecords && imageRecords.length > 0) {
        for (const record of imageRecords) {
          const blob = record.blob;
          const previewUrl = URL.createObjectURL(blob);
          const base64 = await blobToBase64(blob);
          state.uploadedImages.push({
            blob,
            base64,
            mimeType: blob.type || 'image/jpeg',
            previewUrl
          });
        }
      } else if (log.imageUrls && log.imageUrls.length > 0) {
        // バックアップ/キャッシュURLが存在する場合
        for (const url of log.imageUrls) {
          state.uploadedImages.push({
            blob: null,
            base64: '',
            mimeType: 'image/jpeg',
            previewUrl: url
          });
        }
      }
    }
  } else if (batchGroup) {
    // 一括グループからの個別詳細編集
    if (modalTitle) modalTitle.innerText = 'グループ詳細編集';
    document.getElementById('sake-category').value = batchGroup.category || '日本酒';
    document.getElementById('sake-name').value = batchGroup.name || '';
    document.getElementById('sake-product').value = batchGroup.productName || '';
    document.getElementById('sake-brewery').value = batchGroup.brewery || '';
    document.getElementById('sake-region').value = batchGroup.region || '';
    document.getElementById('sake-type').value = batchGroup.type || '';
    document.getElementById('sake-abv').value = batchGroup.abv || '';
    document.getElementById('sake-notes').value = batchGroup.notes || '';
    document.getElementById('sake-ai-info').value = batchGroup.aiInfo || '';

    // 一括画像の読み込み
    for (const item of batchGroup) {
      state.uploadedImages.push({
        blob: item.blob,
        base64: item.base64,
        mimeType: item.mimeType || 'image/jpeg',
        previewUrl: item.previewUrl
      });
    }

    if (batchGroup.backupFormData) {
      state.backupFormData = { ...batchGroup.backupFormData };
    }
  } else {
    // 完全新規
    if (modalTitle) modalTitle.innerText = '新規酒ログ登録';
    document.getElementById('log-form').reset();
    document.getElementById('sake-date').value = new Date().toISOString().split('T')[0];
  }

  // ★画像一覧と1枚目アクティブ表示を確実に適用
  state.activeThumbnailIndex = 0;
  renderImagePreviewList();
  updateFieldRevertUI();

  overlay.style.display = 'flex';
}

/**
 * モーダルを閉じる
 */
export function closeEditorModal() {
  const overlay = document.getElementById('editor-modal-overlay');
  if (overlay) overlay.style.display = 'none';

  // オブジェクトURLの解放
  state.uploadedImages.forEach(img => {
    if (img.previewUrl && img.previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(img.previewUrl);
    }
  });

  state.uploadedImages = [];
  state.activeThumbnailIndex = 0;
  state.backupFormData = {};
  state.currentEditingLogId = null;
  state.currentBatchGroupIndex = null;
}

/**
 * ファイル追加ハンドラ
 */
export async function handleImageFiles(files) {
  if (!files || files.length === 0) return;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file.type.startsWith('image/')) continue;

    const previewUrl = URL.createObjectURL(file);
    const base64 = await blobToBase64(file);

    state.uploadedImages.push({
      blob: file,
      base64,
      mimeType: file.type || 'image/jpeg',
      previewUrl
    });
  }

  // 最初に追加された画像をアクティブにする（画像が以前無かった場合）
  if (state.uploadedImages.length > 0 && state.activeThumbnailIndex < 0) {
    state.activeThumbnailIndex = 0;
  }

  renderImagePreviewList();
}

/**
 * Gemini AIによるラベル解析実行
 */
export async function runAIAnalysis(targetImageItem) {
  if (!targetImageItem && state.uploadedImages.length > 0) {
    targetImageItem = state.uploadedImages[state.activeThumbnailIndex || 0];
  }

  if (!targetImageItem || !targetImageItem.base64) {
    alert('解析する画像を選択してください。');
    return;
  }

  if (!hasApiKey()) {
    alert('Gemini APIキーが設定されていません。設定画面から設定してください。');
    return;
  }

  const btnAnalyze = document.getElementById('btn-analyze');
  const originalText = btnAnalyze ? btnAnalyze.innerHTML : '';
  if (btnAnalyze) {
    btnAnalyze.disabled = true;
    btnAnalyze.innerHTML = '<span class="sella-spinner"></span> 解析中...';
  }

  try {
    // 現状の入力値をバックアップ
    state.backupFormData = {
      'sake-category': document.getElementById('sake-category')?.value || '',
      'sake-name': document.getElementById('sake-name')?.value || '',
      'sake-product': document.getElementById('sake-product')?.value || '',
      'sake-brewery': document.getElementById('sake-brewery')?.value || '',
      'sake-region': document.getElementById('sake-region')?.value || '',
      'sake-type': document.getElementById('sake-type')?.value || '',
      'sake-abv': document.getElementById('sake-abv')?.value || '',
      'sake-notes': document.getElementById('sake-notes')?.value || '',
      'sake-ai-info': document.getElementById('sake-ai-info')?.value || ''
    };

    const result = await analyzeLabelImage(targetImageItem.base64, targetImageItem.mimeType);

    if (result) {
      if (result.category) document.getElementById('sake-category').value = result.category;
      if (result.name || result.productName) document.getElementById('sake-name').value = result.name || result.productName;
      if (result.productName) document.getElementById('sake-product').value = result.productName;
      if (result.brewery) document.getElementById('sake-brewery').value = result.brewery;
      if (result.region) document.getElementById('sake-region').value = result.region;
      if (result.type) document.getElementById('sake-type').value = result.type;
      if (result.abv) document.getElementById('sake-abv').value = result.abv;
      if (result.aiInfo) document.getElementById('sake-ai-info').value = result.aiInfo;

      updateFieldRevertUI();
      alert('✨ AI解析が完了しました！内容をご確認ください。');
    }
  } catch (err) {
    console.error('AI Analysis Failed:', err);
    alert('AI解析中にエラーが発生しました。画像を変えるか時間をおいて再試行してください。');
  } finally {
    if (btnAnalyze) {
      btnAnalyze.disabled = false;
      btnAnalyze.innerHTML = originalText;
    }
  }
}

/**
 * 一括インポートグループへ変更内容を反映
 */
export function syncEditorFormToCurrentBatchGroup() {
  if (state.currentBatchGroupIndex === null || !state.batchGroups[state.currentBatchGroupIndex]) return;

  const group = state.batchGroups[state.currentBatchGroupIndex];
  group.category = document.getElementById('sake-category')?.value || '日本酒';
  group.name = document.getElementById('sake-name')?.value || '';
  group.productName = document.getElementById('sake-product')?.value || '';
  group.brewery = document.getElementById('sake-brewery')?.value || '';
  group.region = document.getElementById('sake-region')?.value || '';
  group.type = document.getElementById('sake-type')?.value || '';
  group.abv = document.getElementById('sake-abv')?.value || '';
  group.notes = document.getElementById('sake-notes')?.value || '';
  group.aiInfo = document.getElementById('sake-ai-info')?.value || '';

  // 画像リストの更新
  group.length = 0;
  state.uploadedImages.forEach(img => {
    group.push({
      blob: img.blob,
      base64: img.base64,
      mimeType: img.mimeType,
      previewUrl: img.previewUrl
    });
  });
}
