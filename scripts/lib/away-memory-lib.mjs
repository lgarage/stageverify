/**
 * Shared helpers for away-list / away-status / memory validation.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "../..");

export const PATHS = {
  awayList: path.join(REPO_ROOT, "PROJECT_STATUS/away-list.json"),
  awayStatus: path.join(REPO_ROOT, "PROJECT_STATUS/away-status.json"),
  awayArchive: path.join(REPO_ROOT, "PROJECT_STATUS/archives/away-batch-3.json"),
  currentState: path.join(REPO_ROOT, "PROJECT_STATUS/CURRENT_STATE.md"),
  nextMd: path.join(REPO_ROOT, "NEXT.md"),
  memoryMd: path.join(REPO_ROOT, "PROJECT_STATUS/MEMORY.md"),
  roadmap: path.join(REPO_ROOT, "docs/roadmap.md"),
  projectState: path.join(REPO_ROOT, "docs/project_state.md"),
};

/** @param {string} filePath */
export function readText(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
}

/** @param {string} filePath */
export function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

/** @param {string} filePath @param {unknown} data */
export function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

/** @param {string} filePath @param {string} text */
export function writeText(filePath, text) {
  fs.writeFileSync(filePath, text.endsWith("\n") ? text : `${text}\n`, "utf8");
}

/** @param {{ id: string, status: string, dependsOn?: string }[]} queue @param {{ items?: { id: string, status: string }[] }} [archive] */
export function firstRunnableItem(queue, archive) {
  const byId = new Map(queue.map((item) => [item.id, item]));
  const archived = new Map((archive?.items ?? []).map((item) => [item.id, item]));

  for (const item of queue) {
    if (item.status !== "queued") continue;
    const dep = item.dependsOn;
    if (!dep) return item;
    const pred = byId.get(dep) ?? archived.get(dep);
    if (pred && pred.status === "done") return item;
  }
  return null;
}

/** @param {string} md */
export function parseLastShippedFromCurrentState(md) {
  const match = md.match(/Last shipped:\s*\*\*(away-\d+)\*\*/i);
  return match ? match[1] : null;
}

/** Roadmap rows that must not regress after batch 3 (Verifier). */
export const ROADMAP_FORBIDDEN = [
  {
    label: "vendor session not started",
    pattern: /Temporary vendor session \+ configurable expiration \+ server validation \| \*\*Phase 3 Slice 4 — Vendor access hardening\*\* \| ⬜ Not started/,
  },
  {
    label: "shop geofence not started",
    pattern: /Shop geofence as additional vendor control \| \*\*Phase 3 Slice 4 — Vendor access hardening\*\* \| ⬜ Not started/,
  },
  {
    label: "pickup token not built",
    pattern: /Opaque, unguessable, revocable, server-validated \*\*pickup token\*\* \| \*\*Phase 3 Slice 5 — Pickup link security\*\* \| ⬜ Not built/,
  },
];
