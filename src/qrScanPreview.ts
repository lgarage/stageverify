import { formatStagingCodeCanonical } from "./dispatcher/stagingCode";
import { parseScannedQr } from "./receiveQrUrls";

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function hostFromUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("http")) return null;
  try {
    return new URL(trimmed).hostname;
  } catch {
    return null;
  }
}

/** Primary line for the iOS-style scan preview pill. */
export function formatQrScanPreviewLabel(raw: string): string {
  const host = hostFromUrl(raw) ?? "lgarage.github.io";
  const parsed = parseScannedQr(raw);

  switch (parsed.kind) {
    case "receive-id":
      return host;
    case "receive-zone":
      return host;
    case "pickup":
      return host;
    case "raw": {
      if (raw.trim().startsWith("http")) {
        return host;
      }
      return `Zone ${formatStagingCodeCanonical(parsed.value)}`;
    }
  }
}

/** Secondary hint under the hostname (route detail). */
export function formatQrScanPreviewDetail(raw: string): string | null {
  const parsed = parseScannedQr(raw);

  switch (parsed.kind) {
    case "receive-id":
      return truncate(`Receive · ${parsed.deliveryId}`, 40);
    case "receive-zone":
      return `Receive · zone ${formatStagingCodeCanonical(parsed.zoneCode)}`;
    case "pickup": {
      const parts = ["Pickup"];
      if (parsed.jobId) parts.push(`job ${parsed.jobId}`);
      if (parsed.deliveryId) parts.push(`delivery ${parsed.deliveryId}`);
      return truncate(parts.join(" · "), 44);
    }
    case "raw": {
      if (raw.trim().startsWith("http")) {
        try {
          const url = new URL(raw.trim());
          const route = url.hash.replace(/^#\/?/, "") || url.pathname;
          return truncate(route || "Open link", 44);
        } catch {
          return null;
        }
      }
      return "Staging zone tag";
    }
  }
}
