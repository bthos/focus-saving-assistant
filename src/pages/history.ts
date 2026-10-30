/**
 * History page logic
 */

import { initPasswordGate } from './utils/password-gate.js';
import { whenDocumentReady } from './utils/document-ready.js';
import { setupRefreshButton } from './utils/refresh-button.js';

interface HistoryEntry {
  id: number;
  url: string;
  title: string;
  timestamp: number;
  restricted: boolean;
  reason?: string;
  matchedPattern?: string;
  classification?: {
    isEducational?: boolean | null;
    category: string;
    reason: string;
    isAgeAppropriate?: boolean | null;
    safetyLevel?: string | null;
    suggestedUrl?: string | null;
    noUrlReason?: string | null;
    model?: string;
    // Legacy fields for backward compatibility
    educational?: boolean | null;
    ageAppropriate?: boolean | null;
    suggestedEducationalResource?: string | null;
  };
}

let allHistory: HistoryEntry[] = [];
let filteredHistory: HistoryEntry[] = [];
let currentPage = 1;
const itemsPerPage = 50;

whenDocumentReady(() => {
  void initPasswordGate(async () => {
    await loadHistory();
    await setupEventListeners();
  }).catch((err) => console.error('History page init failed', err));
});

async function loadHistory(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(['history']);
    allHistory = (result.history as HistoryEntry[]) || [];
    filteredHistory = [...allHistory];
    renderHistory();
    updateStats();
  } catch (error) {
    console.error('Error loading history:', error);
    showError('Error loading history');
  }
}

async function setupEventListeners(): Promise<void> {
  await setupRefreshButton('refreshBtn', loadHistory, {
    loadingText: 'Refreshing...',
    successText: 'Refreshed',
    successDuration: 1500
  });
  
  const exportBtn = document.getElementById('exportBtn');
  if (exportBtn) exportBtn.addEventListener('click', exportHistory);
  
  const clearBtn = document.getElementById('clearBtn');
  if (clearBtn) clearBtn.addEventListener('click', clearHistory);
  
  const applyFiltersBtn = document.getElementById('applyFiltersBtn');
  if (applyFiltersBtn) applyFiltersBtn.addEventListener('click', applyFilters);
  
  const resetFiltersBtn = document.getElementById('resetFiltersBtn');
  if (resetFiltersBtn) resetFiltersBtn.addEventListener('click', resetFilters);
  
  const searchInput = document.getElementById('searchInput') as HTMLInputElement;
  if (searchInput) {
    searchInput.addEventListener('input', debounce(applyFilters, 300));
  }
}

function applyFilters(): void {
  const searchInput = document.getElementById('searchInput') as HTMLInputElement;
  const filterTypeEl = document.getElementById('filterType') as HTMLSelectElement;
  const dateFilterEl = document.getElementById('dateFilter') as HTMLInputElement;
  
  const searchTerm = searchInput?.value.toLowerCase() || '';
  const filterType = filterTypeEl?.value || 'all';
  const dateFilter = dateFilterEl?.value || '';
  
  filteredHistory = allHistory.filter(entry => {
    // Search
    if (searchTerm) {
      const matchesSearch = 
        entry.url.toLowerCase().includes(searchTerm) ||
        (entry.title && entry.title.toLowerCase().includes(searchTerm));
      if (!matchesSearch) return false;
    }
    
    // Filter by type
    if (filterType === 'restricted' && !entry.restricted) return false;
    if (filterType === 'allowed' && entry.restricted) return false;
    const isEducational = entry.classification?.isEducational ?? entry.classification?.educational ?? null;
    if (filterType === 'educational' && (!entry.classification || isEducational !== true)) return false;
    if (filterType === 'non-educational' && (!entry.classification || isEducational !== false)) return false;
    
    // Date filter
    if (dateFilter) {
      const entryDate = new Date(entry.timestamp).toISOString().split('T')[0];
      if (entryDate !== dateFilter) return false;
    }
    
    return true;
  });
  
  currentPage = 1;
  renderHistory();
}

