import { getToken } from './auth.js';

const PALETTE = [
  '#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f',
  '#edc948','#b07aa1','#ff9da7','#9c755f','#bab0ac',
  '#d4a5a5','#a8d8a8','#ffd3b6','#a0c4ff','#caffbf',
  '#ffadad','#ffc6ff','#fdffb6','#bde0fe','#c7f2a4','#f4acb7',
];

const _charts = {};

function destroyChart(id) {
  if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; }
}

// 1ヶ月分のデータを取得
async function fetchMonth(token, year, month) {
  const sheetName = `${year}.${month}`;
  const range = encodeURIComponent(`'${sheetName}'!B:H`);
  // UNFORMATTED_VALUE で数値を生の数値として取得
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}/values/${range}?valueRenderOption=UNFORMATTED_VALUE`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const data = await res.json();
  return parseRows(data.values ?? []);
}

// ヘッダー行から列インデックスを自動判定
function detectCols(header) {
  const largeIdx = header.findIndex(h => String(h).includes('大'));
  if (largeIdx >= 0) {
    return { largeIdx, mediumIdx: largeIdx + 1, amountIdx: largeIdx + 3 };
  }
  // フォールバック：新規作成シートの構造 (B=日付,C=空,D=大,E=中,F=店,G=金額)
  return { largeIdx: 2, mediumIdx: 3, amountIdx: 5 };
}

// 行データをオブジェクトに変換（支出のみ）
function parseRows(values) {
  if (values.length === 0) return [];
  const cols = detectCols(values[0]);
  console.log('[kakeibo] stats cols:', cols, 'header:', values[0]);
  return values.slice(1)
    .map(row => ({
      large_category:  row[cols.largeIdx]  ?? '',
      medium_category: row[cols.mediumIdx] ?? '',
      amount: Number(row[cols.amountIdx])  || 0,
    }))
    .filter(r => r.large_category === '支出' && r.amount > 0);
}

// 中カテゴリ別に集計
function aggregateByMedium(rows) {
  const map = {};
  for (const r of rows) {
    map[r.medium_category] = (map[r.medium_category] || 0) + r.amount;
  }
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

// 円グラフ描画
function renderPie(id, entries) {
  destroyChart(id);
  const canvas = document.getElementById(id);
  if (!canvas || !entries.length) return;
  const total = entries.reduce((s, [, v]) => s + v, 0);
  _charts[id] = new Chart(canvas, {
    type: 'pie',
    data: {
      labels: entries.map(([k]) => k),
      datasets: [{ data: entries.map(([, v]) => v), backgroundColor: PALETTE }],
    },
    options: {
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 12, padding: 8 } },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.label}: ¥${ctx.raw.toLocaleString()} (${(ctx.raw / total * 100).toFixed(1)}%)`,
          },
        },
      },
    },
  });
}

// 棒グラフ描画（月別 × 中カテゴリ上位8件+その他）
function renderBar(id, monthlyRows) {
  destroyChart(id);
  const canvas = document.getElementById(id);
  if (!canvas) return;

  const allEntries = aggregateByMedium(monthlyRows.flat());
  if (!allEntries.length) return;

  const topCats = allEntries.slice(0, 8).map(([k]) => k);
  const hasOther = allEntries.length > 8;
  if (hasOther) topCats.push('その他');

  const labels = Array.from({ length: 12 }, (_, i) => `${i + 1}月`);

  const datasets = topCats.map((cat, i) => ({
    label: cat,
    backgroundColor: PALETTE[i] + 'dd',
    data: monthlyRows.map(rows => {
      if (cat === 'その他') {
        return rows.filter(r => !topCats.slice(0, -1).includes(r.medium_category))
                   .reduce((s, r) => s + r.amount, 0);
      }
      return rows.filter(r => r.medium_category === cat).reduce((s, r) => s + r.amount, 0);
    }),
  }));

  _charts[id] = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 10 }, boxWidth: 10, padding: 6 } },
        tooltip: {
          callbacks: { label: ctx => `${ctx.dataset.label}: ¥${ctx.raw.toLocaleString()}` },
        },
      },
      scales: {
        x: { stacked: true },
        y: {
          stacked: true,
          ticks: { callback: v => v === 0 ? '0' : `¥${(v / 10000).toFixed(0)}万` },
        },
      },
    },
  });
}

// ── 公開API ──────────────────────────────

export async function loadMonthlyStats(year, month) {
  const token = await getToken();
  const rows = await fetchMonth(token, year, month);
  const entries = aggregateByMedium(rows);
  const total = entries.reduce((s, [, v]) => s + v, 0);

  document.getElementById('stats-monthly-total').textContent =
    entries.length ? `支出合計　¥${total.toLocaleString()}` : 'データがありません';

  renderPie('chart-monthly-pie', entries);
}

export async function loadYearlyStats(year) {
  const token = await getToken();
  const monthlyRows = await Promise.all(
    Array.from({ length: 12 }, (_, i) => fetchMonth(token, year, i + 1))
  );
  const allRows = monthlyRows.flat();
  const annual = aggregateByMedium(allRows);
  const total = annual.reduce((s, [, v]) => s + v, 0);

  document.getElementById('stats-yearly-total').textContent =
    allRows.length ? `年間支出合計　¥${total.toLocaleString()}` : 'データがありません';

  renderBar('chart-yearly-bar', monthlyRows);
  renderPie('chart-yearly-pie', annual);
}
