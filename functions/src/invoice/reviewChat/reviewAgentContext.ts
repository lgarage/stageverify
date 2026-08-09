/**
 * Build the smallest useful review context packet for Lane C C1.
 * Amendment 2: not extracted text alone — parsed fields + warnings + windows + chat.
 */
import {
  MAX_REVIEW_CHAT_CONTEXT_CHARS,
  REVIEW_CHAT_MAX_LINES,
  REVIEW_CHAT_MAX_TEXT_WINDOWS,
  REVIEW_CHAT_RECENT_TURNS,
  REVIEW_CHAT_TEXT_WINDOW_CHARS,
} from "../aiShadow/constants";
import type {
  ReviewAgentContextPacket,
  ReviewChatMessageRole,
} from "./reviewAgentTypes";

const HEADER_KEYS = [
  "vendorInvoiceNumber",
  "vendorOrderNumber",
  "customerPoOrReference",
  "fulfillmentMethod",
  "shipVia",
  "invoiceDate",
  "vendorName",
  "jobName",
  "jobNumber",
] as const;

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function subsetHeader(parsedHeader: unknown): Record<string, unknown> {
  const src = asRecord(parsedHeader);
  const out: Record<string, unknown> = {};
  for (const key of HEADER_KEYS) {
    if (key in src) out[key] = src[key];
  }
  return out;
}

