// src/views/lightbox.js

import { state } from '../store/state.js';
import { getImagePreviewSrc, renderImagePreviewList } from './logEditor.js';
import { renderBatchGroupsUI } from './batchImport.js';

export function openLightbox(imageSrc, ctx) {
  let lightbox = document.getElementById('lightbox-modal');
  if (!lightbox) {
    lightbox = document.createElement('div');
    lightbox.id = 'lightbox-modal';
    lightbox.className = 'lightbox-overlay';
    document.body.appendChild(lightbox);
  }

  state.activeLightboxCtx = ctx;

  if (!imageSrc && ctx?.type === 'editor-preview') {
    imageSrc = getImagePreviewSrc(state.uploadedImages[ctx.idx]);
  } else if (!imageSrc && ctx?.type === 'batch-group') {
    imageSrc = getImagePreviewSrc(state.batchGroups[ctx.gidx]?.[ctx.iidx]);
  } else if (!imageSrc && ctx?.type === 'pool') {
    imageSrc = getImagePreviewSrc(state.ungroupedImages[ctx.poolIdx]);
  }

  let controlsHTML = '';
  let indicatorHTML = '';
  let arrowPrevHTML = '';
  let arrowNextHTML = '';
  let total = 0;
  let detachedDangerHTML = '';

  if (ctx) {
    if (ctx.type === 'editor-preview') {
      const idx = ctx.idx;
      total = state.uploadedImages.length;
      const isMain = idx === state.activeThumbnailIndex;

      indicatorHTML = `<div class="lightbox-indicator">${idx + 1} / ${total}</div>`;

      if (total > 1) {
        arrowPrevHTML = `<button type="button" class="lightbox-arrow-btn prev" ${idx > 0 ? '' : 'style="opacity: 0.15; cursor: not-allowed; pointer-events: none;"'} title="前の写真へ">‹</button>`;
        arrowNextHTML = `<button type="button" class="lightbox-arrow-btn next" ${idx < total - 1 ? '' : 'style="opacity: 0.15; cursor: not-allowed; pointer-events: none;"'} title="次の写真へ">›</button>`;
      }

      controlsHTML = `
        <div class="lightbox-controls" style="display: flex; gap: 10px; justify-content: center; margin-top: 16px; flex-wrap: wrap; width: 100%; max-width: 480px; pointer-events: auto;">
          ${isMain 
            ? `<button type="button" class="lightbox-ctrl-btn btn-main-set" disabled style="background: #10b981; border: none; color: #fff; cursor: default; pointer-events: none;">👑 代表メイン写真</button>` 
            : `<button type="button" class="lightbox-ctrl-btn btn-main-unset" data-idx="${idx}">☆ メインに設定</button>`
          }
          <button type="button" class="lightbox-ctrl-btn btn-delete-img" data-idx="${idx}">🗑️ 削除</button>
        </div>
      `;
    } else if (ctx.type === 'batch-group') {
      const gIdx = ctx.gidx;
      const iIdx = ctx.iidx;
      const group = state.batchGroups[gIdx];
      total = group ? group.length : 0;
      const isMain = iIdx === 0;

      indicatorHTML = `<div class="lightbox-indicator">${iIdx + 1} / ${total}</div>`;

      if (total > 1) {
        arrowPrevHTML = `<button type="button" class="lightbox-arrow-btn prev" ${iIdx > 0 ? '' : 'style="opacity: 0.15; cursor: not-allowed; pointer-events: none;"'} title="前の写真へ">‹</button>`;
        arrowNextHTML = `<button type="button" class="lightbox-arrow-btn next" ${iIdx < total - 1 ? '' : 'style="opacity: 0.15; cursor: not-allowed; pointer-events: none;"'} title="次の写真へ">›</button>`;
      }

      controlsHTML = `
        <div class="lightbox-controls" style="display: flex; gap: 10px; justify-content: center; margin-top: 16px; flex-wrap: wrap; width: 100%; max-width: 480px; pointer-events: auto;">
          ${isMain 
            ? `<button type="button" class="lightbox-ctrl-btn btn-batch-main-set" disabled style="background: #10b981; border: none; color: #fff; cursor: default; pointer-events: none;">👑 代表メイン写真</button>` 
            : `<button type="button" class="lightbox-ctrl-btn btn-batch-main-unset" data-gidx="${gIdx}" data-iidx="${iIdx}">☆ メインに設定</button>`
          }
          <button type="button" class="lightbox-ctrl-btn btn-batch-remove-img" data-gidx="${gIdx}" data-iidx="${iIdx}">📤 プールへ外す</button>
        </div>
      `;
    } else if (ctx.type === 'pool') {
      const idx = ctx.poolIdx;
      total = state.ungroupedImages.length;
      indicatorHTML = `<div class="lightbox-indicator">${idx + 1} / ${total}</div>`;

      if (total > 1) {
        arrowPrevHTML = `<button type="button" class="lightbox-arrow-btn prev" ${idx > 0 ? '' : 'style="opacity: 0.15; cursor: not-allowed; pointer-events: none;"'} title="前の写真へ">‹</button>`;
        arrowNextHTML = `<button type="button" class="lightbox-arrow-btn next" ${idx < total - 1 ? '' : 'style="opacity: 0.15; cursor: not-allowed; pointer-events: none;"'} title="次の写真へ">›</button>`;
      }

      let groupOptionsHTML = '';
      if (state.batchGroups.length > 0) {
        groupOptionsHTML = `
          <div style="display: flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.08); padding: 4px 10px; border-radius: 24px; border: 1px solid rgba(255,255,255,0.15); pointer-events: auto;">
            <select class="lightbox-group-selector" style="background: transparent; color: #fff; border: none; font-size: 0.8rem; outline: none; max-width: 140px; cursor: pointer; font-weight: bold;">
              ${state.batchGroups.map((g, i) => `<option value="${i}" style="background: #1e293b; color: #fff;">🍶 グループ #${i+1} (${g.length}枚)</option>`).join('')}
            </select>
            <button type="button" class="lightbox-ctrl-btn btn-pool-add-to-group" data-idx="${idx}" style="background: var(--accent-color) !important; color: #000 !important; border: none !important; padding: 6px 14px !important; font-size: 0.8rem !important; border-radius: 16px !important; height: auto !important; margin: 0 !important; box-shadow: none !important;">➕ 追加</button>
          </div>
        `;
      }

      controlsHTML = `
        <div class="lightbox-controls lightbox-pool-controls" style="display: flex; flex-direction: column; gap: 10px; margin-top: 16px; width: 100%; max-width: 480px; pointer-events: auto;">
          <div class="lightbox-pool-primary-actions">
            <button type="button" class="lightbox-ctrl-btn btn-pool-create-group" data-idx="${idx}">✨ 新しいお酒にする</button>
            ${groupOptionsHTML}
          </div>
        </div>
      `;
      detachedDangerHTML = `
        <div class="lightbox-pool-danger-overlay">
          <button type="button" class="lightbox-ctrl-btn btn-pool-delete-img" data-idx="${idx}">🗑️ 完全に削除</button>
        </div>
      `;
    } else if (ctx.type === 'detail-preview') {
      const idx = ctx.idx;
      total = state.detailImages.length;
      indicatorHTML = `<div class="lightbox-indicator">${idx + 1} / ${total}</div>`;

      if (total > 1) {
        arrowPrevHTML = `<button type="button" class="lightbox-arrow-btn prev" ${idx > 0 ? '' : 'style="opacity: 0.15; cursor: not-allowed; pointer-events: none;"'} title="前の写真へ">‹</button>`;
        arrowNextHTML = `<button type="button" class="lightbox-arrow-btn next" ${idx < total - 1 ? '' : 'style="opacity: 0.15; cursor: not-allowed; pointer-events: none;"'} title="次の写真へ">›</button>`;
      }
      controlsHTML = '';
    }
  }

  lightbox.innerHTML = `
    <div class="lightbox-content" style="display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; width: 100%;">
      <button type="button" class="lightbox-close" style="pointer-events: auto;">&times;</button>
      ${arrowPrevHTML}
      <img id="lightbox-img" src="${imageSrc}" alt="拡大画像" style="pointer-events: auto; cursor: zoom-out;" />
      ${arrowNextHTML}
      ${indicatorHTML}
      ${controlsHTML}
      ${detachedDangerHTML}
    </div>
  `;
  lightbox.classList.add('active');
  bindLightboxGestures(lightbox);
}

function bindLightboxGestures(lightbox) {
  const image = lightbox.querySelector('#lightbox-img');
  if (!image) return;

  image.addEventListener('error', () => {
    const ctx = state.activeLightboxCtx;
    const fallbackFile = ctx?.type === 'editor-preview'
      ? state.uploadedImages[ctx.idx]?.originalFile
      : ctx?.type === 'batch-group'
        ? state.batchGroups[ctx.gidx]?.[ctx.iidx]?.file
        : ctx?.type === 'pool'
          ? state.ungroupedImages[ctx.poolIdx]?.file
          : null;
    if (fallbackFile && image.dataset.fallbackApplied !== 'true') {
      image.dataset.fallbackApplied = 'true';
      image.src = URL.createObjectURL(fallbackFile);
    }
  });

  let startX = 0;
  let startY = 0;
  let moved = false;
  let scale = 1;
  const pointers = new Map();
  let pinchDistance = 0;
  let pinchScale = 1;
  const distance = (first, second) => Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
  const applyScale = () => {
    scale = Math.min(4, Math.max(1, scale));
    image.style.transform = `scale(${scale})`;
    image.classList.toggle('lightbox-image-zoomed', scale > 1);
  };

  image.addEventListener('wheel', (event) => {
    event.preventDefault();
    scale += event.deltaY < 0 ? 0.2 : -0.2;
    applyScale();
  }, { passive: false });

  image.addEventListener('pointerdown', (event) => {
    pointers.set(event.pointerId, event);
    startX = event.clientX;
    startY = event.clientY;
    moved = false;
    if (pointers.size === 2) {
      const [first, second] = pointers.values();
      pinchDistance = distance(first, second);
      pinchScale = scale;
    }
    image.setPointerCapture?.(event.pointerId);
  });

  image.addEventListener('pointermove', (event) => {
    pointers.set(event.pointerId, event);
    if (pointers.size === 2 && pinchDistance > 0) {
      const [first, second] = pointers.values();
      scale = pinchScale * distance(first, second) / pinchDistance;
      applyScale();
      moved = true;
      return;
    }
    moved = Math.abs(event.clientX - startX) > 12 || Math.abs(event.clientY - startY) > 12;
  });

  image.addEventListener('pointerup', (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size > 0) {
      pinchDistance = 0;
      return;
    }
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY)) {
      if (deltaX < 0) triggerLightboxNext();
      else triggerLightboxPrev();
      return;
    }
    if (!moved) {
      scale = scale > 1 ? 1 : 2;
      applyScale();
    }
  });
}

export function closeLightbox() {
  const lightbox = document.getElementById('lightbox-modal');
  if (lightbox) {
    lightbox.classList.remove('active');
  }
  state.activeLightboxCtx = null;
}

export function triggerLightboxNext() {
  if (!state.activeLightboxCtx) return;
  const ctx = state.activeLightboxCtx;
  if (ctx.type === 'editor-preview') {
    const idx = ctx.idx;
    if (idx < state.uploadedImages.length - 1) {
      const nextIdx = idx + 1;
      ctx.idx = nextIdx;
      openLightbox(getImagePreviewSrc(state.uploadedImages[nextIdx]), ctx);
    }
  } else if (ctx.type === 'batch-group') {
    const gIdx = ctx.gidx;
    const iIdx = ctx.iidx;
    const group = state.batchGroups[gIdx];
    if (group && iIdx < group.length - 1) {
      const nextIIdx = iIdx + 1;
      ctx.iidx = nextIIdx;
      openLightbox(getImagePreviewSrc(group[nextIIdx]), ctx);
    }
  } else if (ctx.type === 'pool') {
    const idx = ctx.poolIdx;
    if (idx < state.ungroupedImages.length - 1) {
      const nextIdx = idx + 1;
      ctx.poolIdx = nextIdx;
      openLightbox(getImagePreviewSrc(state.ungroupedImages[nextIdx]), ctx);
    }
  } else if (ctx.type === 'detail-preview') {
    const idx = ctx.idx;
    if (idx < state.detailImages.length - 1) {
      const nextIdx = idx + 1;
      ctx.idx = nextIdx;
      openLightbox(state.detailImages[nextIdx], ctx);
    }
  }
}

export function triggerLightboxPrev() {
  if (!state.activeLightboxCtx) return;
  const ctx = state.activeLightboxCtx;
  if (ctx.type === 'editor-preview') {
    const idx = ctx.idx;
    if (idx > 0) {
      const prevIdx = idx - 1;
      ctx.idx = prevIdx;
      openLightbox(getImagePreviewSrc(state.uploadedImages[prevIdx]), ctx);
    }
  } else if (ctx.type === 'batch-group') {
    const gIdx = ctx.gidx;
    const iIdx = ctx.iidx;
    const group = state.batchGroups[gIdx];
    if (group && iIdx > 0) {
      const prevIIdx = iIdx - 1;
      ctx.iidx = prevIIdx;
      openLightbox(getImagePreviewSrc(group[prevIIdx]), ctx);
    }
  } else if (ctx.type === 'pool') {
    const idx = ctx.poolIdx;
    if (idx > 0) {
      const prevIdx = idx - 1;
      ctx.poolIdx = prevIdx;
      openLightbox(getImagePreviewSrc(state.ungroupedImages[prevIdx]), ctx);
    }
  } else if (ctx.type === 'detail-preview') {
    const idx = ctx.idx;
    if (idx > 0) {
      const prevIdx = idx - 1;
      ctx.idx = prevIdx;
      openLightbox(state.detailImages[prevIdx], ctx);
    }
  }
}
