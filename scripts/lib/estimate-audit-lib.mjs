/**
 * Parse estimate-log.md, run 15-row calibration audits, persist snapshot.
 * SSOT methodology: PROJECT_STATUS/estimate-log.md
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readText, writeJson, writeText } from "./away-memory-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "../..");

export const ESTIMATE_PATHS = {
  estimateLog: path.join(REPO_ROOT, "PROJECT_STATUS/estimate-log.md"),
  estimateAudit: path.join(REPO_ROOT, "PROJECT_STATUS/estimate-audit.json"),
  timeAwareness: path.join(REPO_ROOT, ".cursor/rules/time-awareness.mdc"),
};

/** @typedef {{ rowNum: number, away: string, budgetMin: number, actualMin: number | null, type: string, subtype: string, approx: boolean }} EstimateRow */

/**
 * @param {string} raw
 * @returns {number | null}
 */
function parseActual(raw) {
  const s = String(raw ?? "").trim();
  if (!s || s === "unknown") return null;
  const approx = s.startsWith("~");
  const m = s.match(/(\d+)/);
  if (!m) return null;
  return Number.parseInt(m[1], 10);
}

/**
 * @param {string} md
 * @returns {EstimateRow[]}
 */
export function parseEstimateLogRows(md) {
  const logIdx = md.indexOf("## Log");
  if (logIdx < 0) return [];

  const section = md.slice(logIdx);
  const lines = section.split("\n");
  /** @type {EstimateRow[]} */
  const rows = [];

  for (const line of lines) {
    if (!line.startsWith("|")) continue;
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter((_, i, arr) => i > 0 && i < arr.length - 1);
    if (cells.length < 10) continue;
    const rowNum = Number.parseInt(cells[0], 10);
    if (!Number.isFinite(rowNum)) continue;

    const budgetMin = Number.parseInt(cells[4], 10);
    const rawActual = cells[5];
    const approx = String(rawActual).trim().startsWith("~");
    const actualMin = parseActual(rawActual);

    rows.push({
      rowNum,
      away: cells[1],
      budgetMin: Number.isFinite(budgetMin) ? budgetMin : 0,
      actualMin,
      type: cells[6],
      subtype: cells[7],
      approx,
    });
  }

  return rows;
}

/**
 * @param {number[]} values
 * @returns {number | null}
 */
export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return sorted[mid];
}

/**
 * Conservative budget from median actual (upper bound for time-bound filter).
 * @param {number} medianActual
 */
export function suggestedBudget(medianActual) {
  const raw = Math.max(medianActual * 2, medianActual + 5);
  return Math.ceil(raw / 5) * 5;
}

/**
 * @param {number} rowCount
 * @param {number} lastAuditedRowCount
 */
export function shouldRunAudit(rowCount, lastAuditedRowCount) {
  if (rowCount < 15) return false;
  const milestone = Math.floor(rowCount / 15) * 15;
  return lastAuditedRowCount < milestone;
}

/**
 * @param {EstimateRow[]} rows
 * @param {number} minSamples
 */