function tokenizeQuery(message: string): string[] {
  return message
    .toUpperCase()
    .replace(/[^A-Z0-9\s./-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3)
    .slice(0, 12);
}

/** Find bounded windows around query tokens in extracted invoice text. */
export function extractTextWindows(
  combinedExtractedText: string,
  message: string,
): Array<{ start: number; end: number; text: string }> {
  const text = combinedExtractedText ?? "";
  if (!text.trim()) return [];

  const upper = text.toUpperCase();
  const tokens = tokenizeQuery(message);
  const hits: number[] = [];

  for (const token of tokens) {
    let from = 0;
    while (hits.length < 20) {
      const idx = upper.indexOf(token, from);
      if (idx < 0) break;
      hits.push(idx);
      from = idx + token.length;
    }
  }

  // Always include a head window so the agent has invoice identity context.
  if (hits.length === 0) {
    const end = Math.min(text.length, REVIEW_CHAT_TEXT_WINDOW_CHARS);
    return end > 0 ? [{ start: 0, end, text: text.slice(0, end) }] : [];
  }

  const half = Math.floor(REVIEW_CHAT_TEXT_WINDOW_CHARS / 2);
  const windows: Array<{ start: number; end: number; text: string }> = [];
  const used: Array<{ start: number; end: number }> = [];

  for (const hit of hits) {
    if (windows.length >= REVIEW_CHAT_MAX_TEXT_WINDOWS) break;
    const start = Math.max(0, hit - half);
    const end = Math.min(text.length, hit + half);
    const overlaps = used.some(
      (u) => !(end < u.start - 40 || start > u.end + 40),
    );
    if (overlaps) continue;
    used.push({ start, end });
    windows.push({ start, end, text: text.slice(start, end) });
  }

  return windows;
}

function pickRelevantLines(
  parsedLines: unknown,
  message: string,
): Array<Record<string, unknown>> {
  if (!Array.isArray(parsedLines)) return [];
  const tokens = tokenizeQuery(message);
  const rows = parsedLines
    .filter((row) => row && typeof row === "object")
    .map((row) => row as Record<string, unknown>);

  const scored = rows.map((row, index) => {
    const blob = JSON.stringify(row).toUpperCase();
    let score = 0;
    for (const token of tokens) {
      if (blob.includes(token)) score += 1;
    }
    return { row, index, score };
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  const picked =
    scored.some((s) => s.score > 0)
      ? scored.filter((s) => s.score > 0).slice(0, REVIEW_CHAT_MAX_LINES)
      : scored.slice(0, Math.min(6, REVIEW_CHAT_MAX_LINES));

  return picked.map((p) => ({
    lineIndex: p.index,
    vendorProductNumber: p.row.vendorProductNumber ?? null,
    description: p.row.description ?? null,
    quantityOrdered: p.row.quantityOrdered ?? null,
    quantityShipped: p.row.quantityShipped ?? null,
    quantityBackordered: p.row.quantityBackordered ?? null,
    lineType: p.row.lineType ?? null,
  }));
}

export function buildReviewAgentContextPacket(input: {
  parsedHeader: unknown;
  parsedLines: unknown;
  parseWarnings: unknown;
  reviewRequiredReasons?: unknown;
  error?: unknown;
  combinedExtractedText: string;
  recentTurns: Array<{ role: ReviewChatMessageRole; text: string }>;
  rollingSummary: string;
  dispatcherMessage: string;
}): ReviewAgentContextPacket {
  const parseWarnings = Array.isArray(input.parseWarnings)
    ? input.parseWarnings.filter((w): w is string => typeof w === "string")
    : [];
  const reviewIssues: string[] = [];
  if (typeof input.error === "string" && input.error.trim()) {
    reviewIssues.push(input.error.trim());
  }
  if (Array.isArray(input.reviewRequiredReasons)) {
    for (const r of input.reviewRequiredReasons) {
      if (typeof r === "string" && r.trim()) reviewIssues.push(r.trim());
    }
  }

  const recentTurns = input.recentTurns.slice(-REVIEW_CHAT_RECENT_TURNS);
  const packet: ReviewAgentContextPacket = {
    parsedHeader: subsetHeader(input.parsedHeader),
    relevantLines: pickRelevantLines(input.parsedLines, input.dispatcherMessage),
    parseWarnings,
    reviewIssues,
    textWindows: extractTextWindows(
      input.combinedExtractedText,
      input.dispatcherMessage,
    ),
    recentTurns,
    rollingSummary: (input.rollingSummary || "").slice(0, 1_500),
    sourceTextAvailable: Boolean(input.combinedExtractedText?.trim()),
  };

  // Soft-trim if serialized packet is oversized.
  let serialized = JSON.stringify(packet);
  while (
    serialized.length > MAX_REVIEW_CHAT_CONTEXT_CHARS &&
    packet.relevantLines.length > 2
  ) {
    packet.relevantLines.pop();
    serialized = JSON.stringify(packet);
  }
  while (
    serialized.length > MAX_REVIEW_CHAT_CONTEXT_CHARS &&
    packet.textWindows.length > 1
  ) {
    packet.textWindows.pop();
    serialized = JSON.stringify(packet);
  }
  if (serialized.length > MAX_REVIEW_CHAT_CONTEXT_CHARS) {
    packet.rollingSummary = packet.rollingSummary.slice(0, 400);
  }

  return packet;
}

/** Locate a cited snippet in extracted text; returns offsets or null. */
export function findEvidenceSpan(
  combinedExtractedText: string,
  citationText: string,
): { start: number; end: number; matched: string } | null {
  const hay = combinedExtractedText ?? "";
  const needle = (citationText ?? "").trim();
  if (!hay || !needle) return null;

  const direct = hay.indexOf(needle);
  if (direct >= 0) {
    return { start: direct, end: direct + needle.length, matched: needle };
  }

  const hayU = hay.toUpperCase();
  const needleU = needle.toUpperCase();
  const idx = hayU.indexOf(needleU);
  if (idx >= 0) {
    return {
      start: idx,
      end: idx + needle.length,
      matched: hay.slice(idx, idx + needle.length),
    };
  }

  // Collapse whitespace for a looser match.
  const compactHay = hayU.replace(/\s+/g, " ");
  const compactNeedle = needleU.replace(/\s+/g, " ");
  const cIdx = compactHay.indexOf(compactNeedle);
  if (cIdx < 0) return null;

  // Approximate original offsets by scanning.
  let orig = 0;
  let compactPos = 0;
  while (orig < hay.length && compactPos < cIdx) {
    if (/\s/.test(hay[orig]!)) {
      while (orig < hay.length && /\s/.test(hay[orig]!)) orig += 1;
      compactPos += 1;
    } else {
      orig += 1;
      compactPos += 1;
    }
  }
  const start = orig;
  const end = Math.min(hay.length, start + needle.length);
  return { start, end, matched: hay.slice(start, end) };
}
