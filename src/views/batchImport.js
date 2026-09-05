import { extractPhotoDate, compressImage, groupImagesByTime } from '../utils/image.js';
import { getApiKey, hasApiKey, analyzeLabelImage } from '../services/gemini.js';
import { saveLog } from '../store/db.js';

export function renderBatchImportView() {
  return `
  <div class="view-header">
    <h2>📦 一括画像インポート & スマート・グルーピング</h2>
    <p style="color: var(--text-sub);">飲み会や試飲会で連続撮影した複数のボトル写真を、AIと時間間隔で自動的にグループ分けして一括登録します</p>
  </div>

  <div class="batch-container" style="margin-top: 20px;">
    <!-- ファイル選択セクション -->
    <div class="settings-card" id="batch-upload-card">
      <div class="card-title">
        <span class="icon">📸</span>
        <h3>写真を選択（複数可）</h3>
      </div>
      <p class="card-desc">スマホやデジカメで撮影したお酒の写真をまとめて選択してください。撮影日時（EXIF）を元に自動でグループ分けされます。</p>
      
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
  </div>
  `;
}