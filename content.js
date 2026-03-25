const state = {
  running: false,
  stopRequested: false,
  port: null
};

const STEP_DELAY_MIN_MS = 1000;
const STEP_DELAY_MAX_MS = 3000;
const POST_DELAY_MIN_MS = 20000;
const POST_DELAY_MAX_MS = 40000;
const MAX_RETRIES = 2;

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function randomStepDelay() {
  await delay(randomBetween(STEP_DELAY_MIN_MS, STEP_DELAY_MAX_MS));
}

async function randomPostDelay() {
  await delay(randomBetween(POST_DELAY_MIN_MS, POST_DELAY_MAX_MS));
}

function logStatus(message, progress = null) {
  state.port?.postMessage({ type: 'status', message, progress });
}

function logError(message) {
  state.port?.postMessage({ type: 'error', message });
}

function normalize(text) {
  return text?.toLowerCase().replace(/\s+/g, ' ').trim() || '';
}

function getVisibleElements(selector) {
  return Array.from(document.querySelectorAll(selector)).filter((el) => {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
  });
}

function findClickableByText(textPatterns, selectors = 'button,[role="button"],div[role="button"]') {
  const patterns = textPatterns.map((p) => p.toLowerCase());
  const elements = getVisibleElements(selectors);

  for (const el of elements) {
    const text = normalize(el.innerText || el.getAttribute('aria-label') || el.textContent || '');
    if (patterns.some((p) => text.includes(p))) {
      return el;
    }
  }
  return null;
}

async function waitForElement(checkFn, timeoutMs = 20000, intervalMs = 300) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const found = checkFn();
      if (found) {
        clearInterval(timer);
        resolve(found);
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error('Timed out waiting for UI element.'));
      }
    }, intervalMs);
  });
}

function dataUrlToFile(dataUrl, fileName, mimeType = 'image/jpeg') {
  const arr = dataUrl.split(',');
  const mime = (arr[0].match(/:(.*?);/) || [])[1] || mimeType;
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], fileName, { type: mime });
}

function setNativeInputValue(element, value) {
  const valueSetter = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value')?.set;
  valueSetter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

async function clickCreatePost() {
  const createButton = await waitForElement(() =>
    findClickableByText(['create post', 'create', 'new post'])
  );
  createButton.click();
  logStatus('Clicked Create Post.');
}

async function uploadImage(filePayload) {
  const input = await waitForElement(() => {
    const candidates = getVisibleElements('input[type="file"]');
    return candidates.find((el) => el.accept.includes('image') || !el.accept);
  });

  const dt = new DataTransfer();
  dt.items.add(dataUrlToFile(filePayload.dataUrl, filePayload.name, filePayload.type));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new Event('input', { bubbles: true }));

  logStatus(`Uploaded image ${filePayload.name}.`);
}

async function fillCaption(caption) {
  const editor = await waitForElement(() => {
    const ariaEditor = document.querySelector('[role="textbox"][contenteditable="true"]');
    if (ariaEditor) return ariaEditor;

    const fallback = getVisibleElements('[contenteditable="true"],textarea').find((el) => {
      const label = normalize(el.getAttribute('aria-label') || el.getAttribute('placeholder') || '');
      return label.includes('caption') || label.includes('write') || label.includes('text');
    });

    return fallback || null;
  });

  editor.focus();

  if (editor.tagName.toLowerCase() === 'textarea' || editor.tagName.toLowerCase() === 'input') {
    setNativeInputValue(editor, caption);
  } else {
    editor.innerHTML = '';
    editor.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'deleteContentBackward' }));
    editor.textContent = caption;
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: caption }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
  }

  logStatus('Caption inserted.');
}

async function openSchedulePanel() {
  const scheduleTrigger = await waitForElement(() =>
    findClickableByText(['schedule', 'set date and time', 'publish options'])
  );
  scheduleTrigger.click();
  logStatus('Opened scheduling panel.');
}

