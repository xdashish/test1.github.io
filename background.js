chrome.runtime.onInstalled.addListener(() => {
  console.log('Meta Business Suite Bulk Scheduler installed.');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'ping') {
    sendResponse({ ok: true, from: 'background', tabId: sender.tab?.id ?? null });
  }
  return true;
});
