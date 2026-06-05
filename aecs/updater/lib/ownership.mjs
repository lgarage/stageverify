import fs from 'node:fs';
import path from 'node:path';
import { buildInstalledManifest, buildOwnershipRegistry } from '../../installer/lib/plan.mjs';
import { normalizeRel } from '../../installer/lib/paths.mjs';

/** @typedef {'owned-by-core' | 'owned-by-project' | 'generated' | 'unknown'} OwnershipKind */

/**
 * @param {string} targetRoot
 */
export function loadOwnershipRegistry(targetRoot) {
  const p = path.join(targetRoot, '.cursor', 'aecs', 'ownership.json');
  if (!fs.existsSync(p)) {
    return null;
  }
  const raw = fs.readFileSync(p, 'utf8');
  try {
    return /** @type {Record<string, unknown>} */ (JSON.parse(raw));
  } catch {
    throw new Error('ownership.json is not valid JSON');
  }
}

/**
 * @param {Record<string, unknown> | null} registry
 * @param {string} relPath
 */
export function lookupOwnership(registry, relPath) {
  const norm = normalizeRel(relPath);
  if (!registry || !Array.isArray(registry.entries)) {
    return 'unknown';
  }
  for (const entry of registry.entries) {
    const p = normalizeRel(String(entry.path ?? ''));
    if (p === norm || (p.endsWith('/') && norm.startsWith(p))) {
      return String(entry.ownership ?? 'unknown');
    }
  }
  return 'unknown';
}

/**
 * @param {Record<string, unknown>} installed
 */
export function validateInstallRecord(installed) {
  /** @type {string[]} */
  const errors = [];
  if (!installed || typeof installed !== 'object') {
    return ['Install record missing or not an object'];
  }
  if (!installed.schemaVersion) {
    errors.push('Install record missing schemaVersion');
  }
  if (!installed.aecsVersion) {
    errors.push('Install record missing aecsVersion');
  }
  if (!installed.installedAt) {
    errors.push('Install record missing installedAt');
  }
  if (!Array.isArray(installed.files) || installed.files.length === 0) {
    errors.push('Install record missing files[]');
  } else {
    for (const f of installed.files) {
      if (!f.canonical || !f.installedAs || !f.sha256) {
        errors.push(`Install file entry incomplete: ${JSON.stringify(f)}`);
      }
    }
  }
  return errors;
}

/**
 * Build target ownership registry from planned install (manifest evidence).
 *
 * @param {object} opts
 * @param {Record<string, unknown>} opts.manifest
 * @param {ReturnType<typeof buildInstalledManifest>} opts.installedManifest
 */
export function buildTargetOwnershipRegistry(opts) {
  return buildOwnershipRegistry(opts);
}

/**
 * Compatible metadata evolution: generated paths stay generated.
 *
 * @param {OwnershipKind | string} prior
 * @param {OwnershipKind | string} target
 */
export function isCompatibleOwnershipTransition(prior, target) {
  return prior === target;
}

/**
 * @param {OwnershipKind | string} prior
 * @param {OwnershipKind | string} target
 */
export function ownershipTransitionReason(prior, target) {
  if (isCompatibleOwnershipTransition(prior, target)) {
    return null;
  }
  const pairs = [
    ['owned-by-project', 'owned-by-core', 'project-owned → AECS-owned'],
    ['owned-by-core', 'owned-by-project', 'AECS-owned → project-owned'],
    ['generated', 'owned-by-project', 'generated → project-owned'],
    ['owned-by-project', 'generated', 'project-owned → generated'],
    ['owned-by-core', 'generated', 'AECS-owned → generated'],
    ['generated', 'owned-by-core', 'generated → AECS-owned'],
  ];
  for (const [from, to, label] of pairs) {
    if (prior === from && target === to) {
      return label;
    }
  }
  return `Ownership changed: ${prior} → ${target}`;
}

/**
 * @param {object} opts
 * @param {string} opts.relPath
 * @param {OwnershipKind | string | null} opts.priorOwnership
 * @param {OwnershipKind | string | null} opts.targetOwnership
 * @param {boolean} opts.mutationPlanned
 * @param {boolean} [opts.inPriorInstall]
 * @param {boolean} [opts.isNew]
 * @param {boolean} [opts.isRemoved]
 */
export function evaluateOwnershipPolicy(opts) {
  const { relPath, priorOwnership, targetOwnership, mutationPlanned, inPriorInstall, isNew, isRemoved } =
    opts;
  const prior = priorOwnership ?? 'unknown';
  const target = targetOwnership ?? 'unknown';

  if (!mutationPlanned) {
    return { block: false };
  }

  if (isNew && !inPriorInstall) {
    if (target === 'unknown') {
      return {
        block: true,
        reason: `Ambiguous target ownership for new path: ${relPath}`,
      };
    }
    return { block: false };
  }

  if (prior === 'unknown' && inPriorInstall) {
    return {
      block: true,
      reason: `Ambiguous prior ownership for mutated path: ${relPath}`,
    };
  }

  if (isRemoved && prior !== 'unknown' && target === 'unknown') {
    return { block: false };
  }

  if (prior !== 'unknown' && target === 'unknown') {
    return {
      block: true,
      reason: `Ambiguous target ownership for mutated path: ${relPath}`,
    };
  }

  if (prior !== target) {
    const reason = ownershipTransitionReason(prior, target);
    if (reason) {
      return { block: true, reason: `${reason} (${relPath})` };
    }
  }

  return { block: false };
}

/**
 * @param {object} opts
 * @param {Record<string, unknown>} opts.manifest
 * @param {import('../../installer/lib/plan.mjs').PlannedFile[]} opts.plannedFiles
 * @param {string} opts.manifestSha256
 * @param {string} opts.sourceRoot
 * @param {string} opts.profile
 * @param {string | null} opts.adapterName
 */
export function buildProvisionalInstallRecord(opts) {
  return buildInstalledManifest(opts);
}
