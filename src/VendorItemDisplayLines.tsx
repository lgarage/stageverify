import { getVendorItemDisplay } from "./dispatcher/vendorItemDisplay";

interface VendorItemDisplayLinesProps {
  description: string;
  sku?: string;
  qtyOrdered: number;
  completed?: boolean;
  lineStatus?: "Backordered" | "Not Delivered" | "Partial Delivery" | "Delivered" | null;
}

export function VendorItemDisplayLines({
  description,
  sku,
  qtyOrdered,
  completed = false,
  lineStatus = null,
}: VendorItemDisplayLinesProps) {
  const display = getVendorItemDisplay({ description, sku, qtyOrdered });
  const completedClass = completed ? " line-through" : "";
  const statusClass =
    lineStatus === "Backordered"
      ? "vendor-item-status-backordered"
      : lineStatus === "Not Delivered"
        ? "vendor-item-status-not-delivered"
        : lineStatus === "Partial Delivery"
          ? "vendor-item-status-partial"
          : lineStatus === "Delivered"
            ? "vendor-item-status-delivered"
            : "";

  return (
    <>
      <span className="flex items-start justify-between gap-2">
        <span
          className={`min-w-0 block text-sm font-medium leading-snug ${
            completed ? "text-text-secondary" : "text-text-primary"
          }${completedClass}`}
          data-testid="vendor-item-title"
        >
          {display.title}
        </span>
        {lineStatus && (
          <span
            className={`vendor-item-status-badge ${statusClass}`}
            data-testid="vendor-item-line-status"
          >
            {lineStatus === "Backordered"
              ? "BACKORDERED"
              : lineStatus === "Not Delivered"
                ? "NOT DELIVERED"
                : lineStatus === "Partial Delivery"
                  ? "PARTIAL"
                  : "DELIVERED"}
          </span>
        )}
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
