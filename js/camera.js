let _maxPx = 1568;
const JPEG_Q = 0.75;

export function setMaxPx(px) { _maxPx = px; }
export function getMaxPx() { return _maxPx; }

export function setupCameraInput(onReady) {
  setupInput('camera-input', onReady);
  setupInput('gallery-input', onReady);
}

function setupInput(id, onReady) {
  const input = document.getElementById(id);
  if (!input) return;
  input.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    input.value = '';
    const results = await Promise.all(files.map(processImage));
    onReady(results);
  });
}

function processImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { w, h } = scaledSize(img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', JPEG_Q);
      resolve({ dataUrl, base64: dataUrl.split(',')[1] });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('画像の読み込みに失敗しました'));
    };
    img.src = url;
  });
}

function scaledSize(w, h) {
  if (w <= _maxPx && h <= _maxPx) return { w, h };
  if (w >= h) return { w: _maxPx, h: Math.round(h * _maxPx / w) };
  return { w: Math.round(w * _maxPx / h), h: _maxPx };
}
