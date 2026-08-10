/**
 * Minimal Firestore REST helper using FIREBASE_TOKEN (firebase-tools refresh).
 * Never logs tokens or PIN material.
 */

import { createRequire } from "node:module";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const require = createRequire(import.meta.url);

function npxFirebaseToolsAuthCandidates() {
  const out = [];
  const npxRoot = join(homedir(), ".npm", "_npx");
  if (!existsSync(npxRoot)) return out;
  try {
    for (const entry of readdirSync(npxRoot)) {
      const authPath = join(
        npxRoot,
        entry,
        "node_modules",
        "firebase-tools",
        "lib",
        "auth.js",
      );
      if (existsSync(authPath)) out.push(authPath);
    }
  } catch {
    // ignore
  }
  return out;
}

function loadFirebaseToolsAuth() {
  const candidates = [
    "firebase-tools/lib/auth.js",
    "/usr/lib/node_modules/firebase-tools/lib/auth.js",
    "/usr/local/lib/node_modules/firebase-tools/lib/auth.js",
    ...npxFirebaseToolsAuthCandidates(),
  ];
  for (const candidate of candidates) {
    try {
      if (candidate.startsWith("/") && !existsSync(candidate)) continue;
      return require(candidate);
    } catch {
      // try next
    }
  }
  throw new Error(
    "firebase-tools auth module not found — install firebase-tools or set FIREBASE_TOKEN with CLI available",
  );
}

export async function getFirebaseAccessToken() {
  const token = process.env.FIREBASE_TOKEN?.trim();
  if (!token) {
    throw new Error("FIREBASE_TOKEN required for admin Firestore REST");
  }
  const auth = loadFirebaseToolsAuth();
  const result = await auth.getAccessToken(token, [
    "https://www.googleapis.com/auth/firebase",
    "https://www.googleapis.com/auth/cloud-platform",
  ]);
  const access = result?.access_token;
  if (!access) throw new Error("Unable to refresh FIREBASE_TOKEN access token");
  return access;
}

export function firestoreRestBase(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

export async function restListCollection(accessToken, projectId, collectionId) {
  const base = firestoreRestBase(projectId);
  const docs = [];
  let pageToken = "";
  do {
    const url = new URL(`${base}/${collectionId}`);
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(
        `list ${collectionId} failed: ${res.status} ${await res.text()}`,
      );
    }
    const json = await res.json();
    docs.push(...(json.documents || []));
    pageToken = json.nextPageToken || "";
  } while (pageToken);
  return docs;
}

export async function restDeleteDoc(accessToken, projectId, docPath) {
  const url = `${firestoreRestBase(projectId)}/${docPath}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) return { deleted: false, missing: true };
  if (!res.ok) {
    throw new Error(
      `delete ${docPath} failed: ${res.status} ${await res.text()}`,
    );
  }
  return { deleted: true, missing: false };
}

export function restDocId(documentName) {
  return documentName.split("/").pop();
}

export function restFields(document) {
  const out = {};
  for (const [k, v] of Object.entries(document.fields || {})) {
    if (v.stringValue !== undefined) out[k] = v.stringValue;
    else if (v.booleanValue !== undefined) out[k] = v.booleanValue;
    else if (v.integerValue !== undefined) out[k] = Number(v.integerValue);
    else if (v.nullValue !== undefined) out[k] = null;
  }
  return out;
}
