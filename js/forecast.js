import { getToken } from './auth.js';

const SHEET = '収支予測';

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

async function ensureSheet(token) {
  const r = encodeURIComponent(`'${SHEET}'!A1:E1`);
  try {
    const d = await sheetsFetch(token, `${base()}/values/${r}`);
    if (d.values?.length) return;
  } catch (e) {
    if (!e.message.includes('Unable to parse range') && !e.message.includes('not found')) throw e;
  }
  await sheetsFetch(token, `${base()}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: SHEET } } }] }),
  }).catch(() => {});
  await sheetsFetch(token, `${base()}/values/${r}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values: [['開始年月', '終了年月', '項目名', '収支区分', '月額']] }),
  });
}

// simulate.js からも呼ばれる
export async function fetchRules(token) {
  await ensureSheet(token);
  const r = encodeURIComponent(`'${SHEET}'!A:E`);
  const res = await fetch(`${base()}/values/${r}?valueRenderOption=UNFORMATTED_VALUE`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.values ?? []).slice(1).map((row, i) => ({
    index:  i,
    start:  String(row[0] ?? '').trim(),
    end:    String(row[1] ?? '').trim(),
    name:   String(row[2] ?? '').trim(),
    type:   String(row[3] ?? '').trim(),  // 'income' | 'expense'
    amount: Number(row[4]) || 0,
  })).filter(r => r.start && r.name && r.type);
}

async function addRule(rule) {
  const token = await getToken();
  await ensureSheet(token);
  const r = encodeURIComponent(`'${SHEET}'!A:E`);
  await sheetsFetch(token, `${base()}/values/${r}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    body: JSON.stringify({ values: [[rule.start, rule.end, rule.name, rule.type, rule.amount]] }),
  });
}

async function deleteRule(index) {
  const token = await getToken();
  const rules = await fetchRules(token);
  const remaining = rules.filter((_, i) => i !== index).map(r => [r.start, r.end, r.name, r.type, r.amount]);
  const r = encodeURIComponent(`'${SHEET}'!A2:E`);
  await sheetsFetch(token, `${base()}/values/${r}:clear`, { method: 'POST', body: JSON.stringify({}) });
  if (remaining.length) {
    await sheetsFetch(token, `${base()}/values/${r}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST',
      body: JSON.stringify({ values: remaining }),
    });
  }
}

function renderRuleList(rules) {
  const list = document.getElementById('forecast-rule-list');
  if (!list) return;
  if (!rules.length) {
    list.innerHTML = '<p class="forecast-empty">ルールがまだありません<br><small>「ルールを追加」から収入・支出の予測を登録してください</small></p>';
    return;
  }
  const income  = rules.filter(r => r.type === 'income');
  const expense = rules.filter(r => r.type === 'expense');

  const makeCard = (rule, i) => {
    const endLabel  = rule.end ? `〜 ${rule.end}` : '〜 永続';
    const isOneTime = rule.end && rule.start === rule.end;
    const card = document.createElement('div');
    card.className = 'forecast-event-card';
    card.innerHTML = `
      <div class="forecast-card-body">
        <div class="forecast-event-title">
          ${rule.name}
          <span class="forecast-badge ${rule.type === 'income' ? 'badge-income' : 'badge-expense'}">${rule.type === 'income' ? '収入' : '支出'}</span>
          ${isOneTime ? '<span class="forecast-badge badge-onetime">一時</span>' : ''}
        </div>
        <div class="forecast-event-meta">${rule.start} ${endLabel}</div>
        <div class="forecast-event-meta">¥${rule.amount.toLocaleString()}/月</div>
      </div>
      <button type="button" class="btn btn-outline btn-small" data-rule-index="${rule.index}">削除</button>
    `;
    return card;
  };

  list.innerHTML = '';
  if (income.length) {
    const h = document.createElement('div');
    h.className = 'assets-group-header';
    h.textContent = '収入';
    list.appendChild(h);
    income.forEach(r => list.appendChild(makeCard(r)));
  }
  if (expense.length) {
    const h = document.createElement('div');
    h.className = 'assets-group-header';
    h.textContent = '支出';
    list.appendChild(h);
    expense.forEach(r => list.appendChild(makeCard(r)));
  }
}

export async function refreshForecastView() {
  const token = await getToken();
  const rules = await fetchRules(token);
  renderRuleList(rules);
}

export function initForecastSection() {
  const addBtn = document.getElementById('btn-add-rule');
  if (addBtn) {
    addBtn.addEventListener('click', async () => {
      const name   = document.getElementById('rule-name')?.value?.trim();
      const type   = document.getElementById('rule-type')?.value;
      const amount = Number(document.getElementById('rule-amount')?.value) || 0;
      const start  = document.getElementById('rule-start')?.value;
      const end    = document.getElementById('rule-end')?.value || '';
      if (!name || !start || !amount) {
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: '項目名・開始年月・月額は必須です', type: 'error' } }));
        return;
      }
      try {
        await addRule({ start, end, name, type, amount });
        document.getElementById('rule-name').value   = '';
        document.getElementById('rule-amount').value = '';
        document.getElementById('rule-end').value    = '';
        await refreshForecastView();
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'ルールを追加しました', type: 'success' } }));
      } catch (e) {
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: '追加に失敗: ' + e.message, type: 'error' } }));
      }
    });
  }

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('#forecast-rule-list [data-rule-index]');
    if (!btn) return;
    try {
      await deleteRule(Number(btn.dataset.ruleIndex));
      await refreshForecastView();
      window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'ルールを削除しました', type: 'success' } }));
    } catch (err) {
      window.dispatchEvent(new CustomEvent('toast', { detail: { message: '削除に失敗: ' + err.message, type: 'error' } }));
    }
  });
}
