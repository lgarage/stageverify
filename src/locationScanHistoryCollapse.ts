/**
 * Collapse leftover `#/receive` recovery out from under a location-scan QR.
 * Camera / full navigation would otherwise leave recovery in Safari history.
 *
 * Location-scan sets a target and goes back. The leftover entry (boot or popstate)
 * replaces itself with the scan URL so the recovery screen is not a Back stop.
 */
import {
  canonicalLocationScanHash,
  isLeftoverReceiveHash,
} from "./locationScanHistory";

const LEFTOVER_FLAG = "sv-leftover-receive-entry";
const COLLAPSING_KEY = "sv-collapsing-leftover-receive";
const COLLAPSE_TARGET_KEY = "sv-leftover-collapse-target";
const COLLAPSE_AT_KEY = "sv-leftover-collapse-at";
const COLLAPSE_TTL_MS = 5_000;

function hashChangeEvent(): Event {
  return typeof HashChangeEvent === "function"
    ? new HashChangeEvent("hashchange")
    : new Event("hashchange");
}

function storageGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

function storageRemove(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function isCollapsingLeftoverReceive(): boolean {
  return storageGet(COLLAPSING_KEY) === "1";
}

export function markLeftoverReceiveHistoryEntry(): void {
  if (typeof window === "undefined") return;
  if (isCollapsingLeftoverReceive()) return;
  if (storageGet(COLLAPSE_TARGET_KEY)) return;
  storageSet(LEFTOVER_FLAG, "1");
}

export function clearLeftoverReceiveHistoryFlag(): void {
  storageRemove(LEFTOVER_FLAG);
}

function consumeLeftoverReceiveHistoryFlag(): boolean {
  const marked = storageGet(LEFTOVER_FLAG) === "1";
  storageRemove(LEFTOVER_FLAG);
  return marked;
}

function currentAppUrl(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function clearCollapseKeys(): void {
  storageRemove(COLLAPSE_TARGET_KEY);
  storageRemove(COLLAPSE_AT_KEY);
  storageRemove(COLLAPSING_KEY);
  storageRemove(LEFTOVER_FLAG);
}

/** Leftover entry replaces itself with the pending location-scan URL. */
export function applyPendingLeftoverReceiveCollapse(): boolean {
  if (typeof window === "undefined") return false;
  const target = storageGet(COLLAPSE_TARGET_KEY);
  if (!target) return false;
  const startedAt = Number(storageGet(COLLAPSE_AT_KEY) ?? "0");
  if (!Number.isFinite(startedAt) || Date.now() - startedAt > COLLAPSE_TTL_MS) {
    clearCollapseKeys();
    return false;
  }
  if (!isLeftoverReceiveHash(window.location.hash)) {
    clearCollapseKeys();
    return false;
  }
  clearCollapseKeys();
  window.history.replaceState(window.history.state, "", target);
  window.dispatchEvent(hashChangeEvent());
  return true;
}

/**
 * If leftover recovery sits under this `#/s?loc=` entry, go back so that
 * entry can replace itself with the scan URL (same-document or full load).
 */
export function requestLeftoverReceiveCollapse(): boolean {
  if (typeof window === "undefined") return false;
  if (isCollapsingLeftoverReceive() || storageGet(COLLAPSE_TARGET_KEY)) {
    return false;
  }
  if (!canonicalLocationScanHash(window.location.hash)) return false;
  if (!consumeLeftoverReceiveHistoryFlag()) return false;

  storageSet(COLLAPSE_TARGET_KEY, currentAppUrl());
  storageSet(COLLAPSE_AT_KEY, String(Date.now()));
  storageSet(COLLAPSING_KEY, "1");
  window.history.go(-1);
  return true;
}
