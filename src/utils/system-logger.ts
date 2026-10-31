/**
 * System logger for storing and retrieving system errors
 */

import { MAX_LOG_ENTRIES, STORAGE_KEYS } from './constants.js';

export interface SystemLogEntry {
  timestamp: number;
  category: 'ai' | 'telegram' | 'system' | 'other';
  message: string;
  details?: string;
}

/**
 * Add an error entry to the system log
 */
export async function addSystemLog(
  category: SystemLogEntry['category'],
  message: string,
  details?: string
): Promise<void> {
  try {
    // Check if system logs are enabled
    const settings = await chrome.storage.local.get([STORAGE_KEYS.SETTINGS]);
    const enableSystemLogs = settings[STORAGE_KEYS.SETTINGS]?.enableSystemLogs !== false; // Default to true if not set
    
    if (!enableSystemLogs) {
      return; // System logs are disabled, don't log
    }
    
    const stored = await chrome.storage.local.get([STORAGE_KEYS.SYSTEM_LOGS]);
    const logs: SystemLogEntry[] = stored[STORAGE_KEYS.SYSTEM_LOGS] || [];
    
    const entry: SystemLogEntry = {
      timestamp: Date.now(),
      category,
      message,
      details
    };
    
    logs.unshift(entry); // Add to beginning
    
    // Keep only the last MAX_LOG_ENTRIES entries
    if (logs.length > MAX_LOG_ENTRIES) {
      logs.splice(MAX_LOG_ENTRIES);
    }
    
    await chrome.storage.local.set({ [STORAGE_KEYS.SYSTEM_LOGS]: logs });
  } catch (error) {
    console.error('Error saving system log:', error);
  }
}

/**
 * Get all system log entries
 */
export async function getSystemLogs(): Promise<SystemLogEntry[]> {
  try {
    const stored = await chrome.storage.local.get([STORAGE_KEYS.SYSTEM_LOGS]);
    return stored[STORAGE_KEYS.SYSTEM_LOGS] || [];
  } catch (error) {
    console.error('Error retrieving system logs:', error);
    return [];
  }
}

/**
 * Clear all system logs
 */
export async function clearSystemLogs(): Promise<void> {
  try {
    await chrome.storage.local.remove(STORAGE_KEYS.SYSTEM_LOGS);
  } catch (error) {
    console.error('Error clearing system logs:', error);
  }
}

/**
 * Clear system logs by category
 */
export async function clearSystemLogsByCategory(categories: SystemLogEntry['category'][]): Promise<void> {
  try {
    const stored = await chrome.storage.local.get([STORAGE_KEYS.SYSTEM_LOGS]);
    const logs: SystemLogEntry[] = stored[STORAGE_KEYS.SYSTEM_LOGS] || [];
    
    // Filter out logs with specified categories
    const filteredLogs = logs.filter(log => !categories.includes(log.category));
    
    if (filteredLogs.length === 0) {
      await chrome.storage.local.remove(STORAGE_KEYS.SYSTEM_LOGS);
    } else {
      await chrome.storage.local.set({ [STORAGE_KEYS.SYSTEM_LOGS]: filteredLogs });
    }
  } catch (error) {
    console.error('Error clearing system logs by category:', error);
  }
}

/**
 * Clear error logs (all categories except 'other')
 */
export async function clearErrorLogs(): Promise<void> {
  // Clear AI, Telegram, and System errors (keep 'other' category)
  await clearSystemLogsByCategory(['ai', 'telegram', 'system']);
}

/**
 * Format log entry for display
 */
export function formatLogEntry(entry: SystemLogEntry): string {
  const date = new Date(entry.timestamp);
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
  
  let formatted = `[${timeStr}] ${categoryEmoji[entry.category]} [${entry.category.toUpperCase()}] ${entry.message}`;
  
  if (entry.details) {
    formatted += `\n   Details: ${entry.details}`;
  }
  
  return formatted;
}
