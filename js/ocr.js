const PROMPT = `このレシート画像から情報を抽出し、以下のJSON形式のみで返してください。説明文は不要です。

{
  "date": "YYYY-MM-DD（レシートの日付。不明ならnull）",
  "store": "店名・支払先（不明ならnull）",
  "amount": 合計金額の数値（税込み・円、不明ならnull）,
  "large_category": "支出 または 収入",
  "medium_category": "食費/日用雑貨/外食費/医療費/被服費/電気代/水道代/交際費/スマホ通信費/スマホローン/都民共済/金・銀・プラチナ積立/プロバイダ料金/車関係費/フィットネス費/ペット費/教育費/娯楽費/税金/悠真おこづかい/給与/子供手当/その他 から最適なもの"
}`;

export async function analyzeReceipt(base64Image) {
  const res = await fetch(CONFIG.CLAUDE_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: base64Image },
          },
          { type: 'text', text: PROMPT },
        ],
      }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `OCR 失敗 (${res.status})`);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text?.trim() ?? '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('OCR 結果の JSON 解析に失敗しました');

  return JSON.parse(match[0]);
}
