/**
 * Local wall-clock helpers (pure). Local calendar fields only, never UTC or 24 h arithmetic,
 * so DST days follow what the clock on the wall shows.
 */

/** Local calendar date of the instant as `YYYY-MM-DD`. */
export function formatLocalDate(ts: number): string {
  const d = new Date(ts);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}
