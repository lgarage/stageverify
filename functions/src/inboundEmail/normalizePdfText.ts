/**
 * Detect and normalize pdf-parse U+XX00 custom-font text (Johnstone PDFs).
 * Maps code points where (cp & 0xff) === 0 and cp >= 0x2000 → ASCII (cp >> 8).
 * U+1100 (Hangul filler) → '0' when pdf-parse cannot resolve a digit glyph.
 */

/** True when text likely needs U+XX00 normalization (low ASCII ratio + BMP high-byte glyphs). */
export function hasCustomFontPdfEncoding(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const ascii = trimmed.replace(/[^\x20-\x7E\n\r\t]/g, "").length;
  const ratio = ascii / trimmed.length;
  if (ratio >= 0.85) return false;
  let xx00 = 0;
  for (const c of trimmed) {
    const cp = c.codePointAt(0) ?? 0;
    if (cp >= 0x2000 && (cp & 0xff) === 0) xx00 += 1;
  }
  return xx00 >= 8;
}

/** Fold U+XX00 / U+1100 pdf-parse glyphs to ASCII-like text. */
export function normalizeCustomFontPdfText(raw: string): string {
  const mapped = [...raw]
    .map((c) => {
      const cp = c.codePointAt(0) ?? 0;
      if (cp === 0x1100) return "0";
      if (cp >= 0x2000 && (cp & 0xff) === 0) {
        const ascii = cp >> 8;
        if (ascii === 0) return " ";
        return String.fromCharCode(ascii);
      }
      return c;
    })
    .join("");
  return mapped.replace(/\((\d)\)/g, "$1");
}

/**
 * Johnstone multi-column S/O PDFs: label row + value row without colons.
 * Inject stacked label/value lines so existing parser regexes match.
 */
export function adaptJohnstoneMultiColumnLayout(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);

  for (let i = 0; i < lines.length - 1; i += 1) {
    const label = lines[i]!;
    const value = lines[i + 1]!;
    if (!/Customer\s*#/i.test(label) || !/Sales\s+Order\s*#/i.test(label)) continue;
    if (!/Customer\s+P\/O/i.test(label)) continue;

    const m = value.match(
      /^(\d{3,10})\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{3,10})\s+([A-Z][A-Z]+(?:\s+[A-Z][A-Z]+)?)\s+(.+)$/i,
    );
    if (!m) continue;

    const [, customer, orderDate, salesOrder, buyer, rest] = m;
    const po = rest!
      .replace(/\s+(?:Fond|Ship|UNITED|\d{3,}|\*{3,}).*$/i, "")
      .trim();

    const injected = [
      "Customer #",
      customer!,
      "Sales Order #",
      salesOrder!,
      "Customer P/O #",
      po,
      "Order Date",
      orderDate!,
      "Buyer",
      buyer!.trim(),
    ];
    lines.splice(i + 2, 0, ...injected);
    break;
  }

  return lines.join("\n");
}

/** Canonicalize Johnstone PDF line grid headers/rows for existing parser regexes. */
export function canonicalizeJohnstoneLineGrid(text: string): string {
  let out = text.replace(
    /LN\s+QNTY\s+QNT\s+QNT/gi,
    "LN QNTY ORD QNTY SHIP QNTY B/O",
  );
  out = out.replace(
    /^(\d+)\s+(\d+)\s+(\d+)\s+([LP][\w-])/gm,
    "$1 $2 $3 0 $4",
  );
  return out;
}

/** Full post-extract pipeline: custom-font normalize + layout adapter. */
export function postProcessExtractedPdfText(raw: string): string {
  const step1 = hasCustomFontPdfEncoding(raw) ? normalizeCustomFontPdfText(raw) : raw;
  const step2 = adaptJohnstoneMultiColumnLayout(step1);
  return canonicalizeJohnstoneLineGrid(step2);
}
