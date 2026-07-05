/** StageVerify build version — injected from package.json at build time. */
export const APP_VERSION = __APP_VERSION__;

export function formatAppVersionLabel(): string {
  return `v${APP_VERSION}`;
}
