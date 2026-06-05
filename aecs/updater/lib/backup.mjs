import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteFile } from '../../installer/lib/fs-safe.mjs';
import { sha256File } from '../../installer/lib/hash.mjs';
import { assertNoSymlinkEscape, normalizeRel, resolveUnderRoot } from '../../installer/lib/paths.mjs';
import { BACKUP_MANIFEST_SCHEMA, BACKUPS_REL } from './constants.mjs';
import { isValidTransactionId } from './transaction.mjs';

/**
 * Collapse . segments and backslashes for backup path keys.
 * @param {string} relPath
 */
function normalizeBackupRel(relPath) {
  return path.posix.normalize(normalizeRel(relPath));
}

/**
 * Preserve relative directory structure under files/ (collision-free vs flat __ encoding).
 * @param {string} relPath
 */
export function backupFileRel(relPath) {
  const norm = normalizeBackupRel(relPath);
  if (!norm || norm === '.' || norm === '..') {
    throw new Error(`Invalid backup path: ${relPath}`);
  }
  if (path.isAbsolute(norm) || norm.includes('..') || norm.startsWith('/')) {
    throw new Error(`Invalid backup path: ${relPath}`);
  }
  return `files/${norm}`;
}

/**
 * @param {string} relPath
 * @deprecated Use backupFileRel — flat __ encoding collides (a/b vs a__b).
 */
export function encodeBackupPath(relPath) {
  return backupFileRel(relPath).slice('files/'.length);
}

/**
 * @param {string} transactionId
 */
function assertValidBackupTransactionId(transactionId) {
  if (!isValidTransactionId(transactionId)) {
    throw new Error(`Invalid transaction id: ${transactionId}`);
  }
}

/**
 * @param {string} targetRoot
 * @param {string} transactionId
 */
export function backupDirRel(transactionId) {
  assertValidBackupTransactionId(transactionId);
  return `${BACKUPS_REL}/${transactionId}`;
}

/**
 * @param {string} targetRoot
 * @param {string} transactionId
 * @param {string} relPath
 */
export function resolveBackupFileAbs(targetRoot, transactionId, relPath) {
  const destRel = `${backupDirRel(transactionId)}/${backupFileRel(relPath)}`;
  const abs = resolveUnderRoot(targetRoot, destRel);
  assertNoSymlinkEscape(targetRoot, abs);
  return abs;
}

/**
 * @param {string} targetRoot
 * @param {string} transactionId
 */
export function resolveBackupDirAbs(targetRoot, transactionId) {
  const rel = backupDirRel(transactionId);
  const abs = resolveUnderRoot(targetRoot, rel);
  assertNoSymlinkEscape(targetRoot, abs);
  return abs;
}

/**
 * @param {string} normPath
 */
function pathKey(normPath) {
  return process.platform === 'win32' ? normPath.toLowerCase() : normPath;
}

/**
 * @param {object} opts
 * @param {string} opts.targetRoot
 * @param {string} opts.transactionId
 * @param {string[]} [opts.filePaths]
 * @param {Array<{relPath: string, required?: boolean, reason?: string}>} [opts.fileSpecs]
 * @param {Record<string, unknown>} opts.installed
 * @param {Record<string, unknown> | null} opts.ownership
 * @param {object} opts.version
 * @param {Record<string, unknown>} [opts.rollbackMetadata]
 * @param {boolean} [opts.simulateFailure]
 */
