#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAdapter, defaultSourceRoot } from '../installer/install.mjs';
import { atomicCopyFile, atomicWriteFile } from '../installer/lib/fs-safe.mjs';
import { loadSourceManifest, loadInstalledManifest } from '../installer/lib/manifest.mjs';
import { assertValidTarget, normalizeRel, resolveUnderRoot } from '../installer/lib/paths.mjs';
import { UPDATER_VERSION } from './lib/constants.mjs';
import { createTransactionId } from './lib/transaction.mjs';
import { loadOwnershipRegistry } from './lib/ownership.mjs';
import {
  buildUpdatePlan,
  buildUpdatedInstallRecord,
  buildUpdatedOwnership,
  buildRollbackMetadata,
  collectBackupFileSpecs,
} from './lib/update-plan.mjs';
import { createVerifiedBackup } from './lib/backup.mjs';
import {
  checkUpdateAllowed,
  clearUpdateInProgress,
  writeUpdateInProgress,
} from './lib/progress.mjs';
import { runVerify } from '../installer/verify.mjs';

/**
 * @param {string[]} argv
 */
export function parseUpdateArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const opts = {
    write: false,
    allowDowngrade: false,
    profile: 'sonnet-default',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--write') {
      opts.write = true;
    } else if (arg === '--dry-run') {
      opts.write = false;
    } else if (arg === '--allow-downgrade') {
      opts.allowDowngrade = true;
    } else if (arg === '--target' && argv[i + 1]) {
      opts.target = argv[++i];
    } else if (arg === '--source' && argv[i + 1]) {
      opts.source = argv[++i];
    } else if (arg === '--adapter' && argv[i + 1]) {
      opts.adapter = argv[++i];
    } else if (arg === '--profile' && argv[i + 1]) {
      opts.profile = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    }
  }
  return opts;
}

/**
 * @param {object} opts
 * @param {string} opts.sourceRoot
 * @param {string} opts.targetRoot
 * @param {boolean} [opts.write]
 * @param {boolean} [opts.allowDowngrade]
 * @param {string} [opts.profile]
 * @param {string} [opts.adapterName]
 * @param {string} [opts.brainRepoPath]
 * @param {boolean} [opts.simulateBackupFailure]
 */
