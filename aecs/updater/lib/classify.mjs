import fs from 'node:fs';
import path from 'node:path';
import { isProjectOwnedPath } from '../../installer/lib/collision.mjs';
import { sha256File, sha256String } from '../../installer/lib/hash.mjs';
import { normalizeRel } from '../../installer/lib/paths.mjs';
import { evaluateOwnershipPolicy, lookupOwnership } from './ownership.mjs';

/**
 * @typedef {'aecs-owned' | 'generated' | 'project-owned' | 'local-override' | 'adapter-regenerated' | 'new' | 'removed' | 'unchanged' | 'ownership-changed' | 'unknown'} FileClassification
 */

/**
 * @typedef {object} ClassifiedChange
 * @property {string} relPath
 * @property {FileClassification} classification
 * @property {'auto' | 'block' | 'skip'} disposition
 * @property {string} [reason]
 * @property {string} [installedHash]
 * @property {string} [diskHash]
 * @property {string} [plannedHash]
 * @property {'write' | 'delete' | 'skip'} [action]
 */

/**
 * @param {string} targetRoot
 * @param {string} relPath
 */
function diskHash(targetRoot, relPath) {
  const abs = path.join(targetRoot, relPath.replace(/\//g, path.sep));
  if (!fs.existsSync(abs)) {
    return null;
  }
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) {
    return null;
  }
  return sha256File(abs);
}

/**
 * @param {object} opts
 * @param {string} opts.targetRoot
 * @param {string} opts.relPath
 * @param {string | null} opts.installedHash
 * @param {string | null} opts.plannedHash
 * @param {Record<string, unknown> | null} opts.ownership
 * @param {string[]} opts.projectOwnedGlobs
 * @param {boolean} opts.isNew
 * @param {boolean} opts.isRemoved
 * @param {string | null} [opts.priorOwnership]
 * @param {string | null} [opts.targetOwnership]
 */
export function classifyFileChange(opts) {
  const {
    targetRoot,
    relPath,
    installedHash,
    plannedHash,
    ownership,
    projectOwnedGlobs,
    isNew,
    isRemoved,
    priorOwnership,
    targetOwnership,
  } = opts;

  const norm = normalizeRel(relPath);
  const registryOwnership = lookupOwnership(ownership, norm);
  const onDisk = diskHash(targetRoot, norm);

  const mutationPlanned =
    isNew ||
    isRemoved ||
    Boolean(plannedHash && installedHash && plannedHash !== installedHash) ||
    Boolean(plannedHash && !installedHash);

  const ownershipCheck = evaluateOwnershipPolicy({
    relPath: norm,
    priorOwnership: priorOwnership ?? registryOwnership,
    targetOwnership: targetOwnership ?? registryOwnership,
    mutationPlanned,
    inPriorInstall: Boolean(installedHash),
    isNew,
    isRemoved,
  });

  if (ownershipCheck.block) {
    return /** @type {ClassifiedChange} */ ({
      relPath: norm,
      classification: 'ownership-changed',
      disposition: 'block',
      reason: ownershipCheck.reason ?? `Ownership policy blocked: ${norm}`,
      installedHash: installedHash ?? undefined,
      diskHash: onDisk ?? undefined,
      plannedHash: plannedHash ?? undefined,
    });
  }

  if (isRemoved) {
    if (onDisk && installedHash && onDisk !== installedHash) {
      return {
        relPath: norm,
        classification: 'local-override',
        disposition: 'block',
        reason: `Locally modified file would be removed: ${norm}`,
        installedHash,
        diskHash: onDisk,
      };
    }
    return {
      relPath: norm,
      classification: 'removed',
      disposition: 'auto',
      action: 'delete',
      reason: 'Obsolete AECS-owned file removed after backup',
      installedHash: installedHash ?? undefined,
      diskHash: onDisk ?? undefined,
    };
  }

  if (isNew) {
    if (isProjectOwnedPath(norm, projectOwnedGlobs) && onDisk) {
      return {
        relPath: norm,
        classification: 'project-owned',
        disposition: 'block',
        reason: `Project-owned collision on new path: ${norm}`,
        diskHash: onDisk,
        plannedHash: plannedHash ?? undefined,
      };
    }
    return {
      relPath: norm,
      classification: 'new',
      disposition: 'auto',
      action: 'write',
      reason: 'New AECS-owned file',
      plannedHash: plannedHash ?? undefined,
    };
  }

  if (plannedHash && installedHash && plannedHash === installedHash) {
    if (onDisk && onDisk !== installedHash) {
      return {
        relPath: norm,
        classification: 'local-override',
        disposition: 'block',
        reason: `Locally modified AECS-installed file: ${norm}`,
        installedHash,
        diskHash: onDisk,
        plannedHash,
      };
    }
    return {
      relPath: norm,
      classification: 'unchanged',
      disposition: 'skip',
      action: 'skip',
      installedHash,
      diskHash: onDisk ?? undefined,
      plannedHash,
    };
  }

  if (isProjectOwnedPath(norm, projectOwnedGlobs)) {
    return {
      relPath: norm,
      classification: 'project-owned',
      disposition: 'block',
      reason: `Project-owned file differs: ${norm}`,
      installedHash: installedHash ?? undefined,
      diskHash: onDisk ?? undefined,
      plannedHash: plannedHash ?? undefined,
    };
  }

  if (installedHash && onDisk && onDisk !== installedHash) {
    return {
      relPath: norm,
      classification: 'local-override',
      disposition: 'block',
      reason: `Locally modified AECS-installed file: ${norm}`,
      installedHash,
      diskHash: onDisk,
      plannedHash: plannedHash ?? undefined,
    };
  }

  const ownershipKind = registryOwnership;
  if (ownershipKind === 'owned-by-project') {
    return {
      relPath: norm,
      classification: 'project-owned',
      disposition: 'block',
      reason: `Project-owned path in ownership registry: ${norm}`,
      installedHash: installedHash ?? undefined,
      diskHash: onDisk ?? undefined,
      plannedHash: plannedHash ?? undefined,
    };
  }

  if (ownershipKind === 'unknown' && onDisk && plannedHash) {
    const isAecsPayload = norm.startsWith('aecs/') || norm === 'aecs/manifest.json';
    if (isAecsPayload && installedHash && onDisk === installedHash) {
      return {
        relPath: norm,
        classification: 'aecs-owned',
        disposition: 'auto',
        action: 'write',
        reason: 'Replace AECS payload manifest with newer canonical',
        installedHash,
        diskHash: onDisk,
        plannedHash,
      };
    }
    if (isAecsPayload && !installedHash) {
      return {
        relPath: norm,
        classification: 'new',
        disposition: 'auto',
        action: 'write',
        reason: 'New AECS payload file',
        plannedHash,
      };
    }
    return {
      relPath: norm,
      classification: 'unknown',
      disposition: 'block',
      reason: `Ambiguous ownership for changed file: ${norm}`,
      diskHash: onDisk,
      plannedHash,
    };
  }

  const classification =
    norm.includes('.mdc') && norm.startsWith('.cursor/rules/')
      ? 'adapter-regenerated'
      : ownershipKind === 'generated'
        ? 'generated'
        : 'aecs-owned';

  return {
    relPath: norm,
    classification,
    disposition: 'auto',
    action: 'write',
    reason: `Replace ${classification} with newer canonical`,
    installedHash: installedHash ?? undefined,
    diskHash: onDisk ?? undefined,
    plannedHash: plannedHash ?? undefined,
  };
}
