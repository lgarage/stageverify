/**
 * Bootstrap script hardening — dry-run, projectId, ADC, confirm gates.
 * Usage: npm run test:operator-bootstrap-hardening
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

let passed = 0;
let failed = 0;
const pass = (msg) => {
  passed += 1;
  console.log(`  ✓ ${msg}`);
};
const fail = (msg, detail) => {
  failed += 1;
  console.error(`  ✗ ${msg}`);
  if (detail) console.error(`    ${detail}`);
};

const script = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "operator/bootstrap-first-operator.mjs",
);

function run(args, envOverrides = {}) {
  const env = { ...process.env, ...envOverrides };
  for (const key of [
    "FIRESTORE_EMULATOR_HOST",
    "FIREBASE_AUTH_EMULATOR_HOST",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "APPDATA",
  ]) {
    if (key in envOverrides && envOverrides[key] === undefined) {
      delete env[key];
    }
  }
  return spawnSync(process.execPath, [script, ...args], {
    env,
    encoding: "utf8",
  });
}

console.log("\n=== operator bootstrap hardening ===\n");

const dryRun = run(
  ["--uid", "dry-run-uid", "--name", "Dry Run", "--dry-run"],
  {
    GCLOUD_PROJECT: "stageverify-db",
    FIRESTORE_EMULATOR_HOST: undefined,
    GOOGLE_APPLICATION_CREDENTIALS: undefined,
  },
);

if (dryRun.status === 0 && /dry-run: would write/i.test(dryRun.stdout)) {
  pass("--dry-run exits 0 with would-be writes and no Firestore transaction");
} else {
  fail("--dry-run exits 0 with would-be writes", dryRun.stderr || dryRun.stdout);
}

const noConfirm = run(
  ["--uid", "no-confirm-uid", "--name", "No Confirm"],
  {
    GCLOUD_PROJECT: "stageverify-db",
    FIRESTORE_EMULATOR_HOST: undefined,
    GOOGLE_APPLICATION_CREDENTIALS: undefined,
  },
);

if (
  noConfirm.status !== 0 &&
  /Refusing to write/i.test(noConfirm.stderr + noConfirm.stdout)
) {
  pass("refuses without emulator or --confirm-production");
} else {
  fail("refuses without emulator or --confirm-production", noConfirm.stderr || noConfirm.stdout);
}

const wrongProject = run(
  ["--uid", "wrong-project-uid", "--name", "Wrong", "--dry-run"],
  { GCLOUD_PROJECT: "wrong-project-id" },
);

if (
  wrongProject.status !== 0 &&
  /projectId must be "stageverify-db"/i.test(wrongProject.stderr + wrongProject.stdout)
) {
  pass("refuses wrong projectId");
} else {
  fail("refuses wrong projectId", wrongProject.stderr || wrongProject.stdout);
}

const prodNoAdc = run(
  ["--uid", "prod-no-adc", "--name", "Prod", "--confirm-production"],
  {
    GCLOUD_PROJECT: "stageverify-db",
    FIRESTORE_EMULATOR_HOST: undefined,
    GOOGLE_APPLICATION_CREDENTIALS: undefined,
    APPDATA: undefined,
    HOME: "/tmp/no-gcloud-home",
  },
);

if (
  prodNoAdc.status !== 0 &&
  /Application Default Credentials required/i.test(prodNoAdc.stderr + prodNoAdc.stdout)
) {
  pass("refuses missing ADC on production path");
} else {
  fail("refuses missing ADC on production path", prodNoAdc.stderr || prodNoAdc.stdout);
}

const lookupFirestoreOnly = run(
  ["--lookup-email", "test@example.com"],
  {
    GCLOUD_PROJECT: "stageverify-db",
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
    FIREBASE_AUTH_EMULATOR_HOST: undefined,
    GOOGLE_APPLICATION_CREDENTIALS: undefined,
    APPDATA: undefined,
    HOME: "/tmp/no-gcloud-home",
  },
);

if (
  lookupFirestoreOnly.status !== 0 &&
  /FIRESTORE_EMULATOR_HOST alone can hit live production Auth/i.test(
    lookupFirestoreOnly.stderr + lookupFirestoreOnly.stdout,
  )
) {
  pass("--lookup-email refuses with Firestore emulator only (no Auth emulator, no ADC)");
} else {
  fail(
    "--lookup-email refuses with Firestore emulator only (no Auth emulator, no ADC)",
    lookupFirestoreOnly.stderr || lookupFirestoreOnly.stdout,
  );
}

const confirmWithEmulator = run(
  ["--uid", "conflict-uid", "--name", "Conflict", "--confirm-production"],
  {
    GCLOUD_PROJECT: "stageverify-db",
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  },
);

if (
  confirmWithEmulator.status !== 0 &&
  /cannot be used when FIRESTORE_EMULATOR_HOST/i.test(
    confirmWithEmulator.stderr + confirmWithEmulator.stdout,
  )
) {
  pass("--confirm-production refuses when emulator host is set");
} else {
  fail(
    "--confirm-production refuses when emulator host is set",
    confirmWithEmulator.stderr || confirmWithEmulator.stdout,
  );
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