export function createVerifiedBackup(opts) {
  const {
    targetRoot,
    transactionId,
    filePaths,
    fileSpecs,
    installed,
    ownership,
    version,
    rollbackMetadata,
    simulateFailure,
  } = opts;

  if (!isValidTransactionId(transactionId)) {
    return { ok: false, reason: `Invalid transaction id: ${transactionId}`, transactionId };
  }

  const baseRel = backupDirRel(transactionId);
  resolveUnderRoot(targetRoot, baseRel);

  /** @type {Record<string, string>} */
  const checksums = {};
  /** @type {string[]} */
  const backedFiles = [];
  /** @type {Set<string>} */
  const seenPathKeys = new Set();
  /** @type {Set<string>} */
  const seenDestKeys = new Set();

  const specs =
    fileSpecs ??
    (filePaths ?? []).map((rel) => ({
      relPath: rel,
      required: true,
      reason: 'Backup source required',
    }));

  for (const spec of specs) {
    const norm = normalizeBackupRel(spec.relPath);
    const pk = pathKey(norm);
    if (seenPathKeys.has(pk)) {
      return {
        ok: false,
        reason: `Duplicate backup path: ${norm}`,
        transactionId,
      };
    }
    seenPathKeys.add(pk);

    const destRel = `${baseRel}/${backupFileRel(norm)}`;
    const dk = pathKey(destRel);
    if (seenDestKeys.has(dk)) {
      return {
        ok: false,
        reason: `Backup storage collision for ${norm}`,
        transactionId,
      };
    }
    seenDestKeys.add(dk);

    const abs = path.join(targetRoot, norm.replace(/\//g, path.sep));
    if (!fs.existsSync(abs)) {
      if (spec.required !== false) {
        return {
          ok: false,
          reason: `Missing required backup source: ${norm}${spec.reason ? ` (${spec.reason})` : ''}`,
          transactionId,
        };
      }
      continue;
    }
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      continue;
    }
    assertNoSymlinkEscape(targetRoot, abs);
    const hash = sha256File(abs);
    const content = fs.readFileSync(abs);
    atomicWriteFile(targetRoot, destRel, content.toString('utf8'));
    checksums[norm] = hash;
    backedFiles.push(norm);
  }

  const installedRel = `${baseRel}/installed-manifest.json`;
  const ownershipRel = `${baseRel}/ownership.json`;
  const checksumsRel = `${baseRel}/checksums.json`;

  atomicWriteFile(targetRoot, installedRel, `${JSON.stringify(installed, null, 2)}\n`);
  if (ownership) {
    atomicWriteFile(targetRoot, ownershipRel, `${JSON.stringify(ownership, null, 2)}\n`);
  }

  atomicWriteFile(targetRoot, checksumsRel, `${JSON.stringify(checksums, null, 2)}\n`);

  if (simulateFailure) {
    return { ok: false, reason: 'Simulated Backup failure', transactionId };
  }

  for (const rel of backedFiles) {
    const destAbs = resolveBackupFileAbs(targetRoot, transactionId, rel);
    const expected = checksums[rel];
    const actual = sha256File(destAbs);
    if (actual !== expected) {
      return { ok: false, reason: `Backup integrity failed for ${rel}`, transactionId };
    }
  }

  const manifest = {
    schemaVersion: BACKUP_MANIFEST_SCHEMA,
    transactionId,
    createdAt: new Date().toISOString(),
    installedVersion: version.installed,
    targetVersion: version.target,
    files: backedFiles,
    checksums,
    rollback: rollbackMetadata ?? null,
    audit: {
      operation: 'update',
      status: 'backup-verified',
      fileCount: backedFiles.length,
    },
  };

  atomicWriteFile(targetRoot, `${baseRel}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);

  return { ok: true, transactionId, manifest, backedFiles, checksums };
}

/**
 * @param {string} targetRoot
 * @param {string} transactionId
 */
export function loadBackupManifest(targetRoot, transactionId) {
  if (!isValidTransactionId(transactionId)) {
    throw new Error(`Invalid transaction id: ${transactionId}`);
  }
  const rel = `${backupDirRel(transactionId)}/manifest.json`;
  const abs = resolveUnderRoot(targetRoot, rel);
  if (!fs.existsSync(abs)) {
    throw new Error(`Backup not found: ${transactionId}`);
  }
  const raw = fs.readFileSync(abs, 'utf8');
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch {
    throw new Error(`Corrupt backup manifest: ${transactionId}`);
  }
  if (manifest.transactionId !== transactionId) {
    throw new Error(`Backup manifest transaction mismatch: ${transactionId}`);
  }
  return manifest;
}

/**
 * @param {string[]} files
 */
function validateManifestPathUniqueness(files) {
  /** @type {Set<string>} */
  const seen = new Set();
  for (const rel of files) {
    const norm = normalizeBackupRel(String(rel));
    const pk = pathKey(norm);
    if (seen.has(pk)) {
      return { ok: false, reason: `Duplicate path in backup manifest: ${norm}` };
    }
    seen.add(pk);
  }
  return { ok: true };
}

/**
 * @param {string} targetRoot
 * @param {string} transactionId
 */
export function validateBackupIntegrity(targetRoot, transactionId) {
  if (!isValidTransactionId(transactionId)) {
    return { ok: false, reason: `Invalid transaction id: ${transactionId}` };
  }

  let manifest;
  try {
    manifest = loadBackupManifest(targetRoot, transactionId);
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  const unique = validateManifestPathUniqueness(manifest.files ?? []);
  if (!unique.ok) {
    return unique;
  }

  const backupDir = resolveBackupDirAbs(targetRoot, transactionId);
  const checksumsPath = path.join(backupDir, 'checksums.json');
  if (!fs.existsSync(checksumsPath)) {
    return { ok: false, reason: 'Missing checksums.json' };
  }
  const checksums = JSON.parse(fs.readFileSync(checksumsPath, 'utf8'));

  for (const rel of manifest.files ?? []) {
    const norm = normalizeBackupRel(String(rel));
    let fileAbs;
    try {
      fileAbs = resolveBackupFileAbs(targetRoot, transactionId, norm);
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : `Invalid backup mapping for ${norm}`,
      };
    }
    if (!fs.existsSync(fileAbs)) {
      return { ok: false, reason: `Missing backup file: ${norm}` };
    }
    assertNoSymlinkEscape(targetRoot, fileAbs);
    const actual = sha256File(fileAbs);
    const expected = checksums[norm];
    if (!expected || actual !== expected) {
      return { ok: false, reason: `Checksum mismatch for ${norm}` };
    }
  }
  return { ok: true, manifest };
}

/**
 * @param {string} targetRoot
 */
export function listBackups(targetRoot) {
  const backupsAbs = path.join(targetRoot, BACKUPS_REL.replace(/\//g, path.sep));
  if (!fs.existsSync(backupsAbs)) {
    return [];
  }
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  for (const ent of fs.readdirSync(backupsAbs, { withFileTypes: true })) {
    if (!ent.isDirectory() || ent.name === '.gitkeep') {
      continue;
    }
    if (!isValidTransactionId(ent.name)) {
      continue;
    }
    try {
      const manifest = loadBackupManifest(targetRoot, ent.name);
      out.push(manifest);
    } catch {
      out.push({ transactionId: ent.name, corrupt: true });
    }
  }
  return out.sort((a, b) =>
    String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')),
  );
}
