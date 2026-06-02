import type { DeliveryOrder } from "./models";

/** Parse dispatcher textarea: one pick-list item per non-empty line. */
export function parseShopStockPickListLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function formatShopStockPickListForEditor(
  items: string[] | undefined,
): string {
  return items?.join("\n") ?? "";
}

export function hasShopStockPickList(delivery: DeliveryOrder): boolean {
  return (delivery.shopStockPickListItems?.length ?? 0) > 0;
}

export function shopStockItemKey(deliveryId: string, index: number): string {
  return `${deliveryId}:${index}`;
}
