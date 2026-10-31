import { escapeHtml } from './form-helpers.js';

/**
 * Replace #mainContent with a simple error panel (password gate hidden).
 * Used when a gated extension page fails during init.
 */
export function showPageLoadErrorInMain(title: string, error: unknown): void {
  const passwordGate = document.getElementById('passwordGate');
  if (passwordGate) {
    passwordGate.style.display = 'none';
  }

  const mainContent = document.getElementById('mainContent');
  const message = escapeHtml(error instanceof Error ? error.message : String(error));
  const stackHtml =
    error instanceof Error && error.stack
      ? `<pre style="color: #666; font-size: 0.9em; overflow: auto;">${escapeHtml(error.stack)}</pre>`
      : '';

  if (mainContent) {
    mainContent.innerHTML = `
        <div class="container" style="padding: 2rem;">
          <h1>${escapeHtml(title)}</h1>
          <p>There was an error loading the page. Please check the browser console for details.</p>
          <p style="color: red; font-family: monospace; white-space: pre-wrap;">${message}</p>
          ${stackHtml}
          <button type="button" onclick="window.location.reload()" class="btn btn-primary" style="margin-top: 1rem;">Reload Page</button>
        </div>
      `;
    mainContent.classList.add('visible');
  } else {
    document.body.innerHTML = `
        <div style="padding: 2rem; font-family: sans-serif;">
          <h1>${escapeHtml(title)}</h1>
          <p>Critical error: Could not find main content element.</p>
          <p style="color: red;">${message}</p>
          <button type="button" onclick="window.location.reload()">Reload Page</button>
        </div>
      `;
  }
}
