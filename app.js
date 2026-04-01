const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const startCameraBtn = document.getElementById('startCameraBtn');
const captureBtn = document.getElementById('captureBtn');
const switchCameraBtn = document.getElementById('switchCameraBtn');
const stopCameraBtn = document.getElementById('stopCameraBtn');
const fileInput = document.getElementById('fileInput');
const trackingNumberEl = document.getElementById('trackingNumber');
const resultImage = document.getElementById('resultImage');
const saveBtn = document.getElementById('saveBtn');
const clearLatestBtn = document.getElementById('clearLatestBtn');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const historyList = document.getElementById('historyList');
const scanStatus = document.getElementById('scanStatus');
const cameraStatus = document.getElementById('cameraStatus');
const cameraPlaceholder = document.getElementById('cameraPlaceholder');
const manualTrackingInput = document.getElementById('manualTrackingInput');
const applyManualBtn = document.getElementById('applyManualBtn');

let stream = null;
let currentFacingMode = 'environment';
let latestScan = null;
let tesseractWorker = null;

function setScanStatus(text, type = 'neutral') {
  scanStatus.textContent = text;
  scanStatus.className = `status-pill ${type}`;
}

function setCameraStatus(text, type = 'neutral') {
  cameraStatus.textContent = text;
  cameraStatus.className = `status-pill ${type}`;
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  video.srcObject = null;
  captureBtn.disabled = true;
  switchCameraBtn.disabled = true;
  stopCameraBtn.disabled = true;
  setCameraStatus('Camera off', 'neutral');
  cameraPlaceholder.classList.remove('hidden');
}

async function startCamera() {
  try {
    stopCamera();

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser does not support camera access.');
    }

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: currentFacingMode },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    });

    video.srcObject = stream;
    await video.play();

    captureBtn.disabled = false;
    switchCameraBtn.disabled = false;
    stopCameraBtn.disabled = false;
    setCameraStatus(currentFacingMode === 'environment' ? 'Rear camera' : 'Front camera', 'success');
    cameraPlaceholder.classList.add('hidden');
  } catch (error) {
    console.error(error);
    setCameraStatus('Camera blocked', 'error');
    alert(`Could not open camera: ${error.message}`);
  }
}

function switchCamera() {
  currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
  startCamera();
}

function normalizeTracking(value) {
  if (!value) return null;
  const clean = String(value).trim().replace(/\s+/g, '');
  if (!clean) return null;
  if (/^[0-9]{10,34}$/.test(clean)) return clean;
  if (/^[A-Z0-9-]{8,40}$/i.test(clean)) return clean;
  return null;
}

function scoreCandidate(raw) {
  const digitsOnly = raw.replace(/\D/g, '');
  let score = 0;
  if (/^\d{12}$/.test(digitsOnly)) score += 10;
  if (/^\d{15}$/.test(digitsOnly)) score += 8;
  if (/^\d{20}$/.test(digitsOnly)) score += 7;
  if (/^\d{22}$/.test(digitsOnly)) score += 7;
  if (/^\d{34}$/.test(digitsOnly)) score += 6;
  if (/^\d{10,34}$/.test(digitsOnly)) score += 4;
  if (/96\d{20}$/.test(digitsOnly)) score += 2;
  if (/^\d+$/.test(raw)) score += 1;
  return score;
}

function extractFedExTrackingFromText(text) {
  if (!text) return null;

  const normalizedText = text
    .replace(/[Oo]/g, '0')
    .replace(/[Il|]/g, '1')
    .replace(/[Ss]/g, '5')
    .replace(/[B]/g, '8');

  const matches = new Set();

  const digitGroupRegex = /(?:\d[\s-]*){10,34}/g;
  for (const match of normalizedText.match(digitGroupRegex) || []) {
    const digits = match.replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 34) {
      matches.add(digits);
    }
  }

  const lineCandidates = normalizedText
    .split(/\n+/)
    .map(line => line.replace(/[^\dA-Z- ]/gi, ' ').trim())
    .filter(Boolean);

  for (const line of lineCandidates) {
    const digits = line.replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 34) {
      matches.add(digits);
    }
  }

  const ranked = [...matches]
    .map(value => ({ value, score: scoreCandidate(value) }))
    .sort((a, b) => b.score - a.score || a.value.length - b.value.length);

  return ranked[0]?.value || null;
}

