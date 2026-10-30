/**
 * Run a callback once the document is safe for DOM queries.
 * ES modules are deferred; if this runs after DOMContentLoaded, invokes immediately.
 */
export function whenDocumentReady(callback: () => void): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', callback, { once: true });
  } else {
    callback();
  }
}
