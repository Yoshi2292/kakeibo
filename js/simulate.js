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

// ラベルが重ならないよう y 座標をスタッキング
function buildLabelSlots(eventMarkers, scales, chartArea) {
  const LINE_H = 13;
  const MIN_X_GAP = 48;
  const slots = [];

  eventMarkers.forEach(m => {
    const x = scales.x.getPixelForValue(m.idx);
    let y = chartArea.top + LINE_H;
    for (const s of slots) {
      if (Math.abs(x - s.x) < MIN_X_GAP) {
        y = Math.max(y, s.y + LINE_H);
      }
    }
    slots.push({ x, y, label: m.label });
  });
  return slots;
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

  // カテゴリ別残高（予測ループで複利成長させる）
  const categoryBalances = {};
  for (const [cat, val] of Object.entries(assets[latestMonth])) {
    categoryBalances[cat] = Number(val) || 0;
  }

  // カテゴリ別月次利回り（年率% → 月次係数）
  const monthlyRates = Object.fromEntries(
    ASSET_CATEGORY_DEFS.map(c => [c.name, (c.expectedReturn ?? 0) / 100 / 12])
  );

  const hasGrowth = ASSET_CATEGORY_DEFS.some(c => (c.expectedReturn ?? 0) > 0);

  const now = new Date();
  const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [sy, sm] = latestMonth.split('-').map(Number);
  const MONTHS = 20 * 12;

  const labels = [];
  const data = [];
  let pastEndIdx = -1;
  const eventMarkers = [];

  // forecast rules が収支差をここに積む（利回り0の浮動現金として扱う）
  let floatingCash = 0;

  for (let i = 1; i <= MONTHS; i++) {
    const year  = sy + Math.floor((sm + i - 1) / 12);
    const month = ((sm + i - 1) % 12) + 1;
    const ym    = `${year}-${String(month).padStart(2, '0')}`;

    // 各資産カテゴリに月次複利成長を適用（負債には適用しない）
    for (const [cat, rate] of Object.entries(monthlyRates)) {
      if (rate > 0 && !LIABILITY_CATEGORIES.includes(cat) && cat in categoryBalances) {
        categoryBalances[cat] *= (1 + rate);
      }
    }

    // 収支予測ルールの適用
    const active  = rules.filter(r => ym >= r.start && (!r.end || ym <= r.end));
    const income  = active.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
    const expense = active.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
    floatingCash += income - expense;

    // 純資産 = 資産合計 - 負債合計 + 浮動現金
    const netWorth = Object.entries(categoryBalances).reduce((sum, [cat, val]) => {
      return sum + (LIABILITY_CATEGORIES.includes(cat) ? -val : val);
    }, 0) + floatingCash;

    labels.push(`${year}/${String(month).padStart(2, '0')}`);
    data.push(netWorth);
    if (ym <= currentYm) pastEndIdx = i - 1;

    // 一時イベントマーカー
    active.filter(r => r.start === r.end).forEach(r => {
      eventMarkers.push({ label: r.name, idx: i - 1 });
    });
  }

  const canvas = document.getElementById('chart-simulation');
  if (!canvas) return;
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();

  // ピンチ/パン用に touch-action を制御
  canvas.style.touchAction = 'none';

  // セクションラベルに利回り反映の注記を追加
  const labelEl = document.querySelector('#section-simulate .stats-section-label');
  if (labelEl) {
    labelEl.textContent = hasGrowth
      ? '将来資産推移（実績/予測/イベント） — 想定利回り反映済み'
      : '将来資産推移（実績/予測/イベント）';
  }

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
        zoom: {
          pan: {
            enabled: true,
            mode: 'x',
          },
          zoom: {
            wheel: { enabled: true, speed: 0.1 },
            pinch: { enabled: true },
            mode: 'x',
          },
        },
      },
      scales: {
        x: { ticks: { maxTicksLimit: 10, font: { size: 10 } } },
        y: { ticks: { callback: v => `¥${Math.round(v / 10000)}万` } },
      },
    },
    plugins: [{
      id: 'event-markers',
      afterDraw(chart) {
        if (!eventMarkers.length) return;
        const { ctx, chartArea, scales } = chart;
        ctx.save();

        const slots = buildLabelSlots(eventMarkers, scales, chartArea);

        slots.forEach(s => {
          const x = s.x;

          ctx.strokeStyle = 'rgba(225, 87, 89, 0.7)';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(x, chartArea.top);
          ctx.lineTo(x, chartArea.bottom);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.font = 'bold 10px sans-serif';
          const textW = ctx.measureText(s.label).width;
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.fillRect(x + 2, s.y - 11, textW + 4, 13);
          ctx.fillStyle = '#c62828';
          ctx.fillText(s.label, x + 4, s.y);
        });

        ctx.restore();
      },
    }],
  });
}
