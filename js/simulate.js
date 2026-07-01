import { getToken } from './auth.js';

const SHEET_ASSET = '資産管理';
const SHEET_FORECAST = '収支予測';
const SHEET_EVENTS = 'ライフイベント';

function getBase() {
  return `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}`;
}

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

async function fetchSheetRows(token, sheetName, range) {
  const url = `${getBase()}/values/${encodeURIComponent(`'${sheetName}'!${range}`)}?valueRenderOption=UNFORMATTED_VALUE`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const data = await res.json();
  return data.values ?? [];
}

function parseAssetRows(rows) {
  const result = {};
  rows.slice(1).forEach((row) => {
    const ym = String(row[0] ?? '').trim();
    const cat = String(row[1] ?? '').trim();
    const amount = Number(row[2]) || 0;
    if (!ym || !cat) return;
    if (!result[ym]) result[ym] = {};
    result[ym][cat] = amount;
  });
  return result;
}

function parseForecastRows(rows) {
  const result = [];
  rows.slice(1).forEach((row) => {
    const ym = String(row[0] ?? '').trim();
    const item = String(row[1] ?? '').trim();
    const amount = Number(row[2]) || 0;
    const kind = String(row[3] ?? '').trim();
    const flag = String(row[4] ?? '').trim();
    if (!ym || !item || !kind || !flag) return;
    result.push({ ym, item, amount, kind, flag });
  });
  return result;
}

function parseEventRows(rows) {
  return rows.slice(1).map((row) => ({
    ym: String(row[0] ?? '').trim(),
    name: String(row[1] ?? '').trim(),
    amount: Number(row[2]) || 0,
    memo: String(row[3] ?? '').trim(),
  })).filter((row) => row.ym && row.name);
}

function toMonthIndex(ym) {
  const [year, month] = ym.split('-').map(Number);
  return year * 12 + month;
}

export async function renderSimulationChart() {
  const token = await getToken();
  const [assetRows, forecastRows, eventRows] = await Promise.all([
    fetchSheetRows(token, SHEET_ASSET, 'A:C'),
    fetchSheetRows(token, SHEET_FORECAST, 'A:E'),
    fetchSheetRows(token, SHEET_EVENTS, 'A:D'),
  ]);

  const assets = parseAssetRows(assetRows);
  const forecast = parseForecastRows(forecastRows);
  const events = parseEventRows(eventRows);

  const baseMonths = Object.keys(assets).sort();
  const latestMonth = baseMonths[baseMonths.length - 1] ?? `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const currentYear = new Date().getFullYear();
  const months = [];
  const labels = [];
  const data = [];
  const styles = [];
  const eventMarkers = [];
  let balance = 0;

  const baseAsset = (assets[latestMonth] && typeof assets[latestMonth] === 'object')
    ? Object.values(assets[latestMonth]).reduce((sum, v) => sum + Number(v || 0), 0)
    : 0;
  balance = baseAsset;

  const currentMonth = `${currentYear}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const startYear = Number(currentMonth.split('-')[0]);
  const startMonth = Number(currentMonth.split('-')[1]);
  const totalMonths = 20 * 12;

  for (let i = 0; i <= totalMonths; i++) {
    const year = startYear + Math.floor((startMonth + i - 1) / 12);
    const month = ((startMonth + i - 1) % 12) + 1;
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    months.push(ym);
    labels.push(`${year}/${String(month).padStart(2, '0')}`);

    const monthForecast = forecast.filter((item) => item.ym === ym && item.flag === 'forecast');
    const monthActual = forecast.filter((item) => item.ym === ym && item.flag === 'actual');
    const monthlyIncome = monthForecast.filter((item) => item.kind === 'income').reduce((sum, item) => sum + item.amount, 0);
    const monthlyExpense = monthForecast.filter((item) => item.kind === 'expense').reduce((sum, item) => sum + item.amount, 0);
    const monthlyActualIncome = monthActual.filter((item) => item.kind === 'income').reduce((sum, item) => sum + item.amount, 0);
    const monthlyActualExpense = monthActual.filter((item) => item.kind === 'expense').reduce((sum, item) => sum + item.amount, 0);
    const eventAmount = events.filter((event) => event.ym === ym).reduce((sum, event) => sum + event.amount, 0);

    const isForecast = toMonthIndex(ym) >= toMonthIndex(currentMonth);
    const monthlyNet = isForecast
      ? monthlyIncome - monthlyExpense - eventAmount
      : monthlyActualIncome - monthlyActualExpense - eventAmount;

    balance += monthlyNet;
    data.push(balance);
    styles.push(isForecast ? 'dashed' : 'solid');

    events.filter((event) => event.ym === ym).forEach((event) => {
      eventMarkers.push({ label: `${event.name} -${event.amount.toLocaleString()}`, value: labels.length - 1 });
    });
  }

  const canvas = document.getElementById('chart-simulation');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '純資産推移',
        data,
        borderColor: '#2e7d32',
        borderWidth: 2,
        tension: 0.2,
        pointRadius: 0,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => `¥${Number(ctx.raw).toLocaleString()}` } },
      },
      scales: {
        y: { ticks: { callback: (v) => `¥${Number(v).toLocaleString()}` } },
      },
    },
    plugins: [{
      id: 'event-markers',
      afterDraw(chart) {
        const { ctx, chartArea, scales } = chart;
        if (!chartArea || !scales.x) return;
        ctx.save();
        ctx.strokeStyle = '#e15759';
        ctx.lineWidth = 1;
        eventMarkers.forEach((marker) => {
          const x = scales.x.getPixelForValue(marker.value);
          ctx.beginPath();
          ctx.moveTo(x, chartArea.top);
          ctx.lineTo(x, chartArea.bottom);
          ctx.stroke();
          ctx.fillStyle = '#e15759';
          ctx.fillRect(x - 4, chartArea.top + 4, 8, 12);
          ctx.fillStyle = '#fff';
          ctx.font = '10px sans-serif';
          ctx.fillText(marker.label, x + 5, chartArea.top + 12);
        });
        ctx.restore();
      },
    }],
  });
}
