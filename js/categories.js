import { getToken } from './auth.js';

const LIST_SHEET = 'リスト';
export const ADD_NEW = '__add_new__';

function base() {
  return `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}`;
}

async function sheetsFetch(token, url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `Sheets API エラー (${res.status})`);
  }
  return res.json();
}

let cache = null; // { 支出: [...], 収入: [...] }

// 「リスト」タブ A列=項目, B列=大カテゴリ を読み、大カテゴリが支出/収入のものだけを返す
// （既存の行は大半がB列未入力のため対象外。アプリから追加した行のみB列が入る）
export async function loadCustomCategories(force = false) {
  if (cache && !force) return cache;
  const token = await getToken();
  const range = encodeURIComponent(`'${LIST_SHEET}'!A:B`);
  const data = await sheetsFetch(token, `${base()}/values/${range}`);
  const rows = (data.values ?? []).slice(1);
  const result = { 支出: [], 収入: [] };
  rows.forEach((row) => {
    const name = String(row[0] ?? '').trim();
    const large = String(row[1] ?? '').trim();
    if (name && result[large] && !result[large].includes(name)) {
      result[large].push(name);
    }
  });
  cache = result;
  return result;
}

// 新規中カテゴリを「リスト」タブに追加（既存の大カテゴリの下）
export async function addCustomCategory(largeCat, name) {
  const token = await getToken();
  const range = encodeURIComponent(`'${LIST_SHEET}'!A:B`);
  await sheetsFetch(token, `${base()}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    body: JSON.stringify({ values: [[name, largeCat]] }),
  });
  if (cache) {
    if (!cache[largeCat]) cache[largeCat] = [];
    if (!cache[largeCat].includes(name)) cache[largeCat].push(name);
  }
}
