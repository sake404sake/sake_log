// src/views/logDetail.js

import { getLogById } from '../store/db.js';
import { state } from '../store/state.js';

export function renderLogDetailModal(log) {
  if (!log) return '';
  const imageUrls = state.detailImages || [];

  return `
    <div id="detail-modal-overlay" class="modal-overlay">
      <div class="modal-card">
        <div class="modal-header">
          <h3>酒ログ詳細</h3>
          <button type="button" class="modal-close-btn" id="btn-close-detail">&times;</button>
        </div>
        <div class="modal-body">
          ${imageUrls.length > 0 ? `
            <!-- 🌟 image-preview-wrapper クラスは style.txt により 220px 枠の flex 描画になるため、最外殻にのみ採用します -->
            <div class="sella-carousel-container" style="position: relative; width: 100%; height: 220px; border-radius: 10px; overflow: hidden; background: #000; border: 1px solid var(--border-color); display: block !important; padding: 0 !important; margin: 0;">
              
              <!-- 🌟【!important衝突回避設計】style.txt の [class*="carousel"] などの強力な flex 競合を避けるため、それらの文字列を一切含まないクラス体系で横フリック横スクロール（スナップスクロール）を実現します -->
              <div class="sella-scroll-viewport" id="detail-carousel-scroll" style="display: flex !important; overflow-x: auto !important; scroll-snap-type: x mandatory !important; width: 100% !important; height: 100% !important; scrollbar-width: none !important; -ms-overflow-style: none !important; scroll-behavior: smooth !important; -webkit-overflow-scrolling: touch !important; padding: 0 !important; margin: 0 !important;">
                ${imageUrls.map((url, i) => `
                  <div class="sella-slide-pane" style="flex: 0 0 100% !important; width: 100% !important; height: 100% !important; scroll-snap-align: start !important; display: flex !important; align-items: center !important; justify-content: center !important; position: relative !important; padding: 0 !important; margin: 0 !important;">
                    <img src="${url}" alt="お酒の写真" class="sella-slide-photo" 
                         data-action="enlarge-image" data-context-type="detail-preview" data-idx="${i}" 
                         style="max-width: 100% !important; max-height: 220px !important; width: auto !important; height: auto !important; object-fit: contain !important; cursor: pointer; display: block !important; -webkit-user-drag: none; user-drag: none; padding: 0 !important; margin: 0 !important;" />
                  </div>
                `).join('')}
              </div>
              
              <!-- 複数枚ある場合のみスライドコントロールを表示 -->
              ${imageUrls.length > 1 ? `
                <button type="button" class="sella-btn-prev" id="btn-detail-prev" title="前の写真へ" style="position: absolute; left: 8px; top: 50%; transform: translateY(-50%); z-index: 10; font-family: monospace; font-size: 1.5rem; background: rgba(0,0,0,0.6); color: #fff; border: none; border-radius: 4px; padding: 2px 8px; cursor: pointer; user-select: none;">‹</button>
                <button type="button" class="sella-btn-next" id="btn-detail-next" title="次の写真へ" style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); z-index: 10; font-family: monospace; font-size: 1.5rem; background: rgba(0,0,0,0.6); color: #fff; border: none; border-radius: 4px; padding: 2px 8px; cursor: pointer; user-select: none;">›</button>
                <div class="sella-dots-container" id="detail-carousel-dots" style="position: absolute; bottom: 8px; display: flex; gap: 6px; z-index: 10; justify-content: center; width: 100%; pointer-events: none;">
                  ${imageUrls.map((_, i) => `<span class="sella-dot ${i === state.detailActiveIndex ? 'active' : ''}" data-idx="${i}" style="width: 8px; height: 8px; border-radius: 50%; background: ${i === state.detailActiveIndex ? 'var(--accent-color, #d4a359)' : 'rgba(255,255,255,0.4)'}; display: inline-block; transition: background 0.2s;"></span>`).join('')}
                </div>
              ` : ''}
            </div>
          ` : `
            <div class="image-preview-wrapper" style="width: 100%; height: 220px; background-color: var(--bg-color); border-radius: 10px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border-color);">
              <div class="log-card-no-image" style="color: var(--text-sub); font-size: 0.9rem;">📸 写真なし</div>
            </div>
          `}

          <div class="form-grid" style="pointer-events: none; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; width: 100%;">
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

        <div class="modal-footer" style="display: flex; justify-content: flex-end; margin-top: 20px; gap: 10px;">
          <button type="button" class="btn-primary" id="btn-edit-from-detail" data-id="${log.id}">編集する</button>
          <button type="button" class="btn-secondary" id="btn-close-detail-footer">閉じる</button>
        </div>
      </div>
    </div>
  `;
}

// カルーセルのスクロールイベントを監視し、現在のインデックスをドットに完全連動する
export function initDetailCarouselEvents() {
  const scrollContainer = document.getElementById('detail-carousel-scroll');
  if (!scrollContainer) return;

  // Webkit等のスクロールバー非表示のCSSルールを動的に追加
  if (!document.getElementById('carousel-scrollbar-style')) {
    const style = document.createElement('style');
    style.id = 'carousel-scrollbar-style';
    style.textContent = `
      .sella-scroll-viewport::-webkit-scrollbar { display: none !important; }
    `;
    document.head.appendChild(style);
  }

  scrollContainer.addEventListener('scroll', () => {
    const width = scrollContainer.clientWidth;
    if (width === 0) return;
    const newIdx = Math.round(scrollContainer.scrollLeft / width);
    if (newIdx !== state.detailActiveIndex) {
      state.detailActiveIndex = newIdx;
      updateDetailCarouselDots();
    }
  }, { passive: true });
}

export function updateDetailCarouselDots() {
  const dots = document.querySelectorAll('#detail-carousel-dots .sella-dot');
  dots.forEach((dot, idx) => {
    dot.style.background = idx === state.detailActiveIndex ? 'var(--accent-color, #d4a359)' : 'rgba(255,255,255,0.4)';
  });
}

export async function openDetailModal(logId) {
  closeDetailModal();
  const log = await getLogById(logId);
  if (!log) return;

  state.detailImages = (log.images || []).map(blob => URL.createObjectURL(blob));
  state.detailActiveIndex = 0;

  const detailHTML = renderLogDetailModal(log);
  if (detailHTML) {
    document.body.insertAdjacentHTML('beforeend', detailHTML);
    initDetailCarouselEvents();
  }
}

export function closeDetailModal() {
  const modal = document.getElementById('detail-modal-overlay');
  if (modal) modal.remove();
  
  // 安全にURLキャッシュを開放してメモリリークを防ぐ
  if (state.detailImages && state.detailImages.length > 0) {
    state.detailImages.forEach(url => URL.revokeObjectURL(url));
  }
  state.detailImages = [];
  state.detailActiveIndex = 0;
}
