/**
 * Pattern matching utilities for URL checking
 * Shared between url-matcher and restriction-overlay
 */

/**
 * Checks if URL matches a pattern
 * Supports wildcard patterns:
 * - example.com - exact domain match
 * - *.example.com - all subdomains
 * - example.com/* - all paths on domain
 * - *example.com* - contains domain
 */
export function matchesPattern(url: string, pattern: string): boolean {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;

    // Exact match
    if (pattern === hostname || pattern === url) {
      return true;
    }

    // Pattern starts with * (subdomains)
    if (pattern.startsWith('*.')) {
      const domain = pattern.substring(2);
      if (hostname === domain || hostname.endsWith('.' + domain)) {
        return true;
      }
    }

    // Pattern ends with /* (paths)
    if (pattern.endsWith('/*')) {
      const domain = pattern.slice(0, -2);
      if (hostname === domain || hostname.endsWith('.' + domain)) {
        return true;
      }
    }

    // Pattern contains * (partial match)
    if (pattern.includes('*')) {
      const regexPattern = pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*');
      const regex = new RegExp('^' + regexPattern + '$');
      if (regex.test(hostname) || regex.test(url)) {
        return true;
      }
    }

    // Simple substring inclusion
    if (hostname.includes(pattern) || url.includes(pattern)) {
      return true;
    }

    return false;
  } catch (e) {
    // If URL is invalid, check as string
    return url.includes(pattern);
  }
}
