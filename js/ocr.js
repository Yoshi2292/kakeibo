const CATEGORIES_HINT = '食費/日用雑貨/外食費/医療費/被服費/電気代/水道代/交際費/スマホ通信費/スマホローン/都民共済/金・銀・プラチナ積立/プロバイダ料金/車関係費/フィットネス費/ペット費/教育費/娯楽費/税金/悠真おこづかい/給与/子供手当/その他';

let _model = null;
let _promptMode = 'standard';

export function setModel(model) { _model = model; }
export function getModel() { return _model ?? CONFIG.CLAUDE_MODEL; }
export function setPromptMode(mode) { _promptMode = mode; }
export function getPromptMode() { return _promptMode; }

const STORE_RULES = {
  // 英字ブランド名の日本語読み替えを許容（初期設定）
  standard: '支店名・店舗名まで含む正式名称。英字表記は日本語読みに変換してよい（例：ORIHICA→オリヒカ）。不明ならnull',
  // 印字された文字をそのまま読む（推測禁止）
  strict:   'レシートに印字された文字を一字一句そのまま読み取った支店名・店舗名。記憶・推測・補完は絶対にしないこと。不明ならnull',
};

function buildPrompt(count) {
  const today = new Date().toISOString().slice(0, 10);
  const storeRule = STORE_RULES[_promptMode] ?? STORE_RULES.standard;
  const common = `
- date: レシートに印字された日付をYYYY-MM-DD形式で。不明ならnull。今日は${today}
- store: ${storeRule}
- amount: レシートの合計金額（数値のみ）。不明ならnull
- large_category: "支出" または "収入"
- medium_category: ${CATEGORIES_HINT} から最適なもの`.trim();

  if (count === 1) {
    return `このレシート画像から情報を抽出し、以下のJSON形式のみで返してください。説明文は不要です。

各フィールドの抽出ルール:
${common}

{
  "date": "YYYY-MM-DD",
  "store": "正式店舗名",
  "amount": 数値,
  "large_category": "支出 または 収入",
  "medium_category": "カテゴリ名"
}`;
  }
  return `これら${count}枚のレシート画像それぞれから情報を抽出し、JSON配列のみで返してください。要素数は必ず${count}個、画像の順番に対応させてください。説明文は不要です。

各フィールドの抽出ルール:
${common}

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

export async function analyzeReceipts(images) {
  const content = images.map((img) => ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: img.base64 },
  }));
  content.push({ type: 'text', text: buildPrompt(images.length) });

  const res = await fetch(CONFIG.CLAUDE_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: getModel(),
      max_tokens: 512 * images.length,
      messages: [{ role: 'user', content }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `OCR 失敗 (${res.status})`);
  }

  const data = await res.json();
  const raw = data.content?.[0]?.text?.trim() ?? '';
  const cleaned = raw.replace(/```(?:json)?/g, '').trim();

  if (images.length === 1) {
    const match = cleaned.match(/\{[\s\S]*?\}/);
    if (!match) throw new Error('OCR 結果の解析に失敗しました');
    return [JSON.parse(match[0])];
  }

  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('OCR 結果の解析に失敗しました');
  return JSON.parse(match[0]);
}
