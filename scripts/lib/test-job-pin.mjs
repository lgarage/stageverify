/**
 * Explicit test-fixture PIN helper.
 *
 * Verification scripts must never default to the retired seed job PIN and must
 * never embed a production company PIN. Set STAGEVERIFY_JOB1_PIN (or the named
 * env) only when a dedicated test fixture PIN exists.
 */

/** Leftover seed/demo job PIN — do not write, default, or advertise. */
export const RETIRED_SEED_JOB_PIN = "1234";

export function readExplicitTestPin(envName) {
  const pin = process.env[envName];
  if (!pin) return null;
  if (String(pin) === RETIRED_SEED_JOB_PIN) {
    throw new Error(
      `${envName} must not be the retired seed job PIN. Use a dedicated test fixture PIN, never a production company PIN.`,
    );
  }
  return String(pin);
}

export function skipWithoutExplicitTestPin(
  pin,
  scriptLabel,
  envName = "STAGEVERIFY_JOB1_PIN",
) {
  if (pin) return false;
  console.log(
    `SKIP ${scriptLabel} — set ${envName} to a test fixture PIN (never the retired seed PIN, never a production company PIN).`,
  );
  return true;
}
