/**
 * Popup menu logic
 */

document.addEventListener('DOMContentLoaded', () => {
  const optionsBtn = document.getElementById('optionsBtn');
  const historyBtn = document.getElementById('historyBtn');
  const cacheBtn = document.getElementById('cacheBtn');
  const systemLogsBtn = document.getElementById('systemLogsBtn');
  
  if (!optionsBtn || !historyBtn || !cacheBtn || !systemLogsBtn) {
    console.error('Popup buttons not found');
    return;
  }
  
  optionsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  
  historyBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/history.html') });
  });
  
  cacheBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/cache.html') });
  });
  
  systemLogsBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/system-logs.html') });
  });
});
