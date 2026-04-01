const video = document.getElementById('video');
const startCameraBtn = document.getElementById('startCameraBtn');
const switchCameraBtn = document.getElementById('switchCameraBtn');
const stopCameraBtn = document.getElementById('stopCameraBtn');
const trackingNumberEl = document.getElementById('trackingNumber');
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
let currentReader = null;
let latestScan = null;
let lastScannedValue = '';
let lastScanTime = 0;
let isStartingCamera = false;
let zxingLoadPromise = null;

function setScanStatus(text, type = 'neutral') {
  scanStatus.textContent = text;
  scanStatus.className = `status-pill ${type}`;
}

function setCameraStatus(text, type = 'neutral') {
  cameraStatus.textContent = text;
  cameraStatus.className = `status-pill ${type}`;
}

function normalizeTracking(value) {
  if (!value) return null;
  const clean = String(value).trim().replace(/\s+/g, '');
  if (!clean) return null;
  if (/^[A-Z0-9-]{8,40}$/i.test(clean)) return clean;
  if (/\d{8,40}/.test(clean)) return clean;
  return null;
}

function setLatestResult(value, source = 'Barcode') {
  const finalValue = normalizeTracking(value) || value || 'N/A';
  latestScan = {
    id: crypto.randomUUID(),
    trackingNumber: finalValue,
    source,
    createdAt: new Date().toISOString()
  };
  trackingNumberEl.textContent = finalValue;
  manualTrackingInput.value = finalValue === 'N/A' ? '' : finalValue;
  saveBtn.disabled = false;
  setScanStatus(source === 'Manual' ? 'Manual value applied' : 'Barcode scanned live', 'success');
}

function clearLatest() {
  latestScan = null;
  trackingNumberEl.textContent = '—';
  manualTrackingInput.value = '';
  saveBtn.disabled = true;
  setScanStatus('Waiting', 'neutral');
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem('liveBarcodeHistory') || '[]'); }
  catch { return []; }
}

function saveHistory(items) {
  localStorage.setItem('liveBarcodeHistory', JSON.stringify(items));
}

function renderHistory() {
  const items = loadHistory();
  if (!items.length) {
    historyList.innerHTML = '<div class="history-empty">No saved scans yet.</div>';
    return;
  }
  historyList.innerHTML = items.map(item => `
    <div class="history-item">
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

function applyManualValue() {
  const manualValue = normalizeTracking(manualTrackingInput.value) || manualTrackingInput.value.trim();
  if (!manualValue) {
    alert('Type a barcode or tracking value first.');
    return;
  }
  setLatestResult(manualValue, 'Manual');
}

function handleDecodedValue(rawValue) {
  const normalized = normalizeTracking(rawValue);
  if (!normalized) return;
  const now = Date.now();
  const isDuplicate = normalized === lastScannedValue && now - lastScanTime < 2500;
  if (isDuplicate) return;
  lastScannedValue = normalized;
  lastScanTime = now;
  setLatestResult(normalized, 'Barcode');
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-src="${src}"]`);
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
      if (existing.dataset.loaded === 'true') resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.src = src;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

async function ensureZXingLoaded() {
  if (window.ZXingBrowser) return;
  if (!zxingLoadPromise) {
    zxingLoadPromise = (async () => {
      const sources = [
        'https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/index.min.js',
        'https://unpkg.com/@zxing/browser@0.1.5/umd/index.min.js'
      ];
      let lastError = null;
      for (const src of sources) {
        try {
          await loadScript(src);
          if (window.ZXingBrowser) return;
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError || new Error('ZXing barcode library did not load.');
    })();
  }
  return zxingLoadPromise;
}

function stopReader() {
  if (currentReader && typeof currentReader.reset === 'function') {
    try { currentReader.reset(); }
    catch (error) { console.warn('Reader reset failed', error); }
  }
  currentReader = null;
}

function stopCamera() {
  stopReader();
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  video.srcObject = null;
  switchCameraBtn.disabled = true;
  stopCameraBtn.disabled = true;
  startCameraBtn.disabled = false;
  setCameraStatus('Camera off', 'neutral');
  cameraPlaceholder.classList.remove('hidden');
}

async function startCamera() {
  if (isStartingCamera) return;
  isStartingCamera = true;

  try {
    stopCamera();
    setScanStatus('Loading scanner...', 'neutral');
    await ensureZXingLoaded();

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser does not support camera access.');
    }

    currentReader = new window.ZXingBrowser.BrowserMultiFormatReader();

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: currentFacingMode },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });

    video.srcObject = stream;
    await video.play();

    switchCameraBtn.disabled = false;
    stopCameraBtn.disabled = false;
    startCameraBtn.disabled = true;
    setCameraStatus(currentFacingMode === 'environment' ? 'Rear camera live' : 'Front camera live', 'success');
    setScanStatus('Scanning live...', 'neutral');
    cameraPlaceholder.classList.add('hidden');

    currentReader.decodeFromVideoElementContinuously(video, (result) => {
      if (result) handleDecodedValue(result.text || result.getText?.() || '');
    });
  } catch (error) {
    console.error(error);
    setCameraStatus('Camera blocked', 'error');
    setScanStatus('Scanner failed to start', 'error');
    alert(`Could not open live scanner: ${error.message}`);
    stopCamera();
  } finally {
    isStartingCamera = false;
  }
}

async function switchCamera() {
  currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
  await startCamera();
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
  localStorage.removeItem('liveBarcodeHistory');
  renderHistory();
});

startCameraBtn.addEventListener('click', startCamera);
switchCameraBtn.addEventListener('click', switchCamera);
stopCameraBtn.addEventListener('click', stopCamera);
saveBtn.addEventListener('click', saveLatestScan);
clearLatestBtn.addEventListener('click', clearLatest);
applyManualBtn.addEventListener('click', applyManualValue);
window.addEventListener('beforeunload', stopCamera);

renderHistory();