function groupFindings(rows, minSamples = 3) {
  /** @type {Map<string, { type: string, subtype: string, actuals: number[], budgets: number[] }>} */
  const bySubtype = new Map();
  /** @type {Map<string, { type: string, actuals: number[], budgets: number[] }>} */
  const byType = new Map();

  for (const row of rows) {
    if (row.actualMin == null) continue;
    const subKey = `${row.type}/${row.subtype}`;
    if (!bySubtype.has(subKey)) {
      bySubtype.set(subKey, { type: row.type, subtype: row.subtype, actuals: [], budgets: [] });
    }
    const sub = bySubtype.get(subKey);
    sub.actuals.push(row.actualMin);
    sub.budgets.push(row.budgetMin);

    if (!byType.has(row.type)) {
      byType.set(row.type, { type: row.type, actuals: [], budgets: [] });
    }
    const t = byType.get(row.type);
    t.actuals.push(row.actualMin);
    t.budgets.push(row.budgetMin);
  }

  /** @type {Array<{ key: string, level: 'subtype' | 'type', type: string, subtype?: string, n: number, medianActual: number, medianBudget: number, delta: number, recommendation: string, suggestedBudgetMin: number | null }>} */
  const findings = [];

  for (const [key, g] of bySubtype) {
    if (g.actuals.length < minSamples) continue;
    const medA = median(g.actuals);
    const medB = median(g.budgets);
    if (medA == null || medB == null) continue;
    const suggested = suggestedBudget(medA);
    let recommendation = "OK";
    if (medA > medB * 0.85) recommendation = "INCREASE";
    else if (medA < medB * 0.5) recommendation = "DECREASE";
    findings.push({
      key,
      level: "subtype",
      type: g.type,
      subtype: g.subtype,
      n: g.actuals.length,
      medianActual: medA,
      medianBudget: medB,
      delta: medA - medB,
      recommendation,
      suggestedBudgetMin: recommendation === "OK" ? medB : suggested,
    });
  }

  for (const [type, g] of byType) {
    const covered = findings.some((f) => f.type === type && f.level === "subtype");
    if (g.actuals.length < minSamples) continue;
    const medA = median(g.actuals);
    const medB = median(g.budgets);
    if (medA == null || medB == null) continue;
    const suggested = suggestedBudget(medA);
    let recommendation = "OK";
    if (medA > medB * 0.85) recommendation = "INCREASE";
    else if (medA < medB * 0.5) recommendation = "DECREASE";
    findings.push({
      key: type,
      level: "type",
      type,
      n: g.actuals.length,
      medianActual: medA,
      medianBudget: medB,
      delta: medA - medB,
      recommendation,
      suggestedBudgetMin: recommendation === "OK" ? medB : suggested,
      fallbackForSubtypes: covered,
    });
  }

  return findings.sort((a, b) => {
    const order = { INCREASE: 0, DECREASE: 1, OK: 2 };
    return (order[a.recommendation] ?? 3) - (order[b.recommendation] ?? 3);
  });
}

/**
 * @param {EstimateRow[]} rows
 */
export function runAudit(rows) {
  const withActual = rows.filter((r) => r.actualMin != null);
  const findings = groupFindings(withActual);
  return {
    rowCount: rows.length,
    rowsWithActual: withActual.length,
    rowsSkippedUnknown: rows.length - withActual.length,
    findings,
    auditedAt: new Date().toISOString(),
  };
}

/** @returns {{ lastAuditedRowCount: number, auditedAt?: string, findings?: unknown[] }} */
export function loadAuditSnapshot() {
  try {
    if (!fs.existsSync(ESTIMATE_PATHS.estimateAudit)) {
      return { lastAuditedRowCount: 0 };
    }
    return JSON.parse(readText(ESTIMATE_PATHS.estimateAudit));
  } catch {
    return { lastAuditedRowCount: 0 };
  }
}

/**
 * @param {object} report
 * @param {number} rowCount
 */
export function saveAuditSnapshot(report, rowCount) {
  const snapshot = {
    lastAuditedRowCount: rowCount,
    auditedAt: report.auditedAt,
    rowCount,
    rowsWithActual: report.rowsWithActual,
    findings: report.findings,
  };
  writeJson(ESTIMATE_PATHS.estimateAudit, snapshot);
  return snapshot;
}

/**
 * @param {ReturnType<runAudit>['findings']} findings
 * @param {string} md
 */
export function applySubtypeBudgetsToLog(findings, md) {
  const subtypeFindings = findings.filter(
    (f) => f.level === "subtype" && f.recommendation !== "OK" && f.suggestedBudgetMin != null,
  );
  if (subtypeFindings.length === 0) return { md, applied: [] };

  const header = "## Subtype budgets (recalibrated)";
  const tableHeader =
    "| Type | Subtype | budgetMin | typicalMin | samples | lastAuditAt | notes |\n| ---- | ------- | --------- | ---------- | ------- | ----------- | ----- |";
  const now = new Date().toISOString().slice(0, 10);

  /** @type {string[]} */
  const tableRows = [];
  for (const f of subtypeFindings) {
    tableRows.push(
      `| ${f.type} | ${f.subtype} | ${f.suggestedBudgetMin} | ${f.medianActual} | ${f.n} | ${now} | median actual ${f.medianActual} vs prior budget ${f.medianBudget} → ${f.recommendation} |`,
    );
  }

  const block = `${header}\n\n${tableHeader}\n${tableRows.join("\n")}\n`;

  let next = md;
  if (md.includes(header)) {
    next = md.replace(
      new RegExp(`${header}[\\s\\S]*?(?=\\n## |$)`),
      `${block.trim()}\n\n`,
    );
  } else {
    const insertBefore = "## Recalibration (after 15 rows)";
    if (next.includes(insertBefore)) {
      next = next.replace(insertBefore, `${block}\n${insertBefore}`);
    } else {
      next = `${next.trim()}\n\n${block}`;
    }
  }

  return { md: next, applied: subtypeFindings };
}

