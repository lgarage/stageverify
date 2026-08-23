interface VendorCompactDeliveryCardProps {
  deliveryId: string;
  variant: "vendor-run" | "vendor-job";
  jobName?: string;
  orderNumber: string;
  vendorInvoiceNumber?: string;
  poNumber?: string;
  stagingLocationCodes: string[];
  /** Physical drop-off confirmation — used for PR #173 sort, not order status. */
  delivered: boolean;
  /** Authoritative order-level fulfillment for the face badge/color. */
  fulfillment?: "delivered" | "partial" | "incomplete";
  expanded?: boolean;
  warning?: string;
}

function cleanValue(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

export function VendorCompactDeliveryCard({
  deliveryId,
  variant,
  jobName,
  orderNumber,
  vendorInvoiceNumber,
  poNumber,
  stagingLocationCodes,
  delivered,
  fulfillment,
  expanded = false,
  warning,
}: VendorCompactDeliveryCardProps) {
  const cleanedOrder = cleanValue(orderNumber) ?? "—";
  const cleanedJobName = cleanValue(jobName);
  const primaryHeading =
    cleanedJobName?.toLocaleLowerCase() === "job" || !cleanedJobName
      ? cleanedOrder
      : cleanedJobName;
  const cleanedInvoice = cleanValue(vendorInvoiceNumber);
  const cleanedPo = cleanValue(poNumber) ?? "—";
  const invoiceMatchesOrder =
    cleanedInvoice?.localeCompare(cleanedOrder, undefined, {
      sensitivity: "base",
    }) === 0;
  const locationIdentity =
    stagingLocationCodes.length > 0 ? stagingLocationCodes.join(", ") : "Not assigned";
  const tone = fulfillment ?? (delivered ? "delivered" : "incomplete");
  const showDeliveredBadge = tone === "delivered";
  const showPartialBadge = tone === "partial";
  const primaryTestId =
    variant === "vendor-run"
      ? showDeliveredBadge
        ? `vendor-run-delivered-location-${deliveryId}`
        : `vendor-run-location-${deliveryId}`
      : `vendor-job-name-${deliveryId}`;

  return (
    <div
      className={`vendor-compact-card-face ${
        tone === "delivered"
          ? "vendor-compact-card-face-delivered"
          : tone === "partial"
            ? "vendor-compact-card-face-partial"
            : ""
      }`}
      data-testid={
        variant === "vendor-run" && showDeliveredBadge
          ? `vendor-run-delivered-summary-${deliveryId}`
          : variant === "vendor-run" && showPartialBadge
            ? `vendor-run-partial-summary-${deliveryId}`
            : undefined
      }
      data-fulfillment={tone}
    >
      <div className="vendor-compact-card-heading">
        <p
          className="vendor-compact-card-job"
          data-testid={primaryTestId}
        >
          {primaryHeading}
        </p>
        {showDeliveredBadge && (
          <span
            className="vendor-compact-card-status"
            data-testid={
              variant === "vendor-run"
                ? `vendor-run-delivered-status-${deliveryId}`
                : `vendor-job-delivered-status-${deliveryId}`
            }
          >
            DELIVERED
          </span>
        )}
        {showPartialBadge && (
          <span
            className="vendor-compact-card-status vendor-compact-card-status-partial"
            data-testid={
              variant === "vendor-run"
                ? `vendor-run-partial-status-${deliveryId}`
                : `vendor-job-partial-status-${deliveryId}`
            }
          >
            PARTIAL
          </span>
        )}
      </div>

      <dl
        className="vendor-compact-card-meta"
        data-testid={
          variant === "vendor-run" && !delivered
            ? `vendor-run-job-${deliveryId}`
            : undefined
        }
      >
        <div className="vendor-compact-card-field">
          <dt>{invoiceMatchesOrder ? "Order / Invoice #" : "Order #"}</dt>
          <dd
            className={`vendor-compact-card-order ${
              invoiceMatchesOrder ? "vendor-compact-card-invoice" : ""
            }`}
          >
            {cleanedOrder}
          </dd>
        </div>
        {cleanedInvoice && !invoiceMatchesOrder && (
          <div className="vendor-compact-card-field">
            <dt>Invoice #</dt>
            <dd className="vendor-compact-card-invoice">{cleanedInvoice}</dd>
          </div>
        )}
        <div className="vendor-compact-card-field">
          <dt>PO #</dt>
          <dd className="vendor-compact-card-po">{cleanedPo}</dd>
        </div>
      </dl>

      <div className="vendor-compact-card-footer">
        <span
          className="vendor-compact-card-location"
          data-testid={
            variant === "vendor-run" && showDeliveredBadge
              ? `vendor-run-delivered-location-tile-${deliveryId}`
              : undefined
          }
        >
          <span className="vendor-compact-card-location-label">Staging</span>
          <span className="vendor-compact-card-location-value">
            {locationIdentity}
          </span>
        </span>
        <span
          className={`vendor-compact-card-chevron ${
            expanded ? "vendor-compact-card-chevron-expanded" : ""
          }`}
          aria-hidden
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </span>
      </div>

      {warning && <p className="vendor-compact-card-warning">{warning}</p>}
    </div>
  );
}
