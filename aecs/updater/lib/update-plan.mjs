import fs from 'node:fs';
import path from 'node:path';
import {
  buildInstallPlan,
  buildInstalledManifest,
  buildOwnershipRegistry,
} from '../../installer/lib/plan.mjs';
import { normalizeRel } from '../../installer/lib/paths.mjs';
import { classifyFileChange } from './classify.mjs';
import { checkVersionCompatibility } from './version.mjs';
import {
  buildProvisionalInstallRecord,
  buildTargetOwnershipRegistry,
  lookupOwnership,
  validateInstallRecord,
} from './ownership.mjs';

/**
 * @typedef {import('./classify.mjs').ClassifiedChange} ClassifiedChange
 */

/**
 * @param {object} opts
 * @param {string} opts.sourceRoot
 * @param {string} opts.targetRoot
 * @param {Record<string, unknown>} opts.installed
 * @param {Record<string, unknown>} opts.manifest
 * @param {string} opts.manifestSha256
 * @param {Record<string, unknown> | null} [opts.ownership]
 * @param {Record<string, unknown> | null} [opts.adapter]
 * @param {string} [opts.profile]
 * @param {string} [opts.adapterName]
 * @param {string} [opts.brainRepoPath]
 * @param {boolean} [opts.allowDowngrade]
 */
export function buildUpdatePlan(opts) {
  const {
    sourceRoot,
    targetRoot,
    installed,
    manifest,
    manifestSha256,
    ownership,
    adapter,
    profile = 'sonnet-default',
    adapterName = null,
    brainRepoPath = 'C:/Projects/cursor-agent-brain',
    allowDowngrade = false,
  } = opts;

  /** @type {string[]} */
  const blocks = [];
  /** @type {string[]} */
  const notes = [];

  const recordErrors = validateInstallRecord(installed);
  if (recordErrors.length) {
    return {
      ok: false,
      blocks: recordErrors,
      notes,
      changes: /** @type {ClassifiedChange[]} */ ([]),
      noOp: false,
      version: {
        installed: String(installed.aecsVersion),
        target: String(manifest.aecsVersion),
        canonicalSource: String(manifest.aecsVersion),
      },
    };
  }

  const installedVersion = String(installed.aecsVersion);
  const targetVersion = String(manifest.aecsVersion);
  const versionCheck = checkVersionCompatibility(installedVersion, targetVersion, allowDowngrade);
  if (!versionCheck.ok) {
    blocks.push(versionCheck.reason ?? 'Version incompatible');
  }

  const sameManifestSha =
    installed.sourceManifestSha256 && installed.sourceManifestSha256 === manifestSha256;

  const installPlan = buildInstallPlan({
    sourceRoot,
    targetRoot,
    manifest,
    profile: adapter?.orchestrationProfile ? String(adapter.orchestrationProfile) : profile,
    brainRepoPath,
    adapter,
    existingInstall: installed,
  });

  blocks.push(...installPlan.blocks);

  /** @type {Map<string, {installedAs: string, sha256: string, canonical: string}>} */
  const installedMap = new Map();
  for (const f of installed.files) {
    installedMap.set(normalizeRel(String(f.installedAs)), {
      installedAs: normalizeRel(String(f.installedAs)),
      sha256: String(f.sha256),
      canonical: String(f.canonical),
    });
  }

  /** @type {Map<string, {relPath: string, sha256: string, disposition: string}>} */
  const plannedMap = new Map();
  for (const f of installPlan.files) {
    if (f.disposition === 'block') {
      continue;
    }
    plannedMap.set(normalizeRel(f.relPath), {
      relPath: normalizeRel(f.relPath),
      sha256: f.sha256,
      disposition: f.disposition,
      plannedFile: f,
    });
  }

  const projectOwnedGlobs = Array.isArray(manifest.projectOwned)
    ? manifest.projectOwned.map(String)
    : [];

  const adapterNameResolved =
    opts.adapterName ?? (installed.adapter ? String(installed.adapter) : null);
  const provisionalRecord = buildProvisionalInstallRecord({
    plannedFiles: installPlan.files,
    manifest,
    manifestSha256,
    sourceRoot,
    profile: adapter?.orchestrationProfile ? String(adapter.orchestrationProfile) : profile,
    adapterName: adapterNameResolved,
  });
  const targetOwnershipRegistry = buildTargetOwnershipRegistry({
    manifest,
    installedManifest: provisionalRecord,
  });

  /** @type {ClassifiedChange[]} */
  const changes = [];
  const allPaths = new Set([...installedMap.keys(), ...plannedMap.keys()]);

  for (const rel of allPaths) {
    const inst = installedMap.get(rel);
    const plan = plannedMap.get(rel);

    if (rel === '.cursor/aecs/installed-manifest.json' || rel === '.cursor/aecs/ownership.json') {
      changes.push({
        relPath: rel,
        classification: 'generated',
        disposition: 'skip',
        action: 'skip',
        reason: 'Metadata regenerated only when content mutations exist',
      });
      continue;
    }

    if (rel === '.cursor/aecs/backups/.gitkeep') {
      changes.push({
        relPath: rel,
        classification: 'generated',
        disposition: 'skip',
        action: 'skip',
        reason: 'Backup directory placeholder already present',
      });
      continue;
    }

    const priorOwnership = lookupOwnership(ownership, rel);
    const targetOwnership = lookupOwnership(targetOwnershipRegistry, rel);

    if (inst && !plan) {
      changes.push(
        classifyFileChange({
          targetRoot,
          relPath: rel,
          installedHash: inst.sha256,
          plannedHash: null,
          ownership,
          projectOwnedGlobs,
          isNew: false,
          isRemoved: true,
          priorOwnership,
          targetOwnership,
        }),
      );
      continue;
    }

    if (!inst && plan) {
      changes.push(
        classifyFileChange({
          targetRoot,
          relPath: rel,
          installedHash: null,
          plannedHash: plan.sha256,
          ownership,
          projectOwnedGlobs,
          isNew: true,
          isRemoved: false,
          priorOwnership,
          targetOwnership,
        }),
      );
      continue;
    }

    if (inst && plan) {
      changes.push(
        classifyFileChange({
          targetRoot,
          relPath: rel,
          installedHash: inst.sha256,
          plannedHash: plan.sha256,
          ownership,
          projectOwnedGlobs,
          isNew: false,
          isRemoved: false,
          priorOwnership,
          targetOwnership,
        }),
      );
    }
  }

  for (const ch of changes) {
    if (ch.disposition === 'block') {
      blocks.push(ch.reason ?? `Blocked: ${ch.relPath}`);
    }
  }

  const mutations = changes.filter(
    (c) =>
      c.disposition === 'auto' &&
      c.action !== 'skip' &&
      !c.relPath.startsWith('.cursor/aecs/'),
  );
  const noOp = blocks.length === 0 && mutations.length === 0 && versionCheck.ok && sameManifestSha;

  if (mutations.length > 0) {
    for (const ch of changes) {
      if (
        ch.relPath === '.cursor/aecs/installed-manifest.json' ||
        ch.relPath === '.cursor/aecs/ownership.json'
      ) {
        ch.disposition = 'auto';
        ch.action = 'write';
        ch.reason = 'Regenerate metadata after verify';
      }
    }
  }

  return {
    ok: blocks.length === 0,
    blocks: [...new Set(blocks)],
    notes: [...installPlan.notes, ...notes],
    changes,
    installPlan,
    noOp,
    version: {
      installed: installedVersion,
      target: targetVersion,
      canonicalSource: targetVersion,
      direction: versionCheck.direction,
      sameManifestSha,
    },
    manifestSha256,
    adapterName,
    profile: adapter?.orchestrationProfile ? String(adapter.orchestrationProfile) : profile,
  };
}

