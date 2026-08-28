/**
 * Playwright helper — click Confirm on the invoice review decision panel.
 */
export async function confirmInvoiceReviewDecision(page) {
  const panel = page.getByTestId("invoice-review-decision-confirm");
  await panel.waitFor({ timeout: 5000 });
  await page.getByTestId("invoice-review-decision-confirm-action").click();
}
