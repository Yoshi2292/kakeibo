import { getToken } from './auth.js';

// 日付文字列（YYYY-MM-DD）→ シート名（YYYY.M）
function dateToSheetName(dateStr) {
  const d = new Date(dateStr || Date.now());
  if (isNaN(d.getTime())) {
    const now = new Date();
    return `${now.getFullYear()}.${now.getMonth() + 1}`;
  }
  return `${d.getFullYear()}.${d.getMonth() + 1}`;
}

export async function appendRow(fields) {
  const token = await getToken();

  const row = [
    fields.date             ?? '', // B: 日付
    '',                            // C: 空白
    fields.large_category   ?? '', // D: 大カテゴリ
    fields.medium_category  ?? '', // E: 中カテゴリ
    fields.store            ?? '', // F: 支払先
    fields.amount           ?? '', // G: 金額
    fields.user             ?? '', // H: 使用者
  ];

  const sheetName = dateToSheetName(fields.date);
  const range = encodeURIComponent(`'${sheetName}'`) + '!B:H';
  const url = [
    `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}`,
    `/values/${range}:append`,
    `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
  ].join('');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [row] }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `Sheets 保存失敗 (${res.status})`);
  }

  return res.json();
}
