#!/usr/bin/env node
/**
 * Every-15-rows estimate accuracy audit (median actual vs budget by Type/Subtype).
 * Run: npm run estimate:audit [-- --apply] [-- --force]
 */
import {
  ESTIMATE_PATHS,
  applySubtypeBudgetsToLog,
  applyTimeAwarenessAnchors,
  formatAuditReport,
  loadAuditSnapshot,
  parseEstimateLogRows,
  runAudit,
  saveAuditSnapshot,
  shouldRunAudit,
} from "./lib/estimate-audit-lib.mjs";
import { readText, writeText } from "./lib/away-memory-lib.mjs";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const force = args.includes("--force");

function main() {
  const md = readText(ESTIMATE_PATHS.estimateLog);
  const rows = parseEstimateLogRows(md);
  const rowCount = rows.length;
  const snapshot = loadAuditSnapshot();
  const lastAudited = snapshot.lastAuditedRowCount ?? 0;

  if (rowCount < 15) {
    console.log(`estimate:audit SKIP — ${rowCount}/15 rows (need 15 for first audit)`);
    process.exit(0);
  }

  if (!force && !shouldRunAudit(rowCount, lastAudited)) {
    console.log(
      `estimate:audit SKIP — ${rowCount} rows; last audit at ${lastAudited} (next at ${Math.ceil(rowCount / 15) * 15} or use --force)`,
    );
    process.exit(0);
  }

  const report = runAudit(rows);
  console.log(formatAuditReport(report));

  saveAuditSnapshot(report, rowCount);

  if (apply) {
    const { md: nextMd, applied: logApplied } = applySubtypeBudgetsToLog(report.findings, md);
    if (logApplied.length > 0) {
      writeText(ESTIMATE_PATHS.estimateLog, nextMd);
      console.log(`\nApplied ${logApplied.length} subtype budget row(s) to estimate-log.md`);
    }
    const { applied: anchorApplied } = applyTimeAwarenessAnchors(report.findings);
    if (anchorApplied.length > 0) {
      console.log(`Applied ${anchorApplied.length} time-awareness.mdc anchor update(s)`);
      for (const a of anchorApplied) {
        console.log(`  ${a.category}: ${a.oldBudget} → ${a.newBudget}, typical → ${a.newTypical}`);
      }
    }
    if (logApplied.length === 0 && anchorApplied.length === 0) {
      console.log("\n--apply: no budget adjustments warranted (all OK or insufficient samples)");
    }
  } else {
    const actionable = report.findings.filter((f) => f.recommendation !== "OK");
    if (actionable.length > 0) {
      console.log("\nRun with --apply to write subtype budgets / anchor updates where recommended.");
    }
  }

  console.log(`\nSnapshot: PROJECT_STATUS/estimate-audit.json (lastAuditedRowCount=${rowCount})`);
}

main();
