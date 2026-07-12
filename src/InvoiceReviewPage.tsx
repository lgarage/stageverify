import { Navigate } from "react-router-dom";

/**
 * Deep-link shim: Invoice Review lives on Delivery Overview Needs Review.
 * Keeps `#/invoice-review` working for bookmarks / old links.
 */
export function InvoiceReviewPage() {
  return <Navigate to="/dispatcher?focus=needs-review" replace />;
}
