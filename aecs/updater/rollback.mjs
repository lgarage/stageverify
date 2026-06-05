#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDirectory, isGitRepoRoot } from '../installer/lib/paths.mjs';
import { runVerify } from '../installer/verify.mjs';
import { defaultSourceRoot } from '../installer/install.mjs';
import { UPDATER_VERSION } from './lib/constants.mjs';
import { isValidTransactionId } from './lib/transaction.mjs';
import { listBackups } from './lib/backup.mjs';
import { applyRollback, buildRollbackPlan } from './lib/rollback-engine.mjs';
import {
  checkRollbackAllowed,
  clearRollbackInProgress,
  clearUpdateInProgress,
  markRollbackVerifyFailed,
  readRollbackInProgress,
} from './lib/progress.mjs';

/**
 * @param {string[]} argv
 */
export function parseRollbackArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const opts = {
    write: false,
    list: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--write') {
      opts.write = true;
    } else if (arg === '--dry-run') {
      opts.write = false;
    } else if (arg === '--list') {
      opts.list = true;
    } else if (arg === '--target' && argv[i + 1]) {
      opts.target = argv[++i];
    } else if (arg === '--transaction' && argv[i + 1]) {
      opts.transaction = argv[++i];
    } else if (arg === '--source' && argv[i + 1]) {
      opts.source = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    }
  }
  return opts;
}

/**
 * @param {object} opts
 * @param {string} opts.targetRoot
 * @param {string} [opts.transactionId]
 * @param {boolean} [opts.write]
 * @param {boolean} [opts.list]
 * @param {string} [opts.sourceRoot]
 * @param {number} [opts.simulateApplyFailureAfter]
 */
export function runRollback(opts) {
  const targetRoot = path.resolve(opts.targetRoot);

  if (!isDirectory(targetRoot)) {
    return { ok: false, blocks: ['Target is not a directory'] };
  }
  if (!isGitRepoRoot(targetRoot)) {
    return { ok: false, blocks: ['Target is not a git repository root'] };
  }

  if (opts.list) {
    const backups = listBackups(targetRoot);
    return {
      ok: true,
      dryRun: true,
      list: backups,
      updaterVersion: UPDATER_VERSION,
    };
  }

  const transactionId = opts.transactionId;
  if (!transactionId) {
    return { ok: false, blocks: ['--transaction is required (or use --list)'] };
  }
  if (!isValidTransactionId(transactionId)) {
    return { ok: false, blocks: [`Invalid transaction id format: ${transactionId}`] };
  }

  const progressCheck = checkRollbackAllowed(targetRoot, transactionId, Boolean(opts.write));
  if (!progressCheck.ok) {
    return {
      ok: false,
      dryRun: !opts.write,
      updaterVersion: UPDATER_VERSION,
      transactionId,
      blocks: [progressCheck.reason ?? 'Rollback blocked'],
      planned: [],
      written: [],
      staleState: progressCheck.kind ?? null,
      rollbackProgress: readRollbackInProgress(targetRoot),
    };
  }

  const existingProgress = readRollbackInProgress(targetRoot);

  if (!opts.write) {
    const plan = buildRollbackPlan({ targetRoot, transactionId });
    return {
      ok: plan.ok,
      dryRun: true,
      updaterVersion: UPDATER_VERSION,
      transactionId,
      blocks: plan.blocks,
      planned: plan.changes,
      written: [],
      rollbackProgress: existingProgress,
    };
  }

  const applied = applyRollback({
    targetRoot,
    transactionId,
    simulateApplyFailureAfter: opts.simulateApplyFailureAfter,
  });
  if (!applied.ok) {
    return {
      ok: false,
      dryRun: false,
      updaterVersion: UPDATER_VERSION,
      transactionId,
      rollbackTransactionId: applied.rollbackTransactionId ?? null,
      blocks: applied.blocks ?? ['Rollback apply failed'],
      planned: applied.changes ?? [],
      written: applied.written ?? [],
      applyFailed: true,
      partialFailure: applied.partialFailure ?? false,
      rollbackProgress: applied.rollbackProgress ?? readRollbackInProgress(targetRoot),
      lastSuccessfulStep: applied.lastSuccessfulStep ?? null,
    };
  }

  const sourceRoot = path.resolve(opts.sourceRoot ?? defaultSourceRoot());
  const verify = runVerify({ targetRoot, sourceRoot });

  if (!verify.ok) {
    const progress = readRollbackInProgress(targetRoot);
    if (progress && !('malformed' in progress)) {
      markRollbackVerifyFailed(
        targetRoot,
        progress,
        verify.findings.map((f) => f.message ?? String(f)).join('; ') || 'Verify failed',
      );
    }
    return {
      ok: false,
      dryRun: false,
      updaterVersion: UPDATER_VERSION,
      transactionId,
      rollbackTransactionId: applied.rollbackTransactionId ?? null,
      blocks: verify.findings.map((f) => f.message ?? String(f)),
      planned: applied.changes,
      written: applied.written ?? [],
      verify: { ok: verify.ok, findings: verify.findings },
      rollbackProgress: readRollbackInProgress(targetRoot),
    };
  }

  clearUpdateInProgress(targetRoot);
  clearRollbackInProgress(targetRoot);

  return {
    ok: true,
    dryRun: false,
    updaterVersion: UPDATER_VERSION,
    transactionId,
    rollbackTransactionId: applied.rollbackTransactionId ?? null,
    blocks: [],
    planned: applied.changes,
    written: applied.written ?? [],
    verify: { ok: verify.ok, findings: verify.findings },
    rollbackProgress: null,
  };
}

function printHelp() {
  console.log(`AECS rollback v${UPDATER_VERSION}

Usage:
  node aecs/updater/rollback.mjs --target <repo-root> [options]

Options:
  --target <path>         Installed git repository root (required)
  --list                  List available backups
  --transaction <id>      Backup transaction to restore
  --write                 Apply rollback (default: dry-run)
  --source <path>         AECS host for post-rollback verify
  --help                  Show this help

Dry-run is the default for rollback restore.
`);
}

function main() {
  const opts = parseRollbackArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    process.exit(0);
  }
  if (!opts.target || typeof opts.target !== 'string') {
    console.error('Error: --target is required');
    printHelp();
    process.exit(1);
  }

  try {
    const result = runRollback({
      targetRoot: opts.target,
      transactionId: typeof opts.transaction === 'string' ? opts.transaction : undefined,
      write: Boolean(opts.write),
      list: Boolean(opts.list),
      sourceRoot: typeof opts.source === 'string' ? opts.source : undefined,
    });

    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) {
      process.exit(2);
    }
    process.exit(0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main();
}
