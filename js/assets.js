import { getToken } from './auth.js';

const SHEET_NAME = '資産管理';
const BASE = () => `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}`;

const PALETTE = [
  '#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f',
  '#edc948','#b07aa1','#ff9da7','#9c755f','#bab0ac',
];

let _chart = null;

async function sheetsFetch(token, url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err.error?.message ?? `Sheets API エラー (${res.status})`;
    throw new Error(msg);
  }
  return res.json();
}

async function ensureAssetSheet(token) {
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
  }).catch(() => {}); // ignore "already exists" errors

  await sheetsFetch(token, `${BASE()}/values/${headerRange}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values: [['年月', 'カテゴリ', '残高']] }),
  });
}

// 資産管理シートの全データを取得（{ 'YYYY-MM': { cat: amount } } 形式）
async function fetchAllAssets(token) {
  const range = encodeURIComponent(`'${SHEET_NAME}'!A:C`);
  const url = `${BASE()}/values/${range}?valueRenderOption=UNFORMATTED_VALUE`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return {};
  const data = await res.json();
  const rows = data.values ?? [];
  if (rows.length <= 1) return {};

  const result = {};
  for (const row of rows.slice(1)) {
    const ym = String(row[0] ?? '').trim();
    const cat = String(row[1] ?? '').trim();
    const amount = Number(row[2]) || 0;
    if (!ym || !cat) continue;
    if (!result[ym]) result[ym] = {};
    result[ym][cat] = amount;
  }
  return result;
}

// 特定月の資産を取得
export async function loadMonthAssets(yearMonth) {
  const token = await getToken();
  const all = await fetchAllAssets(token);
  return all[yearMonth] ?? {};
}

// 特定月の資産を保存（upsert）
export async function saveMonthAssets(yearMonth, categories) {
  const token = await getToken();
  await ensureAssetSheet(token);

  // 既存行を取得してインデックスを把握
  const range = encodeURIComponent(`'${SHEET_NAME}'!A:C`);
  const res = await fetch(`${BASE()}/values/${range}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  const rows = data.values ?? [];

  // { cat: rowNumber(1-based) } の対応表を作成
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
      batchData.push({
        range: `'${SHEET_NAME}'!C${existingRowMap[cat]}`,
        values: [[amount]],
      });
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
    await sheetsFetch(token, `${BASE()}/values/${appendRange}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
      method: 'POST',
      body: JSON.stringify({ values: newRows }),
    });
  }
}

// 純資産推移グラフを描画（資産積み上げ＋負債マイナス＋純資産ライン）
export async function loadAssetChart() {
  const token = await getToken();
  const all = await fetchAllAssets(token);

  if (_chart) { _chart.destroy(); _chart = null; }
  const canvas = document.getElementById('chart-assets-line');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const sortedMonths = Object.keys(all).sort();
  const emptyEl = document.getElementById('assets-chart-empty');

  if (!sortedMonths.length) {
    if (emptyEl) emptyEl.classList.remove('hidden');
    return;
  }
  if (emptyEl) emptyEl.classList.add('hidden');

  const labels = sortedMonths.map(ym => {
    const [y, m] = ym.split('-');
    return `${y}/${m}`;
  });

  const ASSET_PALETTE  = ['#4e79a7','#f28e2b','#59a14f','#76b7b2','#edc948','#b07aa1'];
  const LIAB_PALETTE   = ['#e15759','#ff9da7'];

  // 資産カテゴリ（正の積み上げ棒）
  const assetDatasets = ASSET_CATEGORIES.map((cat, i) => ({
    label: cat,
    data: sortedMonths.map(ym => all[ym]?.[cat] ?? 0),
    backgroundColor: ASSET_PALETTE[i % ASSET_PALETTE.length] + 'bb',
    borderColor:     ASSET_PALETTE[i % ASSET_PALETTE.length],
    borderWidth: 1,
    stack: 'assets',
  }));

  // 負債カテゴリ（負の積み上げ棒）
  const liabilityDatasets = LIABILITY_CATEGORIES.map((cat, i) => ({
    label: cat + '（負債）',
    data: sortedMonths.map(ym => -(all[ym]?.[cat] ?? 0)),
    backgroundColor: LIAB_PALETTE[i % LIAB_PALETTE.length] + 'bb',
    borderColor:     LIAB_PALETTE[i % LIAB_PALETTE.length],
    borderWidth: 1,
    stack: 'liabilities',
  }));

  // 純資産ライン
  const netWorthDataset = {
    label: '純資産',
    type: 'line',
    data: sortedMonths.map(ym => {
      const a = ASSET_CATEGORIES.reduce((s, c) => s + (all[ym]?.[c] ?? 0), 0);
      const l = LIABILITY_CATEGORIES.reduce((s, c) => s + (all[ym]?.[c] ?? 0), 0);
      return a - l;
    }),
    borderColor: '#2e7d32',
    backgroundColor: 'transparent',
    borderWidth: 2.5,
    pointRadius: 4,
    pointBackgroundColor: '#2e7d32',
    order: 0,
  };

  _chart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [...assetDatasets, ...liabilityDatasets, netWorthDataset] },
    options: {
      responsive: true,
      interaction: { mode: 'index' },
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 12, padding: 8 } },
        tooltip: {
          callbacks: {
            label: c => `${c.dataset.label}: ¥${Math.abs(Number(c.raw)).toLocaleString()}`,
          },
        },
      },
      scales: {
        x: { stacked: true },
        y: {
          stacked: true,
          ticks: { callback: v => `¥${(v / 10000).toFixed(0)}万` },
        },
      },
    },
  });
}
