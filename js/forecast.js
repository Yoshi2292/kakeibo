import { getToken } from './auth.js';

const FORECAST_SHEET = '収支予測';
const EVENTS_SHEET = 'ライフイベント';
const FORECAST_ITEMS = {
  income: ['給与（自分）', '給与（妻）', '年金', '副業'],
  expense: ['生活費', 'ローン', '保険', 'お小遣い', '教育費'],
};

function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

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

async function ensureSheet(token, sheetName, headers) {
  const headerRange = encodeURIComponent(`'${sheetName}'!A1:${String.fromCharCode(64 + headers.length)}1`);
  try {
    const data = await sheetsFetch(token, `${getBase()}/values/${headerRange}`);
    if (data.values?.length) return { sheetId: null };
  } catch (e) {
    if (!e.message.includes('Unable to parse range') && !e.message.includes('not found')) throw e;
  }

  await sheetsFetch(token, `${getBase()}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: sheetName } } }] }),
  }).catch(() => {});

  await sheetsFetch(token, `${getBase()}/values/${headerRange}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values: [headers] }),
  });

  return { sheetId: null };
}

async function fetchForecastRows(token) {
  await ensureSheet(token, FORECAST_SHEET, ['年月', '項目名', '金額', '収支区分', 'フラグ']);
  const range = encodeURIComponent(`'${FORECAST_SHEET}'!A:E`);
  const url = `${getBase()}/values/${range}?valueRenderOption=UNFORMATTED_VALUE`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.values ?? []).slice(1);
}

async function fetchEventRows(token) {
  await ensureSheet(token, EVENTS_SHEET, ['年月', 'イベント名', '金額', 'メモ']);
  const range = encodeURIComponent(`'${EVENTS_SHEET}'!A:D`);
  const url = `${getBase()}/values/${range}?valueRenderOption=UNFORMATTED_VALUE`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.values ?? []).slice(1);
}

function parseForecastRows(rows, year) {
  const data = { income: {}, expense: {} };
  const targetPrefix = `${year}-`;
  rows.forEach((row) => {
    const ym = String(row[0] ?? '').trim();
    const item = String(row[1] ?? '').trim();
    const amount = Number(row[2]) || 0;
    const type = String(row[3] ?? '').trim();
    const flag = String(row[4] ?? '').trim();
    if (!ym || !item || !type || !flag || !ym.startsWith(targetPrefix)) return;
    const bucket = type === 'income' ? data.income : data.expense;
    if (!bucket[item]) bucket[item] = {};
    bucket[item][flag] = amount;
  });
  return data;
}

function parseEventsRows(rows) {
  return rows.map((row) => ({
    yearMonth: String(row[0] ?? '').trim(),
    name: String(row[1] ?? '').trim(),
    amount: Number(row[2]) || 0,
    memo: String(row[3] ?? '').trim(),
  })).filter((row) => row.yearMonth && row.name);
}

function buildForecastFieldRows(year, data) {
  const current = new Date();
  const currentYear = current.getFullYear();
  const currentMonth = current.getMonth() + 1;
  const rows = [];
  const pushRows = (type, itemName, value, flag) => {
    for (let month = 1; month <= 12; month++) {
      const ym = `${year}-${String(month).padStart(2, '0')}`;
      const isPast = year < currentYear || (year === currentYear && month < currentMonth);
      const effectiveFlag = flag === 'actual' ? 'actual' : (isPast ? 'actual' : 'forecast');
      rows.push([ym, itemName, value, type, effectiveFlag]);
    }
  };

  FORECAST_ITEMS.income.forEach((item) => {
    const actual = Number(data.income?.[item]?.actual ?? 0);
    const forecast = Number(data.income?.[item]?.forecast ?? 0);
    pushRows('income', item, actual, 'actual');
    pushRows('income', item, forecast, 'forecast');
  });

  FORECAST_ITEMS.expense.forEach((item) => {
    const actual = Number(data.expense?.[item]?.actual ?? 0);
    const forecast = Number(data.expense?.[item]?.forecast ?? 0);
    pushRows('expense', item, actual, 'actual');
    pushRows('expense', item, forecast, 'forecast');
  });
  return rows;
}

