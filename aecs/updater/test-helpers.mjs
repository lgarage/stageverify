import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sha256File } from '../installer/lib/hash.mjs';

/**
 * @param {string} [prefix]
 */
export function makeTempRepo(prefix = 'aecs-update-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  return dir;
}

/**
 * Copy aecs payload from host to temp source root.
 * @param {string} hostRoot
 * @param {string} destRoot - becomes source root (contains aecs/)
 */
export function cloneAecsSource(hostRoot, destRoot) {
  const srcAecs = path.join(hostRoot, 'aecs');
  const destAecs = path.join(destRoot, 'aecs');
  fs.mkdirSync(destAecs, { recursive: true });

  function copyTree(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, ent.name);
      const d = path.join(dest, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'dev' || ent.name === 'installer' || ent.name === 'updater') {
          continue;
        }
        copyTree(s, d);
      } else {
        fs.copyFileSync(s, d);
      }
    }
  }
  copyTree(srcAecs, destAecs);
  return destRoot;
}

/**
 * @param {string} sourceRoot
 */
export function readManifest(sourceRoot) {
  const p = path.join(sourceRoot, 'aecs', 'manifest.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/**
 * @param {string} sourceRoot
 * @param {Record<string, unknown>} manifest
 */
export function writeManifest(sourceRoot, manifest) {
  const p = path.join(sourceRoot, 'aecs', 'manifest.json');
  fs.writeFileSync(p, `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * Recompute sha256 entries in manifest from disk.
 * @param {string} sourceRoot
 */
export function refreshManifestHashes(sourceRoot) {
  const manifest = readManifest(sourceRoot);
  for (const entry of manifest.files) {
    const abs = path.join(sourceRoot, entry.path.replace(/\//g, path.sep));
    entry.sha256 = sha256File(abs);
  }
  writeManifest(sourceRoot, manifest);
  return manifest;
}

/**
 * @param {string} sourceRoot
 * @param {string} relPath under aecs/
 * @param {string} append
 */
export function mutateCoreFile(sourceRoot, relPath, append) {
  const abs = path.join(sourceRoot, relPath.replace(/\//g, path.sep));
  fs.appendFileSync(abs, append);
  return refreshManifestHashes(sourceRoot);
}

/**
 * @param {string} sourceRoot
 * @param {string} version
 */
export function bumpSourceVersion(sourceRoot, version) {
  const manifest = readManifest(sourceRoot);
  manifest.aecsVersion = version;
  writeManifest(sourceRoot, manifest);
  return manifest;
}

/**
 * @param {string} sourceRoot
 * @param {string} relPath e.g. aecs/core/schemas/extra.schema.json
 * @param {string} content
 */
export function addManifestFile(sourceRoot, relPath, content) {
  const abs = path.join(sourceRoot, relPath.replace(/\//g, path.sep));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  const manifest = readManifest(sourceRoot);
  manifest.files.push({
    path: relPath,
    layer: 1,
    sha256: sha256File(abs),
    installedAs: null,
    behaviorImpact: 'none',
  });
  writeManifest(sourceRoot, manifest);
  return manifest;
}

/**
 * @param {string} sourceRoot
 * @param {string} relPath
 */
export function removeManifestFile(sourceRoot, relPath) {
  const manifest = readManifest(sourceRoot);
  manifest.files = manifest.files.filter((f) => f.path !== relPath);
  const abs = path.join(sourceRoot, relPath.replace(/\//g, path.sep));
  if (fs.existsSync(abs)) {
    fs.unlinkSync(abs);
  }
  writeManifest(sourceRoot, manifest);
  return manifest;
}

/**
 * @param {string} dir
 */
export function listAllFiles(dir) {
  /** @type {string[]} */
  const out = [];
  function walk(d) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, ent.name);
      if (ent.isDirectory()) {
        walk(abs);
      } else {
        out.push(path.relative(dir, abs).replace(/\\/g, '/'));
      }
    }
  }
  if (fs.existsSync(dir)) {
    walk(dir);
  }
  return out.sort();
}

/**
 * @param {string} hostRoot
 * @param {string} version
 * @param {(sourceRoot: string) => void} [mutator]
 */
export function makeSourceVariant(hostRoot, version, mutator) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aecs-src-'));
  cloneAecsSource(hostRoot, tmp);
  bumpSourceVersion(tmp, version);
  if (mutator) {
    mutator(tmp);
    refreshManifestHashes(tmp);
  }
  return tmp;
}

/**
 * Move a core manifest file to projectOwned (ownership transition test helper).
 * @param {string} sourceRoot
 * @param {string} relPath
 */
export function shiftFileToProjectOwned(sourceRoot, relPath) {
  const manifest = readManifest(sourceRoot);
  manifest.files = manifest.files.filter((f) => f.path !== relPath);
  if (!Array.isArray(manifest.projectOwned)) {
    manifest.projectOwned = [];
  }
  if (!manifest.projectOwned.includes(relPath)) {
    manifest.projectOwned.push(relPath);
  }
  writeManifest(sourceRoot, manifest);
  return manifest;
}