function resetFilters(): void {
  const searchInput = document.getElementById('searchInput') as HTMLInputElement;
  const filterTypeEl = document.getElementById('filterType') as HTMLSelectElement;
  const dateFilterEl = document.getElementById('dateFilter') as HTMLInputElement;
  
  if (searchInput) searchInput.value = '';
  if (filterTypeEl) filterTypeEl.value = 'all';
  if (dateFilterEl) dateFilterEl.value = '';
  
  filteredHistory = [...allHistory];
  currentPage = 1;
  renderHistory();
}

function renderHistory(): void {
  const container = document.getElementById('historyList');
  if (!container) return;
  
  if (filteredHistory.length === 0) {
    container.innerHTML = '<div class="empty">History is empty</div>';
    renderPagination();
    return;
  }
  
  const start = (currentPage - 1) * itemsPerPage;
  const end = start + itemsPerPage;
  const pageItems = filteredHistory.slice(start, end);
  
  container.innerHTML = pageItems.map(entry => {
    const date = new Date(entry.timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    
    let classificationBadge = '';
    if (entry.classification) {
      const isEducational = entry.classification.isEducational ?? entry.classification.educational ?? null;
      if (isEducational !== null) {
        classificationBadge = `<span class="badge ${isEducational ? 'badge-success' : 'badge-warning'}">
          ${isEducational ? 'Educational' : 'Non-Educational'}
        </span>`;
      }
    }
    
    const restrictedBadge = entry.restricted ? 
      '<span class="badge badge-danger">Restricted</span>' : 
      '<span class="badge badge-success">Allowed</span>';
    
    // Always show classification details if classification exists
    const hasClassification = entry.classification !== null && entry.classification !== undefined;

    return `
      <div class="history-item ${entry.restricted ? 'restricted' : ''}">
        <!-- Important Information Section -->
        <div class="item-main">
          <div class="item-header">
            <div class="item-title">${escapeHtml(entry.title || 'No title')}</div>
            <div class="item-badges">
              ${restrictedBadge}
              ${classificationBadge}
            </div>
          </div>
          <div class="item-url">
            <a href="${entry.url}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(entry.url)}">
              ${escapeHtml(entry.url)}
            </a>
          </div>
          <div class="item-meta">
            <span class="item-date">${dateStr}</span>
            ${entry.classification && entry.classification.category ? 
              `<span class="item-category">${escapeHtml(entry.classification.category)}</span>` : ''}
            ${entry.restricted && entry.reason ? 
              `<span class="item-reason-badge">${escapeHtml(entry.reason === 'restricted' ? 'Site in restricted list' : entry.reason)}</span>` : ''}
            ${entry.restricted && entry.matchedPattern ? 
              `<span class="item-pattern">Pattern: ${escapeHtml(entry.matchedPattern)}</span>` : ''}
          </div>
        </div>
        
        <!-- Classification Details Section (always show if classification exists) -->
        ${hasClassification && entry.classification ? (() => {
          const classification = entry.classification;
          const isEducational = classification.isEducational ?? classification.educational ?? null;
          const isAgeAppropriate = classification.isAgeAppropriate ?? classification.ageAppropriate ?? null;
          const suggestedUrl = classification.suggestedUrl ?? classification.suggestedEducationalResource ?? null;
          const noUrlReason = classification.noUrlReason || null;
          const modelName = classification.model || null;
          const detailsTitle = modelName 
            ? `Classification Details (${escapeHtml(modelName)})`
            : 'Classification Details';
          return `
          <div class="item-details">
            <div class="details-header">
              <span class="details-title">${detailsTitle}</span>
            </div>
            <div class="details-content">
              <div class="detail-item">
                <span class="detail-label">Educational:</span>
                <span class="detail-value ${isEducational === true ? 'detail-positive' : isEducational === false ? 'detail-negative' : ''}">
                  ${isEducational === true ? 'Yes' : isEducational === false ? 'No' : 'Unknown'}
                </span>
              </div>
              ${suggestedUrl ? `
                <div class="detail-item detail-item-full">
                  <span class="detail-label">Suggested Educational Resource:</span>
                  <a href="${escapeHtml(suggestedUrl)}" target="_blank" rel="noopener noreferrer" class="detail-link">
                    ${escapeHtml(suggestedUrl)}
                  </a>
                </div>
              ` : `
                <div class="detail-item detail-item-full">
                  <span class="detail-label">Suggested Educational Resource:</span>
                  <span class="detail-value">Not specified${noUrlReason ? ` (${escapeHtml(noUrlReason)})` : ''}</span>
                </div>
              `}
              <div class="detail-item">
                <span class="detail-label">Category:</span>
                <span class="detail-value">${escapeHtml(classification.category || 'Not specified')}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Age Appropriate:</span>
                <span class="detail-value ${isAgeAppropriate === true ? 'detail-positive' : isAgeAppropriate === false ? 'detail-negative' : ''}">
                  ${isAgeAppropriate === true ? 'Yes' : isAgeAppropriate === false ? 'No' : 'Not specified'}
                </span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Safety Level:</span>
                <span class="detail-value">${escapeHtml(classification.safetyLevel || 'Not specified')}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Reason:</span>
                <span class="detail-value">${escapeHtml(classification.reason || 'Not specified')}</span>
              </div>
            </div>
          </div>
        `;
        })() : ''}
      </div>
    `;
  }).join('');
  
  renderPagination();
}

function renderPagination(): void {
  const container = document.getElementById('pagination');
  if (!container) return;
  
  const totalPages = Math.ceil(filteredHistory.length / itemsPerPage);
  
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }
  
  const controlsDiv = document.createElement('div');
  controlsDiv.className = 'pagination-controls';
  
  if (currentPage > 1) {
    const prevBtn = document.createElement('button');
    prevBtn.className = 'btn btn-secondary';
    prevBtn.textContent = 'Previous';
    prevBtn.addEventListener('click', () => goToPage(currentPage - 1));
    controlsDiv.appendChild(prevBtn);
  }
  
  const pageInfo = document.createElement('span');
  pageInfo.className = 'page-info';
  pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
  controlsDiv.appendChild(pageInfo);
  
  if (currentPage < totalPages) {
    const nextBtn = document.createElement('button');
    nextBtn.className = 'btn btn-secondary';
    nextBtn.textContent = 'Next';
    nextBtn.addEventListener('click', () => goToPage(currentPage + 1));
    controlsDiv.appendChild(nextBtn);
  }
  
  container.innerHTML = '';
  container.appendChild(controlsDiv);
}