function renderForecastForm(year, parsedData) {
  const form = document.getElementById('forecast-form');
  if (!form) return;
  form.innerHTML = '';

  const makeSection = (title, items, type) => {
    const section = document.createElement('div');
    section.className = 'forecast-section';
    const header = document.createElement('h3');
    header.className = 'forecast-section-title';
    header.textContent = title;
    section.appendChild(header);
    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'forecast-item';
      row.innerHTML = `
        <label class="forecast-label" for="forecast-${type}-${slugify(item)}">${item}</label>
        <div class="forecast-amounts">
          <div class="forecast-input-group">
            <span>実績</span>
            <input id="forecast-${type}-${slugify(item)}-actual" type="number" inputmode="numeric" min="0" step="1" value="${parsedData[type]?.[item]?.actual ?? ''}">
          </div>
          <div class="forecast-input-group">
            <span>予測</span>
            <input id="forecast-${type}-${slugify(item)}-forecast" type="number" inputmode="numeric" min="0" step="1" value="${parsedData[type]?.[item]?.forecast ?? ''}">
          </div>
        </div>
      `;
      section.appendChild(row);
    });
    form.appendChild(section);
  };

  makeSection('収入', FORECAST_ITEMS.income, 'income');
  makeSection('支出', FORECAST_ITEMS.expense, 'expense');

  const yearInput = document.getElementById('forecast-year');
  if (yearInput) yearInput.value = year;
}

function renderEventList(events) {
  const list = document.getElementById('life-event-list');
  if (!list) return;
  list.innerHTML = '';
  if (!events.length) {
    list.innerHTML = '<p class="forecast-empty">イベントはまだありません</p>';
    return;
  }
  const items = document.createElement('div');
  items.className = 'forecast-event-list';
  events.forEach((event, index) => {
    const card = document.createElement('div');
    card.className = 'forecast-event-card';
    card.innerHTML = `
      <div>
        <div class="forecast-event-title">${event.name}</div>
        <div class="forecast-event-meta">${event.yearMonth} / ¥${Number(event.amount).toLocaleString()}</div>
        <div class="forecast-event-meta">${event.memo || 'メモなし'}</div>
      </div>
      <button type="button" class="btn btn-outline btn-small" data-index="${index}">削除</button>
    `;
    items.appendChild(card);
  });
  list.appendChild(items);
}

export async function refreshForecastView() {
  const yearInput = document.getElementById('forecast-year');
  const year = Number(yearInput?.value || new Date().getFullYear());
  const token = await getToken();
  const [rows, eventRows] = await Promise.all([fetchForecastRows(token), fetchEventRows(token)]);
  const parsed = parseForecastRows(rows, year);
  const events = parseEventsRows(eventRows);
  renderForecastForm(year, parsed);
  renderEventList(events.filter((event) => String(event.yearMonth).startsWith(String(year))));
}

