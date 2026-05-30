import { getToken } from './auth.js';

// 日付文字列（YYYY-MM-DD）→ シート名（YYYY.M）
function dateToSheetName(dateStr) {
  const d = new Date(dateStr);
  if (!dateStr || isNaN(d.getTime())) return CONFIG.SHEET_NAME;
  return `${d.getFullYear()}.${d.getMonth() + 1}`;
}

export async function appendRow(fields) {
  const token = await getToken();

  const row = [
    fields.date          ?? '',
    fields.large_category  ?? '',
    fields.medium_category ?? '',
    fields.store         ?? '',
    fields.amount        ?? '',
    fields.user          ?? '',
  ];

  const sheetName = dateToSheetName(fields.date);
  const range = encodeURIComponent(`'${sheetName}'`) + '!A:F';
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
