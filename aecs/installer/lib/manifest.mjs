import fs from 'node:fs';
import path from 'node:path';
import { sha256File } from './hash.mjs';

/**
 * @param {string} sourceRoot
 */
export function loadSourceManifest(sourceRoot) {
  const manifestPath = path.join(sourceRoot, 'aecs', 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Source manifest not found: ${manifestPath}`);
  }
  const raw = fs.readFileSync(manifestPath, 'utf8');
  /** @type {Record<string, unknown>} */
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid source manifest JSON: ${err instanceof Error ? err.message : err}`);
  }
  if (!manifest.aecsVersion || !Array.isArray(manifest.files)) {
    throw new Error('Source manifest missing required fields (aecsVersion, files[])');
  }
  for (const entry of manifest.files) {
    if (!entry.path || !entry.sha256) {
      throw new Error(`Manifest file entry missing path or sha256: ${JSON.stringify(entry)}`);
    }
    const abs = path.join(sourceRoot, entry.path.replace(/\//g, path.sep));
    if (!fs.existsSync(abs)) {
      throw new Error(`Manifest references missing file: ${entry.path}`);
    }
    const actual = sha256File(abs);
    if (actual !== entry.sha256) {
      throw new Error(
        `Manifest hash mismatch for ${entry.path}: expected ${entry.sha256}, got ${actual}`,
      );
    }
  }
  return { manifest, manifestPath, manifestSha256: sha256File(manifestPath) };
}

/**
 * @param {string} targetRoot
 */
export function loadInstalledManifest(targetRoot) {
  const p = path.join(targetRoot, '.cursor', 'aecs', 'installed-manifest.json');
  if (!fs.existsSync(p)) {
    return null;
  }
  const raw = fs.readFileSync(p, 'utf8');
  try {
    return /** @type {Record<string, unknown>} */ (JSON.parse(raw));
  } catch {
    throw new Error('installed-manifest.json is not valid JSON');
  }
}
