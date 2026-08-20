export interface VendorItemDisplayInput {
  description: string;
  sku?: string;
  qtyOrdered: number;
}

export interface VendorItemDisplay {
  title: string;
  spec?: string;
  qtyLabel: string;
}

const FOOTER_MARKERS = [
  "Signature Proof of Delivery",
  "If you have any questions about your invoice",
  "Remit To",
  "Taxable",
  "TOTAL $",
  "Pay By",
  "Writer:",
  "ENROLLMENT TOKEN",
  "http://",
  "https://",
];

const MONEY_PATTERN = /\$?\d{1,3}(?:,\d{3})*\.\d{2}\b/g;
const MODEL_PATTERN = /[0-9/]/;
const TITLE_ACRONYMS = new Set(["MERV"]);
const SPEC_ACRONYMS = new Set(["CU", "MERV", "ODM"]);

function truncateAtInvoiceFooter(value: string): string {
  const lower = value.toLowerCase();
  const firstMarker = FOOTER_MARKERS.reduce<number | null>((first, marker) => {
    const index = lower.indexOf(marker.toLowerCase());
    if (index < 0) return first;
    return first == null ? index : Math.min(first, index);
  }, null);
  return firstMarker == null ? value : value.slice(0, firstMarker);
}

function titleCaseAllCapsWord(value: string, preserve: Set<string>): string {
  const upper = value.toUpperCase();
  if (preserve.has(upper)) return upper;
  if (!/^[A-Z]+(?:-[A-Z]+)*$/.test(value)) return value;
  return value
    .split("-")
    .map((part) => `${part[0]}${part.slice(1).toLowerCase()}`)
    .join("-");
}

function cleanTitleToken(value: string): string {
  const token = value.replace(/^[,;:]+|[,;:]+$/g, "");
  return titleCaseAllCapsWord(token, TITLE_ACRONYMS);
}

function normalizeSpecToken(value: string): string {
  const token = value.replace(/^[,;:]+|[,;:]+$/g, "");
  const compactUnit = token.match(/^(.+?)(ODM|CU)$/i);
  if (compactUnit && MODEL_PATTERN.test(compactUnit[1])) {
    return `${compactUnit[1]} ${compactUnit[2].toUpperCase()}`;
  }
  return titleCaseAllCapsWord(token, SPEC_ACRONYMS);
}

function splitSpecGroups(value: string): string[] {
  return (value.match(/\([^)]*\)|\S+/g) ?? [])
    .map((group) =>
      group.startsWith("(")
        ? group.replace(/\s+/g, " ").trim()
        : normalizeSpecToken(group),
    )
    .filter(Boolean);
}

function uniqueGroups(groups: string[]): string[] {
  const seen = new Set<string>();
  return groups.filter((group) => {
    const key = group.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function splitTitleAndModels(value: string): {
  titleTokens: string[];
  modelTokens: string[];
} {
  const groups = value.match(/\([^)]*\)|\S+/g) ?? [];
  const titleTokens: string[] = [];
  const modelTokens: string[] = [];

  groups.forEach((group, index) => {
    const cleaned = group.replace(/^[,;:]+|[,;:]+$/g, "");
    const previous = groups[index - 1]?.replace(/[^A-Za-z]/g, "").toUpperCase();
    if (
      group.startsWith("(") ||
      (MODEL_PATTERN.test(cleaned) && previous !== "MERV")
    ) {
      modelTokens.push(
        group.startsWith("(")
          ? group.replace(/\s+/g, " ").trim()
          : normalizeSpecToken(cleaned),
      );
    } else {
      titleTokens.push(cleanTitleToken(cleaned));
    }
  });

  return {
    titleTokens: titleTokens.filter(Boolean),
    modelTokens: modelTokens.filter(Boolean),
  };
}

/**
 * Derive a vendor-safe display label without changing parser or stored item truth.
 */
export function getVendorItemDisplay({
  description,
  sku,
  qtyOrdered,
}: VendorItemDisplayInput): VendorItemDisplay {
  const raw = description.trim();
  const withoutFooter = truncateAtInvoiceFooter(raw)
    .replace(/\*NOTE\s*:[\s\S]*$/i, " ")
    .trim();
  const firstMoney = withoutFooter.search(MONEY_PATTERN);
  MONEY_PATTERN.lastIndex = 0;

  const titleSource =
    firstMoney >= 0 ? withoutFooter.slice(0, firstMoney) : withoutFooter;
  const specSource =
    firstMoney >= 0 ? withoutFooter.slice(firstMoney) : "";
  const cleanTitleSource = titleSource
    .replace(MONEY_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim();
  const cleanSpecSource = specSource
    .replace(MONEY_PATTERN, " ")
    .replace(/\bN\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  MONEY_PATTERN.lastIndex = 0;

  const { titleTokens, modelTokens } = splitTitleAndModels(cleanTitleSource);
  const specGroups = [
    ...(sku?.trim() ? [sku.trim()] : []),
    ...modelTokens,
    ...splitSpecGroups(cleanSpecSource),
  ];
  const uniqueSpecGroups = uniqueGroups(specGroups);

  return {
    title: titleTokens.join(" ").replace(/\s+([,)])/g, "$1") || "Item",
    ...(uniqueSpecGroups.length > 0
      ? { spec: uniqueSpecGroups.join(" · ") }
      : {}),
    qtyLabel: `Qty ${qtyOrdered}`,
  };
}
