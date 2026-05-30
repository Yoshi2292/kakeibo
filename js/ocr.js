import { getToken } from './auth.js';

const CATEGORIES_HINT = '食費/日用雑貨/外食費/医療費/被服費/電気代/水道代/交際費/スマホ通信費/スマホローン/都民共済/金・銀・プラチナ積立/プロバイダ料金/車関係費/フィットネス費/ペット費/教育費/娯楽費/税金/悠真おこづかい/給与/子供手当/その他';

// Stage 1: Google Cloud Vision API でテキスト抽出
async function extractText(base64Image, token) {
  const res = await fetch('https://vision.googleapis.com/v1/images:annotate', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [{
        image: { content: base64Image },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
      }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `Vision API 失敗 (${res.status})`);
  }
  const data = await res.json();
  return data.responses[0]?.fullTextAnnotation?.text ?? '';
}

// Stage 2: Claude でテキスト → JSON 構造化
function buildStructurePrompt(texts) {
  const today = new Date().toISOString().slice(0, 10);
  const blocks = texts.map((t, i) => `--- レシート${i + 1} ---\n${t}`).join('\n\n');
  return `以下は${texts.length}枚のレシートから抽出したテキストです。各レシートの情報を構造化し、JSON配列のみで返してください。要素数は必ず${texts.length}個、レシートの順番に対応させてください。説明文は不要です。

${blocks}

各フィールドの抽出ルール:
- date: レシートに印字された日付をYYYY-MM-DD形式で。不明ならnull。今日は${today}
- store: 支店名・店舗名まで含む正式名称（例：無印良品むさし村山店）。不明ならnull
- amount: レシートの合計金額（数値のみ）。不明ならnull
- large_category: "支出" または "収入"
- medium_category: ${CATEGORIES_HINT} から最適なもの

[
  {
    "date": "YYYY-MM-DD",
    "store": "正式店舗名",
    "amount": 数値,
    "large_category": "支出 または 収入",
    "medium_category": "カテゴリ名"
  }
]`;
}

async function structureWithClaude(texts) {
  const res = await fetch(CONFIG.CLAUDE_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: 256 * texts.length,
      messages: [{ role: 'user', content: buildStructurePrompt(texts) }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `Claude 構造化失敗 (${res.status})`);
  }
  const data = await res.json();
  const raw = data.content?.[0]?.text?.trim() ?? '';
  const cleaned = raw.replace(/```(?:json)?/g, '').trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('Claude 構造化結果の解析に失敗しました');
  return JSON.parse(match[0]);
}

export async function analyzeReceipts(images) {
  const token = await getToken();

  // Stage 1: 全画像を並列でテキスト抽出
  const texts = await Promise.all(images.map((img) => extractText(img.base64, token)));
  console.log('[kakeibo] Vision API テキスト抽出完了:', texts);

  // Stage 2: Claude でまとめて構造化
  return structureWithClaude(texts);
}
