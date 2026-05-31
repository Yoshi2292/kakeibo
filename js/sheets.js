import { getToken } from './auth.js';

function dateToSheetName(dateStr) {
  const d = new Date(dateStr || Date.now());
  if (isNaN(d.getTime())) {
    const now = new Date();
    return `${now.getFullYear()}.${now.getMonth() + 1}`;
  }
  return `${d.getFullYear()}.${d.getMonth() + 1}`;
}

async function sheetsFetch(token, url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `Sheets API エラー (${res.status})`);
  }
  return res.json();
}

export async function appendRow(fields) {
  const token = await getToken();
  const sheetName = dateToSheetName(fields.date);
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}`;

  // B列の現在の行数を取得して次の空き行を特定
  const colRange = encodeURIComponent(`'${sheetName}'!B:B`);
  const current = await sheetsFetch(token, `${base}/values/${colRange}`);
  const nextRow = (current.values?.length ?? 0) + 1;

  const row = [
    fields.date             ?? '', // B
    '',                            // C（空白）
    fields.large_category   ?? '', // D
    fields.medium_category  ?? '', // E
    fields.store            ?? '', // F
    fields.amount           ?? '', // G
    fields.user             ?? '', // H
  ];

  // 行番号を明示して書き込み（appendではなくPUT）
  const writeRange = encodeURIComponent(`'${sheetName}'!B${nextRow}:H${nextRow}`);
  return sheetsFetch(token, `${base}/values/${writeRange}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values: [row] }),
  });
}