export function runUpdate(opts) {
  const sourceRoot = path.resolve(opts.sourceRoot ?? defaultSourceRoot());
  const targetRoot = path.resolve(opts.targetRoot);
  const write = Boolean(opts.write);
  const allowDowngrade = Boolean(opts.allowDowngrade);
  const brainRepoPath =
    opts.brainRepoPath ?? process.env.AECS_BRAIN_REPO_PATH ?? 'C:/Projects/cursor-agent-brain';

  assertValidTarget(sourceRoot, targetRoot);

  const progressGate = checkUpdateAllowed(targetRoot);
  if (!progressGate.ok) {
    return {
      ok: false,
      dryRun: !write,
      updaterVersion: UPDATER_VERSION,
      blocks: [progressGate.reason ?? 'Update blocked by in-progress sentinel'],
      planned: [],
      written: [],
      staleState: progressGate.kind ?? null,
    };
  }

  const installed = loadInstalledManifest(targetRoot);
  if (!installed) {
    return {
      ok: false,
      dryRun: !write,
      updaterVersion: UPDATER_VERSION,
      blocks: ['No installation record found — run aecs:install first'],
      planned: [],
      written: [],
    };
  }

  let manifest;
  let manifestSha256;
  try {
    const loaded = loadSourceManifest(sourceRoot);
    manifest = loaded.manifest;
    manifestSha256 = loaded.manifestSha256;
  } catch (err) {
    return {
      ok: false,
      dryRun: !write,
      updaterVersion: UPDATER_VERSION,
      blocks: [err instanceof Error ? err.message : String(err)],
      planned: [],
      written: [],
    };
  }

  let ownership = null;
  try {
    ownership = loadOwnershipRegistry(targetRoot);
  } catch (err) {
    return {
      ok: false,
      dryRun: !write,
      blocks: [err instanceof Error ? err.message : String(err)],
      planned: [],
      written: [],
    };
  }

  /** @type {Record<string, unknown> | null} */
  let adapter = null;
  if (opts.adapterName) {
    adapter = loadAdapter(sourceRoot, opts.adapterName);
  } else if (installed.adapter) {
    try {
      adapter = loadAdapter(sourceRoot, String(installed.adapter));
    } catch {
      // adapter optional on update
    }
  }

  const plan = buildUpdatePlan({
    sourceRoot,
    targetRoot,
    installed,
    manifest,
    manifestSha256,
    ownership,
    adapter,
    profile: opts.profile ?? String(installed.profile ?? 'sonnet-default'),
    adapterName: opts.adapterName ?? (installed.adapter ? String(installed.adapter) : null),
    brainRepoPath,
    allowDowngrade,
  });

  const result = {
    ok: plan.ok,
    dryRun: !write,
    updaterVersion: UPDATER_VERSION,
    sourceRoot,
    targetRoot,
    version: plan.version,
    blocks: plan.blocks,
    notes: plan.notes,
    noOp: plan.noOp,
    planned: plan.changes.map((c) => ({
      path: c.relPath,
      classification: c.classification,
      disposition: c.disposition,
      action: c.action,
      reason: c.reason,
    })),
    written: /** @type {string[]} */ ([]),
    transactionId: null,
    verify: null,
    partialFailure: false,
  };

  if (!write) {
    return result;
  }

  if (!plan.ok) {
    return result;
  }

  if (plan.noOp) {
    result.notes = [...(result.notes ?? []), 'No changes required — same version and manifest'];
    return result;
  }

  const transactionId = createTransactionId();
  result.transactionId = transactionId;

  const backupSpecs = [
    ...collectBackupFileSpecs(plan.changes),
    { relPath: '.cursor/aecs/installed-manifest.json', required: true },
    { relPath: '.cursor/aecs/ownership.json', required: false },
  ];
  const rollbackMetadata = buildRollbackMetadata(installed, plan.changes);

  writeUpdateInProgress(targetRoot, transactionId);

  const backup = createVerifiedBackup({
    targetRoot,
    transactionId,
    fileSpecs: backupSpecs,
    installed,
    ownership,
    version: plan.version,
    rollbackMetadata,
    simulateFailure: Boolean(opts.simulateBackupFailure),
  });

  if (!backup.ok) {
    clearUpdateInProgress(targetRoot);
    result.ok = false;
    result.blocks.push(backup.reason ?? 'Backup failed');
    return result;
  }

  /** @type {string[]} */
  const written = [];
  try {
    for (const ch of plan.changes) {
      if (ch.disposition !== 'auto') {
        continue;
      }
      if (ch.action === 'skip') {
        continue;
      }
      if (
        ch.relPath === '.cursor/aecs/installed-manifest.json' ||
        ch.relPath === '.cursor/aecs/ownership.json'
      ) {
        continue;
      }

      const planned = plan.installPlan.files.find((f) => normalizeRel(f.relPath) === ch.relPath);
      if (ch.action === 'delete') {
        const abs = resolveUnderRoot(targetRoot, ch.relPath);
        if (fs.existsSync(abs)) {
          fs.unlinkSync(abs);
          written.push(ch.relPath);
        }
        continue;
      }

      if (!planned) {
        continue;
      }

      if (planned.action === 'copy' && planned.sourceAbs) {
        atomicCopyFile(targetRoot, planned.relPath, planned.sourceAbs);
        written.push(normalizeRel(planned.relPath));
      } else if (planned.action === 'substitute' || planned.action === 'generate') {
        const content = planned.content ?? '';
        if (planned.relPath.endsWith('.gitkeep')) {
          atomicWriteFile(targetRoot, planned.relPath, '');
        } else {
          atomicWriteFile(targetRoot, planned.relPath, content);
        }
        written.push(normalizeRel(planned.relPath));
      }
    }

    const adapterNameResolved =
      opts.adapterName ?? (installed.adapter ? String(installed.adapter) : null);
    const newRecord = buildUpdatedInstallRecord({
      plan,
      sourceRoot,
      manifest,
      manifestSha256,
      transactionId,
      adapterName: adapterNameResolved,
    });
    const newOwnership = buildUpdatedOwnership({ manifest, installedManifest: newRecord });

    atomicWriteFile(
      targetRoot,
      '.cursor/aecs/installed-manifest.json',
      `${JSON.stringify(newRecord, null, 2)}\n`,
    );
    atomicWriteFile(
      targetRoot,
      '.cursor/aecs/ownership.json',
      `${JSON.stringify(newOwnership, null, 2)}\n`,
    );
    written.push('.cursor/aecs/installed-manifest.json', '.cursor/aecs/ownership.json');

    result.written = written;

    const verify = runVerify({ targetRoot, sourceRoot });
    result.verify = { ok: verify.ok, findings: verify.findings };
    if (!verify.ok) {
      result.ok = false;
      result.partialFailure = true;
      result.blocks.push(
        `Post-update verify failed — rollback available via transaction ${transactionId}`,
      );
    } else {
      clearUpdateInProgress(targetRoot);
    }
  } catch (err) {
    result.ok = false;
    result.partialFailure = true;
    result.blocks.push(err instanceof Error ? err.message : String(err));
    result.blocks.push(
      `Partial failure — rollback available via transaction ${transactionId}`,
    );
  }

  return result;
}

function printHelp() {
  console.log(`AECS updater v${UPDATER_VERSION}

Usage:
  node aecs/updater/update.mjs --target <repo-root> [options]

Options:
  --target <path>       Installed git repository root (required)
  --source <path>       Local canonical AECS host (default: repo containing installer)
  --adapter <name>      Adapter bindings name
  --profile <name>      Orchestration profile
  --write               Apply changes (default: dry-run)
  --allow-downgrade     Permit target version < installed (default: blocked)
  --help                Show this help

Dry-run is the default. No files are written unless --write is passed.
Local canonical source only — no remote download.
`);
}

function main() {
  const opts = parseUpdateArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    process.exit(0);
  }
  if (!opts.target || typeof opts.target !== 'string') {
    console.error('Error: --target is required');
    printHelp();
    process.exit(1);
  }

  try {
    const result = runUpdate({
      sourceRoot: typeof opts.source === 'string' ? opts.source : defaultSourceRoot(),
      targetRoot: opts.target,
      write: Boolean(opts.write),
      allowDowngrade: Boolean(opts.allowDowngrade),
      profile: typeof opts.profile === 'string' ? opts.profile : undefined,
      adapterName: typeof opts.adapter === 'string' ? opts.adapter : undefined,
    });

    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) {
      process.exit(2);
    }
    process.exit(0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main();
}
