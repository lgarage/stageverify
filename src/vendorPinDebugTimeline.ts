/** In-memory vendor PIN → job-list diagnostic timeline (gated by ?svdebug=1). */

export interface VendorPinDebugEvent {
  t: string;
  elapsedMs: number;
  stage: string;
  message?: string;
}

const MAX_EVENTS = 40;
const listeners = new Set<() => void>();

let debugActive = false;
let pageOpenMs: number | null = null;
let pinSubmitMs: number | null = null;
let heartbeatId: ReturnType<typeof setInterval> | null = null;
const events: VendorPinDebugEvent[] = [];

function sanitizeMessage(message: string): string {
  return message
    .replace(/\b\d{4,6}\b/g, "[pin]")
    .replace(/Bearer\s+\S+/gi, "[auth]")
    .replace(/sessionToken["':\s]+\S+/gi, "sessionToken:[redacted]")
    .slice(0, 120);
}

function elapsedAt(nowMs: number): number {
  const origin = pinSubmitMs ?? pageOpenMs ?? nowMs;
  return nowMs - origin;
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function pushEvent(stage: string, message?: string): void {
  const nowMs = Date.now();
  const event: VendorPinDebugEvent = {
    t: new Date(nowMs).toISOString(),
    elapsedMs: elapsedAt(nowMs),
    stage,
    ...(message ? { message: sanitizeMessage(message) } : {}),
  };
  events.push(event);
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }
  notify();
}

/** True when svdebug is present and not explicitly `0` (search or hash). */
export function isVendorPinDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;

  const search = new URLSearchParams(window.location.search);
  if (search.has("svdebug")) {
    return search.get("svdebug") !== "0";
  }

  const hash = window.location.hash;
  const queryStart = hash.indexOf("?");
  if (queryStart >= 0) {
    const hashParams = new URLSearchParams(hash.slice(queryStart + 1));
    if (hashParams.has("svdebug")) {
      return hashParams.get("svdebug") !== "0";
    }
  }

  return false;
}

export function initVendorPinDebug(): void {
  if (debugActive) return;
  if (!isVendorPinDebugEnabled()) return;
  debugActive = true;
  pageOpenMs = Date.now();
  pushEvent("PAGE_OPEN");

  if (heartbeatId === null) {
    heartbeatId = setInterval(() => {
      notify();
    }, 1000);
  }
}

export function markVendorPinDebug(stage: string, message?: string): void {
  if (!debugActive) {
    if (!isVendorPinDebugEnabled()) return;
    initVendorPinDebug();
  }

  if (stage === "PIN_SUBMIT") {
    pinSubmitMs = Date.now();
    events.length = 0;
    pushEvent(stage, message);
    return;
  }

  pushEvent(stage, message);
}

export function subscribeVendorPinDebug(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getVendorPinDebugEvents(): readonly VendorPinDebugEvent[] {
  return events;
}

export function getVendorPinDebugElapsedMs(): number {
  return elapsedAt(Date.now());
}

export function getVendorPinDebugLastStage(): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const stage = events[i]?.stage;
    if (stage && !stage.startsWith("UI_SCREEN:")) {
      return stage;
    }
  }
  return events.length > 0 ? (events[events.length - 1]?.stage ?? "—") : "—";
}

export function getVendorPinDebugOriginLabel(): "PIN_SUBMIT" | "PAGE_OPEN" {
  return pinSubmitMs !== null ? "PIN_SUBMIT" : "PAGE_OPEN";
}

export function getBundleScriptName(): string {
  if (typeof document === "undefined") return "unknown";
  const hashed = document.querySelector(
    'script[src*="assets/index-"]',
  ) as HTMLScriptElement | null;
  if (hashed?.src) {
    const parts = hashed.src.split("/");
    return parts[parts.length - 1] ?? "unknown";
  }
  const moduleScript = document.querySelector(
    'script[type="module"]',
  ) as HTMLScriptElement | null;
  if (moduleScript?.src) {
    const parts = moduleScript.src.split("/");
    return parts[parts.length - 1] ?? "unknown";
  }
  return "unknown";
}
