import { extractPhotoDate, compressImage, groupImagesByTime } from '../utils/image.js';
import { getApiKey, hasApiKey, analyzeLabelImage } from '../services/gemini.js';
import { saveLog } from '../store/db.js';

export function renderBatchImportView() {
  return `
<div class="batch-import-container" style="max-width: 720px; margin: 0 auto; padding-top: 20px;">
  <div class="batch-header" style="margin-bottom: 24px;">
    <h2 style="font-size: 1.5rem; color: var(--text-main); margin-bottom: 6px;">📦 お酒ボトル一括インポート</h2>
    <p style="font-size: 0.88rem; color: var(--text-sub);">同じタイミングで撮影した写真を同一ボトルのグループ（表・裏ラベル等）に自動でまとめ、一気に追加できます。</p>
  </div>

  <input type="file" id="batch-file-input" accept="image/*" multiple style="display: none;" />
  
  <div class="image-upload-zone" id="batch-upload-zone" style="cursor: pointer; border: 2px dashed var(--border-color); border-radius: 12px; padding: 30px; text-align: center; background: var(--bg-color);">
    <span class="upload-icon" style="font-size: 2.5rem;">📁</span>
    <p style="font-weight: bold; margin-top: 8px;">タップして写真を選択、またはここにドラッグ＆ドロップ</p>
    <span style="font-size: 0.8rem; color: var(--text-sub);">JPEG / PNG / HEIC等対応（自動軽量化）</span>
  </div>
</div>

<!-- プレビュー＆グルーピング調整エリア（初期は非表示） -->
<div id="batch-preview-section" style="display: none; margin-top: 24px;">
  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
    <h3 id="batch-group-count-title" style="font-size: 1.1rem; color: var(--accent-color);">✨ 検出されたグループ (0件)</h3>
    <button type="button" class="btn-primary" id="btn-execute-batch-save" style="background-color: #4cd964; color: #000;">
      🚀 すべてのグループを一括登録する
    </button>
  </div>

  <!-- グループカードが動的に挿入されるコンテナ -->
  <div id="batch-groups-container" style="display: flex; flex-direction: column; gap: 20px;"></div>
</div>
  `;
}
