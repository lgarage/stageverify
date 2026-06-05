import fs from 'node:fs';
import path from 'node:path';
import { RULE_TEMPLATE_MAP } from './constants.mjs';
import { analyzeCollision } from './collision.mjs';
import { sha256File, sha256String } from './hash.mjs';
import { normalizeRel, resolveUnderRoot } from './paths.mjs';
import { repoNameFromTarget, substitutePlaceholders } from './substitute.mjs';

/**
 * @typedef {object} PlannedFile
 * @property {string} relPath
 * @property {'copy' | 'generate' | 'substitute'} action
 * @property {string} [sourceAbs]
 * @property {string} [content]
 * @property {string} sha256
 * @property {string} [canonical]
 * @property {'write' | 'skip' | 'block'} disposition
 * @property {string} [note]
 */

/**
 * @param {object} opts
 * @param {string} opts.sourceRoot
 * @param {string} opts.targetRoot
 * @param {Record<string, unknown>} opts.manifest
 * @param {string} opts.profile
 * @param {string} opts.brainRepoPath
 * @param {Record<string, unknown> | null} [opts.adapter]
 * @param {Record<string, unknown> | null} [opts.existingInstall]
 */
export function buildInstallPlan(opts) {
  const { sourceRoot, targetRoot, manifest, profile, brainRepoPath, adapter, existingInstall } =
    opts;

  /** @type {PlannedFile[]} */
  const files = [];
  /** @type {string[]} */
  const blocks = [];
  /** @type {string[]} */
  const notes = [];

  const bindings = adapter
    ? {
        deploy: /** @type {string | undefined} */ (adapter.ship?.deploy),
        rulesDeploy: /** @type {string | undefined} */ (adapter.ship?.rulesDeploy),
        devPort: /** @type {number | undefined} */ (adapter.verify?.devPort),
      }
    : undefined;

  const subCtx = {
    repoName: repoNameFromTarget(targetRoot),
    profile,
    brainRepoPath,
    bindings,
  };

  const installedRulePaths = new Set(
    Array.isArray(existingInstall?.files)
      ? existingInstall.files
          .map((f) => /** @type {{installedAs?: string}} */ (f).installedAs)
          .filter(Boolean)
      : [],
  );

  /** @type {Map<string, string>} */
  const installedRecordHashes = new Map();
  if (Array.isArray(existingInstall?.files)) {
    for (const f of existingInstall.files) {
      if (f.installedAs && f.sha256) {
        installedRecordHashes.set(normalizeRel(String(f.installedAs)), String(f.sha256));
      }
    }
  }

  const projectOwnedGlobs = Array.isArray(manifest.projectOwned)
    ? manifest.projectOwned.map(String)
    : [];

  // Root manifest (not listed in files[] payload)
  const rootManifestRel = 'aecs/manifest.json';
  const rootManifestAbs = path.join(sourceRoot, rootManifestRel);
  if (fs.existsSync(rootManifestAbs)) {
    files.push({
      relPath: rootManifestRel,
      action: 'copy',
      sourceAbs: rootManifestAbs,
      sha256: sha256File(rootManifestAbs),
      canonical: rootManifestRel,
      disposition: 'write',
    });
  }

  // Core payload files from manifest
  for (const entry of manifest.files) {
    const rel = String(entry.path);
    const sourceAbs = path.join(sourceRoot, rel.replace(/\//g, path.sep));
    files.push({
      relPath: rel,
      action: 'copy',
      sourceAbs,
      sha256: String(entry.sha256),
      canonical: rel,
      disposition: 'write',
    });
  }

  // Rule templates → .cursor/rules
  for (const [templateRel, ruleRel] of Object.entries(RULE_TEMPLATE_MAP)) {
    const sourceAbs = path.join(sourceRoot, templateRel.replace(/\//g, path.sep));
    if (!fs.existsSync(sourceAbs)) {
      blocks.push(`Missing template: ${templateRel}`);
      continue;
    }
    const raw = fs.readFileSync(sourceAbs, 'utf8');
    const content = substitutePlaceholders(raw, subCtx);
    const hash = sha256String(content);
    const collision = analyzeCollision({
      targetRoot,
      relPath: ruleRel,
      plannedContent: content,
      projectOwnedGlobs,
      installedRulePaths,
      installedRecordHash: installedRecordHashes.get(normalizeRel(ruleRel)),
    });

    /** @type {PlannedFile} */
    const planned = {
      relPath: ruleRel,
      action: 'substitute',
      content,
      sha256: hash,
      canonical: templateRel,
      disposition: 'write',
      note: collision.reason,
    };

    if (collision.status === 'skip-identical') {
      planned.disposition = 'skip';
      notes.push(`${ruleRel}: ${collision.reason}`);
    } else if (collision.status === 'block') {
      planned.disposition = 'block';
      blocks.push(collision.reason ?? `Blocked: ${ruleRel}`);
    }
    files.push(planned);
  }

  // Adapter copy
  if (adapter && adapter.targetName) {
    const targetName = String(adapter.targetName);
    if (!/^[a-zA-Z0-9_-]+$/.test(targetName)) {
      blocks.push(`Invalid adapter targetName (rejected): ${targetName}`);
      return { files, blocks, notes };
    }
    const adapterRel = `aecs/adapters/${targetName}.bindings.json`;
    resolveUnderRoot(targetRoot, adapterRel);
    const sourceAdapter = path.join(sourceRoot, adapterRel.replace(/\//g, path.sep));
    if (fs.existsSync(sourceAdapter)) {
      const collision = analyzeCollision({
        targetRoot,
        relPath: adapterRel,
        plannedContent: fs.readFileSync(sourceAdapter, 'utf8'),
        projectOwnedGlobs,
      });
      const planned = {
        relPath: adapterRel,
        action: 'copy',
        sourceAbs: sourceAdapter,
        sha256: sha256File(sourceAdapter),
        canonical: adapterRel,
        disposition: collision.status === 'skip-identical' ? 'skip' : 'write',
      };
      if (collision.status === 'block') {
        planned.disposition = 'block';
        blocks.push(collision.reason ?? `Blocked: ${adapterRel}`);
      }
      files.push(planned);
    }
  }

  // Generated state paths (always regenerated on successful write install)
  const stateFiles = [
    '.cursor/aecs/backups/.gitkeep',
    '.cursor/aecs/installed-manifest.json',
    '.cursor/aecs/ownership.json',
  ];
  for (const rel of stateFiles) {
    files.push({
      relPath: rel,
      action: 'generate',
      sha256: '',
      disposition: blocks.length ? 'skip' : 'write',
      note: 'generated at install time',
    });
  }

  // Optional trials seed — only if missing
  const trialsRel = '.cursor/trials.json';
  const trialsAbs = path.join(targetRoot, trialsRel);
  if (!fs.existsSync(trialsAbs)) {
    const emptyTrials = '{}\n';
    files.push({
      relPath: trialsRel,
      action: 'generate',
      content: emptyTrials,
      sha256: sha256String(emptyTrials),
      disposition: blocks.length ? 'skip' : 'write',
      note: 'empty trials seed',
    });
  } else {
    notes.push(`${trialsRel}: preserved (already exists)`);
  }

  // PROJECT_STATUS — never overwrite existing
  const memoryRel = 'PROJECT_STATUS/CURRENT_STATE.md';
  const memoryAbs = path.join(targetRoot, memoryRel);
  if (!fs.existsSync(memoryAbs)) {
    const seed = `# ${subCtx.repoName} | Current State\n\n> Seeded by AECS installer. Replace with project hot-tier memory.\n`;
    files.push({
      relPath: memoryRel,
      action: 'generate',
      content: seed,
      sha256: sha256String(seed),
      disposition: blocks.length ? 'skip' : 'write',
      note: 'project memory seed',
    });
  } else {
    notes.push(`${memoryRel}: preserved (existing project memory)`);
  }

  return { files, blocks, notes };
}

/**
 * @param {object} opts
 * @param {PlannedFile[]} opts.plannedFiles
 * @param {Record<string, unknown>} opts.manifest
 * @param {string} opts.manifestSha256
 * @param {string} opts.sourceRoot
 * @param {string} opts.profile
 * @param {string | null} opts.adapterName
 */
export function buildInstalledManifest(opts) {
  const { plannedFiles, manifest, manifestSha256, sourceRoot, profile, adapterName } = opts;
  const installedAt = new Date().toISOString();
  const fileRecords = plannedFiles
    .filter((f) => f.canonical && f.disposition !== 'block')
    .map((f) => ({
      canonical: f.canonical,
      installedAs: f.relPath,
      sha256: f.sha256,
    }));

  return {
    schemaVersion: '0.1.0',
    aecsVersion: String(manifest.aecsVersion),
    installerVersion: '0.1.0',
    installedAt,
    profile,
    adapter: adapterName,
    sourceRoot: path.resolve(sourceRoot),
    sourceManifest: 'aecs/manifest.json',
    sourceManifestSha256: manifestSha256,
    files: fileRecords,
  };
}

/**
 * @param {object} opts
 * @param {Record<string, unknown>} opts.manifest
 * @param {ReturnType<typeof buildInstalledManifest>} opts.installedManifest
 */
export function buildOwnershipRegistry(opts) {
  const { manifest, installedManifest } = opts;
  const now = installedManifest.installedAt.split('T')[0];

  /** @type {Array<Record<string, unknown>>} */
  const entries = [];

  entries.push({
    path: 'aecs/manifest.json',
    ownership: 'owned-by-core',
    note: 'Root payload manifest',
  });

  for (const entry of manifest.files) {
    entries.push({
      path: entry.path,
      ownership: 'owned-by-core',
      canonicalSha256: entry.sha256,
    });
  }

  for (const f of installedManifest.files) {
    if (String(f.canonical).includes('.mdc.template')) {
      entries.push({
        path: f.installedAs,
        ownership: 'owned-by-core',
        canonicalPath: f.canonical,
        installedSha256: f.sha256,
        localOverride: false,
      });
    }
  }

  if (Array.isArray(manifest.projectOwned)) {
    for (const p of manifest.projectOwned) {
      entries.push({
        path: p,
        ownership: 'owned-by-project',
        localOverride: false,
      });
    }
  }

  entries.push(
    {
      path: '.cursor/aecs/installed-manifest.json',
      ownership: 'generated',
      note: 'Regenerated on install',
    },
    {
      path: '.cursor/aecs/ownership.json',
      ownership: 'generated',
      note: 'Regenerated on install',
    },
    {
      path: '.cursor/aecs/backups/',
      ownership: 'generated',
      note: 'Phase 4 backups',
    },
  );

  return {
    schemaVersion: '0.1.0',
    generatedAt: now,
    canonicalSource: 'aecs/core/',
    installStateNote:
      'Generated by AECS installer — NOT independently maintained. Edit aecs/core/ first.',
    entries,
  };
}

export { normalizeRel };
