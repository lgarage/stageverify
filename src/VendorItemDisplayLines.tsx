import { getVendorItemDisplay } from "./dispatcher/vendorItemDisplay";

interface VendorItemDisplayLinesProps {
  description: string;
  sku?: string;
  qtyOrdered: number;
  completed?: boolean;
}

export function VendorItemDisplayLines({
  description,
  sku,
  qtyOrdered,
  completed = false,
}: VendorItemDisplayLinesProps) {
  const display = getVendorItemDisplay({ description, sku, qtyOrdered });
  const completedClass = completed ? " line-through" : "";

  return (
    <>
      <span
        className={`block text-sm font-medium leading-snug ${
          completed ? "text-text-secondary" : "text-text-primary"
        }${completedClass}`}
        data-testid="vendor-item-title"
      >
        {display.title}
      </span>
      {display.spec && (
        <span
          className={`mt-0.5 block text-xs text-text-secondary${completedClass}`}
          data-testid="vendor-item-spec"
        >
          {display.spec}
        </span>
      )}
      <span
        className={`mt-1 block text-xs text-text-secondary${completedClass}`}
        data-testid="vendor-item-qty"
      >
        {display.qtyLabel}
      </span>
    </>
  );
}