function goToPage(page: number): void {
  currentPage = page;
  renderHistory();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateStats(): void {
  const total = allHistory.length;
  const restricted = allHistory.filter(e => e.restricted).length;
  const educational = allHistory.filter(e => {
    const isEducational = e.classification?.isEducational ?? e.classification?.educational ?? null;
    return isEducational === true;
  }).length;
  
  const totalEl = document.getElementById('totalVisits');
  if (totalEl) totalEl.textContent = String(total);
  
  const restrictedEl = document.getElementById('restrictedAttempts');
  if (restrictedEl) restrictedEl.textContent = String(restricted);
  
  const educationalEl = document.getElementById('educationalVisits');
  if (educationalEl) educationalEl.textContent = String(educational);
}

async function exportHistory(): Promise<void> {
  const dataStr = JSON.stringify(filteredHistory, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `history-${new Date().toISOString().split('T')[0]}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function clearHistory(): Promise<void> {
  if (confirm('Clear all browsing history? This action cannot be undone.')) {
    await chrome.storage.local.set({ history: [] });
    allHistory = [];
    filteredHistory = [];
    renderHistory();
    updateStats();
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function debounce(func: () => void, wait: number): () => void {
  let timeout: number | undefined;
  return function executedFunction() {
    const later = () => {
      clearTimeout(timeout);
      func();
    };
    clearTimeout(timeout);
    timeout = window.setTimeout(later, wait);
  };
}

function showError(message: string): void {
  const container = document.getElementById('historyList');
  if (container) {
    container.innerHTML = `<div class="error">${message}</div>`;
  }
}

