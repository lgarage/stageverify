import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_OWNED_PREFIXES } from './constants.mjs';
import { sha256String } from './hash.mjs';
import { normalizeRel } from './paths.mjs';

/**
 * @param {string} relPath
 * @param {string[]} [projectOwnedGlobs]
 */
export function isProjectOwnedPath(relPath, projectOwnedGlobs = []) {
  const norm = normalizeRel(relPath);
  const all = [...PROJECT_OWNED_PREFIXES, ...projectOwnedGlobs.map((g) => g.replace(/\*\*/g, ''))];
  return all.some((prefix) => {
    const p = prefix.replace(/\*/g, '');
    return norm === p || norm.startsWith(p);
  });
}

/**
 * @typedef {object} CollisionResult
 * @property {'ok' | 'skip-identical' | 'block'} status
 * @property {string} [reason]
 * @property {'project-owned' | 'local-override' | 'ambiguous'} [kind]
 */

/**
 * @param {object} opts
 * @param {string} opts.targetRoot
 * @param {string} opts.relPath
 * @param {string} opts.plannedContent
 * @param {string[]} [opts.projectOwnedGlobs]
 * @param {Set<string>} [opts.installedRulePaths]
 * @param {string} [opts.installedRecordHash]
 */
export function analyzeCollision(opts) {
  const {
    targetRoot,
    relPath,
    plannedContent,
    projectOwnedGlobs,
    installedRulePaths,
    installedRecordHash,
  } = opts;
  const abs = path.join(targetRoot, relPath.replace(/\//g, path.sep));
  const plannedHash = sha256String(plannedContent);

  if (!fs.existsSync(abs)) {
    return /** @type {CollisionResult} */ ({ status: 'ok' });
  }

  const existing = fs.readFileSync(abs, 'utf8');
  const existingHash = sha256String(existing);

  if (existingHash === plannedHash) {
    return { status: 'skip-identical', reason: 'already installed (identical content)' };
  }

  if (isProjectOwnedPath(relPath, projectOwnedGlobs)) {
    return {
      status: 'block',
      kind: 'project-owned',
      reason: `Project-owned file differs: ${relPath}`,
    };
  }

  if (installedRulePaths?.has(normalizeRel(relPath))) {
    if (installedRecordHash && existingHash === installedRecordHash) {
      return { status: 'ok', reason: 'installed record matches disk — update may replace' };
    }
    return {
      status: 'block',
      kind: 'local-override',
      reason: `Locally modified AECS-installed file: ${relPath}`,
    };
  }

  return {
    status: 'block',
    kind: 'ambiguous',
    reason: `Existing file differs and ownership is ambiguous: ${relPath}`,
  };
}
