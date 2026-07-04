/**
 * LIBRARIAN_LESSONS index load, slice, validate, and append helpers.
 */
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, readJson, readText, writeJson, writeText } from "./away-memory-lib.mjs";
import { validateEntryRange } from "./dossier-index-lib.mjs";

export const LESSONS_INDEX_PATH = path.join(REPO_ROOT, "PROJECT_STATUS/librarian-lessons-index.json");
export const LESSONS_FILE = "PROJECT_STATUS/LIBRARIAN_LESSONS.md";
export const LESSONS_PATH = path.join(REPO_ROOT, LESSONS_FILE);

/** @returns {import('./librarian-lessons-lib.mjs').LessonsIndex} */
export function loadLessonsIndex() {
  return readJson(LESSONS_INDEX_PATH);
}

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   anchor: string,
 *   startLine: number,
 *   endLine: number
 * }} LessonsSection
 *
 * @typedef {{
 *   version: number,
 *   description?: string,
 *   file: string,
 *   sections: LessonsSection[],
 *   entries: { type: string, subtype: string, sectionId: string }[],
 *   typeDefaults?: Record<string, string>
 * }} LessonsIndex
 */

/** @param {LessonsIndex} index @param {string} sectionId */
export function findSectionById(index, sectionId) {
  return index.sections.find((s) => s.id === sectionId) ?? null;
}

/**
 * @param {LessonsIndex} index
 * @param {string} typeKey e.g. "ui-component/drawer-copy"
 */
export function resolveSectionForTypeKey(index, typeKey) {
  const trimmed = typeKey.trim();
  const slash = trimmed.indexOf("/");
  const type = slash >= 0 ? trimmed.slice(0, slash) : trimmed;
  const subtype = slash >= 0 ? trimmed.slice(slash + 1) : "";

  if (subtype) {
    const exact = index.entries.find((e) => e.type === type && e.subtype === subtype);
    if (exact) return findSectionById(index, exact.sectionId);
  }

  const defaultId = index.typeDefaults?.[type];
  if (defaultId) return findSectionById(index, defaultId);

  return null;
}

/** @param {LessonsSection} section @param {string} file */
export function sliceSectionRaw(section, file) {
  const filePath = path.join(REPO_ROOT, file);
  const lines = readText(filePath).split("\n");
  const { startLine, endLine } = section;
  if (startLine < 1 || endLine < startLine || endLine > lines.length) {
    throw new Error(
      `${section.id}: line range ${startLine}-${endLine} invalid for ${file} (${lines.length} lines)`,
    );
  }
  return lines.slice(startLine - 1, endLine).join("\n");
}

/** @param {LessonsSection} section @param {string} [file=LESSONS_FILE] */
export function validateSectionRange(section, file = LESSONS_FILE) {
  return validateEntryRange({
    id: section.id,
    tags: [],
    title: section.title,
    file,
    startLine: section.startLine,
    endLine: section.endLine,
    anchor: section.anchor,
  });
}

/** @param {LessonsIndex} index */
export function validateLessonsIndex(index) {
  /** @type {string[]} */
  const issues = [];
  const file = index.file ?? LESSONS_FILE;
  const filePath = path.join(REPO_ROOT, file);
  if (!fs.existsSync(filePath)) {
    issues.push(`librarian-lessons-index: missing file ${file}`);
    return issues;
  }

  for (const section of index.sections ?? []) {
    issues.push(...validateSectionRange(section, file).map((m) => `librarian-lessons-index: ${m}`));
  }

  const sectionIds = new Set((index.sections ?? []).map((s) => s.id));
  for (const entry of index.entries ?? []) {
    if (!sectionIds.has(entry.sectionId)) {
      issues.push(
        `librarian-lessons-index: entry ${entry.type}/${entry.subtype} references unknown section ${entry.sectionId}`,
      );
    }
  }

  for (const [type, sectionId] of Object.entries(index.typeDefaults ?? {})) {
    if (!sectionIds.has(sectionId)) {
      issues.push(`librarian-lessons-index: typeDefaults.${type} → unknown section ${sectionId}`);
    }
  }

  return issues;
}

