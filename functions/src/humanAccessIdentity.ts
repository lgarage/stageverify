/**
 * Shared validation + Admin roster helpers for Auth human identities.
 */
import { HttpsError } from "firebase-functions/v2/https";
import {
  managerFlagForRole,
  resolveDispatcherAccessRole,
  type DispatcherAccessRole,
  type DispatcherRoleFields,
} from "./inboundEmail/dispatcherAuth";
import { getDb } from "./accessPinSecretsShared";

const DISPATCHER_ROLES_COLLECTION = "dispatcherRoles";

const VAGUE_FULL_NAMES = new Set(
  [
    "dan",
    "test",
    "user",
    "admin",
    "manager",
    "dispatcher",
    "technician",
    "manager pin",
    "management pin",
    "management",
  ].map((s) => s.toLowerCase()),
);

/** Meaningful full name for new human Auth users — first + last token required. */
export function validateHumanFullName(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new HttpsError("invalid-argument", "Full name is required.");
  }
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (trimmed.length < 3 || trimmed.length > 80) {
    throw new HttpsError(
      "invalid-argument",
      "Enter a full name (first and last).",
    );
  }
  if (!/^[A-Za-z][A-Za-z .'-]*$/.test(trimmed)) {
    throw new HttpsError(
      "invalid-argument",
      "Full name may only contain letters, spaces, hyphens, apostrophes, or periods.",
    );
  }
  const parts = trimmed.split(" ").filter(Boolean);
  if (parts.length < 2) {
    throw new HttpsError(
      "invalid-argument",
      "Enter a full name (first and last).",
    );
  }
  if (VAGUE_FULL_NAMES.has(trimmed.toLowerCase())) {
    throw new HttpsError(
      "invalid-argument",
      "Enter a real named identity (not a role or test label).",
    );
  }
  return trimmed;
}

export function parseDispatcherAccessRole(
  raw: unknown,
): DispatcherAccessRole | null {
  if (raw === "admin" || raw === "manager" || raw === "dispatcher") {
    return raw;
  }
  return null;
}

export async function countActiveAdmins(
  excludeUid?: string,
): Promise<number> {
  const snap = await getDb().collection(DISPATCHER_ROLES_COLLECTION).get();
  let count = 0;
  for (const doc of snap.docs) {
    if (excludeUid && doc.id === excludeUid) continue;
    const data = doc.data() as DispatcherRoleFields;
    if (data.removed === true) continue;
    if (data.active === false) continue;
    if (resolveDispatcherAccessRole(data) === "admin") count += 1;
  }
  return count;
}

/** Fail closed if demoting/deactivating would leave zero active Admins. */
export async function assertNotLastActiveAdmin(
  targetUid: string,
  targetData: DispatcherRoleFields,
): Promise<void> {
  if (resolveDispatcherAccessRole(targetData) !== "admin") return;
  if (targetData.active === false || targetData.removed === true) return;
  const remaining = await countActiveAdmins(targetUid);
  if (remaining < 1) {
    throw new HttpsError(
      "failed-precondition",
      "Cannot remove or demote the last active Admin.",
    );
  }
}

export function rolePatch(
  role: DispatcherAccessRole,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    role,
    manager: managerFlagForRole(role),
    ...extra,
  };
}

export { managerFlagForRole, resolveDispatcherAccessRole };
export type { DispatcherAccessRole, DispatcherRoleFields };
