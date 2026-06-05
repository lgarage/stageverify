import fs from 'node:fs';
import path from 'node:path';
import {
  INSTALL_PROGRESS_REL,
  ROLLBACK_PROGRESS_REL,
  ROLLBACK_PROGRESS_SCHEMA,
  UPDATE_PROGRESS_REL,
} from './constants.mjs';
import { createTransactionId, isValidTransactionId } from './transaction.mjs';

/**
 * @param {string} targetRoot
 * @param {string} rel
 */
function progressAbs(targetRoot, rel) {
  return path.join(targetRoot, rel.replace(/\//g, path.sep));
}

/**
 * @param {string} targetRoot
 */
export function readInstallInProgress(targetRoot) {
  const abs = progressAbs(targetRoot, INSTALL_PROGRESS_REL);
  if (!fs.existsSync(abs)) {
    return null;
  }
  return fs.readFileSync(abs, 'utf8').trim();
}

/**
 * @param {string} targetRoot
 */
export function readUpdateInProgress(targetRoot) {
  const abs = progressAbs(targetRoot, UPDATE_PROGRESS_REL);
  if (!fs.existsSync(abs)) {
    return null;
  }
  const raw = fs.readFileSync(abs, 'utf8').trim();
  try {
    const parsed = JSON.parse(raw);
    return {
      transactionId: String(parsed.transactionId ?? ''),
      startedAt: String(parsed.startedAt ?? ''),
    };
  } catch {
    return { transactionId: raw, startedAt: '' };
  }
}

/**
 * @typedef {object} RollbackProgressRecord
 * @property {string} schemaVersion
 * @property {'rollback'} operation
 * @property {string} rollbackTransactionId
 * @property {string} sourceBackupTransactionId
 * @property {string} startedAt
 * @property {'in-progress'|'pending-verify'|'failed'|'verify-failed'} status
 * @property {number} plannedOperationCount
 * @property {number} completedOperationCount
 * @property {string[]} completedOperationIds
 * @property {{ action: string, relPath: string } | null} [currentOperation]
 * @property {string | null} lastSuccessfulStep
 * @property {{ status: string, error: string, atOperation?: string } | null} [failure]
 * @property {string} recoveryGuidance
 */

/**
 * @param {unknown} parsed
 * @returns {RollbackProgressRecord | null}
 */
export function parseRollbackProgressRecord(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  const rec = /** @type {Record<string, unknown>} */ (parsed);
  if (rec.operation !== 'rollback') {
    return null;
  }
  const rollbackTransactionId = String(rec.rollbackTransactionId ?? '');
  const sourceBackupTransactionId = String(rec.sourceBackupTransactionId ?? '');
  if (!isValidTransactionId(rollbackTransactionId) || !isValidTransactionId(sourceBackupTransactionId)) {
    return null;
  }
  const status = String(rec.status ?? '');
  if (!['in-progress', 'pending-verify', 'failed', 'verify-failed'].includes(status)) {
    return null;
  }
  return {
    schemaVersion: String(rec.schemaVersion ?? ''),
    operation: 'rollback',
    rollbackTransactionId,
    sourceBackupTransactionId,
    startedAt: String(rec.startedAt ?? ''),
    status: /** @type {RollbackProgressRecord['status']} */ (status),
    plannedOperationCount: Number(rec.plannedOperationCount ?? 0),
    completedOperationCount: Number(rec.completedOperationCount ?? 0),
    completedOperationIds: Array.isArray(rec.completedOperationIds)
      ? rec.completedOperationIds.map((id) => String(id))
      : [],
    currentOperation:
      rec.currentOperation && typeof rec.currentOperation === 'object'
        ? {
            action: String(
              /** @type {Record<string, unknown>} */ (rec.currentOperation).action ?? '',
            ),
            relPath: String(
              /** @type {Record<string, unknown>} */ (rec.currentOperation).relPath ?? '',
            ),
          }
        : null,
    lastSuccessfulStep:
      rec.lastSuccessfulStep == null ? null : String(rec.lastSuccessfulStep),
    failure:
      rec.failure && typeof rec.failure === 'object'
        ? {
            status: String(/** @type {Record<string, unknown>} */ (rec.failure).status ?? 'failed'),
            error: String(/** @type {Record<string, unknown>} */ (rec.failure).error ?? ''),
            atOperation:
              /** @type {Record<string, unknown>} */ (rec.failure).atOperation == null
                ? undefined
                : String(/** @type {Record<string, unknown>} */ (rec.failure).atOperation),
          }
        : null,
    recoveryGuidance: String(rec.recoveryGuidance ?? ''),
  };
}

/**
 * @param {string} targetRoot
 * @returns {RollbackProgressRecord | { malformed: true, raw: string } | null}
 */
export function readRollbackInProgress(targetRoot) {
  const abs = progressAbs(targetRoot, ROLLBACK_PROGRESS_REL);
  if (!fs.existsSync(abs)) {
    return null;
  }
  const raw = fs.readFileSync(abs, 'utf8').trim();
  try {
    const parsed = parseRollbackProgressRecord(JSON.parse(raw));
    if (!parsed) {
      return { malformed: true, raw };
    }
    return parsed;
  } catch {
    return { malformed: true, raw };
  }
}

/**
 * @param {RollbackProgressRecord | { malformed: true } | null} record
 */
export function isRollbackIncomplete(record) {
  if (!record) {
    return false;
  }
  if ('malformed' in record && record.malformed) {
    return true;
  }
  const status = /** @type {RollbackProgressRecord} */ (record).status;
  return (
    status === 'in-progress' ||
    status === 'pending-verify' ||
    status === 'failed' ||
    status === 'verify-failed'
  );
}

/**
 * @param {string} targetRoot
 */
export function checkInstallAllowed(targetRoot) {
  const installProgress = readInstallInProgress(targetRoot);
  if (installProgress) {
    return {
      ok: false,
      reason: `Install in progress (${INSTALL_PROGRESS_REL}) — resolve partial install before installing`,
      kind: 'install-in-progress',
    };
  }

  const rollbackProgress = readRollbackInProgress(targetRoot);
  if (rollbackProgress && ('malformed' in rollbackProgress || isRollbackIncomplete(rollbackProgress))) {
    const txn =
      'malformed' in rollbackProgress
        ? 'malformed'
        : rollbackProgress.rollbackTransactionId;
    return {
      ok: false,
      reason: `Incomplete rollback (${ROLLBACK_PROGRESS_REL}, rollback ${txn}) — resolve before install write`,
      kind: 'rollback-incomplete',
    };
  }

  const updateProgress = readUpdateInProgress(targetRoot);
  if (updateProgress?.transactionId) {
    return {
      ok: false,
      reason: `Update in progress (${UPDATE_PROGRESS_REL}, transaction ${updateProgress.transactionId}) — complete, rollback, or remove stale sentinel before installing`,
      kind: 'update-in-progress',
      transactionId: updateProgress.transactionId,
    };
  }

  return { ok: true };
}

/**
 * Fail-closed check before update plan/apply.
 * Race window: another process may start between check and write — documented limitation.
 *
 * @param {string} targetRoot
 */
export function checkUpdateAllowed(targetRoot) {
  const installProgress = readInstallInProgress(targetRoot);
  if (installProgress) {
    return {
      ok: false,
      reason: `Install in progress (${INSTALL_PROGRESS_REL}) — resolve partial install before updating`,
      kind: 'install-in-progress',
    };
  }

  const rollbackProgress = readRollbackInProgress(targetRoot);
  if (rollbackProgress && ('malformed' in rollbackProgress || isRollbackIncomplete(rollbackProgress))) {
    const txn =
      'malformed' in rollbackProgress
        ? 'malformed'
        : rollbackProgress.rollbackTransactionId;
    return {
      ok: false,
      reason: `Incomplete rollback (${ROLLBACK_PROGRESS_REL}, rollback ${txn}) — resolve before update write`,
      kind: 'rollback-incomplete',
    };
  }

  const updateProgress = readUpdateInProgress(targetRoot);
  if (updateProgress?.transactionId) {
    return {
      ok: false,
      reason: `Update in progress (${UPDATE_PROGRESS_REL}, transaction ${updateProgress.transactionId}) — complete, rollback, or remove stale sentinel before updating`,
      kind: 'update-in-progress',
      transactionId: updateProgress.transactionId,
    };
  }

  return { ok: true };
}

/**
 * Rollback may proceed when update-in-progress matches the backup transaction,
 * or when no update-in-progress sentinel is present (completed update rollback).
 * Blocks when another rollback is incomplete (no silent restart).
 *
 * @param {string} targetRoot
 * @param {string} transactionId source backup transaction id
 * @param {boolean} [writeMode]
 */
export function checkRollbackAllowed(targetRoot, transactionId, writeMode = false) {
  const installProgress = readInstallInProgress(targetRoot);
  if (installProgress) {
    return {
      ok: false,
      reason: `Install in progress (${INSTALL_PROGRESS_REL}) — resolve partial install before rollback`,
      kind: 'install-in-progress',
    };
  }

  const rollbackProgress = readRollbackInProgress(targetRoot);
  if (rollbackProgress) {
    if ('malformed' in rollbackProgress) {
      if (writeMode) {
        return {
          ok: false,
          reason: `Malformed rollback-in-progress record — resolve manually before rollback write`,
          kind: 'rollback-malformed',
        };
      }
    } else if (isRollbackIncomplete(rollbackProgress)) {
      if (writeMode) {
        return {
          ok: false,
          reason: `Rollback incomplete (rollback ${rollbackProgress.rollbackTransactionId}, last step ${rollbackProgress.lastSuccessfulStep ?? 'none'}) — resolve before new rollback write`,
          kind: 'rollback-incomplete',
          rollbackTransactionId: rollbackProgress.rollbackTransactionId,
          sourceBackupTransactionId: rollbackProgress.sourceBackupTransactionId,
          lastSuccessfulStep: rollbackProgress.lastSuccessfulStep,
        };
      }
    }
  }

  const updateProgress = readUpdateInProgress(targetRoot);
  if (updateProgress?.transactionId) {
    if (updateProgress.transactionId !== transactionId) {
      return {
        ok: false,
        reason: `Update in progress for transaction ${updateProgress.transactionId} — cannot rollback ${transactionId}`,
        kind: 'update-in-progress-mismatch',
      };
    }
    if (!isValidTransactionId(transactionId)) {
      return {
        ok: false,
        reason: `Invalid transaction id: ${transactionId}`,
        kind: 'invalid-transaction',
      };
    }
  }

  return { ok: true };
}

/**
 * @param {string} targetRoot
 * @param {string} transactionId
 */
export function writeUpdateInProgress(targetRoot, transactionId) {
  const payload = {
    transactionId,
    startedAt: new Date().toISOString(),
  };
  const abs = progressAbs(targetRoot, UPDATE_PROGRESS_REL);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(payload, null, 2)}\n`);
}

/**
 * @param {string} targetRoot
 */
export function clearUpdateInProgress(targetRoot) {
  const abs = progressAbs(targetRoot, UPDATE_PROGRESS_REL);
  if (fs.existsSync(abs)) {
    fs.unlinkSync(abs);
  }
}

/**
 * @param {string} action
 * @param {string} relPath
 */
export function rollbackOperationId(action, relPath) {
  return `${action}:${relPath}`;
}

/**
 * @param {object} opts
 * @param {string} opts.targetRoot
 * @param {string} opts.sourceBackupTransactionId
 * @param {number} opts.plannedOperationCount
 * @param {string} [opts.rollbackTransactionId]
 */
export function writeRollbackInProgress(opts) {
  const rollbackTransactionId = opts.rollbackTransactionId ?? createTransactionId();
  /** @type {RollbackProgressRecord} */
  const record = {
    schemaVersion: ROLLBACK_PROGRESS_SCHEMA,
    operation: 'rollback',
    rollbackTransactionId,
    sourceBackupTransactionId: opts.sourceBackupTransactionId,
    startedAt: new Date().toISOString(),
    status: 'in-progress',
    plannedOperationCount: opts.plannedOperationCount,
    completedOperationCount: 0,
    completedOperationIds: [],
    currentOperation: null,
    lastSuccessfulStep: null,
    failure: null,
    recoveryGuidance:
      'Rollback in progress — do not run install/update/rollback write until resolved. Inspect record; manual cleanup required after failure (no auto-resume).',
  };
  persistRollbackProgress(opts.targetRoot, record);
  return record;
}

/**
 * @param {string} targetRoot
 * @param {RollbackProgressRecord} record
 */
function persistRollbackProgress(targetRoot, record) {
  const abs = progressAbs(targetRoot, ROLLBACK_PROGRESS_REL);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(record, null, 2)}\n`);
}

