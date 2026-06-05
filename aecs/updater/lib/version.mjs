/**
 * Parse semver-like x.y.z into numeric tuple.
 * @param {string} version
 */
export function parseVersionTuple(version) {
  const parts = String(version)
    .trim()
    .split('.')
    .map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) {
    throw new Error(`Invalid version format: ${version}`);
  }
  while (parts.length < 3) {
    parts.push(0);
  }
  return parts;
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {-1 | 0 | 1}
 */
export function compareVersions(a, b) {
  const ta = parseVersionTuple(a);
  const tb = parseVersionTuple(b);
  for (let i = 0; i < 3; i++) {
    if (ta[i] < tb[i]) {
      return -1;
    }
    if (ta[i] > tb[i]) {
      return 1;
    }
  }
  return 0;
}

/**
 * @param {string} installedVersion
 * @param {string} targetVersion
 * @param {boolean} [allowDowngrade]
 */
export function checkVersionCompatibility(installedVersion, targetVersion, allowDowngrade = false) {
  const cmp = compareVersions(targetVersion, installedVersion);
  if (cmp < 0 && !allowDowngrade) {
    return {
      ok: false,
      reason: `Downgrade blocked: installed ${installedVersion} → target ${targetVersion} (use --allow-downgrade)`,
    };
  }
  return { ok: true, direction: cmp > 0 ? 'upgrade' : cmp < 0 ? 'downgrade' : 'same' };
}
