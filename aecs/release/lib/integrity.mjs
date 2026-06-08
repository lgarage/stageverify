import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sha256File, sha256String } from '../../installer/lib/hash.mjs';
import { assertNoSymlinkEscape } from '../../installer/lib/paths.mjs';

/**
 * @param {{ relPath: string, absPath: string, kind: 'file' }[]} files
 */
export function buildPayloadHashes(files) {
  return files
    .filter((f) => f.kind === 'file')
    .map((f) => ({
      path: f.relPath.replace(/\\/g, '/'),
      sha256: sha256File(f.absPath),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * @param {{ path: string, sha256: string }[]} hashes
 */
export function computePayloadDigest(hashes) {
  const lines = hashes.map((h) => `${h.path}\t${h.sha256}`).join('\n');
  return sha256String(lines);
}

/**
 * @param {string} outputRoot
 */
export function assertExportOutputWritable(outputRoot) {
  const meta = path.join(outputRoot, 'release-metadata.json');
  const aecsDir = path.join(outputRoot, 'aecs');
  const incomplete = path.join(outputRoot, '.export-incomplete');
  if (fs.existsSync(meta) || fs.existsSync(aecsDir) || fs.existsSync(incomplete)) {
    throw new Error(
      'Export output already exists or prior export was incomplete; use an empty directory',
    );
  }
}

/**
 * @param {string} sourceRoot Export directory root (contains aecs/ + release-metadata.json)
 */
export function verifyReleasePackage(sourceRoot) {
  const root = path.resolve(sourceRoot);
  const metaPath = path.join(root, 'release-metadata.json');
  if (!fs.existsSync(metaPath)) {
    throw new Error(`release-metadata.json missing in export: ${root}`);
  }

  /** @type {Record<string, unknown>} */
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch (err) {
    throw new Error(`Invalid release-metadata.json: ${err instanceof Error ? err.message : err}`);
  }

  if (meta.signed !== false) {
    throw new Error('release-metadata.json must declare signed: false');
  }

  const files = Array.isArray(meta.files) ? meta.files : [];
  /** @type {string[]} */
  const errors = [];

  for (const entry of files) {
    const rel = String(entry.path ?? '');
    const expected = String(entry.sha256 ?? '');
    if (!rel || !expected) {
      errors.push(`Invalid file entry in release-metadata: ${JSON.stringify(entry)}`);
      continue;
    }
    const abs = path.join(root, rel.replace(/\//g, path.sep));
    try {
      assertNoSymlinkEscape(root, abs);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
      continue;
    }
    if (!fs.existsSync(abs)) {
      errors.push(`Exported file missing: ${rel}`);
      continue;
    }
    const actual = sha256File(abs);
    if (actual !== expected) {
      errors.push(`Hash mismatch for ${rel}`);
    }
  }

  const recordedDigest = meta.payloadDigest;
  if (typeof recordedDigest !== 'string' || !recordedDigest) {
    errors.push('release-metadata.json missing required payloadDigest');
  } else {
    const computedDigest = computePayloadDigest(
      files.map((f) => ({ path: String(f.path), sha256: String(f.sha256) })),
    );
    if (recordedDigest !== computedDigest) {
      errors.push('payloadDigest mismatch in release-metadata.json');
    }
  }

  if (errors.length) {
    throw new Error(errors.join('; '));
  }

  return { ok: true, meta, fileCount: files.length };
}

/**
 * Remove partial export artifacts after failure.
 * @param {string} outputRoot
 * @param {string[]} copiedAbsPaths
 */
export function cleanupPartialExport(outputRoot, copiedAbsPaths) {
  for (const abs of copiedAbsPaths) {
    try {
      if (fs.existsSync(abs)) {
        fs.unlinkSync(abs);
      }
    } catch {
      // best effort
    }
  }
  try {
    const marker = path.join(outputRoot, '.export-incomplete');
    fs.writeFileSync(
      marker,
      JSON.stringify({ at: new Date().toISOString(), reason: 'export failed mid-write' }, null, 2),
    );
  } catch {
    // best effort
  }
}
