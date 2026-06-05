import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteFile } from '../../installer/lib/fs-safe.mjs';
import { sha256File } from '../../installer/lib/hash.mjs';
import { loadInstalledManifest } from '../../installer/lib/manifest.mjs';
import { normalizeRel, resolveUnderRoot } from '../../installer/lib/paths.mjs';
import {
  backupDirRel,
  resolveBackupFileAbs,
  validateBackupIntegrity,
} from './backup.mjs';
import {
  checkRollbackAllowed,
  markRollbackFailed,
  markRollbackPendingVerify,
  readRollbackInProgress,
  recordRollbackStepStart,
  recordRollbackStepSuccess,
  rollbackOperationId,
  writeRollbackInProgress,
} from './progress.mjs';

/**
 * @param {Record<string, unknown>} installed
 * @param {string} relPath
 */
function installedRecordHash(installed, relPath) {
  const norm = normalizeRel(relPath);
  for (const f of installed.files ?? []) {
    if (normalizeRel(String(f.installedAs)) === norm) {
      return String(f.sha256);
    }
  }
  return null;
}

/**
 * @param {Array<{relPath: string, action: string}>} changes
 */
function countPlannedRollbackOperations(changes) {
  let count = 0;
  for (const change of changes) {
    if (change.action === 'skip-remove') {
      continue;
    }
    count += 1;
  }
  return count;
}

/**
 * @param {Array<{relPath: string, action: string}>} changes
 */
function buildRollbackApplyQueue(changes) {
  /** @type {Array<{ action: string, relPath: string }>} */
  const queue = [];
  for (const change of changes) {
    if (change.action === 'skip-remove') {
      continue;
    }
    if (change.action === 'remove-added') {
      queue.push({ action: 'remove-added', relPath: change.relPath });
    }
  }
  return queue;
}

/**
 * @param {object} opts
 * @param {string} opts.targetRoot
 * @param {string} opts.transactionId
 */