/**
 * Recompute section line ranges from ## headers in LIBRARIAN_LESSONS.md.
 * @param {LessonsIndex} index
 * @returns {LessonsIndex}
 */
export function recomputeSectionRanges(index, content) {
  const file = index.file ?? LESSONS_FILE;
  const lines = content ?? readText(path.join(REPO_ROOT, file)).split("\n");
  /** @type {{ line: number, anchor: string }[]} */
  const headers = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("## ")) {
      headers.push({ line: i + 1, anchor: line.trim() });
    }
  }

  const updatedSections = (index.sections ?? []).map((section) => {
    const headerIdx = headers.findIndex((h) => h.anchor === section.anchor.trim());
    if (headerIdx < 0) return section;
    const startLine = headers[headerIdx].line;
    const nextHeader = headers[headerIdx + 1];
    let endLine = nextHeader ? nextHeader.line - 1 : lines.length;
    while (endLine > startLine && lines[endLine - 1].trim() === "") {
      endLine -= 1;
    }
    return { ...section, startLine, endLine };
  });

  return { ...index, sections: updatedSections };
}

/**
 * Append one bullet to the section for type/subtype and refresh index ranges.
 * @param {{ typeKey: string, bullet: string, dryRun?: boolean }} opts
 */
export function appendLessonBullet(opts) {
  const { typeKey, bullet, dryRun = false } = opts;
  const index = loadLessonsIndex();
  const section = resolveSectionForTypeKey(index, typeKey);
  if (!section) {
    throw new Error(`No lessons section for type key: ${typeKey}`);
  }

  const file = index.file ?? LESSONS_FILE;
  const filePath = path.join(REPO_ROOT, file);
  const lines = readText(filePath).split("\n");
  const insertAt = section.endLine;
  const bulletLine = bullet.startsWith("- ") ? bullet : `- ${bullet}`;

  const nextLines = [...lines.slice(0, insertAt), bulletLine, ...lines.slice(insertAt)];
  const nextContent = nextLines.join("\n");

  if (dryRun) {
    const nextIndex = recomputeSectionRanges(index, nextContent);
    return { section: section.id, insertAt: insertAt + 1, bulletLine, nextIndex };
  }

  writeText(filePath, nextContent);
  const nextIndex = recomputeSectionRanges(index, nextContent);
  writeJson(LESSONS_INDEX_PATH, nextIndex);
  return { section: section.id, insertAt: insertAt + 1, bulletLine, nextIndex };
}

/**
 * @param {LessonsIndex} index
 * @param {string} typeKey
 */
export function buildLessonsSliceResult(index, typeKey) {
  const section = resolveSectionForTypeKey(index, typeKey);
  if (!section) {
    return { typeKey, found: false, message: `No section mapping for ${typeKey}` };
  }
  const file = index.file ?? LESSONS_FILE;
  return {
    typeKey,
    found: true,
    sectionId: section.id,
    title: section.title,
    file,
    startLine: section.startLine,
    endLine: section.endLine,
    sliceCommand: `npm run context:lessons -- --type ${typeKey}`,
    excerpt: sliceSectionRaw(section, file),
  };
}

/** @param {ReturnType<typeof buildLessonsSliceResult>} result */
export function renderLessonsSliceMarkdown(result) {
  if (!result.found) {
    return `# Lessons slice\n\n${result.message ?? "Not found"}\n`;
  }
  const lines = [
    `# Lessons slice — ${result.typeKey}`,
    "",
    `Section: **${result.title}** (${result.file}:${result.startLine}-${result.endLine})`,
    "",
    result.excerpt ?? "",
    "",
  ];
  return `${lines.join("\n").trim()}\n`;
}
