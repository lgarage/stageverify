#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FORBIDDEN_INSTALL_PATTERNS,
  FORBIDDEN_PORTABLE_PATTERNS,
  RULE_TEMPLATE_MAP,
} from './lib/constants.mjs';
import { sha256File, sha256String } from './lib/hash.mjs';
import { loadSourceManifest, loadInstalledManifest } from './lib/manifest.mjs';
import { isDirectory, isGitRepoRoot, normalizeRel, resolveUnderRoot } from './lib/paths.mjs';
import { defaultSourceRoot } from './install.mjs';

/**
 * @typedef {object} VerifyFinding
 * @property {'error' | 'warn'} level
 * @property {string} code
 * @property {string} message
 */

/**
 * @param {string[]} argv
 */
export function parseVerifyArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--target' && argv[i + 1]) {
      opts.target = argv[++i];
    } else if (arg === '--source' && argv[i + 1]) {
      opts.source = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    }
  }
  return opts;
}

/**
 * @param {string} targetRoot
 * @param {string} rel
 */
function readTargetFile(targetRoot, rel) {
  const abs = path.join(targetRoot, rel.replace(/\//g, path.sep));
  if (!fs.existsSync(abs)) {
    return null;
  }
  return fs.readFileSync(abs, 'utf8');
}

/**
 * @param {object} opts
 * @param {string} opts.targetRoot
 * @param {string} [opts.sourceRoot]
 */
export function runVerify(opts) {
  const targetRoot = path.resolve(opts.targetRoot);
  const sourceRoot = path.resolve(opts.sourceRoot ?? defaultSourceRoot());

  /** @type {VerifyFinding[]} */
  const findings = [];

  if (!isDirectory(targetRoot)) {
    findings.push({ level: 'error', code: 'TARGET_NOT_DIR', message: 'Target is not a directory' });
    return { ok: false, findings };
  }
  if (!isGitRepoRoot(targetRoot)) {
    findings.push({
      level: 'error',
      code: 'TARGET_NOT_GIT',
      message: 'Target is not a git repository root',
    });
  }

  let installed;
  try {
    installed = loadInstalledManifest(targetRoot);
  } catch (err) {
    findings.push({
      level: 'error',
      code: 'INSTALL_RECORD_INVALID',
      message: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, findings, targetRoot };
  }

  const progressPath = path.join(targetRoot, '.cursor', 'aecs', 'install-in-progress');
  if (fs.existsSync(progressPath)) {
    findings.push({
      level: 'error',
      code: 'INSTALL_INCOMPLETE',
      message: 'Partial install detected (.cursor/aecs/install-in-progress present)',
    });
  }

  if (!installed) {
    findings.push({
      level: 'error',
      code: 'INSTALL_RECORD_MISSING',
      message: 'No .cursor/aecs/installed-manifest.json found',
    });
    return { ok: false, findings, targetRoot };
  }

  if (!installed.schemaVersion || !installed.aecsVersion || !installed.installedAt) {
    findings.push({
      level: 'error',
      code: 'INSTALL_RECORD_INCOMPLETE',
      message: 'installed-manifest.json missing schemaVersion, aecsVersion, or installedAt',
    });
  }

  if (!installed.profile) {
    findings.push({
      level: 'warn',
      code: 'PROFILE_MISSING',
      message: 'No orchestration profile recorded in install manifest',
    });
  }

  // Manifest integrity at target
  const targetManifestPath = path.join(targetRoot, 'aecs', 'manifest.json');
  if (!fs.existsSync(targetManifestPath)) {
    findings.push({
      level: 'error',
      code: 'TARGET_MANIFEST_MISSING',
      message: 'aecs/manifest.json missing in target',
    });
  } else {
    try {
      const recorded = String(installed.sourceManifestSha256 ?? '');
      const actual = sha256File(targetManifestPath);
      if (recorded && recorded !== actual) {
        findings.push({
          level: 'error',
          code: 'MANIFEST_DRIFT',
          message: 'Target aecs/manifest.json hash differs from install record',
        });
      }
    } catch (err) {
      findings.push({
        level: 'error',
        code: 'MANIFEST_INVALID',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Per-file integrity from install record
  if (Array.isArray(installed.files)) {
    for (const rec of installed.files) {
      const installedAs = String(rec.installedAs ?? '');
      const expectedHash = String(rec.sha256 ?? '');
      if (!installedAs) {
        continue;
      }
      try {
        resolveUnderRoot(targetRoot, installedAs);
      } catch {
        findings.push({
          level: 'error',
          code: 'PATH_ESCAPE',
          message: `Install record path escapes target root: ${installedAs}`,
        });
        continue;
      }

      for (const pat of FORBIDDEN_INSTALL_PATTERNS) {
        if (pat.test(installedAs)) {
          findings.push({
            level: 'error',
            code: 'FORBIDDEN_PATH',
            message: `Forbidden install path in record: ${installedAs}`,
          });
        }
      }

      const abs = path.join(targetRoot, installedAs.replace(/\//g, path.sep));
      if (!fs.existsSync(abs)) {
        findings.push({
          level: 'error',
          code: 'FILE_MISSING',
          message: `Installed file missing: ${installedAs}`,
        });
        continue;
      }
      const hash = sha256File(abs);
      if (expectedHash && hash !== expectedHash) {
        findings.push({
          level: 'error',
          code: 'FILE_HASH_MISMATCH',
          message: `Hash mismatch for ${installedAs}`,
        });
      }
    }
  } else {
    findings.push({
      level: 'error',
      code: 'INSTALL_FILES_MISSING',
      message: 'installed-manifest.json has no files[] array',
    });
  }

  // Canonical core vs source manifest
  try {
    const { manifest } = loadSourceManifest(sourceRoot);
    for (const entry of manifest.files) {
      const rel = String(entry.path);
      const targetFile = path.join(targetRoot, rel.replace(/\//g, path.sep));
      if (!fs.existsSync(targetFile)) {
        findings.push({
          level: 'error',
          code: 'CORE_FILE_MISSING',
          message: `Core file missing in target: ${rel}`,
        });
        continue;
      }
      const hash = sha256File(targetFile);
      if (hash !== entry.sha256) {
        findings.push({
          level: 'error',
          code: 'CORE_HASH_MISMATCH',
          message: `Core file drift: ${rel}`,
        });
      }
    }
    void manifest;
  } catch (err) {
    findings.push({
      level: 'warn',
      code: 'SOURCE_MANIFEST_CHECK',
      message: `Could not validate against source manifest: ${err instanceof Error ? err.message : err}`,
    });
  }

  // Portable core forbidden patterns
  const coreRoot = path.join(targetRoot, 'aecs', 'core');
  if (fs.existsSync(coreRoot)) {
    walkFiles(coreRoot, (abs) => {
      const content = fs.readFileSync(abs, 'utf8');
      const rel = normalizeRel(path.relative(targetRoot, abs));
      for (const pat of FORBIDDEN_PORTABLE_PATTERNS) {
        if (pat.test(content)) {
          findings.push({
            level: 'error',
            code: 'PORTABLE_CONTAMINATION',
            message: `Forbidden pattern in portable core: ${rel}`,
          });
        }
      }
    });
  }

  // Ownership consistency
  const ownershipPath = path.join(targetRoot, '.cursor', 'aecs', 'ownership.json');
  if (!fs.existsSync(ownershipPath)) {
    findings.push({
      level: 'error',
      code: 'OWNERSHIP_MISSING',
      message: '.cursor/aecs/ownership.json missing',
    });
  } else {
    try {
      const ownership = JSON.parse(fs.readFileSync(ownershipPath, 'utf8'));
      if (!Array.isArray(ownership.entries)) {
        findings.push({
          level: 'error',
          code: 'OWNERSHIP_INVALID',
          message: 'ownership.json entries[] missing',
        });
      }
    } catch {
      findings.push({
        level: 'error',
        code: 'OWNERSHIP_PARSE',
        message: 'ownership.json is not valid JSON',
      });
    }
  }

  // Cursor integration — expected rule files from install
  for (const ruleRel of Object.values(RULE_TEMPLATE_MAP)) {
    const abs = path.join(targetRoot, ruleRel.replace(/\//g, path.sep));
    if (!fs.existsSync(abs)) {
      findings.push({
        level: 'warn',
        code: 'RULE_MISSING',
        message: `Expected Cursor rule not present: ${ruleRel}`,
      });
    }
  }

  // Duplicate orchestration authority — profile should appear once in agent-ops
  const agentOps = readTargetFile(targetRoot, '.cursor/rules/agent-ops.mdc');
  if (agentOps) {
    const profileMatches = agentOps.match(/orchestrationProfile|ORCHESTRATION_PROFILE|composer-default|sonnet-default/gi);
    if (profileMatches && profileMatches.length > 4) {
      findings.push({
        level: 'warn',
        code: 'DUPLICATE_AUTHORITY',
        message: 'Multiple orchestration profile markers in agent-ops.mdc',
      });
    }
  }

  // Project-owned paths should not have been replaced by AECS core templates incorrectly
  if (fs.existsSync(path.join(targetRoot, '.cursor', 'rules', 'composer-orchestrator.mdc'))) {
    const content = readTargetFile(targetRoot, '.cursor/rules/composer-orchestrator.mdc');
    if (content && content.includes('<REPO>')) {
      findings.push({
        level: 'error',
        code: 'PROJECT_RULE_CONTAMINATED',
        message: 'composer-orchestrator.mdc contains unresolved AECS placeholders',
      });
    }
  }

  const errors = findings.filter((f) => f.level === 'error');
  return {
    ok: errors.length === 0,
    targetRoot,
    sourceRoot,
    findings,
    summary: {
      errors: errors.length,
      warnings: findings.filter((f) => f.level === 'warn').length,
    },
  };
}

/**
 * @param {string} dir
 * @param {(abs: string) => void} fn
 */
function walkFiles(dir, fn) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isSymbolicLink()) {
      continue;
    }
    if (ent.isDirectory()) {
      walkFiles(abs, fn);
    } else if (ent.isFile()) {
      fn(abs);
    }
  }
}

function printHelp() {
  console.log(`AECS install verifier (read-only)

Usage:
  node aecs/installer/verify.mjs --target <repo-root> [--source <aecs-host>]

Options:
  --target <path>   Installed repository root (required)
  --source <path>   AECS host for canonical hash comparison
  --help            Show this help
`);
}

function main() {
  const opts = parseVerifyArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    process.exit(0);
  }
  if (!opts.target || typeof opts.target !== 'string') {
    console.error('Error: --target is required');
    printHelp();
    process.exit(1);
  }

  const result = runVerify({
    targetRoot: opts.target,
    sourceRoot: typeof opts.source === 'string' ? opts.source : undefined,
  });

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 2);
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main();
}