async function decodeWithBarcodeDetector(source) {
  if (!('BarcodeDetector' in window)) return null;

  try {
    const formats = ['code_128', 'code_39', 'code_93', 'codabar', 'itf', 'pdf417', 'ean_13', 'ean_8', 'upc_a', 'upc_e'];
    const detector = new BarcodeDetector({ formats });
    const results = await detector.detect(source);

    const values = results
      .map(item => normalizeTracking(item.rawValue || item.rawValue?.text || ''))
      .filter(Boolean);

    return values[0] || null;
  } catch (error) {
    console.warn('BarcodeDetector failed', error);
    return null;
  }
}

async function decodeWithZXingFromCanvasElement(canvasEl) {
  const ZXing = window.ZXingBrowser;
  if (!ZXing) return null;

  try {
    const reader = new ZXing.BrowserMultiFormatReader();
    const result = await reader.decodeFromCanvas(canvasEl);
    return normalizeTracking(result?.text || result?.getText?.());
  } catch {
    return null;
  }
}

function makeCanvas(width, height) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

function drawRotated(sourceCanvas, degrees) {
  const radians = degrees * Math.PI / 180;
  const swap = Math.abs(degrees) === 90;
  const rotated = makeCanvas(swap ? sourceCanvas.height : sourceCanvas.width, swap ? sourceCanvas.width : sourceCanvas.height);
  const rctx = rotated.getContext('2d', { willReadFrequently: true });
  rctx.translate(rotated.width / 2, rotated.height / 2);
  rctx.rotate(radians);
  rctx.drawImage(sourceCanvas, -sourceCanvas.width / 2, -sourceCanvas.height / 2);
  return rotated;
}

function cropCenter(sourceCanvas, widthPercent = 0.7, heightPercent = 0.55) {
  const c = makeCanvas(Math.floor(sourceCanvas.width * widthPercent), Math.floor(sourceCanvas.height * heightPercent));
  const cctx = c.getContext('2d', { willReadFrequently: true });
  const sx = Math.floor((sourceCanvas.width - c.width) / 2);
  const sy = Math.floor((sourceCanvas.height - c.height) / 2);
  cctx.drawImage(sourceCanvas, sx, sy, c.width, c.height, 0, 0, c.width, c.height);
  return c;
}

function enhanceForOCR(sourceCanvas) {
  const enlarged = makeCanvas(sourceCanvas.width * 2, sourceCanvas.height * 2);
  const ectx = enlarged.getContext('2d', { willReadFrequently: true });
  ectx.drawImage(sourceCanvas, 0, 0, enlarged.width, enlarged.height);

  const img = ectx.getImageData(0, 0, enlarged.width, enlarged.height);
  const data = img.data;

  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    const value = gray > 150 ? 255 : 0;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }

  ectx.putImageData(img, 0, 0);
  return enlarged;
}

async function tryBarcodeStrategies(baseCanvas) {
  const candidates = [
    baseCanvas,
    cropCenter(baseCanvas, 0.8, 0.7),
    cropCenter(baseCanvas, 0.65, 0.55),
    drawRotated(baseCanvas, 90),
    drawRotated(baseCanvas, -90),
  ];

  for (const candidate of candidates) {
    const fromNative = await decodeWithBarcodeDetector(candidate);
    if (fromNative) return fromNative;

    const fromZXing = await decodeWithZXingFromCanvasElement(candidate);
    if (fromZXing) return fromZXing;
  }

  return null;
}

async function getTesseractWorker() {
  if (tesseractWorker) return tesseractWorker;

  if (!window.Tesseract?.createWorker) {
    throw new Error('Tesseract failed to load.');
  }

  tesseractWorker = await window.Tesseract.createWorker('eng');
  return tesseractWorker;
}

async function tryOCRStrategies(baseCanvas) {
  const worker = await getTesseractWorker();
  const variants = [
    baseCanvas,
    cropCenter(baseCanvas, 0.85, 0.75),
    cropCenter(baseCanvas, 0.7, 0.6),
    enhanceForOCR(baseCanvas),
    enhanceForOCR(cropCenter(baseCanvas, 0.85, 0.75)),
    drawRotated(enhanceForOCR(baseCanvas), 90),
    drawRotated(enhanceForOCR(baseCanvas), -90),
  ];

  for (const variant of variants) {
    const { data } = await worker.recognize(variant);
    const candidate = extractFedExTrackingFromText(data?.text || '');
    if (candidate) return candidate;
  }

  return null;
}

