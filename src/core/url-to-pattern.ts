/**
 * Converts URL or pattern string to a restriction pattern format
 */

/**
 * Converts a URL or pattern string to a restriction pattern.
 * - If input looks like a pattern (contains *, no ://) - return as-is (trimmed)
 * - Otherwise try to parse as URL: extract hostname, return *.hostname for subdomain coverage
 */
export function urlToPattern(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;

  // Already looks like a pattern (contains wildcard, no protocol)
  if (trimmed.includes('*') && !trimmed.includes('://')) {
    return trimmed;
  }

  try {
    // If no protocol, add https for parsing
    const urlStr = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
    const url = new URL(urlStr);
    const hostname = url.hostname;

    if (!hostname) return trimmed;

    // Remove leading www. for cleaner pattern
    const domain = hostname.replace(/^www\./i, '');
    if (!domain) return hostname;

    // Return *.domain for subdomain coverage (e.g. www.youtube.com -> *.youtube.com)
    return `*.${domain}`;
  } catch {
    // Invalid URL - return sanitized input (remove protocol if present)
    const withoutProtocol = trimmed.replace(/^https?:\/\//i, '').split('/')[0];
    return withoutProtocol || trimmed;
  }
}
