import { getToken } from './auth.js';

const SHEET_NAME = 'キャッシュフロー';
const BASE = () => `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}`;

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

async function ensureSheet(token) {
  const headerRange = encodeURIComponent(`'${SHEET_NAME}'!A1:C1`);
  try {
    const data = await sheetsFetch(token, `${BASE()}/values/${headerRange}`);
    if (data.values?.length) return;
  } catch (e) {
    if (!e.message.includes('Unable to parse range') && !e.message.includes('not found')) throw e;
  }

  await sheetsFetch(token, `${BASE()}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] }),
  }).catch(() => {});

  await sheetsFetch(token, `${BASE()}/values/${headerRange}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values: [['年月', '科目', '金額']] }),
  });
}

// 家計簿の月次シートから支出合計を自動取得
async function fetchKakeiboTotal(token, year, month) {
  const sheetName = `${year}.${month}`;
  const range = encodeURIComponent(`'${sheetName}'!B:H`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}/values/${range}?valueRenderOption=UNFORMATTED_VALUE`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return 0;
  const data = await res.json();
  const rows = data.values ?? [];
  if (rows.length <= 1) return 0;

  const header = rows[0];
  const largeIdx = header.findIndex(h => String(h).includes('大'));
  const effectiveLargeIdx = largeIdx >= 0 ? largeIdx : 2;
  const amountIdx = effectiveLargeIdx + 3;

  return rows.slice(1)
    .filter(row => String(row[effectiveLargeIdx] ?? '') === '支出')
    .reduce((sum, row) => sum + (Number(row[amountIdx]) || 0), 0);
}

// キャッシュフローシートの全データを取得
async function fetchAll(token) {
  const range = encodeURIComponent(`'${SHEET_NAME}'!A:C`);
  const url = `${BASE()}/values/${range}?valueRenderOption=UNFORMATTED_VALUE`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return {};
  const data = await res.json();
  const rows = data.values ?? [];
  if (rows.length <= 1) return {};

  const result = {};
  for (const row of rows.slice(1)) {
    const ym  = String(row[0] ?? '').trim();
    const cat = String(row[1] ?? '').trim();
    if (!ym || !cat) continue;
    if (!result[ym]) result[ym] = {};
    result[ym][cat] = Number(row[2]) || 0;
  }
  return result;
}

// 特定月の収支データを取得（手動入力 + 家計簿自動取込）
export async function loadCashflow(yearMonth) {
  const token = await getToken();
  const [year, month] = yearMonth.split('-').map(Number);
  const [all, kakeiboTotal] = await Promise.all([
    fetchAll(token),
    fetchKakeiboTotal(token, year, month),
  ]);
  return { manual: all[yearMonth] ?? {}, kakeiboTotal };
}

// 収支データを保存（手動入力分のみ）
export async function saveCashflow(yearMonth, categories) {
  const token = await getToken();
  await ensureSheet(token);

  const range = encodeURIComponent(`'${SHEET_NAME}'!A:C`);
  const res = await fetch(`${BASE()}/values/${range}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  const rows = data.values ?? [];

  const existingRowMap = {};
  rows.forEach((row, idx) => {
    if (String(row[0]).trim() === yearMonth && row[1]) {
      existingRowMap[String(row[1]).trim()] = idx + 1;
    }
  });

  const batchData = [];
  const newRows = [];

  for (const [cat, amount] of Object.entries(categories)) {
    if (existingRowMap[cat] !== undefined) {
      batchData.push({ range: `'${SHEET_NAME}'!C${existingRowMap[cat]}`, values: [[amount]] });
    } else {
      newRows.push([yearMonth, cat, amount]);
    }
  }

  if (batchData.length) {
    await sheetsFetch(token, `${BASE()}/values:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: batchData }),
    });
  }

  if (newRows.length) {
    const appendRange = encodeURIComponent(`'${SHEET_NAME}'!A:C`);
    await sheetsFetch(token, `${BASE()}/values/${appendRange}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST',
      body: JSON.stringify({ values: newRows }),
    });
  }
}
