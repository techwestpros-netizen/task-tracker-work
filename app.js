const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
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

let stream = null;
let currentFacingMode = 'environment';
let latestScan = null;

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

  const looksValid =
    /^[A-Z0-9-]{8,40}$/i.test(clean) ||
    /\d{10,34}/.test(clean);

  return looksValid ? clean : null;
}

async function decodeFromCanvas() {
  const ZXing = window.ZXingBrowser;
  if (!ZXing) return null;

  const reader = new ZXing.BrowserMultiFormatReader();

  try {
    const result = await reader.decodeFromCanvas(canvas);
    return normalizeTracking(result?.text || result?.getText?.());
  } catch {
    return null;
  }
}

function setLatestResult(imageDataUrl, trackingValue) {
  const finalTracking = trackingValue || 'N/A';

  latestScan = {
    id: crypto.randomUUID(),
    imageDataUrl,
    trackingNumber: finalTracking,
    createdAt: new Date().toISOString()
  };

  resultImage.src = imageDataUrl;
  resultImage.classList.remove('hidden');
  trackingNumberEl.textContent = finalTracking;
  saveBtn.disabled = false;

  if (finalTracking === 'N/A') {
    setScanStatus('No readable tracking found', 'warning');
  } else {
    setScanStatus('Tracking found', 'success');
  }
}

async function processCanvasCapture() {
  setScanStatus('Reading label...', 'neutral');
  const tracking = await decodeFromCanvas();
  setLatestResult(canvas.toDataURL('image/jpeg', 0.92), tracking);
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
      <img class="history-thumb" src="${item.imageDataUrl}" />
      <div class="history-meta">
        <div class="date">${new Date(item.createdAt).toLocaleString()}</div>
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
  saveBtn.disabled = true;
  setScanStatus('Waiting', 'neutral');
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

window.addEventListener('beforeunload', stopCamera);

renderHistory();
