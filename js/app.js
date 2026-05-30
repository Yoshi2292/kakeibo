import { initAuth, login, isLoggedIn, logout } from './auth.js';
import { setupCameraInput } from './camera.js';
import { analyzeReceipt } from './ocr.js';
import { appendRow } from './sheets.js';

// ── State ─────────────────────────────────
let capturedImage = null; // { dataUrl, base64 }

// ── DOM refs ──────────────────────────────
const $ = (id) => document.getElementById(id);
const SECTIONS = ['auth', 'camera', 'form', 'success'];

// ── Boot ──────────────────────────────────
(async () => {
  try {
    await initAuth();
  } catch (e) {
    console.error('[kakeibo] initAuth failed:', e);
    showToast('Google 認証の初期化に失敗: ' + e.message, 'error');
    return;
  }

  buildCategoryOptions();
  buildUserOptions();
  bindEvents();
  setDefaultDate();

  showSection(isLoggedIn() ? 'camera' : 'auth');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();

// ── Event bindings ────────────────────────
function bindEvents() {
  // Auth
  $('btn-login').addEventListener('click', async () => {
    try {
      await login();
      showSection('camera');
    } catch {
      showToast('ログインに失敗しました。ポップアップが許可されているか確認してください。', 'error');
    }
  });

  $('btn-logout').addEventListener('click', () => {
    logout();
    showSection('auth');
    showToast('ログアウトしました');
  });

  // Camera input
  setupCameraInput((img) => {
    capturedImage = img;
    $('preview-img').src = img.dataUrl;
    $('preview-wrap').classList.remove('hidden');
    $('camera-placeholder').classList.add('hidden');
    $('btn-ocr').classList.remove('hidden');
  });

  $('btn-retake').addEventListener('click', () => {
    capturedImage = null;
    $('preview-wrap').classList.add('hidden');
    $('camera-placeholder').classList.remove('hidden');
    $('btn-ocr').classList.add('hidden');
  });

  // OCR
  $('btn-ocr').addEventListener('click', async () => {
    if (!capturedImage) return;
    setOcrLoading(true);
    try {
      const ocr = await analyzeReceipt(capturedImage.base64);
      fillForm(ocr);
      showSection('form');
    } catch (e) {
      showToast('OCR 読み取りエラー: ' + e.message, 'error');
    } finally {
      setOcrLoading(false);
    }
  });

  // Manual entry
  $('btn-manual').addEventListener('click', () => {
    resetForm();
    showSection('form');
  });

  // Form navigation
  $('btn-back-camera').addEventListener('click', () => showSection('camera'));

  // Category cascade
  $('field-large-cat').addEventListener('change', (e) => {
    buildMediumOptions(e.target.value);
  });

  // Save
  $('entry-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = readForm();
    setSaveLoading(true);
    try {
      await appendRow(data);
      renderSuccessSummary(data);
      showSection('success');
    } catch (e) {
      showToast('保存エラー: ' + e.message, 'error');
    } finally {
      setSaveLoading(false);
    }
  });

  // Continue
  $('btn-next').addEventListener('click', () => {
    resetCamera();
    resetForm();
    showSection('camera');
  });
}

// ── Section control ───────────────────────
function showSection(name) {
  SECTIONS.forEach((s) => {
    $(`section-${s}`).classList.toggle('active', s === name);
  });
}

// ── Category options ──────────────────────
function buildCategoryOptions() {
  const sel = $('field-large-cat');
  sel.innerHTML = '<option value="">選択してください</option>';
  Object.keys(CATEGORIES).forEach((cat) => {
    const opt = document.createElement('option');
    opt.value = opt.textContent = cat;
    sel.appendChild(opt);
  });
}

function buildUserOptions() {
  const sel = $('field-user');
  USERS.forEach((u) => {
    const opt = document.createElement('option');
    opt.value = opt.textContent = u;
    sel.appendChild(opt);
  });
}

function buildMediumOptions(largeCat) {
  const sel = $('field-medium-cat');
  sel.innerHTML = '';
  const items = CATEGORIES[largeCat] ?? [];
  if (!items.length) {
    sel.innerHTML = '<option value="">（なし）</option>';
    return;
  }
  items.forEach((cat) => {
    const opt = document.createElement('option');
    opt.value = opt.textContent = cat;
    sel.appendChild(opt);
  });
}

// ── Form helpers ──────────────────────────
function fillForm(ocr) {
  $('field-date').value = ocr.date ?? todayISO();

  if (ocr.large_category) {
    $('field-large-cat').value = ocr.large_category;
    buildMediumOptions(ocr.large_category);
  }
  if (ocr.medium_category) {
    $('field-medium-cat').value = ocr.medium_category;
  }
  if (ocr.store)  $('field-store').value  = ocr.store;
  if (ocr.amount != null) $('field-amount').value = ocr.amount;
}

function readForm() {
  const fd = new FormData($('entry-form'));
  return Object.fromEntries(fd.entries());
}

function resetForm() {
  $('entry-form').reset();
  setDefaultDate();
  buildMediumOptions('');
}

function setDefaultDate() {
  $('field-date').value = todayISO();
}

// ── Loading states ────────────────────────
function setOcrLoading(on) {
  $('loading-ocr').classList.toggle('hidden', !on);
  $('btn-ocr').disabled = on;
  $('label-camera').style.pointerEvents = on ? 'none' : '';
}

function setSaveLoading(on) {
  $('loading-save').classList.toggle('hidden', !on);
  $('btn-save').disabled = on;
}

// ── Camera reset ──────────────────────────
function resetCamera() {
  capturedImage = null;
  $('preview-wrap').classList.add('hidden');
  $('camera-placeholder').classList.remove('hidden');
  $('btn-ocr').classList.add('hidden');
}

// ── Success summary ───────────────────────
function renderSuccessSummary(d) {
  $('success-summary').innerHTML = `
    <p>${d.date}・${d.large_category} / ${d.medium_category}</p>
    <p>${d.store || '（支払先なし）'}・<strong>¥${Number(d.amount || 0).toLocaleString()}</strong></p>
    ${d.user ? `<p>使用者：${d.user}</p>` : ''}
  `;
}

// ── Toast ─────────────────────────────────
let _toastTimer = null;
function showToast(msg, type = 'info') {
  clearTimeout(_toastTimer);
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast-${type} visible`;
  _toastTimer = setTimeout(() => el.classList.remove('visible'), 3500);
}

// ── Utility ───────────────────────────────
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