function setLatestResult(imageDataUrl, trackingValue, sourceLabel = 'N/A') {
  const finalTracking = trackingValue || 'N/A';

  latestScan = {
    id: crypto.randomUUID(),
    imageDataUrl,
    trackingNumber: finalTracking,
    source: sourceLabel,
    createdAt: new Date().toISOString()
  };

  resultImage.src = imageDataUrl;
  resultImage.classList.remove('hidden');
  trackingNumberEl.textContent = finalTracking;
  manualTrackingInput.value = finalTracking === 'N/A' ? '' : finalTracking;
  saveBtn.disabled = false;

  if (finalTracking === 'N/A') {
    setScanStatus('No readable tracking found', 'warning');
  } else if (sourceLabel === 'OCR') {
    setScanStatus('Tracking found by OCR', 'success');
  } else {
    setScanStatus('Tracking found by barcode', 'success');
  }
}

async function processCanvasCapture() {
  const imageDataUrl = canvas.toDataURL('image/jpeg', 0.92);

  try {
    setScanStatus('Reading barcode...', 'neutral');
    let tracking = await tryBarcodeStrategies(canvas);

    if (tracking) {
      setLatestResult(imageDataUrl, tracking, 'Barcode');
      return;
    }

    setScanStatus('Barcode missed. Reading text...', 'warning');
    tracking = await tryOCRStrategies(canvas);

    if (tracking) {
      setLatestResult(imageDataUrl, tracking, 'OCR');
      return;
    }

    setLatestResult(imageDataUrl, null, 'N/A');
  } catch (error) {
    console.error(error);
    setLatestResult(imageDataUrl, null, 'N/A');
    setScanStatus('Scan failed', 'error');
  }
}

function capturePhoto() {
  if (!video.videoWidth || !video.videoHeight) {
    alert('Camera is not ready yet.');
    return;
  }

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  processCanvasCapture();
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem('packageScanHistory') || '[]');
  } catch {
    return [];
  }
}

function saveHistory(items) {
  localStorage.setItem('packageScanHistory', JSON.stringify(items));
}

function renderHistory() {
  const items = loadHistory();

  if (!items.length) {
    historyList.innerHTML = '<div class="history-empty">No saved scans yet.</div>';
    return;
  }

  historyList.innerHTML = items.map(item => `
    <div class="history-item">
      <img class="history-thumb" src="${item.imageDataUrl}" alt="Saved package scan" />
      <div class="history-meta">
        <div class="date">${new Date(item.createdAt).toLocaleString()} • ${item.source || 'Unknown'}</div>
        <div class="code">${item.trackingNumber}</div>
      </div>
      <button class="btn btn-danger btn-small" data-delete-id="${item.id}">Delete</button>
    </div>
  `).join('');
}

function saveLatestScan() {
  if (!latestScan) return;
  const items = loadHistory();
  items.unshift(latestScan);
  saveHistory(items);
  renderHistory();
  setScanStatus('Saved to history', 'success');
}

function clearLatest() {
  latestScan = null;
  resultImage.src = '';
  resultImage.classList.add('hidden');
  trackingNumberEl.textContent = '—';
  manualTrackingInput.value = '';
  saveBtn.disabled = true;
  setScanStatus('Waiting', 'neutral');
}

function applyManualValue() {
  const manualValue = normalizeTracking(manualTrackingInput.value) || manualTrackingInput.value.trim();
  if (!latestScan) {
    alert('Capture or upload a label first.');
    return;
  }
  if (!manualValue) {
    alert('Type a tracking number first.');
    return;
  }
  latestScan.trackingNumber = manualValue;
  latestScan.source = 'Manual';
  trackingNumberEl.textContent = manualValue;
  setScanStatus('Manual tracking applied', 'success');
}

async function handleFileUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const imageBitmap = await createImageBitmap(file);
  canvas.width = imageBitmap.width;
  canvas.height = imageBitmap.height;
  ctx.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height);
  await processCanvasCapture();
  fileInput.value = '';
}

historyList.addEventListener('click', (event) => {
  const deleteId = event.target?.dataset?.deleteId;
  if (!deleteId) return;

  const items = loadHistory().filter(item => item.id !== deleteId);
  saveHistory(items);
  renderHistory();
});

clearHistoryBtn.addEventListener('click', () => {
  if (!confirm('Delete all saved scan history?')) return;
  localStorage.removeItem('packageScanHistory');
  renderHistory();
});

startCameraBtn.addEventListener('click', startCamera);
captureBtn.addEventListener('click', capturePhoto);
switchCameraBtn.addEventListener('click', switchCamera);
stopCameraBtn.addEventListener('click', stopCamera);
saveBtn.addEventListener('click', saveLatestScan);
clearLatestBtn.addEventListener('click', clearLatest);
fileInput.addEventListener('change', handleFileUpload);
applyManualBtn.addEventListener('click', applyManualValue);

window.addEventListener('beforeunload', async () => {
  stopCamera();
  if (tesseractWorker) {
    try { await tesseractWorker.terminate(); } catch {}
  }
});

renderHistory();
