const imagePicker = document.getElementById('imagePicker');
const imageCount = document.getElementById('imageCount');
const captionsInput = document.getElementById('captionsInput');
const captionCount = document.getElementById('captionCount');
const startDate = document.getElementById('startDate');
const postsPerDayInput = document.getElementById('postsPerDay');
const startBtn = document.getElementById('startBtn');
const validationMsg = document.getElementById('validationMsg');
const statusLog = document.getElementById('statusLog');
const progressText = document.getElementById('progressText');

let selectedImages = [];
let port;

function todayIsoDate() {
  const now = new Date();
  const tzOffset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - tzOffset).toISOString().slice(0, 10);
}

function parseCaptions(raw) {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function appendLog(message, level = 'info') {
  const ts = new Date().toLocaleTimeString();
  const prefix = level === 'error' ? '[ERROR]' : level === 'warn' ? '[WARN]' : '[INFO]';
  statusLog.textContent += `\n${ts} ${prefix} ${message}`;
  statusLog.scrollTop = statusLog.scrollHeight;
}

function setValidation(message, isError = true) {
  validationMsg.textContent = message;
  validationMsg.className = isError ? 'error' : 'success';
}

function updateCounts() {
  imageCount.textContent = `${selectedImages.length} image(s) selected`;
  captionCount.textContent = `${parseCaptions(captionsInput.value).length} caption(s)`;
}

function validateBeforeStart() {
  const captions = parseCaptions(captionsInput.value);

  if (!selectedImages.length) {
    return 'Please select at least one image.';
  }

  if (!captions.length) {
    return 'Please provide captions (one per line).';
  }

  if (selectedImages.length !== captions.length) {
    return 'Number of images and captions must match';
  }

  const postsPerDay = Number(postsPerDayInput.value || 0);
  if (!Number.isInteger(postsPerDay) || postsPerDay < 1) {
    return 'Posts per day must be a positive number.';
  }

  if (!startDate.value) {
    return 'Please choose a start date.';
  }

  return null;
}

function serializeFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        name: file.name,
        type: file.type,
        dataUrl: reader.result
      });
    };
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function getOrCreateBusinessSuiteTab() {
  const existing = await chrome.tabs.query({ url: 'https://business.facebook.com/*' });
  if (existing.length > 0) {
    const tab = existing[0];
    await chrome.tabs.update(tab.id, { active: true });
    return tab.id;
  }

  const tab = await chrome.tabs.create({
    url: 'https://business.facebook.com/latest/home',
    active: true
  });

  return tab.id;
}

function connectPort(tabId) {
  if (port) {
    try {
      port.disconnect();
    } catch {
      // Ignore
    }
  }

  port = chrome.tabs.connect(tabId, { name: 'bulk-scheduler-popup' });

  port.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'status') {
      appendLog(msg.message || '');
      if (msg.progress) {
        progressText.textContent = msg.progress;
      }
    }

    if (msg.type === 'error') {
      appendLog(msg.message || 'Unknown error', 'error');
    }

    if (msg.type === 'done') {
      appendLog('Automation completed.');
      progressText.textContent = 'Done';
      setValidation('Scheduling completed.', false);
      startBtn.disabled = false;
    }
  });

  port.onDisconnect.addListener(() => {
    appendLog('Disconnected from content script.', 'warn');
  });
}

imagePicker.addEventListener('change', () => {
  selectedImages = Array.from(imagePicker.files || []).filter((f) => f.type.startsWith('image/'));
  updateCounts();
  chrome.storage.local.set({ imageCount: selectedImages.length });
});

captionsInput.addEventListener('input', () => {
  updateCounts();
  chrome.storage.local.set({ captionsRaw: captionsInput.value });
});

startDate.value = todayIsoDate();
postsPerDayInput.value = '3';

(async () => {
  const saved = await chrome.storage.local.get(['captionsRaw', 'postsPerDay', 'startDate']);
  if (saved.captionsRaw) {
    captionsInput.value = saved.captionsRaw;
  }
  if (saved.postsPerDay) {
    postsPerDayInput.value = String(saved.postsPerDay);
  }
  if (saved.startDate) {
    startDate.value = saved.startDate;
  }
  updateCounts();
})();

startBtn.addEventListener('click', async () => {
  setValidation('');
  progressText.textContent = 'Preparing...';

  const validationError = validateBeforeStart();
  if (validationError) {
    setValidation(validationError, true);
    progressText.textContent = 'Validation failed';
    return;
  }

  startBtn.disabled = true;

  try {
    const captions = parseCaptions(captionsInput.value);
    const postsPerDay = Number(postsPerDayInput.value);

    const serializedFiles = [];
    for (const file of selectedImages) {
      serializedFiles.push(await serializeFile(file));
    }

    await chrome.storage.local.set({
      captionsRaw: captionsInput.value,
      postsPerDay,
      startDate: startDate.value,
      lastRunTotal: serializedFiles.length
    });

    const tabId = await getOrCreateBusinessSuiteTab();
    connectPort(tabId);

    appendLog(`Sending ${serializedFiles.length} posts to tab ${tabId}...`);
    progressText.textContent = `Post 0 of ${serializedFiles.length}`;

    port.postMessage({
      type: 'startScheduling',
      payload: {
        files: serializedFiles,
        captions,
        startDate: startDate.value,
        postsPerDay
      }
    });
  } catch (error) {
    appendLog(error?.message || 'Failed to initialize scheduling.', 'error');
    setValidation(error?.message || 'Failed to initialize scheduling.', true);
    startBtn.disabled = false;
  }
});
