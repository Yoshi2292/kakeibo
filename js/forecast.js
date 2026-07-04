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
    type:   String(row[3] ?? '').trim(),
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

async function writeAllRules(token, rows) {
  const r = encodeURIComponent(`'${SHEET}'!A2:E`);
  await sheetsFetch(token, `${base()}/values/${r}:clear`, { method: 'POST', body: JSON.stringify({}) });
  if (rows.length) {
    await sheetsFetch(token, `${base()}/values/${r}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST',
      body: JSON.stringify({ values: rows }),
    });
  }
}

async function deleteRule(index) {
  const token = await getToken();
  const rules = await fetchRules(token);
  const rows = rules.filter((_, i) => i !== index).map(r => [r.start, r.end, r.name, r.type, r.amount]);
  await writeAllRules(token, rows);
}

async function updateRule(index, newRule) {
  const token = await getToken();
  const rules = await fetchRules(token);
  const rows = rules.map((r, i) =>
    i === index
      ? [newRule.start, newRule.end, newRule.name, newRule.type, newRule.amount]
      : [r.start, r.end, r.name, r.type, r.amount]
  );
  await writeAllRules(token, rows);
}

let cachedRules = [];

function renderRuleList(rules) {
  cachedRules = rules;
  const list = document.getElementById('forecast-rule-list');
  if (!list) return;
  if (!rules.length) {
    list.innerHTML = '<p class="forecast-empty">ルールがまだありません<br><small>「＋ 追加」から収入・支出の予測を登録してください</small></p>';
    return;
  }
  const income  = rules.filter(r => r.type === 'income');
  const expense = rules.filter(r => r.type === 'expense');

  const makeCard = (rule) => {
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
        <div class="forecast-event-meta">${rule.start} ${isOneTime ? '' : endLabel}</div>
        <div class="forecast-event-meta">¥${rule.amount.toLocaleString()}${isOneTime ? '' : '/月'}</div>
      </div>
      <div class="forecast-card-actions">
        <button type="button" class="btn btn-outline btn-small" data-edit-index="${rule.index}">編集</button>
        <button type="button" class="btn btn-outline btn-small btn-danger-outline" data-rule-index="${rule.index}">削除</button>
      </div>
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
  let isOnetime = false;
  let editingIndex = null;

  function setMode(onetime) {
    isOnetime = onetime;
    document.querySelectorAll('.forecast-mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === (onetime ? 'onetime' : 'recurring'));
    });
    const endGroup    = document.getElementById('rule-end-group');
    const startLabel  = document.getElementById('rule-start-label');
    const amountLabel = document.getElementById('rule-amount-label');
    endGroup?.classList.toggle('hidden', onetime);
    if (startLabel)  startLabel.textContent  = onetime ? '年月' : '開始年月';
    if (amountLabel) amountLabel.textContent = onetime ? '金額（円）' : '月額（円）';
  }

  function setEditMode(rule) {
    const addBtn    = document.getElementById('btn-add-rule');
    const cancelBtn = document.getElementById('btn-cancel-edit');
    const titleEl   = document.querySelector('#section-forecast .forecast-section-title');
    if (rule) {
      editingIndex = rule.index;
      const isOneTime = rule.end && rule.start === rule.end;
      setMode(isOneTime);
      document.getElementById('rule-name').value   = rule.name;
      document.getElementById('rule-amount').value = rule.amount;
      document.getElementById('rule-start').value  = rule.start;
      const typeEl = document.getElementById('rule-type');
      if (typeEl) typeEl.value = rule.type;
      if (!isOneTime && document.getElementById('rule-end')) {
        document.getElementById('rule-end').value = rule.end || '';
      }
      if (addBtn) addBtn.textContent = '✔ 更新';
      cancelBtn?.classList.remove('hidden');
      if (titleEl) titleEl.textContent = '編集';
      document.getElementById('btn-add-rule')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      editingIndex = null;
      setMode(false);
      document.getElementById('rule-name').value   = '';
      document.getElementById('rule-amount').value = '';
      document.getElementById('rule-start').value  = '';
      const endEl = document.getElementById('rule-end');
      if (endEl) endEl.value = '';
      if (addBtn) addBtn.textContent = '＋ 追加';
      cancelBtn?.classList.add('hidden');
      if (titleEl) titleEl.textContent = '追加';
    }
  }

  // モード切替
  document.querySelectorAll('.forecast-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode === 'onetime'));
  });

  // キャンセル
  document.getElementById('btn-cancel-edit')?.addEventListener('click', () => setEditMode(null));

  // 追加 / 更新
  const addBtn = document.getElementById('btn-add-rule');
  if (addBtn) {
    addBtn.addEventListener('click', async () => {
      const name   = document.getElementById('rule-name')?.value?.trim();
      const type   = document.getElementById('rule-type')?.value;
      const amount = Number(document.getElementById('rule-amount')?.value) || 0;
      const start  = document.getElementById('rule-start')?.value;
      const end    = isOnetime ? start : (document.getElementById('rule-end')?.value || '');
      if (!name || !start || !amount) {
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: '項目名・年月・金額は必須です', type: 'error' } }));
        return;
      }
      try {
        if (editingIndex !== null) {
          await updateRule(editingIndex, { start, end, name, type, amount });
          setEditMode(null);
          await refreshForecastView();
          window.dispatchEvent(new CustomEvent('toast', { detail: { message: '更新しました', type: 'success' } }));
        } else {
          await addRule({ start, end, name, type, amount });
          document.getElementById('rule-name').value   = '';
          document.getElementById('rule-amount').value = '';
          if (!isOnetime) document.getElementById('rule-end').value = '';
          await refreshForecastView();
          window.dispatchEvent(new CustomEvent('toast', { detail: { message: isOnetime ? 'イベントを追加しました' : 'ルールを追加しました', type: 'success' } }));
        }
      } catch (e) {
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: '保存に失敗: ' + e.message, type: 'error' } }));
      }
    });
  }

  // 削除・編集
  document.addEventListener('click', async (e) => {
    const delBtn  = e.target.closest('#forecast-rule-list [data-rule-index]');
    const editBtn = e.target.closest('#forecast-rule-list [data-edit-index]');

    if (delBtn) {
      const idx = Number(delBtn.dataset.ruleIndex);
      if (editingIndex === idx) setEditMode(null);
      try {
        await deleteRule(idx);
        await refreshForecastView();
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: '削除しました', type: 'success' } }));
      } catch (err) {
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: '削除に失敗: ' + err.message, type: 'error' } }));
      }
    }

    if (editBtn) {
      const idx  = Number(editBtn.dataset.editIndex);
      const rule = cachedRules.find(r => r.index === idx);
      if (rule) setEditMode(rule);
    }
  });
}
