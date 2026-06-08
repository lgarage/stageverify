#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSourceManifest } from '../installer/lib/manifest.mjs';
import { assertNoSymlinkEscape, isInsideRoot, safeRealpath } from '../installer/lib/paths.mjs';
import { EXPORT_VERSION, RELEASE_METADATA_SCHEMA, RELEASE_TRACK } from './lib/constants.mjs';
import {
  assertExportOutputWritable,
  buildPayloadHashes,
  cleanupPartialExport,
  computePayloadDigest,
} from './lib/integrity.mjs';
import { buildReleaseFileList, countReleaseFiles } from './lib/payload.mjs';

/**
 * @param {string[]} argv
 */
export function parseExportArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const opts = { write: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--write') {
      opts.write = true;
    } else if (arg === '--dry-run') {
      opts.write = false;
    } else if (arg === '--output' && argv[i + 1]) {
      opts.output = argv[++i];
    } else if (arg === '--source' && argv[i + 1]) {
      opts.source = argv[++i];
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
 * Refuse exporting into the source tree (prevents accidental self-overlay).
 * @param {string} sourceRoot
 * @param {string} outputRoot
 */
export function assertExportOutputSafe(sourceRoot, outputRoot) {
  const sourceReal = safeRealpath(sourceRoot);
  const outputReal = safeRealpath(outputRoot);
  if (sourceReal === outputReal) {
    throw new Error('Export output must not be the AECS source root');
  }
  if (isInsideRoot(sourceReal, outputReal)) {
    throw new Error('Export output must not be inside the AECS source root');
  }
  if (isInsideRoot(outputReal, sourceReal)) {
    throw new Error('Export output must not contain the AECS source root');
  }
}

/**
 * @param {object} opts
 * @param {string} opts.sourceRoot
 * @param {string} opts.outputRoot
 * @param {boolean} [opts.write]
 */
export function runExport(opts) {
  const sourceRoot = path.resolve(opts.sourceRoot ?? defaultSourceRoot());
  const outputRoot = path.resolve(opts.outputRoot);
  const write = Boolean(opts.write);

  if (!opts.outputRoot) {
    return {
      ok: false,
      exitCode: 2,
      errors: ['--output <dir> is required'],
      write,
    };
  }

  assertExportOutputSafe(sourceRoot, outputRoot);

  /** @type {string[]} */
  const errors = [];

  let manifestInfo;
  try {
    manifestInfo = loadSourceManifest(sourceRoot);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { ok: false, exitCode: 2, errors, write };
  }

  let files;
  try {
    files = buildReleaseFileList(sourceRoot);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { ok: false, exitCode: 2, errors, write };
  }

  const fileCount = countReleaseFiles(files);
  const aecsVersion = String(manifestInfo.manifest.aecsVersion);
  const payloadHashes = buildPayloadHashes(files);
  const payloadDigest = computePayloadDigest(payloadHashes);

  const releaseMetadata = {
    schemaVersion: RELEASE_METADATA_SCHEMA,
    exportVersion: EXPORT_VERSION,
    aecsVersion,
    releaseTrack: RELEASE_TRACK,
    manifestSchemaNote: 'installed-manifest schema 0.1.0; update/backup schema 0.2.0 — independent of aecsVersion',
    exportedAt: new Date().toISOString(),
    sourceManifestSha256: manifestInfo.manifestSha256,
    fileCount,
    payloadDigest,
    files: payloadHashes,
    excluded: ['aecs/dev/**', 'aecs/examples/**', 'aecs/adapters/*.bindings.json'],
    localOnly: true,
    signed: false,
  };

  if (!write) {
    return {
      ok: true,
      exitCode: 0,
      write: false,
      sourceRoot,
      outputRoot,
      aecsVersion,
      releaseTrack: RELEASE_TRACK,
      fileCount,
      files: files.map((f) => f.relPath),
      releaseMetadata,
      message: `Dry-run: would export ${fileCount} files to ${outputRoot}`,
    };
  }

  try {
    assertExportOutputWritable(outputRoot);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { ok: false, exitCode: 2, errors, write };
  }

  /** @type {string[]} */
  const copiedAbs = [];

  try {
    for (const entry of files) {
      const destAbs = path.join(outputRoot, entry.relPath.replace(/\//g, path.sep));
      assertNoSymlinkEscape(outputRoot, destAbs);
      fs.mkdirSync(path.dirname(destAbs), { recursive: true });
      fs.copyFileSync(entry.absPath, destAbs);
      copiedAbs.push(destAbs);
    }

    const metaPath = path.join(outputRoot, 'release-metadata.json');
    fs.mkdirSync(outputRoot, { recursive: true });
    fs.writeFileSync(metaPath, `${JSON.stringify(releaseMetadata, null, 2)}\n`, 'utf8');
  } catch (err) {
    cleanupPartialExport(outputRoot, copiedAbs);
    errors.push(err instanceof Error ? err.message : String(err));
    return { ok: false, exitCode: 1, errors, write };
  }

  return {
    ok: true,
    exitCode: 0,
    write: true,
    sourceRoot,
    outputRoot,
    aecsVersion,
    releaseTrack: RELEASE_TRACK,
    fileCount,
    releaseMetadataPath: path.join(outputRoot, 'release-metadata.json'),
    message: `Exported ${fileCount} files to ${outputRoot}`,
  };
}

function printHelp() {
  console.log(`AECS export v${EXPORT_VERSION}

Usage:
  npm run aecs:export -- --output <dir> [--source <aecs-host>] [--dry-run]
  npm run aecs:export:write -- --output <dir> [--source <aecs-host>]

Creates a local portable AECS package (no network). Excludes aecs/dev/, aecs/examples/, and active adapter bindings.
`);
}

function main() {
  const opts = parseExportArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    process.exit(0);
  }
  const result = runExport({
    sourceRoot: typeof opts.source === 'string' ? opts.source : defaultSourceRoot(),
    outputRoot: typeof opts.output === 'string' ? opts.output : '',
    write: Boolean(opts.write),
  });
  if (result.message) {
    console.log(result.message);
  }
  if (result.errors?.length) {
    for (const e of result.errors) {
      console.error(e);
    }
  }
  if (result.write === false && result.files) {
    console.log(`Files (${result.fileCount}):`);
    for (const f of result.files) {
      console.log(`  ${f}`);
    }
  }
  process.exit(result.exitCode ?? (result.ok ? 0 : 1));
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main();
}
