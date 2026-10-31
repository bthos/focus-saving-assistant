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
