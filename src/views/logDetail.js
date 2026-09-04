import { getLogById } from '../store/db.js';

export async function renderLogDetailModal(logId) {
  const log = await getLogById(logId);
  if (!log) return '';

  const imageUrls = (log.images || []).map(blob => URL.createObjectURL(blob));

  return `
  <div class="modal-overlay" id="detail-modal-overlay">
    <div class="modal-card">
      <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center;">
        <h3>酒ログ詳細</h3>
        <button type="button" class="btn-close" id="btn-close-detail" aria-label="閉じる">&times;</button>
      </div>

      <div class="modal-body">
        <!-- 画像ギャラリー (タップで拡大) -->
        ${imageUrls.length > 0 ? `
          <div class="detail-image-gallery" style="display: flex; gap: 8px; overflow-x: auto; margin-bottom: 16px; padding-bottom: 8px;">
            ${imageUrls.map(url => `
              <img src="${url}" class="detail-gallery-thumb" data-action="enlarge-image" style="width: 90px; height: 90px; object-fit: cover; border-radius: 8px; cursor: pointer; border: 1px solid var(--border-color);" />
            `).join('')}
          </div>
        ` : ''}

        <div class="form-grid" style="pointer-events: none;">
          <div class="form-group">
            <label>酒の種類</label>
            <div class="read-only-field">${log.category || 'その他'}</div>
          </div>
          <div class="form-group">
            <label>銘柄</label>
            <div class="read-only-field" style="font-weight: bold; color: var(--accent-color);">${log.name || ''}</div>
          </div>
          <div class="form-group">
            <label>商品名</label>
            <div class="read-only-field">${log.productName || '未設定'}</div>
          </div>
          <div class="form-group">
            <label>酒蔵・メーカー</label>
            <div class="read-only-field">${log.brewery || '未設定'}</div>
          </div>
          <div class="form-group">
            <label>産地</label>
            <div class="read-only-field">${log.region || '未設定'}</div>
          </div>
          <div class="form-group">
            <label>特定名称・格付</label>
            <div class="read-only-field">${log.type || '未設定'}</div>
          </div>
          <div class="form-group">
            <label>度数 (%)</label>
            <div class="read-only-field">${log.abv ? log.abv + '%' : '未設定'}</div>
          </div>
          <div class="form-group">
            <label>飲んだ日</label>
            <div class="read-only-field">${log.date || '未設定'}</div>
          </div>
        </div>

        <div class="form-group" style="margin-top: 12px; pointer-events: none;">
          <label>評価</label>
          <div class="read-only-field">★ ${log.rating || '4.0'}</div>
        </div>

        ${log.tags && log.tags.length > 0 ? `
          <div class="form-group" style="margin-top: 12px; pointer-events: none;">
            <label>タグ</label>
            <div class="tag-list" style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px;">
              ${log.tags.map(t => `<span class="tag-chip">${t}</span>`).join('')}
            </div>
          </div>
        ` : ''}

        <div class="form-group" style="margin-top: 12px; pointer-events: none;">
          <label>メモ・感想（自分用）</label>
          <div class="read-only-field text-box">${log.notes || 'なし'}</div>
        </div>

        ${log.aiInfo ? `
          <div class="form-group" style="margin-top: 12px; pointer-events: none;">
            <label>🤖 AIによる情報・補足</label>
            <div class="read-only-field text-box ai-info-box">${log.aiInfo}</div>
          </div>
        ` : ''}
      </div>

      <div class="modal-footer" style="display: flex; justify-content: space-between; margin-top: 20px;">
        <button type="button" class="btn-secondary" id="btn-delete-from-detail" data-id="${log.id}" style="color: #ff4d4f; border-color: #ff4d4f;">削除</button>
        <div>
          <button type="button" class="btn-primary" id="btn-edit-from-detail" data-id="${log.id}">編集する</button>
          <button type="button" class="btn-secondary" id="btn-close-detail-footer">閉じる</button>
        </div>
      </div>
    </div>
  </div>
  `;
}