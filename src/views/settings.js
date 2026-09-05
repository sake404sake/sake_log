export function renderSettingsView() {
  const savedKey = localStorage.getItem('gemini_api_key') || '';
  const currentTheme = localStorage.getItem('sella_theme') || 'dark';

  return `
<div class="settings-container">
  <div class="settings-card">
    <div class="card-title">
      <span class="icon">🤖</span>
      <h3>Gemini API 設定（無料）</h3>
    </div>
    <p class="card-desc">お酒のラベル解析に使用します。約1分で取得可能です。</p>

    <div class="guide-steps">
      <div class="step-item"><span class="step-num">1</span><span>下のボタンを押して Google AI Studio を開く</span></div>
      <div class="step-item"><span class="step-num">2</span><span>「<strong>Create API key</strong>」を押して表示されたキーをコピー</span></div>
      <div class="step-item"><span class="step-num">3</span><span>下の入力欄に貼り付けて「保存」を押す</span></div>
    </div>

    <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" class="btn-external-link" style="display: inline-block; margin-bottom: 12px;">
      <span>🚀 APIキー発行画面を開く (Google)</span>
    </a>

    <div class="form-group" style="margin-bottom: 16px;">
      <label for="gemini-api-key">APIキー</label>
      <div class="input-group">
        <input type="password" class="input-dark" id="gemini-api-key" value="${savedKey}" placeholder="AIzaSy..." />
        <button class="btn-primary" id="btn-save-api-key">保存</button>
      </div>
      <p id="api-key-msg" style="font-size: 0.8rem; margin-top: 8px; color: #4cd964; display: none;">✓ キーを保存しました</p>
    </div>

    <div class="form-group">
      <label for="select-gemini-model">使用するAIモデル</label>
      <div class="input-group">
        <select id="select-gemini-model" class="input-dark">
          <option value="">モデルを取得中...</option>
        </select>
        <button type="button" id="btn-reload-models" class="btn-secondary">再取得</button>
      </div>
    </div>
  </div>

  <div class="settings-card" style="margin-top: 20px;">
    <div class="card-title">
      <span class="icon">🎨</span>
      <h3>アプリのテーマ（配色）変更</h3>
    </div>
    <p class="card-desc">お好みのカラーテーマにデザインを切り替えます。</p>
    <div class="form-group">
      <label for="theme-select">配色テーマ</label>
      <select id="theme-select" class="input-dark">
        <option value="dark" ${currentTheme === 'dark' ? 'selected' : ''}>🌙 ダーク（デフォルト）</option>
        <option value="light" ${currentTheme === 'light' ? 'selected' : ''}>☀️ ライト（明るい画面）</option>
        <option value="sakura" ${currentTheme === 'sakura' ? 'selected' : ''}>🌸 桜（さくら）</option>
        <option value="gaming" ${currentTheme === 'gaming' ? 'selected' : ''}>🎮 ゲーム（サイバーネオン）</option>
        <option value="japan-modern" ${currentTheme === 'japan-modern' ? 'selected' : ''}>🏯 モダン（墨・朱・金）</option>
      </select>
    </div>
  </div>
</div>
  `;
}