/**
 * Apply type-level DECREASE/INCREASE to time-awareness category anchors when unambiguous.
 * @param {ReturnType<runAudit>['findings']} findings
 */
export function applyTimeAwarenessAnchors(findings) {
  const typeFindings = findings.filter(
    (f) =>
      f.level === "type" &&
      !f.fallbackForSubtypes &&
      f.recommendation !== "OK" &&
      f.suggestedBudgetMin != null,
  );
  if (typeFindings.length === 0) return { applied: [], md: readText(ESTIMATE_PATHS.timeAwareness) };

  let md = readText(ESTIMATE_PATHS.timeAwareness);
  /** @type {typeof typeFindings} */
  const applied = [];

  const anchorMap = {
    "docs-update": /Verify-only scripts \(bundle\)|docs-update|T0.*docs/i,
    "ui-component": /T1 single-domain ship \(e\.g\. Settings UI\)/,
    "verify-only": /Verify-only scripts \(bundle\)|`verify:pickup:prod` alone/,
    "scripts-only": /T1 verify harness script/,
    "service-logic": /T1 verify harness script|T1 single-domain/,
  };

  for (const f of typeFindings) {
    const pattern = anchorMap[f.type];
    if (!pattern) continue;

    const lineMatch = md.match(
      /\| ([^|]+) \| (\d+(?:–\d+)? min) \| ([^|]+) \|/g,
    );
    if (!lineMatch) continue;

    for (const line of lineMatch) {
      const m = line.match(/\| ([^|]+) \| (\d+(?:–\d+)? min) \| ([^|]+) \|/);
      if (!m) continue;
      const [, category, budgetCol, typicalCol] = m;
      if (!pattern.test(category)) continue;

      const newBudget = `${f.suggestedBudgetMin} min`;
      const newTypical = `~${f.medianActual} min`;
      if (budgetCol === newBudget && typicalCol.trim() === newTypical) continue;

      const oldLine = `| ${category} | ${budgetCol} | ${typicalCol} |`;
      const newLine = `| ${category} | ${newBudget} | ${newTypical} |`;
      md = md.replace(oldLine, newLine);
      applied.push({ ...f, category, oldBudget: budgetCol, newBudget, newTypical });
      break;
    }
  }

  if (applied.length > 0) {
    writeText(ESTIMATE_PATHS.timeAwareness, md);
  }

  return { applied, md };
}

/**
 * @param {ReturnType<runAudit>} report
 */
export function formatAuditReport(report) {
  const lines = [
    `estimate:audit — ${report.rowCount} log rows (${report.rowsWithActual} with actual, ${report.rowsSkippedUnknown} unknown/skipped)`,
    "",
    "| Level | Type/Subtype | n | medianActual | medianBudget | delta | recommendation | suggestedBudget |",
    "| ----- | ------------ | - | ------------ | ------------ | ----- | -------------- | --------------- |",
  ];

  if (report.findings.length === 0) {
    lines.push("| — | (no groups with ≥3 samples) | — | — | — | — | — | — |");
  } else {
    for (const f of report.findings) {
      const label = f.level === "subtype" ? `${f.type}/${f.subtype}` : `${f.type} (type)`;
      const sug = f.suggestedBudgetMin ?? "—";
      lines.push(
        `| ${f.level} | ${label} | ${f.n} | ${f.medianActual} | ${f.medianBudget} | ${f.delta >= 0 ? "+" : ""}${f.delta} | ${f.recommendation} | ${sug} |`,
      );
    }
  }

  return lines.join("\n");
}

/**
 * @param {number} rowCount
 * @param {number} lastAuditedRowCount
 * @returns {string | null}
 */
export function auditDueWarning(rowCount, lastAuditedRowCount) {
  if (!shouldRunAudit(rowCount, lastAuditedRowCount)) return null;
  const milestone = Math.floor(rowCount / 15) * 15;
  return `estimate-log has ${rowCount} rows — audit due at ${milestone}-row milestone (last audit at ${lastAuditedRowCount}). Run: npm run estimate:audit`;
}
