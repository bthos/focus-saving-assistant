/**
 * Classification Cache page logic
 */

import { initPasswordGate } from './utils/password-gate.js';
import { whenDocumentReady } from './utils/document-ready.js';
import { setupRefreshButton } from './utils/refresh-button.js';
import type { ClassificationResult } from '../types/index.js';
import {
  PROBABILITY_TITLE,
  SYNTHESIZED_REASON_NOTE,
  describeDecisionModel,
  describeExplanationModel,
  describeMissingSuggestion,
  formatProbabilityAnswer,
  isSynthesizedReason,
} from '../core/classification-details.ts';

interface CacheEntry {
  domain: string;
  classification: ClassificationResult;
  isValid: boolean;
  ageHours: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

let allCache: CacheEntry[] = [];
let filteredCache: CacheEntry[] = [];
let currentPage = 1;
const itemsPerPage = 50;

whenDocumentReady(() => {
  void initPasswordGate(async () => {
    await loadCache();
    await setupEventListeners();
  }).catch((err) => console.error('Cache page init failed', err));
});

async function loadCache(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(['classificationCache']);
    const cacheData = (result.classificationCache as { [domain: string]: any }) || {};
    
    // Convert cache object to array of entries
    allCache = Object.entries(cacheData).map(([domain, classification]) => {
      const cachedAt = classification.cachedAt || 0;
      const cacheAge = Date.now() - cachedAt;
      const isValid = cacheAge < CACHE_TTL_MS;
      const ageHours = Math.floor(cacheAge / (60 * 60 * 1000));
      
      return {
        domain,
        classification: {
          ...classification,
          cachedAt
        },
        isValid,
        ageHours
      };
    });
    
    // Sort by cachedAt (most recent first)
    allCache.sort((a, b) => {
      const aTime = a.classification.cachedAt || 0;
      const bTime = b.classification.cachedAt || 0;
      return bTime - aTime;
    });
    
    filteredCache = [...allCache];
    renderCache();
    updateStats();
  } catch (error) {
    console.error('Error loading cache:', error);
    showError('Error loading cache');
  }
}

async function setupEventListeners(): Promise<void> {
  await setupRefreshButton('refreshBtn', loadCache, {
    loadingText: 'Refreshing...',
    successText: 'Refreshed',
    successDuration: 1500
  });
  
  const exportBtn = document.getElementById('exportBtn');
  if (exportBtn) exportBtn.addEventListener('click', exportCache);
  
  const clearBtn = document.getElementById('clearBtn');
  if (clearBtn) clearBtn.addEventListener('click', clearCache);
  
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
  
  const searchTerm = searchInput?.value.toLowerCase() || '';
  const filterType = filterTypeEl?.value || 'all';
  
  filteredCache = allCache.filter(entry => {
    // Search
    if (searchTerm) {
      const matchesSearch = entry.domain.toLowerCase().includes(searchTerm);
      if (!matchesSearch) return false;
    }
    
    // Filter by type
    const isEducational = entry.classification.isEducational ?? entry.classification.educational ?? null;
    if (filterType === 'educational' && isEducational !== true) return false;
    if (filterType === 'non-educational' && isEducational !== false) return false;
    if (filterType === 'expired' && entry.isValid) return false;
    if (filterType === 'valid' && !entry.isValid) return false;
    
    return true;
  });
  
  currentPage = 1;
  renderCache();
}

function resetFilters(): void {
  const searchInput = document.getElementById('searchInput') as HTMLInputElement;
  const filterTypeEl = document.getElementById('filterType') as HTMLSelectElement;
  
  if (searchInput) searchInput.value = '';
  if (filterTypeEl) filterTypeEl.value = 'all';
  
  filteredCache = [...allCache];
  currentPage = 1;
  renderCache();
}

