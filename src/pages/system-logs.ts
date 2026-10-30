/**
 * System Logs page logic
 */

import { initPasswordGate } from './utils/password-gate.js';
import { whenDocumentReady } from './utils/document-ready.js';
import { showPageLoadErrorInMain } from './utils/page-load-error.js';
import { loadSystemLogs, clearSystemLogsHandler } from './utils/system-logs-handler.js';
import { setupRefreshButton } from './utils/refresh-button.js';

whenDocumentReady(() => {
  void initPasswordGate(async () => {
    await loadSystemLogs();
    await setupEventListeners();
  }).catch((error) => {
    console.error('Error initializing system logs page:', error);
    showPageLoadErrorInMain('Error Loading System Logs', error);
  });
});

async function setupEventListeners(): Promise<void> {
  // Refresh logs button with loading indication
  await setupRefreshButton('refreshLogsBtn', loadSystemLogs, {
    loadingText: 'Refreshing...',
    successText: 'Refreshed',
    successDuration: 1500
  });
  
  // Clear all logs button
  const clearLogsBtn = document.getElementById('clearLogsBtn');
  if (clearLogsBtn) clearLogsBtn.addEventListener('click', clearSystemLogsHandler);
  
  // Auto-refresh logs when they change
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.systemLogs) {
      loadSystemLogs();
    }
  });
}
