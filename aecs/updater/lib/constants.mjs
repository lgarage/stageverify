export const UPDATER_VERSION = '0.2.0';
export const UPDATE_RECORD_SCHEMA = '0.2.0';
export const BACKUP_MANIFEST_SCHEMA = '0.2.0';

/** Relative prefix for all backup transactions */
export const BACKUPS_REL = '.cursor/aecs/backups';

/** Partial-operation sentinels (fail-closed; race window documented in phase-4-plan) */
export const INSTALL_PROGRESS_REL = '.cursor/aecs/install-in-progress';
export const UPDATE_PROGRESS_REL = '.cursor/aecs/update-in-progress';
export const ROLLBACK_PROGRESS_REL = '.cursor/aecs/rollback-in-progress';

export const ROLLBACK_PROGRESS_SCHEMA = '0.2.0';
