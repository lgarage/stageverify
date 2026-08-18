/**
 * Collapse leftover `#/receive` recovery out from under a location-scan QR.
 * Camera / hash assignment would otherwise leave recovery in Safari history.
 */
import { canonicalLocationScanHash } from "./locationScanHistory";

const LEFTOVER_FLAG = "sv-leftover-receive-entry";
const COLLAPSING_KEY = "sv-collapsing-leftover-receive";

function hashChangeEvent(): Event {
  return typeof HashChangeEvent === "function"
    ? new HashChangeEvent("hashchange")
    : new Event("hashchange");
}

export function isCollapsingLeftoverReceive(): boolean {
  try {
    return sessionStorage.getItem(COLLAPSING_KEY) === "1";
  } catch {
    return false;
  }
}

export function markLeftoverReceiveHistoryEntry(): void {
  if (typeof window === "undefined") return;
  if (isCollapsingLeftoverReceive()) return;
  try {
    sessionStorage.setItem(LEFTOVER_FLAG, "1");
  } catch {
    /* private mode */
  }
}

export function clearLeftoverReceiveHistoryFlag(): void {
  try {
    sessionStorage.removeItem(LEFTOVER_FLAG);
  } catch {
    /* ignore */
  }
}

function consumeLeftoverReceiveHistoryFlag(): boolean {
  try {
    const marked = sessionStorage.getItem(LEFTOVER_FLAG) === "1";
    sessionStorage.removeItem(LEFTOVER_FLAG);
    return marked;
  } catch {
    return false;
  }
}

function currentAppUrl(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function finishCollapse(scanUrl: string, onDone?: () => void): void {
  window.history.replaceState(window.history.state, "", scanUrl);
  try {
    sessionStorage.removeItem(COLLAPSING_KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(hashChangeEvent());
  onDone?.();
}

/** Drop leftover recovery sitting under the current `#/s?loc=` entry. */
export function collapseLeftoverReceiveUnderLocationScan(
  onDone?: () => void,
): boolean {
  if (typeof window === "undefined") return false;
  if (isCollapsingLeftoverReceive()) return false;
  if (!canonicalLocationScanHash(window.location.hash)) return false;
  if (!consumeLeftoverReceiveHistoryFlag()) return false;

  const scanUrl = currentAppUrl();
  try {
    sessionStorage.setItem(COLLAPSING_KEY, "1");
  } catch {
    /* ignore */
  }

  const onPop = () => {
    window.removeEventListener("popstate", onPop);
    window.clearTimeout(fallback);
    finishCollapse(scanUrl, onDone);
  };
  window.addEventListener("popstate", onPop);
  const fallback = window.setTimeout(() => {
    window.removeEventListener("popstate", onPop);
    finishCollapse(scanUrl, onDone);
  }, 150);
  window.history.go(-1);
  return true;
}