/**
 * @param {string} targetRoot
 * @param {RollbackProgressRecord} record
 * @param {object} step
 * @param {string} step.action
 * @param {string} step.relPath
 */
export function recordRollbackStepSuccess(targetRoot, record, step) {
  const opId = rollbackOperationId(step.action, step.relPath);
  record.completedOperationIds.push(opId);
  record.completedOperationCount = record.completedOperationIds.length;
  record.lastSuccessfulStep = opId;
  record.currentOperation = null;
  persistRollbackProgress(targetRoot, record);
}

/**
 * @param {string} targetRoot
 * @param {RollbackProgressRecord} record
 * @param {{ action: string, relPath: string }} step
 */
export function recordRollbackStepStart(targetRoot, record, step) {
  record.currentOperation = step;
  persistRollbackProgress(targetRoot, record);
}

/**
 * @param {string} targetRoot
 * @param {RollbackProgressRecord} record
 */
export function markRollbackPendingVerify(targetRoot, record) {
  record.status = 'pending-verify';
  record.currentOperation = null;
  record.recoveryGuidance =
    'Rollback file mutations complete — pending verify. If verify fails, inspect and resolve manually; no auto-resume.';
  persistRollbackProgress(targetRoot, record);
}

/**
 * @param {string} targetRoot
 * @param {RollbackProgressRecord} record
 * @param {string} error
 * @param {string} [atOperation]
 */
export function markRollbackFailed(targetRoot, record, error, atOperation) {
  record.status = 'failed';
  record.failure = {
    status: 'failed',
    error,
    atOperation,
  };
  record.currentOperation = null;
  record.recoveryGuidance =
    'Rollback failed mid-apply — partial state possible. Inspect rollback-in-progress, fix drift, remove sentinel manually after recovery. No auto-resume.';
  persistRollbackProgress(targetRoot, record);
}

/**
 * @param {string} targetRoot
 * @param {RollbackProgressRecord} record
 * @param {string} error
 */
export function markRollbackVerifyFailed(targetRoot, record, error) {
  record.status = 'verify-failed';
  record.failure = {
    status: 'verify-failed',
    error,
  };
  record.recoveryGuidance =
    'Rollback apply completed but verify failed — inspect findings, resolve manually, remove sentinel after recovery.';
  persistRollbackProgress(targetRoot, record);
}

/**
 * @param {string} targetRoot
 */
export function clearRollbackInProgress(targetRoot) {
  const abs = progressAbs(targetRoot, ROLLBACK_PROGRESS_REL);
  if (fs.existsSync(abs)) {
    fs.unlinkSync(abs);
  }
}
