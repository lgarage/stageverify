/**
 * Remove ephemeral Playwright screenshots (gitignored artifacts).
 * Usage: npm run clean:verify-artifacts
 */

import { existsSync, readdirSync, unlinkSync, rmSync } from "fs";
import { resolve } from "path";

const root = process.cwd();

for (const name of readdirSync(root)) {
  if (
    name.startsWith("before-") &&
    name.endsWith(".png")
  ) {
    unlinkSync(resolve(root, name));
  }
  if (
    name.startsWith("after-") &&
    name.endsWith(".png")
  ) {
    unlinkSync(resolve(root, name));
  }
}

const shotsDir = resolve(root, "screenshots");
if (existsSync(shotsDir)) {
  for (const entry of readdirSync(shotsDir, { withFileTypes: true })) {
    const p = resolve(shotsDir, entry.name);
    if (entry.isDirectory()) rmSync(p, { recursive: true, force: true });
    else if (entry.name.endsWith(".png")) unlinkSync(p);
  }
}

console.log("Cleaned verify artifacts (screenshots/, before/after PNGs at root).");