/**
 * @param {object} opts
 * @param {ReturnType<typeof buildUpdatePlan>} opts.plan
 * @param {string} opts.sourceRoot
 * @param {Record<string, unknown>} opts.manifest
 * @param {string} opts.manifestSha256
 * @param {string} opts.transactionId
 * @param {string | null} opts.adapterName
 */
export function buildUpdatedInstallRecord(opts) {
  const { plan, sourceRoot, manifest, manifestSha256, transactionId, adapterName } = opts;
  const installedManifest = buildInstalledManifest({
    plannedFiles: plan.installPlan.files,
    manifest,
    manifestSha256,
    sourceRoot,
    profile: plan.profile,
    adapterName,
  });

  return {
    ...installedManifest,
    schemaVersion: '0.2.0',
    updaterVersion: '0.2.0',
    previousAecsVersion: plan.version.installed,
    updatedAt: new Date().toISOString(),
    lastTransactionId: transactionId,
  };
}

/**
 * @param {object} opts
 * @param {Record<string, unknown>} opts.manifest
 * @param {ReturnType<typeof buildUpdatedInstallRecord>} opts.installedManifest
 */
export function buildUpdatedOwnership(opts) {
  return buildOwnershipRegistry(opts);
}

/**
 * @param {Record<string, unknown>} installed
 * @param {ClassifiedChange[]} changes
 */
export function buildRollbackMetadata(installed, changes) {
  /** @type {Set<string>} */
  const before = new Set();
  for (const f of installed.files ?? []) {
    before.add(normalizeRel(String(f.installedAs)));
  }

  /** @type {string[]} */
  const filesAdded = [];
  /** @type {string[]} */
  const filesChanged = [];
  /** @type {string[]} */
  const filesRemoved = [];

  for (const ch of changes) {
    if (ch.disposition !== 'auto' || ch.action === 'skip') {
      continue;
    }
    if (
      ch.relPath === '.cursor/aecs/installed-manifest.json' ||
      ch.relPath === '.cursor/aecs/ownership.json'
    ) {
      continue;
    }
    if (ch.classification === 'new' && ch.action === 'write') {
      filesAdded.push(ch.relPath);
    } else if (ch.classification === 'removed' && ch.action === 'delete') {
      filesRemoved.push(ch.relPath);
    } else if (ch.action === 'write') {
      filesChanged.push(ch.relPath);
    }
  }

  return {
    filesBeforeUpdate: [...before].sort(),
    filesAdded: filesAdded.sort(),
    filesChanged: filesChanged.sort(),
    filesRemoved: filesRemoved.sort(),
    metadataReplaced: ['.cursor/aecs/installed-manifest.json', '.cursor/aecs/ownership.json'],
  };
}

/**
 * @param {ClassifiedChange[]} changes
 */
export function collectBackupFileSpecs(changes) {
  /** @type {Array<{relPath: string, required: boolean, reason?: string}>} */
  const specs = [];
  for (const c of changes) {
    if (c.disposition !== 'auto' || (c.action !== 'write' && c.action !== 'delete')) {
      continue;
    }
    if (
      c.relPath.endsWith('installed-manifest.json') ||
      c.relPath.endsWith('ownership.json')
    ) {
      continue;
    }
    if (c.classification === 'new') {
      continue;
    }
    specs.push({
      relPath: c.relPath,
      required: true,
      reason:
        c.action === 'delete'
          ? 'File scheduled for removal must exist for backup'
          : 'File scheduled for change must exist for backup',
    });
  }
  return specs;
}

/**
 * @param {ClassifiedChange[]} changes
 */
export function collectBackupPaths(changes) {
  return collectBackupFileSpecs(changes).map((s) => s.relPath);
}
