import { initAuth, login, isLoggedIn, logout } from './auth.js';
import { setupCameraInput, setMaxPx, getMaxPx } from './camera.js';
import { analyzeReceipts, setModel, getModel, setPromptMode, getPromptMode } from './ocr.js';
import { appendRow } from './sheets.js';

// ── State ─────────────────────────────────
let capturedImages = []; // [{dataUrl, base64}, ...]
let ocrResults    = []; // [{date, store, amount, ...}, ...]
let savedResults  = []; // 手動モードで保存済みの件数
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
  loadOcrPrefs();
  setupTestModeToggle();
  setupSheetLinks();
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

  // OCR settings
  $('sel-model').addEventListener('change', (e) => {
    setModel(e.target.value);
    localStorage.setItem('ocr-model', e.target.value);
    updateVersionLabel();
  });

  $('sel-maxpx').addEventListener('change', (e) => {
    setMaxPx(Number(e.target.value));
    localStorage.setItem('ocr-maxpx', e.target.value);
    updateVersionLabel();
  });

  $('sel-prompt').addEventListener('change', (e) => {
    setPromptMode(e.target.value);
    localStorage.setItem('ocr-prompt', e.target.value);
    updateVersionLabel();
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
      console.log(`[kakeibo] 送信画像数: ${capturedImages.length}`);
      ocrResults = await analyzeReceipts(capturedImages);
      console.log(`[kakeibo] OCR結果数: ${ocrResults.length}`, ocrResults);
      currentIndex = 0;
      savedResults = [];
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

  // Gallery label も OCR ボタン表示対象に
  const galleryLabel = document.getElementById('label-gallery');
  if (galleryLabel) {
    // gallery-input の変更は camera.js 側で処理済み
  }

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

  $('field-date').addEventListener('change', (e) => {
    applyDateWarning(e.target.value);
    $('field-date').classList.remove('date-corrected');
    $('date-corrected-msg').textContent = '';
  });

  $('field-large-cat').addEventListener('change', (e) => {
    buildMediumOptions(e.target.value);
  });

  $('entry-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = readForm();
    setSaveLoading(true);
    try {
      await appendRow(data);
      savedResults.push(data);
      if (currentIndex < ocrResults.length - 1) {
        currentIndex++;
        fillForm(ocrResults[currentIndex]);
        updateFormProgress();
        const remaining = ocrResults.length - currentIndex;
        $('btn-save').textContent = `💾 保存して次へ（残り${remaining}件）`;
      } else {
        $('btn-save').textContent = '💾 Google Sheets に保存';
        renderSuccessSummary(savedResults);
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
  const failed = [];
  setSaveLoading(true);
  try {
    for (let i = 0; i < total; i++) {
      updateLoadingText(`${i + 1} / ${total} 件保存中...`);
      try {
        const fields = { ...ocrResults[i], date: sanitizeDate(ocrResults[i].date) ?? ocrResults[i].date };
        await appendRow(fields);
        saved.push(fields);
      } catch (e) {
        console.error(`[kakeibo] 保存失敗 ${i + 1}件目:`, e);
        failed.push(i + 1);
      }
    }
    if (failed.length) showToast(`${failed.join(',')}件目の保存に失敗しました`, 'error');
    renderSuccessSummary(saved);
    showSection('success');
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
  const original = ocr.date ?? null;
  const date = sanitizeDate(original) ?? todayISO();
  $('field-date').value = date;
  applyDateWarning(date);
  const corrected = !!original && date !== original;
  $('field-date').classList.toggle('date-corrected', corrected);
  $('date-corrected-msg').textContent = corrected ? `日付を自動補正しました（${original} → ${date}）` : '';
  if (ocr.large_category) {
    $('field-large-cat').value = ocr.large_category;
    buildMediumOptions(ocr.large_category);
  }
  if (ocr.medium_category) $('field-medium-cat').value = ocr.medium_category;
  $('field-store').value  = ocr.store  ?? '';
  $('field-amount').value = ocr.amount ?? '';
}

// 年がずれている場合に現在年で補正（過去6ヶ月以内に収まる場合のみ）
function sanitizeDate(dateStr) {
  if (!dateStr) return dateStr;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const now = new Date();
  const diffDays = (now - d) / (1000 * 60 * 60 * 24);
  if (diffDays >= 0 && diffDays <= 180) return dateStr; // 過去6ヶ月以内なら問題なし
  for (const yr of [now.getFullYear(), now.getFullYear() - 1]) {
    const candidate = new Date(d);
    candidate.setFullYear(yr);
    const days = (now - candidate) / (1000 * 60 * 60 * 24);
    if (days >= 0 && days <= 180) { // 未来でなく、かつ過去6ヶ月以内
      console.log(`[kakeibo] 日付を自動補正: ${dateStr} → ${candidate.toISOString().slice(0, 10)}`);
      return candidate.toISOString().slice(0, 10);
    }
  }
  return dateStr;
}

// 2ヶ月以上前 or 未来の日付なら赤色警告
function applyDateWarning(dateStr) {
  const el = $('field-date');
  if (!dateStr) { el.classList.remove('date-warning'); return; }
  const d = new Date(dateStr);
  const now = new Date();
  const diffDays = (now - d) / (1000 * 60 * 60 * 24);
  el.classList.toggle('date-warning', diffDays > 60 || diffDays < -1);
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

function loadOcrPrefs() {
  const model  = localStorage.getItem('ocr-model')   ?? CONFIG.CLAUDE_MODEL;
  const px     = Number(localStorage.getItem('ocr-maxpx')    ?? 800);
  const prompt = localStorage.getItem('ocr-prompt')  ?? 'standard';
  setModel(model);
  setMaxPx(px);
  setPromptMode(prompt);
  $('sel-model').value  = model;
  $('sel-maxpx').value  = String(px);
  $('sel-prompt').value = prompt;
  updateVersionLabel();
}

function updateVersionLabel() {
  const modelLabel  = getModel().includes('sonnet') ? 'Sonnet' : 'Haiku';
  const promptLabel = getPromptMode() === 'strict' ? '厳密' : '標準';
  $('app-version').textContent = `${CONFIG.BUILD_TIME} | ${modelLabel} / ${getMaxPx()}px / ${promptLabel}`;
}

function setupSheetLinks() {
  const url = `https://docs.google.com/spreadsheets/d/${CONFIG.SPREADSHEET_ID}/edit`;
  $('link-sheet').href = url;
  $('link-sheet-success').href = url;
}

let _tapCount = 0;
let _tapTimer = null;
function setupTestModeToggle() {
  $('app-version').addEventListener('click', () => {
    _tapCount++;
    clearTimeout(_tapTimer);
    _tapTimer = setTimeout(() => { _tapCount = 0; }, 2000);
    if (_tapCount >= 5) {
      _tapCount = 0;
      const settings = document.querySelector('.ocr-settings');
      const isVisible = settings.classList.toggle('visible');
      $('app-version').classList.toggle('test-mode', isVisible);
    }
  });
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
