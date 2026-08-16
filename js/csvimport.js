import { getToken } from './auth.js';

const MAP_SHEET = '支払先カテゴリ';

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

// ── 支払先の表記ゆれ統一 ────────────────────
export function normalizePayee(raw) {
  const s = String(raw ?? '').trim();
  if (/^アマゾン|^ｱﾏｿﾞﾝ|^amazon/i.test(s)) return 'Amazon';
  if (s.includes('サンドラツグ') || s.includes('サンドラッグ')) return 'サンドラッグ';
  return s;
}

// ── CSV読み込み（文字コード自動判定） ─────────
export async function readCsvFile(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buf);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('shift_jis').decode(buf); // セゾンカード等の明細CSVはShift_JIS
  }
}

function parseCsvLine(line) {
  const cells = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      cells.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  cells.push(cur);
  return cells.map(s => s.trim());
}

function toIsoDate(s) {
  const m = String(s).match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

// クレジットカード明細CSVを解析（「利用日,ご利用店名及び商品名,...,利用金額,...」形式のヘッダー行を探して以降をパース）
export function parseCardCsv(text) {
  const lines = text.split(/\r\n|\r|\n/).filter(l => l.trim().length > 0);
  const headerIdx = lines.findIndex(l => l.startsWith('利用日,'));
  if (headerIdx === -1) throw new Error('CSVの形式を認識できませんでした（「利用日」列が見つかりません）');
  const header = parseCsvLine(lines[headerIdx]);
  const storeCol  = header.indexOf('ご利用店名及び商品名');
  const amountCol = header.indexOf('利用金額');
  if (storeCol === -1 || amountCol === -1) throw new Error('CSVの列構成を認識できませんでした');

  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const date = toIsoDate(cells[0]);
    if (!date) continue; // 集計行・注記行などをスキップ
    const rawStore = cells[storeCol] ?? '';
    const amount = Number(String(cells[amountCol] ?? '').replace(/[^\d.-]/g, ''));
    if (!rawStore || !amount) continue;
    rows.push({ date, rawStore, store: normalizePayee(rawStore), amount });
  }
  return rows;
}

export function signatureOf(row) {
  return `${row.date}|${row.store}|${row.amount}`;
}

// ── 既存データとの重複判定 ──────────────────
function cellToISODate(cell) {
  if (cell == null || cell === '') return '';
  if (typeof cell === 'number') {
    // Sheetsのシリアル値（1899-12-30起点）をISO日付に変換
    const ms = Math.round((cell - 25569) * 86400 * 1000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  const m = String(cell).trim().match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
}

function dateToSheetName(dateStr) {
  const [y, m] = dateStr.split('-');
  return `${y}.${Number(m)}`;
}

// 対象日付が含まれる月シートを読み、「日付|支払先|金額」の既存シグネチャ集合を返す
export async function fetchExistingSignatures(dates) {
  const token = await getToken();
  const months = [...new Set(dates.map(dateToSheetName))];
  const result = new Set();
  await Promise.all(months.map(async (sheetName) => {
    try {
      const range = encodeURIComponent(`'${sheetName}'!B:H`);
      const data = await sheetsFetch(token, `${base()}/values/${range}?valueRenderOption=UNFORMATTED_VALUE`);
      const values = data.values ?? [];
      if (values.length < 2) return;
      const header = values[0];
      const hasGapCol = header.length >= 2 && header[1] === '';
      const storeIdx  = hasGapCol ? 4 : 3;
      const amountIdx = hasGapCol ? 5 : 4;
      values.slice(1).forEach(row => {
        const iso = cellToISODate(row[0]);
        const store = String(row[storeIdx] ?? '').trim();
        const amount = Number(row[amountIdx]) || 0;
        if (iso && store && amount) result.add(`${iso}|${store}|${amount}`);
      });
    } catch {
      // シート未作成 → 重複なし扱い
    }
  }));
  return result;
}

// ── 支払先 → 中カテゴリ 対応表（シート「支払先カテゴリ」） ─
async function ensureMapSheet(token) {
  const r = encodeURIComponent(`'${MAP_SHEET}'!A1:C1`);
  try {
    const d = await sheetsFetch(token, `${base()}/values/${r}`);
    if (d.values?.length) return;
  } catch (e) {
    if (!e.message.includes('Unable to parse range') && !e.message.includes('not found')) throw e;
  }
  await sheetsFetch(token, `${base()}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: MAP_SHEET } } }] }),
  }).catch(() => {});
  await sheetsFetch(token, `${base()}/values/${r}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values: [['支払先', '中カテゴリ', '件数']] }),
  });
}

async function fetchMapRows(token) {
  await ensureMapSheet(token);
  const r = encodeURIComponent(`'${MAP_SHEET}'!A:C`);
  const data = await sheetsFetch(token, `${base()}/values/${r}?valueRenderOption=UNFORMATTED_VALUE`);
  return (data.values ?? []).slice(1).map(row => ({
    store: String(row[0] ?? '').trim(),
    medium: String(row[1] ?? '').trim(),
    count: Number(row[2]) || 0,
  })).filter(r => r.store && r.medium);
}

// store -> [{medium, count}]（件数の多い順）
export async function loadPayeeCategoryMap() {
  const token = await getToken();
  const rows = await fetchMapRows(token);
  const map = new Map();
  rows.forEach(({ store, medium, count }) => {
    if (!map.has(store)) map.set(store, []);
    map.get(store).push({ medium, count });
  });
  map.forEach(list => list.sort((a, b) => b.count - a.count));
  return map;
}

// 登録時に確定した 支払先→中カテゴリ の組み合わせを対応表に反映（既存なら件数+1、なければ新規追加）
export async function commitPayeeCategoryChoices(choices) {
  if (!choices.size) return;
  const token = await getToken();
  const rows = await fetchMapRows(token);
  choices.forEach((medium, store) => {
    const existing = rows.find(r => r.store === store && r.medium === medium);
    if (existing) existing.count += 1;
    else rows.push({ store, medium, count: 1 });
  });
  const clearRange = encodeURIComponent(`'${MAP_SHEET}'!A2:C`);
  await sheetsFetch(token, `${base()}/values/${clearRange}:clear`, { method: 'POST', body: JSON.stringify({}) });
  if (rows.length) {
    await sheetsFetch(token, `${base()}/values/${clearRange}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST',
      body: JSON.stringify({ values: rows.map(r => [r.store, r.medium, r.count]) }),
    });
  }
}
