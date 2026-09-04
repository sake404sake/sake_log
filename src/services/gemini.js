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

/**
 * 利用可能なGeminiモデル一覧を取得
 */
export async function fetchAvailableModels() {
  const apiKey = getApiKey().trim();
  if (!apiKey) return [];

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!res.ok) throw new Error(`モデル一覧取得失敗 (${res.status})`);
    
    const data = await res.json();
    
    // 画像解析 (generateContent) に対応したモデルのみを抽出
    return (data.models || []).filter(m => 
      m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent')
    );
  } catch (error) {
    console.error('Fetch Models Error:', error);
    return [];
  }
}

/**
 * リストの中から最適なデフォルトモデルを自動決定
 */
export function autoSelectBestModel(models) {
  if (!models || models.length === 0) return '';

  // 安定版 flash モデルを最優先
  const flashModel = models.find(m => m.name.includes('gemini-1.5-flash') || (m.name.includes('flash') && !m.name.includes('experimental') && !m.name.includes('2.5')));
  if (flashModel) return flashModel.name;

  const proModel = models.find(m => m.name.includes('pro') && !m.name.includes('experimental'));
  if (proModel) return proModel.name;

  return models[0].name;
}

/**
 * 実際に使用するモデル名を確定する（非推奨モデルの自動クリア含む）
 */
export async function getOrDetermineModel() {
  const models = await fetchAvailableModels();
  if (models.length === 0) return getSavedModel() || 'models/gemini-1.5-flash';

  const saved = getSavedModel();

  // gemini-2.5-flash などの非推奨/無効なモデルが保存されている場合は上書きリセット
  if (saved && (saved.includes('2.5') || !models.some(m => m.name === saved))) {
    const bestModel = autoSelectBestModel(models);
    setSavedModel(bestModel);
    return bestModel;
  }

  if (saved) return saved;

  const bestModel = autoSelectBestModel(models);
  setSavedModel(bestModel);
  return bestModel;
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

  const targetModel = await getOrDetermineModel();
  const modelPath = targetModel.startsWith('models/') ? targetModel : `models/${targetModel}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${apiKey}`;

  // プロンプトから "notes" を排除し、AI情報はすべて "aiInfo" に集約
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