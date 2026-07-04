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
  const r = encodeURIComponent(`'${SHEET}'!A1:G1`);
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
    body: JSON.stringify({ values: [['開始年月', '終了年月', '項目名', '収支区分', '金額', '振替先', '適用月']] }),
  });
}

// simulate.js からも呼ばれる
export async function fetchRules(token) {
  await ensureSheet(token);
  const r = encodeURIComponent(`'${SHEET}'!A:G`);
  const res = await fetch(`${base()}/values/${r}?valueRenderOption=UNFORMATTED_VALUE`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.values ?? []).slice(1).map((row, i) => ({
    index:      i,
    start:      String(row[0] ?? '').trim(),
    end:        String(row[1] ?? '').trim(),
    name:       String(row[2] ?? '').trim(),
    type:       String(row[3] ?? '').trim(),
    amount:     Number(row[4]) || 0,
    transferTo: String(row[5] ?? '').trim(),
    applyMonth: Number(row[6]) || 0,   // 0=毎月, 1-12=毎年X月
  })).filter(r => r.start && r.name && r.type);
}

function ruleToRow(rule) {
  return [
    rule.start, rule.end, rule.name, rule.type,
    rule.amount, rule.transferTo || '', rule.applyMonth || 0,
  ];
}

async function addRule(rule) {
  const token = await getToken();
  await ensureSheet(token);
  const r = encodeURIComponent(`'${SHEET}'!A:G`);
  await sheetsFetch(token, `${base()}/values/${r}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    body: JSON.stringify({ values: [ruleToRow(rule)] }),
  });
}

async function writeAllRules(token, rows) {
  const r = encodeURIComponent(`'${SHEET}'!A2:G`);
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
  await writeAllRules(token, rules.filter((_, i) => i !== index).map(ruleToRow));
}

async function updateRule(index, newRule) {
  const token = await getToken();
  const rules = await fetchRules(token);
  await writeAllRules(token, rules.map((r, i) => i === index ? ruleToRow(newRule) : ruleToRow(r)));
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
    const isOneTime = rule.end && rule.start === rule.end;
    const endLabel  = rule.end ? `〜 ${rule.end}` : '〜 永続';
    const freqLabel = rule.applyMonth > 0 ? `毎年${rule.applyMonth}月` : '毎月';
    const amtLabel  = isOneTime
      ? `¥${rule.amount.toLocaleString()}`
      : rule.applyMonth > 0
        ? `¥${rule.amount.toLocaleString()}/年`
        : `¥${rule.amount.toLocaleString()}/月`;

    const card = document.createElement('div');
    card.className = 'forecast-event-card';
    card.innerHTML = `
      <div class="forecast-card-body">
        <div class="forecast-event-title">
          ${rule.name}
          <span class="forecast-badge ${rule.type === 'income' ? 'badge-income' : 'badge-expense'}">${rule.type === 'income' ? '収入' : '支出'}</span>
          ${isOneTime ? '<span class="forecast-badge badge-onetime">一時</span>' : ''}
          ${rule.applyMonth > 0 ? '<span class="forecast-badge badge-yearly">年次</span>' : ''}
          ${rule.transferTo ? '<span class="forecast-badge badge-transfer">振替</span>' : ''}
        </div>
        <div class="forecast-event-meta">${rule.start} ${isOneTime ? '' : endLabel}${!isOneTime ? ` • ${freqLabel}` : ''}</div>
        <div class="forecast-event-meta">${amtLabel}${rule.transferTo ? ` → ${rule.transferTo}` : ''}</div>
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

  // 振替先セレクトボックスにASSET_CATEGORIESを設定
  const transferSelect = document.getElementById('rule-transfer');
  if (transferSelect) {
    ASSET_CATEGORIES.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      transferSelect.appendChild(opt);
    });
  }

  const freqSelect       = document.getElementById('rule-freq');
  const monthGroup       = document.getElementById('rule-month-group');
  const applyMonthSelect = document.getElementById('rule-apply-month');
  const amountLabel      = document.getElementById('rule-amount-label');
  const freqRow          = document.getElementById('rule-freq-row');

  function updateAmountLabel() {
    if (!amountLabel) return;
    if (isOnetime) {
      amountLabel.textContent = '金額（円）';
    } else if (freqSelect?.value === 'yearly') {
      amountLabel.textContent = '年額（円）';
    } else {
      amountLabel.textContent = '月額（円）';
    }
  }

  // 頻度セレクト変更
  freqSelect?.addEventListener('change', () => {
    const isYearly = freqSelect.value === 'yearly';
    monthGroup?.classList.toggle('hidden', !isYearly);
    updateAmountLabel();
  });

  function setMode(onetime) {
    isOnetime = onetime;
    document.querySelectorAll('.forecast-mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === (onetime ? 'onetime' : 'recurring'));
    });
    const endGroup   = document.getElementById('rule-end-group');
    const startLabel = document.getElementById('rule-start-label');
    endGroup?.classList.toggle('hidden', onetime);
    if (startLabel) startLabel.textContent = onetime ? '年月' : '開始年月';
    // 一時イベントモードでは頻度行を非表示
    freqRow?.classList.toggle('hidden', onetime);
    if (onetime && freqSelect) {
      freqSelect.value = 'monthly';
      monthGroup?.classList.add('hidden');
    }
    updateAmountLabel();
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
      if (!isOneTime) {
        const endEl = document.getElementById('rule-end');
        if (endEl) endEl.value = rule.end || '';
      }
      if (transferSelect) transferSelect.value = rule.transferTo || '';

      // 頻度の復元
      if (!isOneTime && freqSelect) {
        if (rule.applyMonth > 0) {
          freqSelect.value = 'yearly';
          monthGroup?.classList.remove('hidden');
          if (applyMonthSelect) applyMonthSelect.value = String(rule.applyMonth);
        } else {
          freqSelect.value = 'monthly';
          monthGroup?.classList.add('hidden');
        }
        updateAmountLabel();
      }

      if (addBtn) addBtn.textContent = '✔ 更新';
      cancelBtn?.classList.remove('hidden');
      if (titleEl) titleEl.textContent = '編集';
      addBtn?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      editingIndex = null;
      setMode(false);
      document.getElementById('rule-name').value   = '';
      document.getElementById('rule-amount').value = '';
      document.getElementById('rule-start').value  = '';
      const endEl = document.getElementById('rule-end');
      if (endEl) endEl.value = '';
      if (transferSelect) transferSelect.value = '';
      if (freqSelect) freqSelect.value = 'monthly';
      monthGroup?.classList.add('hidden');
      updateAmountLabel();
      if (addBtn) addBtn.textContent = '＋ 追加';
      cancelBtn?.classList.add('hidden');
      if (titleEl) titleEl.textContent = '追加';
    }
  }

  document.querySelectorAll('.forecast-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode === 'onetime'));
  });

  document.getElementById('btn-cancel-edit')?.addEventListener('click', () => setEditMode(null));

  const addBtn = document.getElementById('btn-add-rule');
  if (addBtn) {
    addBtn.addEventListener('click', async () => {
      const name       = document.getElementById('rule-name')?.value?.trim();
      const type       = document.getElementById('rule-type')?.value;
      const amount     = Number(document.getElementById('rule-amount')?.value) || 0;
      const start      = document.getElementById('rule-start')?.value;
      const end        = isOnetime ? start : (document.getElementById('rule-end')?.value || '');
      const transferTo = transferSelect?.value || '';
      const applyMonth = (!isOnetime && freqSelect?.value === 'yearly')
        ? (Number(applyMonthSelect?.value) || 1)
        : 0;

      if (!name || !start || !amount) {
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: '項目名・年月・金額は必須です', type: 'error' } }));
        return;
      }
      try {
        if (editingIndex !== null) {
          await updateRule(editingIndex, { start, end, name, type, amount, transferTo, applyMonth });
          setEditMode(null);
          await refreshForecastView();
          window.dispatchEvent(new CustomEvent('toast', { detail: { message: '更新しました', type: 'success' } }));
        } else {
          await addRule({ start, end, name, type, amount, transferTo, applyMonth });
          document.getElementById('rule-name').value   = '';
          document.getElementById('rule-amount').value = '';
          if (!isOnetime) document.getElementById('rule-end').value = '';
          if (transferSelect) transferSelect.value = '';
          await refreshForecastView();
          window.dispatchEvent(new CustomEvent('toast', { detail: { message: isOnetime ? 'イベントを追加しました' : 'ルールを追加しました', type: 'success' } }));
        }
      } catch (e) {
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: '保存に失敗: ' + e.message, type: 'error' } }));
      }
    });
  }

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