function formatDateForInput(dateObj) {
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatTimeForInput(dateObj) {
  const hh = String(dateObj.getHours()).padStart(2, '0');
  const mm = String(dateObj.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

async function setDateTime(dateObj) {
  const dateInput = await waitForElement(() => {
    const candidates = Array.from(document.querySelectorAll('input[type="date"], input[aria-label*="Date" i], input[placeholder*="Date" i]'));
    return candidates.find((el) => el.offsetParent !== null) || null;
  });

  const timeInput = await waitForElement(() => {
    const candidates = Array.from(document.querySelectorAll('input[type="time"], input[aria-label*="Time" i], input[placeholder*="Time" i]'));
    return candidates.find((el) => el.offsetParent !== null) || null;
  });

  setNativeInputValue(dateInput, formatDateForInput(dateObj));
  await randomStepDelay();
  setNativeInputValue(timeInput, formatTimeForInput(dateObj));

  logStatus(`Set schedule to ${dateObj.toLocaleString()}.`);
}

async function confirmSchedule() {
  const confirmButton = await waitForElement(() =>
    findClickableByText(['schedule', 'save', 'done'])
  );
  confirmButton.click();
  logStatus('Confirmed scheduled post.');
}

function buildScheduleTimes(startDate, postsPerDay, total) {
  const baseSlots = [10, 14, 18];
  const slots = [];

  if (postsPerDay <= baseSlots.length) {
    for (let i = 0; i < postsPerDay; i += 1) {
      slots.push(baseSlots[i]);
    }
  } else {
    const step = Math.max(1, Math.floor(12 / postsPerDay));
    let hour = 9;
    for (let i = 0; i < postsPerDay; i += 1) {
      slots.push(Math.min(23, hour));
      hour += step;
    }
  }

  const start = new Date(`${startDate}T00:00:00`);
  const schedule = [];

  for (let i = 0; i < total; i += 1) {
    const dayOffset = Math.floor(i / postsPerDay);
    const slotIdx = i % postsPerDay;
    const date = new Date(start);
    date.setDate(start.getDate() + dayOffset);
    date.setHours(slots[slotIdx], 0, 0, 0);
    schedule.push(date);
  }

  return schedule;
}

async function runStepWithRetry(name, stepFn, retries = MAX_RETRIES) {
  let lastError;
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      await stepFn();
      return;
    } catch (error) {
      lastError = error;
      const msg = `${name} failed (attempt ${attempt}/${retries + 1}): ${error.message}`;
      logError(msg);
      await randomStepDelay();
    }
  }
  throw lastError;
}

async function scheduleOnePost(item, scheduledDate, index, total) {
  const progress = `Post ${index + 1} of ${total}`;
  logStatus(`Starting ${progress}`, progress);

  await runStepWithRetry('Create post', clickCreatePost);
  await randomStepDelay();

  await runStepWithRetry('Upload image', () => uploadImage(item.file));
  await randomStepDelay();

  await runStepWithRetry('Fill caption', () => fillCaption(item.caption));
  await randomStepDelay();

  await runStepWithRetry('Open schedule', openSchedulePanel);
  await randomStepDelay();

  await runStepWithRetry('Set date/time', () => setDateTime(scheduledDate));
  await randomStepDelay();

  await runStepWithRetry('Confirm schedule', confirmSchedule);

  logStatus(`Completed ${progress}`, progress);
}

async function runAutomation(payload) {
  if (state.running) {
    logError('Automation already running.');
    return;
  }

  const { files, captions, startDate, postsPerDay } = payload;

  if (!Array.isArray(files) || !Array.isArray(captions) || !files.length) {
    logError('Invalid payload.');
    return;
  }

  state.running = true;
  state.stopRequested = false;

  try {
    const scheduleDates = buildScheduleTimes(startDate, Number(postsPerDay), files.length);

    for (let i = 0; i < files.length; i += 1) {
      if (state.stopRequested) {
        logStatus('Stop requested. Ending automation early.');
        break;
      }

      const item = {
        file: files[i],
        caption: captions[i] || ''
      };

      try {
        await scheduleOnePost(item, scheduleDates[i], i, files.length);
      } catch (error) {
        logError(`Skipped post ${i + 1} after retries: ${error.message}`);
      }

      if (i < files.length - 1) {
        logStatus('Waiting randomized anti-detection delay before next post...');
        await randomPostDelay();
      }
    }

    state.port?.postMessage({ type: 'done' });
  } finally {
    state.running = false;
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'bulk-scheduler-popup') {
    return;
  }

  state.port = port;
  logStatus('Connected to popup controller.');

  port.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'startScheduling') {
      runAutomation(msg.payload);
    }

    if (msg.type === 'stopScheduling') {
      state.stopRequested = true;
    }
  });

  port.onDisconnect.addListener(() => {
    state.port = null;
  });
});