export function buildRollbackPlan(opts) {
  const { targetRoot, transactionId } = opts;

  const progressCheck = checkRollbackAllowed(targetRoot, transactionId, false);
  if (!progressCheck.ok) {
    return {
      ok: false,
      blocks: [progressCheck.reason ?? 'Rollback blocked by in-progress sentinel'],
      changes: [],
      transactionId,
    };
  }

  const integrity = validateBackupIntegrity(targetRoot, transactionId);
  if (!integrity.ok) {
    return {
      ok: false,
      blocks: [integrity.reason ?? 'Backup integrity check failed'],
      changes: [],
      transactionId,
    };
  }

  const manifest = integrity.manifest;
  /** @type {string[]} */
  const blocks = [];
  /** @type {Array<{relPath: string, action: string, reason?: string}>} */
  const changes = [];

  let installed = null;
  try {
    installed = loadInstalledManifest(targetRoot);
  } catch {
    blocks.push('Cannot read current installation record for drift detection');
  }
  if (!installed) {
    blocks.push('Missing post-update install record — drift checks cannot run, rollback blocked');
  }

  const rollbackMeta = /** @type {Record<string, string[]> | null} */ (manifest.rollback ?? null);
  const filesAdded = rollbackMeta?.filesAdded ?? [];

  if (installed && Array.isArray(installed.files)) {
    for (const f of installed.files) {
      const norm = normalizeRel(String(f.installedAs));
      if (filesAdded.includes(norm)) {
        continue;
      }
      const expected = String(f.sha256);
      const abs = path.join(targetRoot, norm.replace(/\//g, path.sep));
      if (!fs.existsSync(abs) || abs.endsWith('.gitkeep')) {
        continue;
      }
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) {
        continue;
      }
      const current = sha256File(abs);
      if (current !== expected) {
        blocks.push(
          `Post-update drift detected for ${norm}: file changed since update (rollback blocked)`,
        );
      }
    }
  }

  for (const rel of filesAdded) {
    const norm = normalizeRel(rel);
    const abs = path.join(targetRoot, norm.replace(/\//g, path.sep));
    if (!fs.existsSync(abs)) {
      changes.push({
        relPath: norm,
        action: 'skip-remove',
        reason: 'Update-added file already absent',
      });
      continue;
    }
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      continue;
    }
    if (installed) {
      const expected = installedRecordHash(installed, norm);
      if (expected) {
        const current = sha256File(abs);
        if (current !== expected) {
          blocks.push(
            `Drift on update-added file ${norm} before removal — file modified since update (rollback blocked)`,
          );
          continue;
        }
      }
    }
    changes.push({
      relPath: norm,
      action: 'remove-added',
      reason: 'Remove file introduced by update (not in prior install record)',
    });
  }

  for (const rel of manifest.files ?? []) {
    const norm = normalizeRel(rel);
    changes.push({
      relPath: norm,
      action: 'restore',
      reason: 'Restore from verified backup',
    });
  }

  const installedBackup = path.join(
    targetRoot,
    backupDirRel(transactionId),
    'installed-manifest.json',
  );
  if (!fs.existsSync(installedBackup)) {
    blocks.push('Missing installed-manifest.json in backup');
  } else {
    changes.push({
      relPath: '.cursor/aecs/installed-manifest.json',
      action: 'restore-record',
      reason: 'Restore prior installation record',
    });
  }

  const ownershipBackup = path.join(targetRoot, backupDirRel(transactionId), 'ownership.json');
  if (fs.existsSync(ownershipBackup)) {
    changes.push({
      relPath: '.cursor/aecs/ownership.json',
      action: 'restore-record',
      reason: 'Restore prior ownership registry',
    });
  }

  return {
    ok: blocks.length === 0,
    blocks,
    changes,
    transactionId,
    manifest,
    rollbackMeta,
    dryRun: true,
  };
}

/**
 * @param {object} opts
 * @param {string} opts.targetRoot
 * @param {string} opts.transactionId
 * @param {number} [opts.simulateApplyFailureAfter] fail after N successful ops (test hook)
 */
export function applyRollback(opts) {
  const { targetRoot, transactionId, simulateApplyFailureAfter } = opts;

  const progressCheck = checkRollbackAllowed(targetRoot, transactionId, true);
  if (!progressCheck.ok) {
    return {
      ok: false,
      blocks: [progressCheck.reason ?? 'Rollback blocked by in-progress sentinel'],
      changes: [],
      transactionId,
      written: [],
    };
  }

  const plan = buildRollbackPlan(opts);
  if (!plan.ok) {
    return { ...plan, written: [] };
  }

  /** @type {string[]} */
  const written = [];
  const base = backupDirRel(transactionId);
  const plannedCount = countPlannedRollbackOperations(plan.changes);
  const progress = writeRollbackInProgress({
    targetRoot,
    sourceBackupTransactionId: transactionId,
    plannedOperationCount: plannedCount,
  });

  const removalQueue = buildRollbackApplyQueue(plan.changes);

  try {
    for (const step of removalQueue) {
      recordRollbackStepStart(targetRoot, progress, step);
      if (
        simulateApplyFailureAfter != null &&
        progress.completedOperationCount >= simulateApplyFailureAfter
      ) {
        throw new Error('Simulated rollback apply failure');
      }

      const abs = resolveUnderRoot(targetRoot, step.relPath);
      if (fs.existsSync(abs)) {
        const stat = fs.statSync(abs);
        if (!stat.isDirectory()) {
          fs.unlinkSync(abs);
          written.push(`removed:${step.relPath}`);
        }
      }
      recordRollbackStepSuccess(targetRoot, progress, step);
    }

    for (const rel of plan.manifest.files ?? []) {
      const norm = normalizeRel(rel);
      const step = { action: 'restore', relPath: norm };
      recordRollbackStepStart(targetRoot, progress, step);
      if (
        simulateApplyFailureAfter != null &&
        progress.completedOperationCount >= simulateApplyFailureAfter
      ) {
        throw new Error('Simulated rollback apply failure');
      }

      const srcAbs = resolveBackupFileAbs(targetRoot, transactionId, norm);
      const content = fs.readFileSync(srcAbs, 'utf8');
      atomicWriteFile(targetRoot, norm, content);
      written.push(norm);
      recordRollbackStepSuccess(targetRoot, progress, step);
    }

    const installedStep = {
      action: 'restore-record',
      relPath: '.cursor/aecs/installed-manifest.json',
    };
    recordRollbackStepStart(targetRoot, progress, installedStep);
    if (
      simulateApplyFailureAfter != null &&
      progress.completedOperationCount >= simulateApplyFailureAfter
    ) {
      throw new Error('Simulated rollback apply failure');
    }
    const installedSrc = path.join(targetRoot, base, 'installed-manifest.json');
    const installedContent = fs.readFileSync(installedSrc, 'utf8');
    atomicWriteFile(targetRoot, '.cursor/aecs/installed-manifest.json', installedContent);
    written.push('.cursor/aecs/installed-manifest.json');
    recordRollbackStepSuccess(targetRoot, progress, installedStep);

    const ownershipSrc = path.join(targetRoot, base, 'ownership.json');
    if (fs.existsSync(ownershipSrc)) {
      const ownershipStep = {
        action: 'restore-record',
        relPath: '.cursor/aecs/ownership.json',
      };
      recordRollbackStepStart(targetRoot, progress, ownershipStep);
      if (
        simulateApplyFailureAfter != null &&
        progress.completedOperationCount >= simulateApplyFailureAfter
      ) {
        throw new Error('Simulated rollback apply failure');
      }
      const ownershipContent = fs.readFileSync(ownershipSrc, 'utf8');
      atomicWriteFile(targetRoot, '.cursor/aecs/ownership.json', ownershipContent);
      written.push('.cursor/aecs/ownership.json');
      recordRollbackStepSuccess(targetRoot, progress, ownershipStep);
    }

    markRollbackPendingVerify(targetRoot, progress);

    return {
      ok: true,
      transactionId,
      rollbackTransactionId: progress.rollbackTransactionId,
      written,
      changes: plan.changes,
      dryRun: false,
      rollbackProgress: readRollbackInProgress(targetRoot),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const atOperation = progress.currentOperation
      ? rollbackOperationId(progress.currentOperation.action, progress.currentOperation.relPath)
      : progress.lastSuccessfulStep ?? undefined;
    markRollbackFailed(targetRoot, progress, message, atOperation);
    return {
      ok: false,
      transactionId,
      rollbackTransactionId: progress.rollbackTransactionId,
      blocks: [message],
      changes: plan.changes,
      written,
      dryRun: false,
      applyFailed: true,
      partialFailure: true,
      rollbackProgress: readRollbackInProgress(targetRoot),
      lastSuccessfulStep: progress.lastSuccessfulStep,
    };
  }
}

/**
 * @param {string} targetRoot
 * @param {string} transactionId
 * @param {string} relPath
 */
export function readBackupFile(targetRoot, transactionId, relPath) {
  let abs;
  try {
    abs = resolveBackupFileAbs(targetRoot, transactionId, relPath);
  } catch {
    return null;
  }
  if (!fs.existsSync(abs)) {
    return null;
  }
  return fs.readFileSync(abs, 'utf8');
}
