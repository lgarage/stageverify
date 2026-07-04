/**
 * Task-trigger gotcha map — composer-orchestrator steps 6–8 → CLI lookup.
 */
import path from "node:path";
import { REPO_ROOT, readJson } from "./away-memory-lib.mjs";
import { findByTag, loadDossierIndex } from "./dossier-index-lib.mjs";
import {
  buildLessonsSliceResult,
  findSectionById,
  loadLessonsIndex,
  sliceSectionRaw,
} from "./librarian-lessons-lib.mjs";

export const GOTCHA_MAP_PATH = path.join(REPO_ROOT, "PROJECT_STATUS/gotcha-map.json");

/** @returns {{ version: number, orchestratorSteps: Record<string, object>, triggers: GotchaTrigger[] }} */
export function loadGotchaMap() {
  return readJson(GOTCHA_MAP_PATH);
}

/**
 * @typedef {{
 *   id: string,
 *   match: string[],
 *   orchestratorSteps?: number[],
 *   dossierTags?: string[],
 *   lessonsSection?: string,
 *   files?: string[],
 *   rules?: string[],
 *   commands?: string[],
 *   gateCandidate?: boolean,
 *   injectBefore?: string[],
 *   warning?: string
 * }} GotchaTrigger
 */

/** @param {string} query @param {string} phrase */
function phraseMatches(query, phrase) {
  const q = query.toLowerCase();
  const p = phrase.toLowerCase();
  if (q.includes(p) || p.includes(q)) return true;
  const qTokens = q.split(/\s+/).filter(Boolean);
  const pTokens = p.split(/\s+/).filter(Boolean);
  if (pTokens.length > 1) return false;
  return pTokens.some((t) => t.length >= 3 && qTokens.some((qt) => qt.includes(t) || t.includes(qt)));
}

