import { assertReadableTextContrast } from "./ui-text-contrast-lib.mjs";

function isBareDash(text) {
  return text === "—" || text === "-" || text === "–";
}

/**
 * Presentation asserts for Deliveries Issue column: no-issue → OK; issue rows unchanged.
 * @param {import("playwright").Page} page
 * @param {{ viewportLabel?: string }} [opts]
 */
export async function assertDeliveriesIssueColumn(page, opts = {}) {
  const viewportLabel = opts.viewportLabel ?? "desktop";
  const table = page.getByTestId("dispatcher-deliveries-table");
  await table.waitFor({ state: "visible", timeout: 30_000 });
  await page
    .locator('[data-testid="dispatcher-deliveries-table"] tbody tr')
    .first()
    .waitFor({ state: "visible", timeout: 45_000 });

  const issueCells = page.locator('[data-testid^="delivery-issue-cell-"]');
  const cellCount = await issueCells.count();
  if (cellCount === 0) {
    throw new Error(`${viewportLabel}: no Issue cells on Deliveries table`);
  }

  let okCount = 0;
  let issueCount = 0;
  for (let i = 0; i < cellCount; i += 1) {
    const cell = issueCells.nth(i);
    const text = (await cell.innerText()).replace(/\s+/g, " ").trim();
    const hasOk =
      (await cell.locator('[data-testid^="delivery-issue-ok-"]').count()) > 0;
    const hasIssueBadge =
      (await cell.locator('[data-testid^="open-issue-badge-"]').count()) > 0;
    const hasStagingPill =
      (await cell.locator('[data-testid^="staging-assignment-pill-"]').count()) >
      0;
    const hasIssueCopy =
      text.includes("⚠") || hasIssueBadge || hasStagingPill ||
      (text.length > 0 && text !== "OK" && !isBareDash(text));

    if (hasOk) {
      if (text !== "OK") {
        throw new Error(
          `${viewportLabel}: OK cell must be exactly "OK", got "${text}"`,
        );
      }
      if (hasIssueBadge || hasStagingPill) {
        throw new Error(
          `${viewportLabel}: OK must not appear with issue badge/pill`,
        );
      }
      okCount += 1;
    } else {
      if (isBareDash(text) || text === "") {
        throw new Error(
          `${viewportLabel}: no-issue cell still shows dash/empty ("${text}")`,
        );
      }
      if (!hasIssueCopy) {
        throw new Error(
          `${viewportLabel}: issue cell unexpected text "${text}"`,
        );
      }
      issueCount += 1;
    }
  }

  if (okCount === 0 && issueCount === 0) {
    throw new Error(`${viewportLabel}: Issue column classified zero cells`);
  }

  await assertReadableTextContrast(page, {
    rootSelector: '[data-testid="dispatcher-deliveries-table"]',
    elements: [
      {
        name: "Issue OK value",
        selector: '[data-testid^="delivery-issue-ok-"]',
        optional: true,
      },
      {
        name: "open issue badge",
        selector: '[data-testid^="open-issue-badge-"]',
        optional: true,
      },
      {
        name: "staging assignment pill",
        selector: '[data-testid^="staging-assignment-pill-"]',
        optional: true,
      },
    ],
  });

  console.log(
    `PASS: Issue column ${viewportLabel} — ${okCount} OK, ${issueCount} issue rows, D-42 contrast`,
  );
  return { okCount, issueCount };
}

export async function assertDeliveriesIssueSortAndFilter(page) {
  const issueHeader = page
    .getByTestId("dispatcher-deliveries-table-header")
    .getByRole("button", { name: /Issue/i });
  if ((await issueHeader.count()) === 0) {
    throw new Error("Issue column sort header button missing");
  }
  const beforeFirst = await page
    .locator('[data-testid="dispatcher-deliveries-table"] tbody tr')
    .first()
    .getAttribute("data-order-number");
  await issueHeader.click();
  await page.waitForTimeout(400);
  await assertDeliveriesIssueColumn(page, { viewportLabel: "after-issue-sort" });
  const afterFirst = await page
    .locator('[data-testid="dispatcher-deliveries-table"] tbody tr')
    .first()
    .getAttribute("data-order-number");
  console.log(
    `PASS: Issue sort still interactive (first row ${beforeFirst} → ${afterFirst})`,
  );

  const willCall = page.getByTestId("deliveries-will-call-filter");
  if ((await willCall.count()) > 0 && (await willCall.isVisible())) {
    await willCall.click();
    await page.waitForTimeout(400);
    const filteredRows = await page
      .locator('[data-testid="dispatcher-deliveries-table"] tbody tr')
      .count();
    if (filteredRows > 0) {
      await assertDeliveriesIssueColumn(page, {
        viewportLabel: "will-call-filter",
      });
    }
    const clearBtn = page.getByRole("button", { name: /Clear/i }).first();
    if (await clearBtn.isVisible().catch(() => false)) {
      await clearBtn.click();
      await page.waitForTimeout(400);
    } else {
      await willCall.click();
      await page.waitForTimeout(400);
    }
    await assertDeliveriesIssueColumn(page, { viewportLabel: "after-clear" });
    console.log("PASS: status filter + clear still works with Issue column");
  }
}