export async function saveForecastData() {
  const token = await getToken();
  const yearInput = document.getElementById('forecast-year');
  const year = Number(yearInput?.value || new Date().getFullYear());
  const data = { income: {}, expense: {} };
  ['income', 'expense'].forEach((type) => {
    (FORECAST_ITEMS[type] || []).forEach((item) => {
      const actual = Number(document.getElementById(`forecast-${type}-${slugify(item)}-actual`)?.value) || 0;
      const forecast = Number(document.getElementById(`forecast-${type}-${slugify(item)}-forecast`)?.value) || 0;
      data[type][item] = { actual, forecast };
    });
  });

  const rows = buildForecastFieldRows(year, data);
  await ensureSheet(token, FORECAST_SHEET, ['年月', '項目名', '金額', '収支区分', 'フラグ']);

  const range = encodeURIComponent(`'${FORECAST_SHEET}'!A:E`);
  const currentRows = await sheetsFetch(token, `${getBase()}/values/${range}?valueRenderOption=UNFORMATTED_VALUE`);
  const existingRows = (currentRows.values ?? []).slice(1);
  const existingKeys = new Set();
  existingRows.forEach((row, idx) => {
    const ym = String(row[0] ?? '').trim();
    const item = String(row[1] ?? '').trim();
    const flag = String(row[4] ?? '').trim();
    if (ym.startsWith(`${year}-`) && item && flag) {
      existingKeys.add(`${ym}|${item}|${flag}`);
    }
  });

  const batchData = [];
  const appendRows = [];
  rows.forEach((row) => {
    const [ym, item, amount, type, flag] = row;
    const key = `${ym}|${item}|${flag}`;
    if (existingKeys.has(key)) {
      const rowIndex = existingRows.findIndex((existingRow) => {
        const existingYm = String(existingRow[0] ?? '').trim();
        const existingItem = String(existingRow[1] ?? '').trim();
        const existingFlag = String(existingRow[4] ?? '').trim();
        return existingYm === ym && existingItem === item && existingFlag === flag;
      });
      if (rowIndex >= 0) {
        batchData.push({
          range: `'${FORECAST_SHEET}'!C${rowIndex + 2}`,
          values: [[amount]],
        });
      }
    } else {
      appendRows.push(row);
    }
  });

  if (batchData.length) {
    await sheetsFetch(token, `${getBase()}/values:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: batchData }),
    });
  }

  if (appendRows.length) {
    await sheetsFetch(token, `${getBase()}/values/${encodeURIComponent(`'${FORECAST_SHEET}'!A:E`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST',
      body: JSON.stringify({ values: appendRows }),
    });
  }
}

export async function addLifeEvent(event) {
  const token = await getToken();
  await ensureSheet(token, EVENTS_SHEET, ['年月', 'イベント名', '金額', 'メモ']);
  await sheetsFetch(token, `${getBase()}/values/${encodeURIComponent(`'${EVENTS_SHEET}'!A:D`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    body: JSON.stringify({ values: [[event.yearMonth, event.name, event.amount, event.memo]] }),
  });
}

export async function deleteLifeEvent(index) {
  const token = await getToken();
  const rows = await fetchEventRows(token);
  if (!rows[index]) return;
  const remainingRows = rows.filter((_, i) => i !== index).map((row) => [String(row[0] ?? '').trim(), String(row[1] ?? '').trim(), Number(row[2]) || 0, String(row[3] ?? '').trim()]);
  await sheetsFetch(token, `${getBase()}/values/${encodeURIComponent(`'${EVENTS_SHEET}'!A2:D`)}:clear`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (remainingRows.length) {
    await sheetsFetch(token, `${getBase()}/values/${encodeURIComponent(`'${EVENTS_SHEET}'!A2:D`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST',
      body: JSON.stringify({ values: remainingRows }),
    });
  }
}

export function initForecastSection() {
  const yearInput = document.getElementById('forecast-year');
  const saveBtn = document.getElementById('btn-save-forecast');
  const eventForm = document.getElementById('life-event-form');
  const eventSubmit = document.getElementById('btn-add-event');

  if (yearInput) {
    yearInput.addEventListener('change', () => refreshForecastView());
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      try {
        await saveForecastData();
        await refreshForecastView();
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: '収支予測を保存しました', type: 'success' } }));
      } catch (e) {
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: '保存に失敗しました: ' + e.message, type: 'error' } }));
      }
    });
  }

  if (eventForm && eventSubmit) {
    eventForm.innerHTML = `
      <div class="forecast-event-form">
        <input id="event-yearmonth" type="month" value="${new Date().toISOString().slice(0, 7)}">
        <input id="event-name" type="text" placeholder="イベント名">
        <input id="event-amount" type="number" inputmode="numeric" min="0" step="1" placeholder="金額">
        <input id="event-memo" type="text" placeholder="メモ">
      </div>
    `;
    eventSubmit.addEventListener('click', async () => {
      const yearMonth = document.getElementById('event-yearmonth')?.value;
      const name = document.getElementById('event-name')?.value;
      const amount = Number(document.getElementById('event-amount')?.value || 0);
      const memo = document.getElementById('event-memo')?.value || '';
      if (!yearMonth || !name) return;
      try {
        await addLifeEvent({ yearMonth, name, amount, memo });
        await refreshForecastView();
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'イベントを追加しました', type: 'success' } }));
      } catch (e) {
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'イベント追加に失敗しました: ' + e.message, type: 'error' } }));
      }
    });
  }

  document.addEventListener('click', async (event) => {
    const btn = event.target.closest('#life-event-list [data-index]');
    if (!btn) return;
    const index = Number(btn.dataset.index);
    try {
      await deleteLifeEvent(index);
      await refreshForecastView();
      window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'イベントを削除しました', type: 'success' } }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent('toast', { detail: { message: '削除に失敗しました: ' + e.message, type: 'error' } }));
    }
  });
}