/** @param {string} task @param {GotchaTrigger[]} triggers */
export function matchTriggers(task, triggers) {
  const scored = triggers
    .map((trigger) => {
      let score = 0;
      for (const phrase of trigger.match ?? []) {
        if (phraseMatches(task, phrase)) score += phrase.split(/\s+/).length;
      }
      return { trigger, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.map(({ trigger }) => trigger);
}

/**
 * @param {GotchaTrigger[]} matched
 * @param {Record<string, object>} orchestratorSteps
 */
export function buildGotchaResult(matched, orchestratorSteps) {
  /** @type {Set<number>} */
  const stepNums = new Set();
  /** @type {Set<string>} */
  const dossierTags = new Set();
  /** @type {Set<string>} */
  const files = new Set();
  /** @type {Set<string>} */
  const rules = new Set();
  /** @type {Set<string>} */
  const commands = new Set();
  /** @type {Set<string>} */
  const lessonsSectionIds = new Set();
  /** @type {Set<string>} */
  const gateWarnings = new Set();
  /** @type {Set<string>} */
  const injectBeforeHints = new Set();
  /** @type {{ id: string, score: number }[]} */
  const triggerIds = matched.map((t) => t.id);

  for (const trigger of matched) {
    for (const s of trigger.orchestratorSteps ?? []) stepNums.add(s);
    for (const tag of trigger.dossierTags ?? []) dossierTags.add(tag);
    if (trigger.lessonsSection) lessonsSectionIds.add(trigger.lessonsSection);
    for (const f of trigger.files ?? []) {
      if (
        trigger.lessonsSection &&
        (f === "PROJECT_STATUS/LIBRARIAN_LESSONS.md" ||
          f.endsWith("/LIBRARIAN_LESSONS.md"))
      ) {
        continue;
      }
      files.add(f);
    }
    for (const r of trigger.rules ?? []) rules.add(r);
    for (const c of trigger.commands ?? []) commands.add(c);
    if (trigger.gateCandidate && typeof trigger.warning === "string" && trigger.warning.trim()) {
      gateWarnings.add(trigger.warning.trim());
    }
    for (const hint of trigger.injectBefore ?? []) {
      if (typeof hint === "string" && hint.trim()) injectBeforeHints.add(hint.trim());
    }
  }

  if (stepNums.has(7) && lessonsSectionIds.size === 0) {
    lessonsSectionIds.add("ship-verify");
  }

  const dossierIndex = loadDossierIndex();
  const dossierPointers = [...dossierTags].map((tag) => {
    const entry = findByTag(dossierIndex, tag);
    if (!entry) return { tag, found: false };
    return {
      tag,
      found: true,
      id: entry.id,
      file: entry.file,
      startLine: entry.startLine,
      endLine: entry.endLine,
      sliceCommand: `npm run dossier:slice -- --tag ${tag}`,
    };
  });

  const steps = [...stepNums]
    .sort((a, b) => a - b)
    .map((n) => {
      const key = String(n);
      const meta = orchestratorSteps[key];
      return meta ? { step: n, ...meta } : { step: n, label: `orchestrator step ${n}` };
    });

  const lessonsIndex = loadLessonsIndex();
  const lessonsSlices = [...lessonsSectionIds].map((sectionId) => {
    const section = findSectionById(lessonsIndex, sectionId);
    if (!section) return { sectionId, found: false };
    const file = lessonsIndex.file ?? "PROJECT_STATUS/LIBRARIAN_LESSONS.md";
    return {
      sectionId,
      found: true,
      title: section.title,
      file,
      startLine: section.startLine,
      endLine: section.endLine,
      sliceCommand: `npm run context:lessons -- --section ${sectionId}`,
      excerpt: sliceSectionRaw(section, file),
    };
  });

  return {
    matchedTriggers: triggerIds,
    lessonsSlices,
    orchestratorSteps: steps,
    dossierTags: [...dossierTags],
    dossierPointers,
    files: [...files],
    rules: [...rules],
    suggestedCommands: [...commands],
    gateWarnings: [...gateWarnings],
    injectBeforeHints: [...injectBeforeHints],
  };
}

/**
 * @param {string} typeKey e.g. ui-component/drawer-copy
 */
export function buildLessonsSliceForTypeKey(typeKey) {
  const index = loadLessonsIndex();
  return buildLessonsSliceResult(index, typeKey);
}

/** @param {ReturnType<typeof loadGotchaMap>} map */
export function validateGotchaMap(map) {
  /** @type {string[]} */
  const warnings = [];
  const dossierIndex = loadDossierIndex();
  const knownTags = new Set(dossierIndex.entries.flatMap((e) => e.tags ?? []));

  if (!map.orchestratorSteps || typeof map.orchestratorSteps !== "object") {
    warnings.push("gotcha-map: missing orchestratorSteps object");
  } else {
    for (const key of ["6", "7", "8"]) {
      if (!map.orchestratorSteps[key]) {
        warnings.push(`gotcha-map: missing orchestratorSteps.${key}`);
      }
    }
  }

  if (!Array.isArray(map.triggers) || map.triggers.length === 0) {
    warnings.push("gotcha-map: triggers must be a non-empty array");
    return warnings;
  }

  const ids = new Set();
  for (const trigger of map.triggers) {
    if (!trigger.id) warnings.push("gotcha-map: trigger missing id");
    else if (ids.has(trigger.id)) warnings.push(`gotcha-map: duplicate trigger id ${trigger.id}`);
    else ids.add(trigger.id);

    if (!Array.isArray(trigger.match) || trigger.match.length === 0) {
      warnings.push(`gotcha-map: ${trigger.id ?? "?"} missing match phrases`);
    }

    for (const tag of trigger.dossierTags ?? []) {
      if (!knownTags.has(tag)) {
        warnings.push(`gotcha-map: ${trigger.id} dossierTag not in dossier-index: ${tag}`);
      }
    }

    for (const step of trigger.orchestratorSteps ?? []) {
      if (![6, 7, 8].includes(step)) {
        warnings.push(`gotcha-map: ${trigger.id} invalid orchestratorStep ${step} (expected 6, 7, or 8)`);
      }
    }

    if (trigger.lessonsSection) {
      for (const f of trigger.files ?? []) {
        if (
          f === "PROJECT_STATUS/LIBRARIAN_LESSONS.md" ||
          f.endsWith("/LIBRARIAN_LESSONS.md")
        ) {
          warnings.push(
            `gotcha-map: ${trigger.id} lists LIBRARIAN_LESSONS.md in files[] but has lessonsSection — remove file (slice via context:lessons)`,
          );
        }
      }
    }

    if (trigger.gateCandidate === true) {
      if (!trigger.warning?.trim()) {
        warnings.push(`gotcha-map: ${trigger.id} gateCandidate but missing warning text`);
      }
      const rules = trigger.rules ?? [];
      if (!rules.some((r) => r.includes("ship-loop"))) {
        warnings.push(`gotcha-map: ${trigger.id} gateCandidate should reference ship-loop.mdc`);
      }
    }
  }

  return warnings;
}

/** @param {ReturnType<typeof buildGotchaResult>} result */
export function renderGotchaMarkdown(result) {
  const lines = ["# Gotcha map lookup", ""];

  const lessonsSlices = /** @type {NonNullable<ReturnType<typeof buildGotchaResult>["lessonsSlices"]>} */ (
    result.lessonsSlices ?? []
  );
  if (lessonsSlices.length > 0) {
    lines.push("## Lessons slice (LIBRARIAN_LESSONS.md)");
    for (const slice of lessonsSlices) {
      if (slice.found) {
        lines.push(`### ${slice.title} (${slice.file}:${slice.startLine}-${slice.endLine})`);
        lines.push("");
        lines.push(slice.excerpt ?? "");
        lines.push("");
      } else {
        lines.push(`- WARN: section ${slice.sectionId} not in librarian-lessons-index`);
      }
    }
  }

  if (result.matchedTriggers.length === 0) {
    lines.push("No trigger match. Hot tier only — CURRENT_STATE.md + MEMORY.md.");
    lines.push("");
    lines.push("Try: `npm run context:gotcha -- --list`");
    return `${lines.join("\n")}\n`;
  }

  lines.push(`Matched triggers: ${result.matchedTriggers.join(", ")}`);
  lines.push("");

  const gateWarnings = /** @type {string[]} */ (result.gateWarnings ?? []);
  if (gateWarnings.length > 0) {
    lines.push("## Gate candidate warnings (inject before prod verify / ship)");
    for (const w of gateWarnings) {
      lines.push(`- ⚠ ${w}`);
    }
    lines.push("");
  }

  const injectBeforeHints = /** @type {string[]} */ (result.injectBeforeHints ?? []);
  if (injectBeforeHints.length > 0) {
    lines.push("## Inject before");
    for (const hint of injectBeforeHints) lines.push(`- ${hint}`);
    lines.push("");
  }

  if (result.orchestratorSteps.length > 0) {
    lines.push("## Orchestrator on-demand reads");
    for (const step of result.orchestratorSteps) {
      lines.push(`### Step ${step.step}: ${step.label ?? ""}`);
      if (step.when) lines.push(`- When: ${step.when}`);
      if (step.action) lines.push(`- Action: ${step.action}`);
      lines.push("");
    }
  }

  if (result.dossierPointers.length > 0) {
    lines.push("## Dossier tags");
    for (const p of result.dossierPointers) {
      if (p.found) {
        lines.push(`- **${p.tag}** → ${p.file}:${p.startLine}-${p.endLine} (\`${p.sliceCommand}\`)`);
      } else {
        lines.push(`- **${p.tag}** — WARN: not in dossier-index`);
      }
    }
    lines.push("");
  }

  if (result.files.length > 0) {
    lines.push("## Files");
    for (const f of result.files) lines.push(`- ${f}`);
    lines.push("");
  }

  if (result.rules.length > 0) {
    lines.push("## Rules");
    for (const r of result.rules) {
      const path = r.includes("/") || r.includes("§") ? r : `.cursor/rules/${r.endsWith(".mdc") ? r : `${r}.mdc`}`;
      lines.push(`- ${path}`);
    }
    lines.push("");
  }

  if (result.suggestedCommands.length > 0) {
    lines.push("## Suggested commands");
    for (const c of result.suggestedCommands) lines.push(`- \`${c}\``);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}
