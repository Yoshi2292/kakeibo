import { getToken } from './auth.js';
import { fetchRules } from './forecast.js';

const SHEET_ASSET = '資産管理';

function base() {
  return `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}`;
}

async function fetchAssetRows(token) {
  const url = `${base()}/values/${encodeURIComponent(`'${SHEET_ASSET}'!A:C`)}?valueRenderOption=UNFORMATTED_VALUE`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  return (await res.json()).values ?? [];
}

function parseAssets(rows) {
  const result = {};
  rows.slice(1).forEach(row => {
    const ym  = String(row[0] ?? '').trim();
    const cat = String(row[1] ?? '').trim();
    const amt = Number(row[2]) || 0;
    if (!ym || !cat) return;
    if (!result[ym]) result[ym] = {};
    result[ym][cat] = amt;
  });
  return result;
}

function calcNetWorth(monthData) {
  return Object.entries(monthData).reduce((sum, [cat, val]) => {
    return sum + (LIABILITY_CATEGORIES.includes(cat) ? -Number(val) : Number(val));
  }, 0);
}

export async function renderSimulationChart() {
  const token = await getToken();
  const [assetRows, rules] = await Promise.all([
    fetchAssetRows(token),
    fetchRules(token),
  ]);

  const assets = parseAssets(assetRows);
  const sortedMonths = Object.keys(assets).sort();
  const empty = document.getElementById('simulation-empty');

  if (!sortedMonths.length) {
    if (empty) empty.classList.remove('hidden');
    return;
  }
  if (empty) empty.classList.add('hidden');

  const latestMonth = sortedMonths[sortedMonths.length - 1];
  let balance = calcNetWorth(assets[latestMonth]);

  const now = new Date();
  const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [sy, sm] = latestMonth.split('-').map(Number);
  const MONTHS = 20 * 12;

  const labels = [];
  const data = [];
  let pastEndIdx = -1;
  const eventMarkers = [];

  for (let i = 1; i <= MONTHS; i++) {
    const year  = sy + Math.floor((sm + i - 1) / 12);
    const month = ((sm + i - 1) % 12) + 1;
    const ym    = `${year}-${String(month).padStart(2, '0')}`;

    const active  = rules.filter(r => ym >= r.start && (!r.end || ym <= r.end));
    const income  = active.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
    const expense = active.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
    balance += income - expense;

    labels.push(`${year}/${String(month).padStart(2, '0')}`);
    data.push(balance);
    if (ym <= currentYm) pastEndIdx = i - 1;

    // 一時支出（start === end）はマーカー表示
    active.filter(r => r.start === r.end).forEach(r => {
      eventMarkers.push({ label: r.name, idx: i - 1 });
    });
  }

  const canvas = document.getElementById('chart-simulation');
  if (!canvas) return;
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();

  new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '純資産推移',
        data,
        borderWidth: 2,
        tension: 0.1,
        pointRadius: 0,
        segment: {
          borderColor: ctx => ctx.p0DataIndex <= pastEndIdx ? '#2e7d32' : '#81c784',
          borderDash:  ctx => ctx.p0DataIndex <= pastEndIdx ? undefined : [5, 4],
        },
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `¥${Math.round(Number(ctx.raw) / 10000).toLocaleString()}万`,
          },
        },
      },
      scales: {
        x: { ticks: { maxTicksLimit: 12, font: { size: 10 } } },
        y: { ticks: { callback: v => `¥${Math.round(v / 10000)}万` } },
      },
    },
    plugins: [{
      id: 'event-markers',
      afterDraw(chart) {
        if (!eventMarkers.length) return;
        const { ctx, chartArea, scales } = chart;
        ctx.save();
        ctx.strokeStyle = '#e15759';
        ctx.lineWidth = 1;
        eventMarkers.forEach(m => {
          const x = scales.x.getPixelForValue(m.idx);
          ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = '#e15759';
          ctx.font = 'bold 10px sans-serif';
          ctx.fillText(m.label, x + 3, chartArea.top + 14);
        });
        ctx.restore();
      },
    }],
  });
}
