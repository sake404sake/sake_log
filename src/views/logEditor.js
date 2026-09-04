import { getAllTags } from '../store/db.js';

export async function renderLogEditorModal() {
  const today = new Date().toISOString().split('T')[0];
  const existingTags = await getAllTags();

  const tagChipsHTML = existingTags.map(tag => `
    <button type="button" class="tag-chip-btn" data-tag="${tag}">+ ${tag}</button>
  `).join('');

  return `
  <div id="modal-overlay" class="modal-overlay">
    <div class="modal-card">
      <div class="modal-header">
        <h3>酒ログ登録</h3>
        <button id="btn-close-modal" class="modal-close-btn">✕</button>
      </div>

      <div class="modal-body">
        <!-- 左側：複数画像アップロード＆プレビューマネージャー -->
        <div class="modal-image-col">
          <input type="file" id="file-input" accept="image/*" multiple style="display: none;" />
          
          <!-- 初期状態（画像0枚時）のドラッグ＆ドロップエリア -->
          <div class="image-upload-zone" id="upload-zone">
            <div class="upload-placeholder" id="upload-placeholder">
              <span class="upload-icon">📸</span>
              <p class="upload-text">タップ・ドラッグで画像を複数選択<br><small style="color:var(--text-sub)">(自動圧縮保存)</small></p>
            </div>
            <div id="analyzing-status" class="analyzing-overlay" style="display: none;">
              <div class="spinner"></div>
              <span>解析中...</span>
            </div>
          </div>

          <!-- 選択中画像リスト（2枚目以降の「＋追加」ボタンもここに自動生成） -->
          <div id="image-preview-list" class="image-preview-grid"></div>
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
            <label for="sake-notes">メモ・感想</label>
            <textarea id="sake-notes" class="input-dark" rows="2" placeholder="香りの特徴や味わい、合わせ料理など"></textarea>
          </div>

          <div class="form-group">
            <label for="sake-ai-info" style="color: var(--accent-color);">🤖 AIによる情報・補足</label>
            <textarea id="sake-ai-info" class="input-dark ai-info-input" rows="2" placeholder="AI解析結果やおすすめの飲み方"></textarea>
          </div>
        </div>
      </div>

      <!-- フッター -->
      <div class="modal-footer">
        <div class="modal-footer-left">
          <button type="button" id="btn-analyze" class="btn-ai-action" style="display: none;">🤖 AI解析実行</button>
        </div>
        <div class="modal-footer-right">
          <button type="button" id="btn-cancel-modal" class="btn-sub">キャンセル</button>
          <button type="button" id="btn-save-log" class="btn-primary">保存</button>
        </div>
      </div>
    </div>
  </div>
  `;
}