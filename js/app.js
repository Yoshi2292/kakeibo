import { initAuth, login, isLoggedIn, logout } from './auth.js';
import { setupCameraInput } from './camera.js';
import { analyzeReceipts } from './ocr.js';
import { appendRow } from './sheets.js';

// ── State ─────────────────────────────────
let capturedImages = []; // [{dataUrl, base64}, ...]
let ocrResults    = []; // [{date, store, amount, ...}, ...]
let currentIndex  = 0;
let autoSave      = false;

// ── DOM ───────────────────────────────────
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
  setDefaultDate();
  loadAutoSavePref();
  bindEvents();

  showSection(isLoggedIn() ? 'camera' : 'auth');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();

// ── Events ────────────────────────────────
function bindEvents() {
  // Auth
  $('btn-login').addEventListener('click', async () => {
    try { await login(); showSection('camera'); }
    catch { showToast('ログインに失敗しました', 'error'); }
  });

  $('btn-logout').addEventListener('click', () => {
    logout();
    showSection('auth');
    showToast('ログアウトしました');
  });

  // Auto-save toggle
  $('toggle-autosave').addEventListener('change', (e) => {
    autoSave = e.target.checked;
    localStorage.setItem('autosave', autoSave ? '1' : '0');
  });

  // Camera
  setupCameraInput((images) => {
    capturedImages = images;
    renderThumbnails(images);
    $('camera-placeholder').classList.add('hidden');
    $('preview-wrap').classList.add('hidden');
    $('btn-ocr').classList.remove('hidden');
    $('btn-ocr').textContent = images.length > 1
      ? `🔍 ${images.length}枚を一括OCR`
      : '🔍 OCR で読み取る';
  });

  $('btn-retake').addEventListener('click', resetCamera);

  // OCR
  $('btn-ocr').addEventListener('click', async () => {
    if (!capturedImages.length) return;
    setOcrLoading(true);
    try {
      ocrResults = await analyzeReceipts(capturedImages);
      currentIndex = 0;
      if (autoSave) {
        await runAutoSave();
      } else {
        fillForm(ocrResults[0]);
        updateFormProgress();
        showSection('form');
      }
    } catch (e) {
      showToast('OCR エラー: ' + e.message, 'error');
    } finally {
      setOcrLoading(false);
    }
  });

  // Manual entry
  $('btn-manual').addEventListener('click', () => {
    ocrResults = [{}];
    currentIndex = 0;
    resetForm();
    $('form-progress').textContent = '';
    showSection('form');
  });

  // Form
  $('btn-back-camera').addEventListener('click', () => showSection('camera'));

  $('field-large-cat').addEventListener('change', (e) => {
    buildMediumOptions(e.target.value);
  });

  $('entry-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = readForm();
    setSaveLoading(true);
    try {
      await appendRow(data);
      if (currentIndex < ocrResults.length - 1) {
        currentIndex++;
        fillForm(ocrResults[currentIndex]);
        updateFormProgress();
      } else {
        renderSuccessSummary([data]);
        showSection('success');
      }
    } catch (e) {
      showToast('保存エラー: ' + e.message, 'error');
    } finally {
      setSaveLoading(false);
    }
  });

  // Success
  $('btn-next').addEventListener('click', () => {
    resetCamera();
    resetForm();
    showSection('camera');
  });
}

// ── Auto-save ─────────────────────────────
async function runAutoSave() {
  const total = ocrResults.length;
  const saved = [];
  setSaveLoading(true);
  try {
    for (let i = 0; i < total; i++) {
      updateLoadingText(`${i + 1} / ${total} 件保存中...`);
      await appendRow(ocrResults[i]);
      saved.push(ocrResults[i]);
    }
    renderSuccessSummary(saved);
    showSection('success');
  } catch (e) {
    showToast('保存エラー: ' + e.message, 'error');
  } finally {
    setSaveLoading(false);
    updateLoadingText('保存中...');
  }
}

// ── Sections ──────────────────────────────
function showSection(name) {
  SECTIONS.forEach((s) => {
    $(`section-${s}`).classList.toggle('active', s === name);
  });
}

// ── Thumbnails ────────────────────────────
function renderThumbnails(images) {
  const wrap = $('thumb-queue');
  wrap.innerHTML = '';
  images.forEach((img, i) => {
    const div = document.createElement('div');
    div.className = 'thumb-item';
    div.innerHTML = `<img src="${img.dataUrl}" alt=""><span class="thumb-badge">${i + 1}</span>`;
    wrap.appendChild(div);
  });
  wrap.classList.toggle('hidden', images.length === 0);
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

function buildUserOptions() {
  const sel = $('field-user');
  sel.innerHTML = '<option value="">選択してください</option>';
  USERS.forEach((u) => {
    const opt = document.createElement('option');
    opt.value = opt.textContent = u;
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
  if (ocr.medium_category) $('field-medium-cat').value = ocr.medium_category;
  $('field-store').value  = ocr.store  ?? '';
  $('field-amount').value = ocr.amount ?? '';
}

function readForm() {
  return Object.fromEntries(new FormData($('entry-form')).entries());
}

function resetForm() {
  $('entry-form').reset();
  setDefaultDate();
  buildMediumOptions('');
}

function setDefaultDate() {
  $('field-date').value = todayISO();
}

function updateFormProgress() {
  const total = ocrResults.length;
  $('form-progress').textContent = total > 1 ? `${currentIndex + 1}/${total}` : '';
}

// ── Loading ───────────────────────────────
function setOcrLoading(on) {
  $('loading-ocr').classList.toggle('hidden', !on);
  $('btn-ocr').disabled = on;
  $('label-camera').style.pointerEvents = on ? 'none' : '';
}

function setSaveLoading(on) {
  $('loading-save').classList.toggle('hidden', !on);
  $('btn-save').disabled = on;
}

function updateLoadingText(text) {
  const p = $('loading-save').querySelector('p');
  if (p) p.textContent = text;
}

// ── Camera reset ──────────────────────────
function resetCamera() {
  capturedImages = [];
  ocrResults = [];
  currentIndex = 0;
  $('preview-wrap').classList.add('hidden');
  $('camera-placeholder').classList.remove('hidden');
  $('btn-ocr').classList.add('hidden');
  $('thumb-queue').innerHTML = '';
  $('thumb-queue').classList.add('hidden');
}

// ── Success ───────────────────────────────
function renderSuccessSummary(items) {
  const html = items.map((d) => `
    <div class="success-item">
      <span>${d.date ?? ''}　${d.large_category ?? ''} / ${d.medium_category ?? ''}</span>
      <span>${d.store ?? ''}　<strong>¥${Number(d.amount || 0).toLocaleString()}</strong></span>
    </div>
  `).join('');
  $('success-summary').innerHTML = html;
}

// ── Prefs ─────────────────────────────────
function loadAutoSavePref() {
  autoSave = localStorage.getItem('autosave') === '1';
  $('toggle-autosave').checked = autoSave;
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

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
