/**
 * Pure history merge logic (no storage access).
 */

import type { ClassificationResult, HistoryEntry, VisitInfo } from '../types/index.ts';

/** Entry as passed to addHistoryEntry: id is assigned here, timestamp defaults to "now". */
export type NewHistoryEntry = Omit<HistoryEntry, 'id' | 'timestamp'> & { timestamp?: number };

/**
 * Combine two visit lists: sorted by visitTime, duplicates (same visitTime) removed.
 */
export function mergeVisits(existingVisits: VisitInfo[], incomingVisits: VisitInfo[]): VisitInfo[] {
  // Combine visits and sort by time
  const combinedVisits = [...existingVisits, ...incomingVisits];
  combinedVisits.sort((a, b) => a.visitTime - b.visitTime);

  // Remove duplicates based on visitTime
  const uniqueVisits: VisitInfo[] = [];
  const seenTimes = new Set<number>();
  for (const visit of combinedVisits) {
    if (!seenTimes.has(visit.visitTime)) {
      seenTimes.add(visit.visitTime);
      uniqueVisits.push(visit);
    }
  }
  return uniqueVisits;
}

/**
 * Merge synced history entries with existing history
 * Prevents duplicates and maintains chronological order
 */
export function mergeHistoryEntries(
  existingEntries: HistoryEntry[],
  newEntries: HistoryEntry[]
): HistoryEntry[] {
  const urlMap = new Map<string, HistoryEntry>();

  // Add existing entries to map
  for (const entry of existingEntries) {
    urlMap.set(entry.url, entry);
  }

  // Merge new entries
  for (const newEntry of newEntries) {
    const existing = urlMap.get(newEntry.url);

    if (existing) {
      // Merge visits if they exist
      if (newEntry.visits && existing.visits) {
        const uniqueVisits = mergeVisits(existing.visits, newEntry.visits);
        existing.visits = uniqueVisits;
        existing.visitCount = uniqueVisits.length;
      }

      // Update timestamp if new entry is more recent
      if (newEntry.timestamp > existing.timestamp) {
        existing.timestamp = newEntry.timestamp;
        existing.title = newEntry.title; // Update title if changed
      }
    } else {
      // New entry, add it
      urlMap.set(newEntry.url, newEntry);
    }
  }

  // Convert back to array and sort by timestamp (most recent first)
  const merged = Array.from(urlMap.values());
  merged.sort((a, b) => b.timestamp - a.timestamp);

  return merged;
}

/**
 * Record one navigation in the history list (newest first).
 * Same URL as an existing entry: merge into it and move it to the top; otherwise prepend a new entry.
 * `now` is the fallback timestamp, `newId` the id for a new entry (both supplied by the caller so this stays pure).
 * Does not apply the history size cap.
 */
export function upsertHistoryEntry(
  history: HistoryEntry[],
  entry: NewHistoryEntry,
  now: number,
  newId: number
): { history: HistoryEntry[]; entry: HistoryEntry } {
  const timestamp = entry.timestamp || now;

  // Check if entry with same URL already exists
  const existingIndex = history.findIndex(e => e.url === entry.url);

  if (existingIndex >= 0) {
    // Merge with existing entry
    const existing: HistoryEntry = { ...history[existingIndex] };

    // Merge visits if provided
    if (entry.visits && entry.visits.length > 0) {
      const uniqueVisits = mergeVisits(existing.visits || [], entry.visits);
      existing.visits = uniqueVisits;
      existing.visitCount = uniqueVisits.length;
    }

    // Update timestamp if new entry is more recent
    if (timestamp > existing.timestamp) {
      existing.timestamp = timestamp;
      existing.title = entry.title; // Update title if changed
    }

    // Update other fields if provided
    // Don't overwrite restricted=true with false - once restricted, always restricted
    if (entry.restricted !== undefined && !existing.restricted) {
      existing.restricted = entry.restricted;
    }
    if (entry.reason !== undefined) existing.reason = entry.reason;
    if (entry.matchedPattern !== undefined) existing.matchedPattern = entry.matchedPattern;
    if (entry.classification !== undefined) existing.classification = entry.classification;
    if (entry.incognito !== undefined) existing.incognito = entry.incognito;

    // Move to top (most recent)
    const rest = [...history.slice(0, existingIndex), ...history.slice(existingIndex + 1)];
    return { history: [existing, ...rest], entry: existing };
  }

  // New entry
  const newEntry: HistoryEntry = {
    ...entry,
    id: newId,
    timestamp: timestamp
  };
  return { history: [newEntry, ...history], entry: newEntry };
}

export function patchHistoryClassification(history: HistoryEntry[], url: string, classification: ClassificationResult): HistoryEntry[] {
  const i = history.findIndex((e) => e.url === url);
  if (i < 0) return history;
  const copy = history.slice();
  copy[i] = { ...history[i], classification };
  return copy;
}
