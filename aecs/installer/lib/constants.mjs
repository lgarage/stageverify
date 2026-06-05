/** @typedef {'owned-by-core' | 'owned-by-project' | 'generated' | 'local-override'} OwnershipKind */

export const INSTALLER_VERSION = '0.1.0';
export const INSTALLED_MANIFEST_SCHEMA = '0.1.0';

/** Rule templates → runtime Cursor rule paths */
export const RULE_TEMPLATE_MAP = {
  'aecs/core/rules/model-audit-gate.mdc.template': '.cursor/rules/model-audit-gate.mdc',
  'aecs/core/rules/model-dispatch-gate.mdc.template': '.cursor/rules/model-dispatch-gate.mdc',
  'aecs/core/rules/parallel-agent-strategy.mdc.template':
    '.cursor/rules/parallel-agent-strategy.mdc',
  'aecs/core/rules/session-cleanup-gate.mdc.template':
    '.cursor/rules/session-cleanup-gate.mdc',
  'aecs/core/rules/agent-ops-bridge.mdc.template': '.cursor/rules/agent-ops.mdc',
  'aecs/core/rules/ship-loop.mdc.template': '.cursor/rules/ship-loop.mdc',
};

/** Glob-like project-owned prefixes — installer must not overwrite differing content */
export const PROJECT_OWNED_PREFIXES = [
  '.cursor/rules/composer-orchestrator.mdc',
  'PROJECT_STATUS/',
  'scripts/verify-',
  'aecs/adapters/',
];

export const FORBIDDEN_PORTABLE_PATTERNS = [
  /stageverify-db/i,
  /\bstageverify\b/i,
  /C:\\Projects\\/i,
  /c:\/projects\/stageverify/i,
  /lgarage\.github\.io\/stageverify/i,
];

export const FORBIDDEN_INSTALL_PATTERNS = [
  /\.env(\.|$)/i,
  /playwright\/\.auth\//i,
  /node_modules\//i,
  /\.git\//i,
];
