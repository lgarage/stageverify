import type {
  ShopStockLine,
  ShopStockLocationMapping,
} from "./models";
import { normalizeStagingCodeKey } from "./stagingCode";

/** Thrown when assigning vendor staging to a permanently reserved shop-stock code. */
export class ShopStockLocationReservedError extends Error {
  readonly code = "SHOP_STOCK_LOCATION_RESERVED";
  readonly locationCode: string;
  readonly stockItemLabel: string;

  constructor(locationCode: string, stockItemLabel: string) {
    super(
      `Zone ${locationCode} is permanently reserved for shop stock (${stockItemLabel}). Pick another spot.`,
    );
    this.name = "ShopStockLocationReservedError";
    this.locationCode = locationCode;
    this.stockItemLabel = stockItemLabel;
  }
}

export function isShopStockLocationReservedError(
  err: unknown,
): err is ShopStockLocationReservedError {
  return err instanceof ShopStockLocationReservedError;
}

export function reservedLocationCodesForMapping(
  mapping: ShopStockLocationMapping,
): string[] {
  const members = mapping.memberLocationCodes?.length
    ? mapping.memberLocationCodes
    : [mapping.locationCode];
  return members.map((code) => code.trim()).filter((code) => code.length > 0);
}

export function formatMappingLocationHeader(
  mapping: ShopStockLocationMapping,
): string {
  const group = mapping.combinationGroupLabel?.trim();
  if (group) return group;
  const code = mapping.locationCode.trim();
  const label = mapping.stockItemLabel.trim();
  if (code && label) return `${code} — ${label}`;
  return code || label || "Shop stock";
}

/** Active mapping reserving each normalized location code. */
export function mapActiveShopStockReservationsByCode(
  mappings: ShopStockLocationMapping[],
): Record<string, ShopStockLocationMapping> {
  const byCode: Record<string, ShopStockLocationMapping> = {};
  for (const mapping of mappings) {
    if (!mapping.active) continue;
    for (const code of reservedLocationCodesForMapping(mapping)) {
      byCode[normalizeStagingCodeKey(code)] = mapping;
    }
  }
  return byCode;
}

export function findShopStockMappingForLocationCode(
  locationCode: string,
  mappings: ShopStockLocationMapping[],
): ShopStockLocationMapping | undefined {
  const key = normalizeStagingCodeKey(locationCode);
  return mapActiveShopStockReservationsByCode(mappings)[key];
}

const QTY_LINE_RE =
  /^(\d+)\s*[x×]\s*(.+)$/i;

export function parsePickListLine(line: string): {
  qty: number;
  description: string;
} {
  const trimmed = line.trim();
  const match = trimmed.match(QTY_LINE_RE);
  if (match) {
    const qty = Number.parseInt(match[1], 10);
    const description = match[2].trim();
    if (qty > 0 && description.length > 0) {
      return { qty, description };
    }
  }
  return { qty: 1, description: trimmed };
}

export function buildShopStockLinesFromPickList(
  items: string[],
  mappings: ShopStockLocationMapping[],
  linkedMappingId?: string,
): ShopStockLine[] {
  const mappingById = new Map(mappings.map((m) => [m.id, m]));
  const linked =
    linkedMappingId !== undefined
      ? mappingById.get(linkedMappingId)
      : undefined;

  return items.map((line) => {
    const { qty, description } = parsePickListLine(line);
    const matched =
      linked ??
      mappings.find(
        (m) =>
          m.active &&
          (description.toLowerCase().includes(m.stockItemLabel.toLowerCase()) ||
            line.toLowerCase().includes(m.locationCode.toLowerCase())),
      );

    return {
      id: `ssl-${crypto.randomUUID()}`,
      description,
      qty,
      shopStockLocationCode: matched?.locationCode,
      shopStockMappingId: matched?.id,
    };
  });
}

export function shopStockLocationNoteFromLines(
  lines: ShopStockLine[],
  mappings: ShopStockLocationMapping[],
): string {
  const mappingById = new Map(mappings.map((m) => [m.id, m]));
  for (const line of lines) {
    if (!line.shopStockMappingId) continue;
    const mapping = mappingById.get(line.shopStockMappingId);
    if (mapping) return formatMappingLocationHeader(mapping);
  }
  const firstCode = lines.find((l) => l.shopStockLocationCode)?.shopStockLocationCode;
  return firstCode?.trim() ?? "";
}

export function hasShopStockPickListContent(delivery: {
  shopStockPickListItems?: string[];
  shopStockLines?: ShopStockLine[];
}): boolean {
  return (
    (delivery.shopStockPickListItems?.length ?? 0) > 0 ||
    (delivery.shopStockLines?.length ?? 0) > 0
  );
}

export function shopStockPickListLabels(delivery: {
  shopStockPickListItems?: string[];
  shopStockLines?: ShopStockLine[];
}): string[] {
  if (delivery.shopStockLines?.length) {
    return delivery.shopStockLines.map((line) => {
      const qtyPrefix = line.qty > 1 ? `${line.qty} × ` : "";
      return `${qtyPrefix}${line.description}`;
    });
  }
  return delivery.shopStockPickListItems ?? [];
}
