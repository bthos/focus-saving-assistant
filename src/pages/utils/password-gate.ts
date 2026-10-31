/**
 * Password gate utilities for settings pages
 */

import { STORAGE_KEYS } from '../../utils/constants.js';
import type { Settings } from '../../types/index.js';

const DEFAULT_PASSWORD_HINT = 'Enter word "friend"';

/** Same storage read as history/cache — avoids any merge path differing from the gate password. */
export async function getSettingsForPasswordCheck(): Promise<{ password: string; hint: string }> {
  const result = await chrome.storage.local.get([STORAGE_KEYS.SETTINGS]);
  const raw = result[STORAGE_KEYS.SETTINGS] as Settings | undefined;
  const password = coercePasswordString(raw?.parentPassword);
  const hint =
    typeof raw?.passwordHint === 'string' && raw.passwordHint.trim() !== ''
      ? raw.passwordHint.trim()
      : DEFAULT_PASSWORD_HINT;

  return { password, hint };
}

function coercePasswordString(value: unknown): string {
  if (value == null) return '';
  return String(value)
    .replace(/\u00a0/g, ' ')
    .trim();
}

/** Compare stored vs typed password consistently (NBSP, unicode norm, locale-insensitive case). */
function normalizePasswordForCompare(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .trim()
    .normalize('NFC')
    .toLocaleLowerCase('en-US');
}

function safeNormalizePasswordForCompare(value: string): string {
  try {
    return normalizePasswordForCompare(value);
  } catch {
    return value
      .replace(/\u00a0/g, ' ')
      .trim()
      .toLowerCase();
  }
}

/** Abort listeners from a previous gate setup (e.g. if init runs twice). */
let gateInteractionAbort: AbortController | undefined;

/**
 * Check if user is authenticated in this session
 */
export function isAuthenticated(): boolean {
  return sessionStorage.getItem('settingsAuthenticated') === 'true';
}

/**
 * Set authentication status
 */
export function setAuthenticated(value: boolean): void {
  if (value) {
    sessionStorage.setItem('settingsAuthenticated', 'true');
  } else {
    sessionStorage.removeItem('settingsAuthenticated');
  }
}

/**
 * Show password gate UI
 */
export function showPasswordGate(
  correctPassword: string,
  hint: string,
  onSuccess: () => void | Promise<void>
): void {
  // Safety check: if password is empty, don't show gate
  if (!coercePasswordString(correctPassword)) {
    showMainContent();
    void Promise.resolve(onSuccess()).catch((err) => {
      console.error('Password gate: post-auth callback failed', err);
    });
    return;
  }
  
  const gateEl = document.getElementById('passwordGate');
  const mainEl = document.getElementById('mainContent');

  const passwordInput = document.getElementById('passwordInput') as HTMLInputElement;
  const enterBtn = document.getElementById('enterBtn');
  const gateForm = document.getElementById('passwordGateForm') as HTMLFormElement | null;

  if (!passwordInput || !enterBtn || !gateForm) {
    console.error('Password gate: Required elements not found');
    // Fallback: show main content if elements are missing
    showMainContent();
    void Promise.resolve(onSuccess()).catch((err) => {
      console.error('Password gate: post-auth callback failed', err);
    });
    return;
  }

  if (gateEl) {
    gateEl.style.display = 'flex';
  }
  if (mainEl) {
    mainEl.classList.remove('visible');
  }

  const showHintBtn = document.getElementById('showHintBtn');
  const hintTextEl = document.getElementById('hintText');
  const closeHintBtn = document.getElementById('closeHintBtn');
  const hintContainer = document.getElementById('hintContainer');

  gateInteractionAbort?.abort();
  gateInteractionAbort = new AbortController();
  const { signal } = gateInteractionAbort;

  // Set hint text
  if (hintTextEl) {
    hintTextEl.textContent = hint;
  }

  // Show hint handler
  if (showHintBtn && hintContainer) {
    showHintBtn.addEventListener(
      'click',
      () => {
        hintContainer.classList.add('expanded');
      },
      { signal }
    );
  }

  // Close hint handler
  if (closeHintBtn && hintContainer) {
    closeHintBtn.addEventListener(
      'click',
      () => {
        hintContainer.classList.remove('expanded');
      },
      { signal }
    );
  }

  const checkPassword = () => {
    const errorEl = document.getElementById('passwordError');
    const enteredNorm = safeNormalizePasswordForCompare(passwordInput.value);
    const storedNorm = safeNormalizePasswordForCompare(coercePasswordString(correctPassword));

    if (enteredNorm === storedNorm && enteredNorm.length > 0) {
      // Correct password
      gateInteractionAbort?.abort();
      gateInteractionAbort = undefined;
      setAuthenticated(true);
      if (gateEl) gateEl.style.display = 'none';
      if (mainEl) {
        mainEl.classList.add('visible');
      }
      if (errorEl) errorEl.textContent = '';
      passwordInput.value = '';
      void Promise.resolve(onSuccess()).catch((err) => {
        console.error('Password gate: post-auth callback failed', err);
      });
    } else {
      // Wrong password
      if (errorEl) {
        errorEl.textContent = 'The way is shut. It was made by those who are Dead, and the Dead keep it.';
        errorEl.style.animation = 'none';
        setTimeout(() => {
          errorEl.style.animation = 'shake 0.5s ease-in-out';
        }, 10);
      }
      passwordInput.value = '';
      passwordInput.focus();
    }
  };

  gateForm.addEventListener(
    'submit',
    (ev) => {
      ev.preventDefault();
      checkPassword();
    },
    { signal }
  );
  enterBtn.addEventListener(
    'click',
    (e) => {
      e.preventDefault();
      checkPassword();
    },
    { signal }
  );
  passwordInput.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        checkPassword();
      }
    },
    { signal }
  );

  // Focus on input
  setTimeout(() => {
    passwordInput.focus();
  }, 100);
}

/**
 * Show main content
 */
export function showMainContent(): void {
  const gateEl = document.getElementById('passwordGate');
  const mainEl = document.getElementById('mainContent');

  if (gateEl) gateEl.style.display = 'none';
  if (mainEl) {
    mainEl.classList.add('visible');
  }
}

/**
 * Initialize password gate check
 */
export async function initPasswordGate(
  onAuthenticated: () => void | Promise<void>
): Promise<void> {
  if (isAuthenticated()) {
    showMainContent();
    try {
      await Promise.resolve(onAuthenticated());
    } catch (err) {
      console.error('Password gate: init callback failed', err);
      throw err;
    }
    return;
  }

  const { password, hint } = await getSettingsForPasswordCheck();

  if (!password) {
    showMainContent();
    try {
      await Promise.resolve(onAuthenticated());
    } catch (err) {
      console.error('Password gate: init callback failed', err);
      throw err;
    }
    return;
  }

  showPasswordGate(password, hint, onAuthenticated);
}
