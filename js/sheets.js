import { getToken } from './auth.js';

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

  const range = encodeURIComponent(`${CONFIG.SHEET_NAME}!A:F`);
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
