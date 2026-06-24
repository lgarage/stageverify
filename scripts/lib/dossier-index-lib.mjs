/**
 * Shared dossier index load, slice, and validation helpers.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT, readJson, readText } from "./away-memory-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DOSSIER_INDEX_PATH = path.join(REPO_ROOT, "PROJECT_STATUS/dossier-index.json");
export const CONTEXT_INDEX_PATH = path.join(REPO_ROOT, "PROJECT_STATUS/context-index.json");

/** @returns {{ version: number, entries: import('./dossier-index-lib.mjs').DossierEntry[] }} */
export function loadDossierIndex() {
  return readJson(DOSSIER_INDEX_PATH);
}

/** @returns {{ version: number, sections?: DossierEntry[], concerns: object[] }} */
export function loadContextIndex() {
  return readJson(CONTEXT_INDEX_PATH);
}

/**
 * @typedef {{ id: string, tags: string[], title: string, file: string, startLine: number, endLine: number, anchor?: string, section?: string }} DossierEntry
 */

/** @param {{ entries: DossierEntry[] }} index */
export function allTags(index) {
  /** @type {Map<string, DossierEntry>} */
  const byTag = new Map();
  for (const entry of index.entries) {
    for (const tag of entry.tags ?? []) {
      if (!byTag.has(tag)) byTag.set(tag, entry);
    }
  }
  return byTag;
}

/** @param {DossierEntry} entry */
export function sliceEntry(entry) {
  const filePath = path.join(REPO_ROOT, entry.file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${entry.file}`);
  }
  const lines = readText(filePath).split("\n");
  const start = entry.startLine;
  const end = entry.endLine;
  if (start < 1 || end < start || end > lines.length) {
    throw new Error(
      `${entry.id}: line range ${start}-${end} invalid for ${entry.file} (${lines.length} lines)`,
    );
  }
  return lines.slice(start - 1, end).join("\n");
}

/** @param {DossierEntry} entry */
export function validateEntryRange(entry) {
  /** @type {string[]} */
  const issues = [];
  const filePath = path.join(REPO_ROOT, entry.file);
  if (!fs.existsSync(filePath)) {
    issues.push(`${entry.id}: missing file ${entry.file}`);
    return issues;
  }
  const lines = readText(filePath).split("\n");
  const { startLine, endLine, anchor, id } = entry;
  if (startLine < 1) issues.push(`${id}: startLine must be ≥1`);
  if (endLine < startLine) issues.push(`${id}: endLine ${endLine} < startLine ${startLine}`);
  if (endLine > lines.length) {
    issues.push(`${id}: endLine ${endLine} exceeds ${entry.file} length (${lines.length})`);
  }
  if (anchor && startLine >= 1 && startLine <= lines.length) {
    const line = lines[startLine - 1].trim();
    const anchorText = anchor.replace(/^#+\s*/, "").trim();
    if (!line.includes(anchorText) && !line.includes(anchor.trim())) {
      const snippet = line.slice(0, 60);
      issues.push(`${id}: anchor drift at line ${startLine} — expected "${anchor}", got "${snippet}…"`);
    }
  }
  return issues;
}

/** @param {{ entries: DossierEntry[] }} index */
export function validateDossierIndex(index) {
  /** @type {string[]} */
  const warnings = [];
  for (const entry of index.entries) {
    warnings.push(...validateEntryRange(entry));
  }
  return warnings;
}

/** @param {{ sections?: DossierEntry[] }} contextIndex */
export function validateContextIndex(contextIndex) {
  /** @type {string[]} */
  const warnings = [];
  for (const entry of contextIndex.sections ?? []) {
    warnings.push(...validateEntryRange(entry));
  }
  return warnings;
}

/** @param {DossierEntry[]} sections @param {string} tag */
export function findSectionByTag(sections, tag) {
  return sections.find((e) => (e.tags ?? []).includes(tag)) ?? null;
}

/** @param {DossierEntry[]} sections @param {string} id */
export function findSectionById(sections, id) {
  return sections.find((e) => e.id === id) ?? null;
}

/** @param {{ entries: DossierEntry[] }} index @param {string} tag */
export function findByTag(index, tag) {
  return index.entries.find((e) => (e.tags ?? []).includes(tag)) ?? null;
}

/** @param {{ entries: DossierEntry[] }} index @param {string} id */
export function findById(index, id) {
  return index.entries.find((e) => e.id === id) ?? null;
}
