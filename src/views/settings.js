// src/views/settings.js

import { getApiKey } from '../services/gemini.js';
import { state } from '../store/state.js';

export function renderSettingsView() {
  const savedKey = getApiKey();
  const currentTheme = localStorage.getItem('sella_theme') || 'dark';
  const lastSynced = localStorage.getItem('sella_last_synced_time') || '未同期';

  const isGoogleConnected = state.isGoogleLoggedIn || localStorage.getItem('sella_google_logged_in') === 'true';

  return `
    <style>
      .settings-container {
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
      }
      .settings-card {
        box-sizing: border-box;
        width: 100%;
        max-width: 100%;
        overflow: hidden;
      }
      .settings-card .input-dark {
        min-width: 0 !important;
        box-sizing: border-box !important;
      }
      .btn-external-link {
        word-break: break-all;
        white-space: normal;
      }
      /* 📱 スマホ用超レスポンシブ強制パッチ (優先度の高い詳細セレクタで上書き) */
      @media (max-width: 600px) {
        .settings-card {
          padding: 12px !important;
        }
        /* グローバルな style.txt の settings-card button nowrap を徹底的に上書き破壊 */
        .settings-card button,
        .settings-card .btn-primary,
        .settings-card .btn-secondary,
        #btn-destroy-all-data {
          white-space: normal !important;
          word-break: break-all !important;
          flex-shrink: 1 !important;
          height: auto !important;
          min-height: 40px !important;
          width: 100% !important;
          max-width: 100% !important;
          padding: 10px 12px !important;
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          box-sizing: border-box !important;
          text-align: center !important;
        }
        .settings-card .input-group {
          flex-direction: column !important;
          align-items: stretch !important;
          width: 100% !important;
          gap: 8px !important;
        }
        .settings-card .input-group .input-dark,
        .settings-card .input-group select,
        .settings-card .input-group input {
          width: 100% !important;
          flex: none !important;
          box-sizing: border-box !important;
        }
        .settings-sync-status {
          flex-direction: column !important;
          align-items: stretch !important;
          gap: 12px !important;
        }
        .settings-sync-buttons {
          flex-direction: column !important;
          align-items: stretch !important;
          width: 100% !important;
          gap: 8px !important;
        }
        .settings-sync-buttons button {
          width: 100% !important;
          margin: 0 !important;
          box-sizing: border-box !important;
        }
        /* ガイド文や危険テキストの回り込み・はみ出し防止 */
        .card-desc, .step-item span, label, .step-item {
          word-break: break-all !important;
          overflow-wrap: break-word !important;
          white-space: normal !important;
        }
        .step-item {
          display: flex !important;
          align-items: flex-start !important;
        }
        .step-num {
          flex-shrink: 0 !important;
        }
      }
    </style>

    <div class="settings-container">
      <div class="dashboard-header" style="margin-bottom: 16px;">
        <h2>設定・認証連携</h2>
      </div>

      <!-- 🧠 API設定カード -->
      <div class="settings-card" id="gemini-api-settings-card" style="margin-bottom: 16px;">
        <div class="card-title">
          <span class="icon" style="font-size: 1.25rem;">🧠</span>
          <h3>Gemini API 設定</h3>
        </div>
        <p class="card-desc">
          AIラベル解析・お酒情報補足機能を利用するために、Google AI Studio で発行したAPIキーを設定してください。
        </p>

        <div class="guide-steps" style="margin-bottom: 12px; font-size: 0.82rem; color: var(--text-sub); display: flex; flex-direction: column; gap: 4px;">
          <div class="step-item"><span class="step-num" style="background: var(--accent-color); color:#000; border-radius:50%; width:16px; height:16px; display:inline-flex; align-items:center; justify-content:center; font-size:10px; margin-right:6px; font-weight:bold;">1</span><span>APIキー発行画面を開くを押してキーを作成</span></div>
          <div class="step-item"><span class="step-num" style="background: var(--accent-color); color:#000; border-radius:50%; width:16px; height:16px; display:inline-flex; align-items:center; justify-content:center; font-size:10px; margin-right:6px; font-weight:bold;">2</span><span>表示されたキーをコピーし、下の入力欄に貼り付けて「保存」を押す</span></div>
        </div>

        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px;">
          <button type="button" id="btn-open-gemini-api-key" class="btn-primary" style="font-size: 0.82rem;">🚀 APIキーを取得</button>
          <button type="button" id="btn-paste-gemini-api-key" class="btn-secondary" style="font-size: 0.82rem;">📋 コピーしたキーを貼り付け</button>
        </div>

        <div class="form-group" style="margin-bottom: 16px;">
          <label for="gemini-api-key">Gemini APIキー</label>
          <div class="input-group" style="display: flex; gap: 8px;">
            <input type="password" class="input-dark" id="gemini-api-key" value="${savedKey}" placeholder="AIzaSy..." style="flex: 1; min-width: 0;" />
            <button type="button" class="btn-primary" id="btn-save-api-key" style="height: auto;">保存して接続確認</button>
          </div>
          <p id="api-key-msg" style="font-size: 0.8rem; margin-top: 8px; color: #4cd964; display: none;">✓ キーを保存しました</p>
        </div>

        <div class="form-group">
          <label for="select-gemini-model">使用するAIモデル</label>
          <div class="input-group" style="display: flex; gap: 8px;">
            <select id="select-gemini-model" class="input-dark" style="flex: 1; min-width: 0;">
              <option value="">モデルを取得中...</option>
            </select>
            <button type="button" id="btn-reload-models" class="btn-secondary">再取得</button>
          </div>
        </div>
      </div>

      <!-- ☁️ Googleアカウント同期カード (AppData方式) -->
      <div class="settings-card" style="margin-bottom: 16px;">
        <div class="card-title">
          <span class="icon" style="font-size: 1.25rem;">☁️</span>
          <h3>Googleアカウントデータ同期 (クラウド)</h3>
        </div>
        <p class="card-desc">
          Google Driveの「アプリケーション専用隠しフォルダ (AppData)」領域を使用し、画像を含めた全ての酒ログデータをクラウドに安全に同期・バックアップします。他デバイス間での一括共有も可能です。
        </p>

        <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); border-radius: 8px; padding: 14px; margin-top: 14px;">
          <div class="settings-sync-status" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
            <div>
              <div style="font-weight: bold; color: var(--text-main); font-size: 0.9rem; display: flex; align-items: center; gap: 6px;">
                <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${isGoogleConnected ? '#10b981' : '#ef4444'};"></span>
                連携状態: ${isGoogleConnected ? 'Google Drive 同期中' : '未連携・オフライン'}
              </div>
              <div style="font-size: 0.75rem; color: var(--text-sub); margin-top: 4px;">
                最終同期: <span id="sync-time-lbl" style="font-weight: bold; color: var(--text-main);">${lastSynced}</span>
              </div>
            </div>
            
            <div class="settings-sync-buttons" style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
              ${isGoogleConnected ? `
                <button type="button" id="btn-trigger-sync" class="btn-primary" style="background: #10b981;" ${state.isSyncing ? 'disabled' : ''}>
                  ${state.isSyncing ? '<span class="sella-spinner"></span>同期中' : '🔄 今すぐ同期'}
                </button>
                <button type="button" id="btn-google-logout" class="btn-secondary" style="color: #ef4444; border-color: rgba(239, 68, 68, 0.3); margin: 0;">
                  切断 (ログアウト)
                </button>
              ` : `
                <button type="button" id="btn-google-login" class="btn-primary" style="background: var(--accent-color); color: #000; width: 100%;">
                  Googleアカウントでログイン
                </button>
              `}
            </div>
          </div>
        </div>
      </div>

      <!-- 🎨 テーマ設定カード -->
      <div class="settings-card" style="margin-bottom: 16px;">
        <div class="card-title">
          <span class="icon" style="font-size: 1.25rem;">🎨</span>
          <h3>アプリテーマ設定</h3>
        </div>
        <p class="card-desc">
          お好みの配色テーマに切り替えることができます。
        </p>
        <div class="form-group">
          <label for="theme-select">配色テーマ</label>
          <select id="theme-select" class="input-dark">
            <option value="dark" ${currentTheme === 'dark' ? 'selected' : ''}>ダーク</option>
            <option value="light" ${currentTheme === 'light' ? 'selected' : ''}>ライト</option>
            <option value="sakura" ${currentTheme === 'sakura' ? 'selected' : ''}>桜</option>
            <option value="moon" ${currentTheme === 'moon' ? 'selected' : ''}>月</option>
            <option value="maple" ${currentTheme === 'maple' ? 'selected' : ''}>楓</option>
            <option value="nature" ${currentTheme === 'nature' ? 'selected' : ''}>自然</option>
            <option value="water" ${currentTheme === 'water' ? 'selected' : ''}>水</option>
            <option value="bar" ${currentTheme === 'bar' ? 'selected' : ''}>洋風のバー</option>
            <option value="kominka" ${currentTheme === 'kominka' ? 'selected' : ''}>古民家</option>
            <option value="japan-modern" ${currentTheme === 'japan-modern' ? 'selected' : ''}>和モダン</option>
            <option value="gaming" ${currentTheme === 'gaming' ? 'selected' : ''}>ゲーム</option>
          </select>
        </div>
      </div>

      <!-- ⚠️ 危険セクション (データ完全消去) -->
      <div class="settings-card" style="border-color: #ef4444; background-color: rgba(239, 68, 68, 0.02); margin-top: 24px;">
        <div class="card-title" style="color: #ef4444;">
          <span class="icon" style="font-size: 1.25rem;">⚠️</span>
          <h3 style="color: #ef4444;">危険ゾーン: データの完全消去</h3>
        </div>
        <p class="card-desc" style="color: var(--text-sub);">
          この操作は取り返しがつきません。ローカルブラウザのデータベース(IndexedDB)、キャッシュ、およびGoogle Drive AppDataに保存されているすべてのログと画像を<strong>完全に、かつ永久に抹消</strong>します。
        </p>

        <div style="background: rgba(239, 68, 68, 0.05); border: 1px dashed rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 14px;">
          <div class="form-group" style="margin-bottom: 12px;">
            <label for="destroy-validation-input" style="color: #ef4444; font-weight: bold;">
              確認のため、下に「データをすべて消去する」と入力してください
            </label>
            <input type="text" class="input-dark" id="destroy-validation-input" placeholder="データをすべて消去する" style="border-color: rgba(239, 68, 68, 0.3);" />
          </div>
          <button type="button" id="btn-destroy-all-data" class="btn-primary" disabled 
                  style="background: #ef4444; color: #fff; border: none; width: 100%; justify-content: center; display: inline-flex; align-items: center; font-weight: bold; opacity: 0.3; cursor: not-allowed;">
            🚨 クラウドを含むすべてのデータを永久に消去する
          </button>
        </div>
      </div>

    </div>
  `;
}
