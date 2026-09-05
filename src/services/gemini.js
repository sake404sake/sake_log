const STORAGE_KEY_API = 'gemini_api_key';
const STORAGE_KEY_MODEL = 'gemini_selected_model';

export function getApiKey() {
  return localStorage.getItem(STORAGE_KEY_API) || '';
}

export function saveApiKey(key) {
  localStorage.setItem(STORAGE_KEY_API, key.trim());
}

export function getSavedModel() {
  return localStorage.getItem(STORAGE_KEY_MODEL) || '';
}

export function setSavedModel(modelName) {
  localStorage.setItem(STORAGE_KEY_MODEL, modelName);
}

export function hasApiKey() {
  return Boolean(getApiKey().trim());
}

let cachedModels = null;
let lastApiKey = null;

const DEFAULT_MODELS = [
  { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash (推奨・安定)', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-1.5-flash', displayName: 'Gemini 1.5 Flash', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-1.5-pro', displayName: 'Gemini 1.5 Pro', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.1-pro-preview-customtools', displayName: 'Gemini 3.1 Pro Preview', supportedGenerationMethods: ['generateContent'] }
];

/**
 * 利用可能なGeminiモデル一覧を取得
 */
export async function fetchAvailableModels(forceRefresh = false) {
  const apiKey = getApiKey().trim();
  if (!apiKey) return [];

  // 強制リフレッシュ時はキャッシュを確実にクリアする
  if (forceRefresh) {
    cachedModels = null;
  }

  if (cachedModels && lastApiKey === apiKey) {
    return cachedModels;
  }

  const uniqueMap = new Map();
  // 1. まず確実にデフォルトモデルを登録
  DEFAULT_MODELS.forEach(m => uniqueMap.set(m.name, m));

  // 2. APIからの取得を試みる（CORS等で失敗する場合はフォールバックを維持）
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (res.ok) {
      const data = await res.json();
      const apiModels = data.models || [];
      apiModels.forEach(m => {
        const methods = m.supportedGenerationMethods || [];
        const name = (m.name || '').toLowerCase();
        const supportsContent = methods.includes('generateContent');
        const isUnusable = name.includes('tts') || name.includes('imagen') || name.includes('embedding') || name.includes('banana');

        if (supportsContent && !isUnusable) {
          if (!uniqueMap.has(m.name)) {
            uniqueMap.set(m.name, {
              name: m.name,
              displayName: m.displayName || m.name,
              supportedGenerationMethods: methods
            });
          }
        }
      });
    }
  } catch (error) {
    console.warn('API model fetch blocked or failed (using default model list):', error);
  }

  cachedModels = Array.from(uniqueMap.values());
  lastApiKey = apiKey;
  return cachedModels;
}

/**
 * リストの中から最適なデフォルトモデルを自動決定
 */
export function autoSelectBestModel(models) {
  if (!models || models.length === 0) return 'models/gemini-2.5-flash';
  const flash25 = models.find(m => m.name.includes('gemini-2.5-flash'));
  if (flash25) return flash25.name;
  const flash20 = models.find(m => m.name.includes('gemini-2.0-flash'));
  if (flash20) return flash20.name;
  const flash15 = models.find(m => m.name.includes('gemini-1.5-flash'));
  if (flash15) return flash15.name;
  return models[0].name || 'models/gemini-2.5-flash';
}

/**
 * 実際に使用するモデル名を確定する
 */
export async function getOrDetermineModel() {
  const modalSelect = document.querySelector('.modal-overlay .model-select') || document.getElementById('select-gemini-model');
  if (modalSelect && modalSelect.value) {
    return modalSelect.value;
  }

  const models = await fetchAvailableModels();
  if (models.length === 0) return getSavedModel() || 'models/gemini-2.5-flash';

  const saved = getSavedModel();
  if (saved && models.some(m => m.name === saved)) {
    return saved;
  }

  const bestModel = autoSelectBestModel(models);
  setSavedModel(bestModel);
  return bestModel;
}

/**
 * 任意のセレクトボックス要素にモデル一覧を同期・反映する共通関数
 */
export async function populateModelDropdown(selectElement, forceRefresh = false) {
  if (!selectElement) return;

  const apiKey = getApiKey();
  if (!apiKey) {
    selectElement.innerHTML = '<option value="">APIキーを入力してください</option>';
    return;
  }

  selectElement.innerHTML = '<option value="">モデルを取得中...</option>';
  const models = await fetchAvailableModels(forceRefresh);

  if (models.length === 0) {
    selectElement.innerHTML = '<option value="">有効なモデルが見つかりません</option>';
    return;
  }

  let currentSaved = getSavedModel();
  if (!currentSaved || !models.some(m => m.name === currentSaved)) {
    currentSaved = autoSelectBestModel(models);
    setSavedModel(currentSaved);
  }

  selectElement.innerHTML = models.map(m => {
    const val = m.name;
    const text = m.displayName || m.name;
    const isSelected = (val === currentSaved) ? 'selected' : '';
    return `<option value="${val}" ${isSelected}>${text}</option>`;
  }).join('');
}

/**
 * 酒ラベル画像解析の実行
 */
export async function analyzeLabelImage(base64Image, mimeType = 'image/jpeg') {
  const apiKey = getApiKey().trim();
  if (!apiKey) {
    alert('APIキーが設定されていません。設定画面でキーを登録してください。');
    return null;
  }

  let targetModel = '';
  const activeModalSelect = document.querySelector('.modal-overlay .model-select');
  const globalSelect = document.getElementById('select-gemini-model');
  const candidateSelect = activeModalSelect || globalSelect;

  if (candidateSelect && candidateSelect.value) {
    targetModel = candidateSelect.value;
  }

  if (!targetModel) {
    targetModel = await getOrDetermineModel();
  }

  const modelPath = targetModel.startsWith('models/') ? targetModel : `models/${targetModel}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${apiKey}`;

  const prompt = `あなたは日本酒・お酒のラベル解析のエキスパートです。
画像から情報を読み取り、以下のJSONフォーマットのみを出力してください（Markdown記法や前置きテキストは一切含めないでください）。

{
  "category": "日本酒",
  "name": "銘柄名",
  "productName": "商品名・特定名称等",
  "brewery": "酒蔵・メーカー名",
  "region": "産地（都道府県など）",
  "type": "特定名称・格付",
  "abv": "16",
  "aiInfo": "味の特徴、おすすめの飲み方や補足情報"
}`;

  const payload = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Image
            }
          }
        ]
      }
    ],
    generationConfig: {
      response_mime_type: "application/json"
    }
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const msg = errData.error?.message || `HTTPエラー (${response.status})`;
      console.error('Gemini API Error Detail:', errData);
      alert(`解析に失敗しました (${targetModel}):\n${msg}`);
      return null;
    }

    const data = await response.json();
    const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!textResponse) {
      alert('解析結果のテキストを取得できませんでした。');
      return null;
    }

    return JSON.parse(textResponse);
  } catch (error) {
    console.error('Analysis Exception:', error);
    alert(`通信または処理中にエラーが発生しました:\n${error.message}`);
    return null;
  }
}