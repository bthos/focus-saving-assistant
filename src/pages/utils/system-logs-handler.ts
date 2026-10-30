/**
 * System logs handler for displaying and managing logs
 */

import { getSystemLogs, clearSystemLogs, clearErrorLogs, SystemLogEntry } from '../../utils/system-logger.js';
import { escapeHtml } from './form-helpers.js';
import { showStatus } from './form-helpers.js';

/**
 * Load and display system logs
 */
export async function loadSystemLogs(): Promise<void> {
  const container = document.getElementById('systemLogsContainer');
  if (!container) return;

  try {
    const logs = await getSystemLogs();
    console.log('Loaded system logs:', logs.length, 'entries');
    
    // Filter to show only AI logs for debugging
    const aiLogs = logs.filter(log => log.category === 'ai');
    console.log('AI logs:', aiLogs.length, 'entries');

    if (logs.length === 0) {
      container.innerHTML = '<div class="system-logs-placeholder">No errors logged yet.</div>';
      return;
    }

    container.innerHTML = logs.map((log: SystemLogEntry) => {
      const date = new Date(log.timestamp);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');
      const timeStr = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

      const categoryEmoji: Record<SystemLogEntry['category'], string> = {
        ai: '🤖',
        telegram: '📱',
        system: '⚙️',
        other: '⚠️'
      };

      // Format details with preserved line breaks
      const formattedDetails = log.details 
        ? escapeHtml(log.details).replace(/\n/g, '<br>')
        : '';
      
      return `
        <div class="system-log-entry ${log.category}">
          <div class="system-log-time">${timeStr}</div>
          <div class="system-log-message">
            <span class="system-log-category">${categoryEmoji[log.category]} [${log.category.toUpperCase()}]</span>
            ${escapeHtml(log.message)}
          </div>
          ${formattedDetails ? `<div class="system-log-details">${formattedDetails}</div>` : ''}
        </div>
      `;
    }).join('');
  } catch (error) {
    container.innerHTML = '<div class="system-logs-placeholder">Error loading logs.</div>';
    console.error('Error loading system logs:', error);
  }
}

/**
 * Clear error logs handler
 * Clears only AI, Telegram, and System logs (keeps 'other' category)
 */
export async function clearErrorLogsHandler(): Promise<void> {
  const logs = await getSystemLogs();
  const errorLogs = logs.filter(log => ['ai', 'telegram', 'system'].includes(log.category));
  const otherLogs = logs.filter(log => log.category === 'other');
  
  if (errorLogs.length === 0) {
    showStatus('No error logs to clear', 'info');
    return;
  }
  
  const message = `Are you sure you want to clear ${errorLogs.length} error log(s)?\n` +
    `This will remove AI, Telegram, and System logs.\n` +
    (otherLogs.length > 0 ? `${otherLogs.length} log(s) in 'other' category will be kept.` : '');
  
  if (!confirm(message)) {
    return;
  }

  try {
    await clearErrorLogs();
    await loadSystemLogs();
    showStatus(`Cleared ${errorLogs.length} error log(s) successfully`, 'success');
  } catch (error) {
    showStatus('Error clearing error logs', 'error');
    console.error('Error clearing error logs:', error);
  }
}

/**
 * Clear all system logs handler
 * Clears ALL logs including 'other' category
 */
export async function clearSystemLogsHandler(): Promise<void> {
  const logs = await getSystemLogs();
  
  if (logs.length === 0) {
    showStatus('No logs to clear', 'info');
    return;
  }
  
  const message = `Are you sure you want to clear ALL ${logs.length} system log(s)?\n` +
    `This will remove all logs including AI, Telegram, System, and Other categories.\n` +
    `This action cannot be undone.`;
  
  if (!confirm(message)) {
    return;
  }

  try {
    await clearSystemLogs();
    await loadSystemLogs();
    showStatus(`Cleared all ${logs.length} log(s) successfully`, 'success');
  } catch (error) {
    showStatus('Error clearing system logs', 'error');
    console.error('Error clearing system logs:', error);
  }
}
