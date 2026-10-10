/** Pure helpers for scheduled Gmail inbound catch-up (no I/O). */

export const OVERLAP_SECONDS = 2 * 60 * 60;
export const DEFAULT_LOOKBACK_SECONDS = 7 * 24 * 60 * 60;
/** Max messages processed per catch-up sync pass (history + after: union). */
export const PROCESS_CAP = 40;
/** Max inbox/history ids listed per pass before cursor advance is blocked. */
export const LIST_CAP = 500;

export function isGmailListingComplete(options: {
  listedCount: number;
  listCap: number;
  nextPageToken?: string | null;
  emptyPage: boolean;
}): boolean {
  if (options.listedCount >= options.listCap) return false;
  if (options.emptyPage) return !options.nextPageToken;
  return !options.nextPageToken;
}

export function buildInboxCatchUpQuery(options: {
  lastSyncAt?: string;
  replyEnabled: boolean;
  nowMs: number;
}): string {
  const { lastSyncAt, replyEnabled, nowMs } = options;
  let unixSeconds: number;
  if (lastSyncAt) {
    const parsed = Date.parse(lastSyncAt);
    if (!Number.isNaN(parsed)) {
      unixSeconds = Math.floor((parsed - OVERLAP_SECONDS * 1000) / 1000);
    } else {
      unixSeconds = Math.floor((nowMs - DEFAULT_LOOKBACK_SECONDS * 1000) / 1000);
    }
  } else {
    unixSeconds = Math.floor((nowMs - DEFAULT_LOOKBACK_SECONDS * 1000) / 1000);
  }

  const inboxClause = replyEnabled
    ? "in:inbox (has:attachment filename:pdf OR -has:attachment)"
    : "has:attachment filename:pdf in:inbox";

  return `after:${unixSeconds} ${inboxClause}`;
}

/** Gmail messages.list is newest-first; catch-up should process oldest-first. */
export function oldestFirstInboxIds(newestFirstIds: string[]): string[] {
  return [...newestFirstIds].reverse();
}

export function uniquePreserveOrder(ids: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

export function applyCatchUpCap(options: {
  listedIds: string[];
  cap: number;
}): { processNow: string[]; remainderCount: number } {
  const { listedIds, cap } = options;
  const unique = uniquePreserveOrder(listedIds);
  const processNow = unique.slice(0, cap);
  const remainderCount = Math.max(0, unique.length - cap);
  return { processNow, remainderCount };
}

export function shouldAdvanceInboundSyncCursor(options: {
  listingComplete: boolean;
  remainderCount: number;
}): boolean {
  return options.listingComplete === true && options.remainderCount === 0;
}
