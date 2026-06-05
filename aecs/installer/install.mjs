#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTALLER_VERSION } from './lib/constants.mjs';
import { atomicCopyFile, atomicWriteFile } from './lib/fs-safe.mjs';
import { loadSourceManifest, loadInstalledManifest } from './lib/manifest.mjs';
import {
  buildInstallPlan,
  buildInstalledManifest,
  buildOwnershipRegistry,
} from './lib/plan.mjs';
import { assertValidTarget, normalizeRel } from './lib/paths.mjs';
import { checkInstallAllowed } from '../updater/lib/progress.mjs';

/**
 * @param {string[]} argv
 */
export function parseInstallArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const opts = {
    write: false,
    profile: 'sonnet-default',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--write') {
      opts.write = true;
    } else if (arg === '--dry-run') {
      opts.write = false;
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

export function defaultSourceRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

/**
 * @param {string} sourceRoot
 * @param {string} adapterName
 */
export function loadAdapter(sourceRoot, adapterName) {
  const p = path.join(sourceRoot, 'aecs', 'adapters', `${adapterName}.bindings.json`);
  if (!fs.existsSync(p)) {
    throw new Error(`Adapter not found: ${p}`);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/**
 * @param {object} opts
 * @param {string} opts.sourceRoot
 * @param {string} opts.targetRoot
 * @param {boolean} [opts.write]
 * @param {string} [opts.profile]
 * @param {string} [opts.adapterName]
 * @param {string} [opts.brainRepoPath]
 */
export function runInstall(opts) {
  const sourceRoot = path.resolve(opts.sourceRoot ?? defaultSourceRoot());
  const targetRoot = path.resolve(opts.targetRoot);
  const write = Boolean(opts.write);
  const profile = opts.profile ?? 'sonnet-default';
  const brainRepoPath =
    opts.brainRepoPath ?? process.env.AECS_BRAIN_REPO_PATH ?? 'C:/Projects/cursor-agent-brain';

  assertValidTarget(sourceRoot, targetRoot);

  const { manifest, manifestSha256 } = loadSourceManifest(sourceRoot);
  const existingInstall = loadInstalledManifest(targetRoot);

  /** @type {Record<string, unknown> | null} */
  let adapter = null;
  if (opts.adapterName) {
    adapter = loadAdapter(sourceRoot, opts.adapterName);
  }

  const effectiveProfile = adapter?.orchestrationProfile
    ? String(adapter.orchestrationProfile)
    : profile;

  const plan = buildInstallPlan({
    sourceRoot,
    targetRoot,
    manifest,
    profile: effectiveProfile,
    brainRepoPath,
    adapter,
    existingInstall,
  });

  const result = {
    ok: plan.blocks.length === 0,
    dryRun: !write,
    installerVersion: INSTALLER_VERSION,
    sourceRoot,
    targetRoot,
    profile: effectiveProfile,
    adapter: opts.adapterName ?? null,
    blocks: plan.blocks,
    notes: plan.notes,
    planned: plan.files.map((f) => ({
      path: f.relPath,
      disposition: f.disposition,
      action: f.action,
      note: f.note,
    })),
    written: /** @type {string[]} */ ([]),
  };

  if (!write) {
    return result;
  }

  const progressGate = checkInstallAllowed(targetRoot);
  if (!progressGate.ok) {
    result.ok = false;
    result.blocks.push(progressGate.reason ?? 'Install blocked by in-progress sentinel');
    return result;
  }

  if (!result.ok) {
    return result;
  }

  const installedManifest = buildInstalledManifest({
    plannedFiles: plan.files,
    manifest,
    manifestSha256,
    sourceRoot,
    profile: effectiveProfile,
    adapterName: opts.adapterName ?? null,
  });

  const ownership = buildOwnershipRegistry({ manifest, installedManifest });

  const progressRel = '.cursor/aecs/install-in-progress';
  atomicWriteFile(targetRoot, progressRel, `${installedManifest.installedAt}\n`);

  try {
    for (const f of plan.files) {
      if (f.disposition !== 'write') {
        continue;
      }
      if (f.relPath === '.cursor/aecs/installed-manifest.json') {
        continue;
      }
      if (f.relPath === '.cursor/aecs/ownership.json') {
        continue;
      }

      if (f.action === 'copy' && f.sourceAbs) {
        atomicCopyFile(targetRoot, f.relPath, f.sourceAbs);
        result.written.push(normalizeRel(f.relPath));
      } else if (f.action === 'substitute' || f.action === 'generate') {
        const content = f.content ?? '';
        if (f.relPath.endsWith('.gitkeep')) {
          atomicWriteFile(targetRoot, f.relPath, '');
        } else {
          atomicWriteFile(targetRoot, f.relPath, content);
        }
        result.written.push(normalizeRel(f.relPath));
      }
    }

    atomicWriteFile(
      targetRoot,
      '.cursor/aecs/installed-manifest.json',
      `${JSON.stringify(installedManifest, null, 2)}\n`,
    );
    atomicWriteFile(
      targetRoot,
      '.cursor/aecs/ownership.json',
      `${JSON.stringify(ownership, null, 2)}\n`,
    );
    result.written.push('.cursor/aecs/installed-manifest.json', '.cursor/aecs/ownership.json');

    const progressAbs = path.join(targetRoot, progressRel.replace(/\//g, path.sep));
    if (fs.existsSync(progressAbs)) {
      fs.unlinkSync(progressAbs);
    }
  } catch (err) {
    result.ok = false;
    result.blocks.push(err instanceof Error ? err.message : String(err));
    throw err;
  }

  return result;
}

function printHelp() {
  console.log(`AECS installer v${INSTALLER_VERSION}

Usage:
  node aecs/installer/install.mjs --target <repo-root> [options]

Options:
  --target <path>    Destination git repository root (required)
  --source <path>    AECS host root (default: repo containing this script)
  --adapter <name>   Install aecs/adapters/<name>.bindings.json
  --profile <name>   sonnet-default | composer-default (default: sonnet-default)
  --write            Apply changes (default: dry-run)
  --dry-run          Plan only (default)
  --help             Show this help

Dry-run is the default. No files are written unless --write is passed.
`);
}

function main() {
  const opts = parseInstallArgs(process.argv.slice(2));
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
    const result = runInstall({
      sourceRoot: typeof opts.source === 'string' ? opts.source : defaultSourceRoot(),
      targetRoot: opts.target,
      write: Boolean(opts.write),
      profile: typeof opts.profile === 'string' ? opts.profile : 'sonnet-default',
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