function renderCache(): void {
  const container = document.getElementById('cacheList');
  if (!container) return;
  
  if (filteredCache.length === 0) {
    container.innerHTML = '<div class="empty">Cache is empty</div>';
    renderPagination();
    return;
  }
  
  const start = (currentPage - 1) * itemsPerPage;
  const end = start + itemsPerPage;
  const pageItems = filteredCache.slice(start, end);
  
  container.innerHTML = pageItems.map(entry => {
    const cachedAt = entry.classification.cachedAt || 0;
    const date = new Date(cachedAt);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    
    const isEducational = entry.classification.isEducational ?? entry.classification.educational ?? null;
    const classificationBadge = isEducational !== null ? 
      `<span class="badge ${isEducational ? 'badge-success' : 'badge-warning'}">
        ${isEducational ? 'Educational' : 'Non-Educational'}
      </span>` : '';
    
    const validityBadge = entry.isValid ? 
      '<span class="badge badge-success">Valid</span>' : 
      '<span class="badge badge-danger">Expired</span>';
    
    const ageText = entry.ageHours < 1 ? 
      'Less than 1 hour' : 
      entry.ageHours === 1 ? 
        '1 hour' : 
        `${entry.ageHours} hours`;
    
    const hasClassification = entry.classification !== null && entry.classification !== undefined;

    return `
      <div class="history-item ${!entry.isValid ? 'expired' : ''}">
        <!-- Main Information Section -->
        <div class="item-main">
          <div class="item-header">
            <div class="item-title">${escapeHtml(entry.domain)}</div>
            <div class="item-badges">
              ${validityBadge}
              ${classificationBadge}
            </div>
          </div>
          <div class="item-meta">
            <span class="item-date">Cached: ${dateStr}</span>
            <span class="item-date">Age: ${ageText}</span>
            ${entry.classification.category ? 
              `<span class="item-category">${escapeHtml(entry.classification.category)}</span>` : ''}
            ${entry.classification.source === 'decision' ?
              `<span class="item-category">Decision model: ${escapeHtml(describeDecisionModel(entry.classification) ?? '')}</span>` :
              entry.classification.model ?
              `<span class="item-category">Model: ${escapeHtml(entry.classification.model)}</span>` : ''}
          </div>
        </div>
        
        <!-- Classification Details Section -->
        ${hasClassification && entry.classification ? (() => {
          const classification = entry.classification;
          const isDecision = classification.source === 'decision';
          const probabilities = isDecision ? classification.decision?.probabilities : undefined;
          const isEducational = classification.isEducational ?? classification.educational ?? null;
          const isAgeAppropriate = classification.isAgeAppropriate ?? classification.ageAppropriate ?? null;
          const educationalProbability = formatProbabilityAnswer(probabilities?.isEducational, classification.decision?.model);
          const ageProbability = formatProbabilityAnswer(probabilities?.isAgeAppropriate, classification.decision?.model);
          const suggestedUrl = classification.suggestedUrl ?? classification.suggestedEducationalResource ?? null;
          const decisionModel = describeDecisionModel(classification);
          const explanationModel = describeExplanationModel(classification, Date.now());
          const modelName = classification.model || null;
          const detailsTitle = modelName && !isDecision
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
                <span class="detail-value ${isEducational === true ? 'detail-positive' : isEducational === false ? 'detail-negative' : ''}"${educationalProbability ? ` title="${PROBABILITY_TITLE}"` : ''}>
                  ${educationalProbability ?? (isEducational === true ? 'Yes' : isEducational === false ? 'No' : 'Unknown')}
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
                  <span class="detail-value">${escapeHtml(describeMissingSuggestion(classification, Date.now()))}</span>
                </div>
              `}
              <div class="detail-item">
                <span class="detail-label">Category:</span>
                <span class="detail-value">${escapeHtml(classification.category || 'Not specified')}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Age Appropriate:</span>
                <span class="detail-value ${isAgeAppropriate === true ? 'detail-positive' : isAgeAppropriate === false ? 'detail-negative' : ''}"${ageProbability ? ` title="${PROBABILITY_TITLE}"` : ''}>
                  ${ageProbability ?? (isAgeAppropriate === true ? 'Yes' : isAgeAppropriate === false ? 'No' : 'Not specified')}
                </span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Safety Level:</span>
                <span class="detail-value">${escapeHtml(classification.safetyLevel || 'Not specified')}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Reason:</span>
                <span class="detail-value">${escapeHtml(classification.reason || 'Not specified')}${isSynthesizedReason(classification) ? `<span class="detail-note">${SYNTHESIZED_REASON_NOTE}</span>` : ''}</span>
              </div>
              ${decisionModel ? `
              <div class="detail-item">
                <span class="detail-label">Decision model:</span>
                <span class="detail-value">${escapeHtml(decisionModel)}</span>
              </div>
              ` : ''}
              ${explanationModel ? `
              <div class="detail-item">
                <span class="detail-label">Explanation model:</span>
                <span class="detail-value ${explanationModel.failed ? 'detail-negative' : ''}">${escapeHtml(explanationModel.text)}</span>
              </div>
              ` : ''}
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
  
  const totalPages = Math.ceil(filteredCache.length / itemsPerPage);
  
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
  renderCache();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateStats(): void {
  const total = allCache.length;
  const valid = allCache.filter(e => e.isValid).length;
  const expired = allCache.filter(e => !e.isValid).length;
  const educational = allCache.filter(e => {
    const isEducational = e.classification.isEducational ?? e.classification.educational ?? null;
    return isEducational === true;
  }).length;
  
  const totalEl = document.getElementById('totalEntries');
  if (totalEl) totalEl.textContent = String(total);
  
  const validEl = document.getElementById('validEntries');
  if (validEl) validEl.textContent = String(valid);
  
  const expiredEl = document.getElementById('expiredEntries');
  if (expiredEl) expiredEl.textContent = String(expired);
  
  const educationalEl = document.getElementById('educationalEntries');
  if (educationalEl) educationalEl.textContent = String(educational);
}

async function exportCache(): Promise<void> {
  const dataStr = JSON.stringify(filteredCache, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `classification-cache-${new Date().toISOString().split('T')[0]}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function clearCache(): Promise<void> {
  if (confirm('Clear all classification cache? This action cannot be undone.')) {
    await chrome.storage.local.set({ classificationCache: {} });
    allCache = [];
    filteredCache = [];
    renderCache();
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
  const container = document.getElementById('cacheList');
  if (container) {
    container.innerHTML = `<div class="error">${message}</div>`;
  }
}

