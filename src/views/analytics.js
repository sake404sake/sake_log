import { getAllLogs } from '../store/db.js';
import { getApiKey, requestGeminiText } from '../services/gemini.js';

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function localDateKey(value) {
  const match = String(value || '').match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : '';
}

function buildSummary(logs) {
  const categoryCounts = {};
  const nameCounts = {};
  const ratingTotal = logs.reduce((sum, log) => sum + (Number(log.rating) || 0), 0);
  const abvValues = logs.map(log => Number(log.abv)).filter(value => Number.isFinite(value));
  logs.forEach(log => {
    const category = log.category || 'その他';
    const name = log.name || '名称未設定';
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    nameCounts[name] = (nameCounts[name] || 0) + 1;
  });
  return {
    total: logs.length,
    averageRating: logs.length ? (ratingTotal / logs.length).toFixed(1) : '0.0',
    averageAbv: abvValues.length ? (abvValues.reduce((sum, value) => sum + value, 0) / abvValues.length).toFixed(1) : '-',
    categoryCounts,
    nameCounts
  };
}

function rankingHTML(counts) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!entries.length) return '<p class="analytics-muted">まだ酒ログがありません。</p>';
  const max = entries[0][1];
  return entries.map(([name, count], index) => `
    <div class="analytics-ranking-row">
      <span class="analytics-rank">${index + 1}</span>
      <span class="analytics-ranking-name">${escapeHtml(name)}</span>
      <span class="analytics-ranking-bar"><i style="width:${Math.max(12, count / max * 100)}%"></i></span>
      <strong>${count}回</strong>
    </div>`).join('');
}

export async function renderAnalyticsView() {
  const logs = await getAllLogs(false, false);
  const summary = buildSummary(logs);
  const today = new Date();
  const pastRecords = logs.filter(log => {
    const date = localDateKey(log.date);
    if (!date) return false;
    const logDate = new Date(`${date}T12:00:00`);
    return logDate.getMonth() === today.getMonth() && logDate.getDate() === today.getDate() && logDate.getFullYear() < today.getFullYear();
  }).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const aiStatus = getApiKey() ? 'AI分析を実行できます' : 'APIキーがないためAI分析は利用できません。設定画面でAPIキーを登録してください。';
  const pastRecordsHTML = pastRecords.length ? `
      <section class="analytics-card"><h3>あれば X年前の今日飲んだお酒</h3>
        ${pastRecords.map(log => {
          const date = localDateKey(log.date);
          const yearsAgo = today.getFullYear() - Number(date.slice(0, 4));
          return `<div class="analytics-memory-row"><strong>${yearsAgo}年前の今日</strong><span>（${escapeHtml(date)}）</span><span>${escapeHtml(log.name || '名称未設定')}</span></div>`;
        }).join('')}
      </section>` : '';

  return `
    <div class="analytics-container">
      <div class="dashboard-header analytics-header"><h2>Analytics</h2><p>酒ログから飲み方の傾向を見える化します。</p></div>
      <div class="analytics-summary-grid">
        <div class="analytics-stat"><span>呑んだ回数</span><strong>${summary.total}</strong><small>件</small></div>
        <div class="analytics-stat"><span>平均評価</span><strong>${summary.averageRating}</strong><small>/ 5.0</small></div>
        <div class="analytics-stat"><span>平均度数</span><strong>${summary.averageAbv}</strong><small>%</small></div>
      </div>
      <section class="analytics-card"><h3>呑んだ回数ランキング</h3><div class="analytics-ranking">${rankingHTML(summary.nameCounts)}</div></section>
      <section class="analytics-card"><div class="analytics-card-heading"><h3>好みのお酒の傾向</h3><button type="button" class="btn-secondary analytics-ai-button" data-analytics-ai="preference">AIで分析</button></div><p class="analytics-muted">カテゴリ別の登録回数をチャート表示しています。</p><div class="analytics-chart">${rankingHTML(summary.categoryCounts)}</div><div id="analytics-preference-result" class="analytics-ai-result">${escapeHtml(aiStatus)}</div></section>
      ${pastRecordsHTML}
      <section class="analytics-card"><div class="analytics-card-heading"><h3>本日のおすすめ</h3><button type="button" class="btn-secondary analytics-ai-button" data-analytics-ai="recommendation">AIで提案</button></div><div id="analytics-recommendation-result" class="analytics-ai-result">${escapeHtml(aiStatus)}</div></section>
    </div>
  `;
}

export async function runAnalyticsAI(kind) {
  const resultId = kind === 'preference' ? 'analytics-preference-result' : 'analytics-recommendation-result';
  const resultEl = document.getElementById(resultId);
  if (!resultEl) return;
  if (!getApiKey()) {
    resultEl.textContent = 'APIキーがないためAI分析は利用できません。設定画面でAPIキーを登録してください。';
    return;
  }
  const logs = await getAllLogs(false, false);
  if (!logs.length) {
    resultEl.textContent = '分析できる酒ログがまだありません。';
    return;
  }
  resultEl.innerHTML = '<span class="sella-spinner"></span> AIが分析中...';
  const compactLogs = logs.map(log => ({ name: log.name, category: log.category, brewery: log.brewery, region: log.region, type: log.type, abv: log.abv, rating: log.rating, date: log.date, notes: log.notes })).slice(0, 100);
  const prompt = kind === 'preference'
    ? `以下の酒ログから、利用者の好みの傾向を日本語で3点以内に簡潔に説明してください。根拠としてカテゴリ、酒蔵、度数、評価に触れてください。\n${JSON.stringify(compactLogs)}`
    : `以下の酒ログを参考に、本日おすすめの一杯を1つ提案してください。候補がある場合は銘柄名と理由を日本語で簡潔に答えてください。\n${JSON.stringify(compactLogs)}`;
  try {
    resultEl.textContent = await requestGeminiText(prompt);
  } catch (error) {
    resultEl.textContent = `AI分析に失敗しました: ${error.message}`;
  }
}
