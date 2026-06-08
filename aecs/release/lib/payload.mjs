import fs from 'node:fs';
import path from 'node:path';
import { assertNoSymlinkEscape } from '../../installer/lib/paths.mjs';

/** Top-level aecs/ children included in a portable release. */
export const RELEASE_TOP_LEVEL = [
  'manifest.json',
  'core',
  'adapters',
  'installer',
  'updater',
  'release',
];

/** Never ship Layer 2 dev memory or dev-only examples to targets. */
export const RELEASE_EXCLUDED_DIRS = new Set(['dev', 'examples']);

/** Active adapter bindings are project-owned — ship template only from adapters/. */
export const RELEASE_EXCLUDED_ADAPTER_SUFFIX = '.bindings.json';

/**
 * @param {string} relFromRepo e.g. aecs/adapters/foo.bindings.json
 */
export function isExcludedAdapterBinding(relFromRepo) {
  const norm = relFromRepo.replace(/\\/g, '/');
  return norm.startsWith('aecs/adapters/') && norm.endsWith(RELEASE_EXCLUDED_ADAPTER_SUFFIX);
}

/**
 * @param {string} sourceRoot - AECS host repo root (parent of aecs/)
 * @returns {{ relPath: string, absPath: string, kind: 'file' | 'dir' }[]}
 */
export function buildReleaseFileList(sourceRoot) {
  const aecsRoot = path.join(sourceRoot, 'aecs');
  if (!fs.existsSync(aecsRoot)) {
    throw new Error(`aecs/ not found under source root: ${sourceRoot}`);
  }

  /** @type {{ relPath: string, absPath: string, kind: 'file' | 'dir' }[]} */
  const entries = [];

  for (const top of RELEASE_TOP_LEVEL) {
    const abs = path.join(aecsRoot, top);
    if (!fs.existsSync(abs)) {
      throw new Error(`Required release path missing: aecs/${top}`);
    }
    collectEntries(aecsRoot, `aecs/${top}`, abs, entries);
  }

  return entries.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

/**
 * @param {string} aecsRoot
 * @param {string} relFromRepo
 * @param {string} abs
 * @param {{ relPath: string, absPath: string, kind: 'file' | 'dir' }[]} out
 */
function collectEntries(aecsRoot, relFromRepo, abs, out) {
  try {
    assertNoSymlinkEscape(aecsRoot, abs);
  } catch (err) {
    throw new Error(
      `Source symlink escape in payload: ${relFromRepo} — ${err instanceof Error ? err.message : err}`,
    );
  }
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) {
    const parts = relFromRepo.split('/');
    const dirName = parts[parts.length - 1] ?? '';
    if (RELEASE_EXCLUDED_DIRS.has(dirName)) {
      return;
    }
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      collectEntries(
        aecsRoot,
        `${relFromRepo}/${ent.name}`,
        path.join(abs, ent.name),
        out,
      );
    }
    return;
  }

  const rel = relFromRepo.replace(/\\/g, '/');
  if (isExcludedAdapterBinding(rel)) {
    return;
  }

  out.push({
    relPath: rel,
    absPath: abs,
    kind: 'file',
  });
}

/**
 * @param {{ relPath: string, absPath: string, kind: 'file' | 'dir' }[]} files
 */
export function countReleaseFiles(files) {
  return files.filter((f) => f.kind === 'file').length;
}
