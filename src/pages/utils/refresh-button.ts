/**
 * Unified Refresh Button Utility
 * Provides consistent refresh button behavior with loading indication
 */

/**
 * Setup a refresh button with loading indication
 * @param buttonId - ID of the refresh button element
 * @param refreshFunction - Async function to call when refresh is clicked
 * @param options - Optional configuration
 */
export async function setupRefreshButton(
  buttonId: string,
  refreshFunction: () => Promise<void>,
  options: {
    loadingText?: string;
    successText?: string;
    successDuration?: number;
  } = {}
): Promise<void> {
  const button = document.getElementById(buttonId) as HTMLButtonElement;
  if (!button) {
    console.warn(`Refresh button with ID "${buttonId}" not found`);
    return;
  }

  const {
    loadingText = 'Refreshing...',
    successText = 'Refreshed',
    successDuration = 1500
  } = options;

  // Store original text
  const originalText = button.textContent || 'Refresh';
  let isLoading = false;

  button.addEventListener('click', async () => {
    // Prevent multiple simultaneous refreshes
    if (isLoading) return;
    
    isLoading = true;
    
    // Set loading state
    button.disabled = true;
    button.classList.add('refresh-loading');
    button.innerHTML = `
      <span class="refresh-spinner"></span>
      <span class="refresh-text">${loadingText}</span>
    `;

    try {
      // Execute refresh function
      await refreshFunction();

      // Show success state
      button.classList.remove('refresh-loading');
      button.classList.add('refresh-success');
      button.innerHTML = `
        <span class="refresh-checkmark">✓</span>
        <span class="refresh-text">${successText}</span>
      `;

      // Reset to normal state after success duration
      setTimeout(() => {
        button.classList.remove('refresh-success');
        button.disabled = false;
        button.textContent = originalText;
        isLoading = false;
      }, successDuration);
    } catch (error) {
      // Show error state
      button.classList.remove('refresh-loading');
      button.classList.add('refresh-error');
      button.innerHTML = `
        <span class="refresh-error-icon">✗</span>
        <span class="refresh-text">Error</span>
      `;

      // Reset to normal state after error
      setTimeout(() => {
        button.classList.remove('refresh-error');
        button.disabled = false;
        button.textContent = originalText;
        isLoading = false;
      }, successDuration);
      
      console.error('Refresh error:', error);
    }
  });
}
