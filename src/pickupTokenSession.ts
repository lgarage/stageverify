const STORAGE_PREFIX = "stageverify.pickupToken.";

export function storePickupTokenForJob(jobId: string, token: string): void {
  try {
    sessionStorage.setItem(`${STORAGE_PREFIX}${jobId}`, token);
  } catch {
    // sessionStorage unavailable — copy may fall back to job link
  }
}

export function readPickupTokenForJob(jobId: string): string | null {
  try {
    return sessionStorage.getItem(`${STORAGE_PREFIX}${jobId}`);
  } catch {
    return null;
  }
}

export function clearPickupTokenForJob(jobId: string): void {
  try {
    sessionStorage.removeItem(`${STORAGE_PREFIX}${jobId}`);
  } catch {
    // ignore
  }
}

export function buildPickupTokenUrl(token: string): string {
  return `${window.location.origin}${window.location.pathname}#/pickup?t=${token}`;
}
