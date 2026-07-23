/**
 * Reusable Playwright readable-text / contrast asserts (D-42).
 * Import in route verify scripts; call assertReadableTextContrast on changed surfaces.
 */

export const MIN_TEXT_CONTRAST = 4.5;
export const MIN_LARGE_TEXT_CONTRAST = 3;

/**
 * @param {import('playwright').Page} page
 * @param {{
 *   rootSelector: string;
 *   elements: Array<{ name: string; selector: string; large?: boolean; optional?: boolean }>;
 *   minText?: number;
 *   minLarge?: number;
 * }} spec
 */
export async function assertReadableTextContrast(page, spec) {
  const {
    rootSelector,
    elements,
    minText = MIN_TEXT_CONTRAST,
    minLarge = MIN_LARGE_TEXT_CONTRAST,
  } = spec;

  const result = await page.evaluate(
    ({ rootSelector, elements, minText, minLarge }) => {
      const parseColor = (color) => {
        const m = color.match(
          /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/,
        );
        if (!m) return null;
        return {
          r: Number(m[1]),
          g: Number(m[2]),
          b: Number(m[3]),
          a: m[4] !== undefined ? Number(m[4]) : 1,
        };
      };

      const relativeLuminance = (r, g, b) => {
        const lin = [r, g, b].map((c) => {
          const s = c / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
      };

      const contrastRatio = (fg, bg) => {
        const l1 = relativeLuminance(fg.r, fg.g, fg.b);
        const l2 = relativeLuminance(bg.r, bg.g, bg.b);
        const lighter = Math.max(l1, l2);
        const darker = Math.min(l1, l2);
        return (lighter + 0.05) / (darker + 0.05);
      };

      const getEffectiveBackground = (el) => {
        let node = el;
        while (node) {
          const bg = getComputedStyle(node).backgroundColor;
          const parsed = parseColor(bg);
          if (parsed && parsed.a >= 0.95) return parsed;
          node = node.parentElement;
        }
        return { r: 240, g: 242, b: 245, a: 1 };
      };

      const isNearWhite = (rgb) =>
        rgb.r >= 230 && rgb.g >= 230 && rgb.b >= 230;

      const root = document.querySelector(rootSelector);
      if (!root) return { ok: false, error: `${rootSelector} missing` };

      const failures = [];
      for (const check of elements) {
        const el = root.querySelector(check.selector);
        if (!el) {
          if (check.optional) continue;
          failures.push(`${check.name}: element not found (${check.selector})`);
          continue;
        }
        const fg = parseColor(getComputedStyle(el).color);
        const bg = getEffectiveBackground(el);
        if (!fg) {
          failures.push(`${check.name}: could not parse text color`);
          continue;
        }
        if (isNearWhite(fg) && isNearWhite(bg)) {
          failures.push(
            `${check.name}: white/near-white text (${getComputedStyle(el).color}) on light background (rgb(${bg.r},${bg.g},${bg.b}))`,
          );
          continue;
        }
        const ratio = contrastRatio(fg, bg);
        const min = check.large ? minLarge : minText;
        if (ratio < min) {
          failures.push(
            `${check.name}: contrast ${ratio.toFixed(2)}:1 < ${min}:1`,
          );
        }
      }

      if (failures.length) return { ok: false, error: failures.join("; ") };
      return { ok: true };
    },
    { rootSelector, elements, minText, minLarge },
  );

  if (!result.ok) {
    throw new Error(`Readable text contrast: ${result.error}`);
  }
}

/** Technicians Settings panel — first concrete route check (D-42). */
export const TECHNICIAN_PANEL_CONTRAST_SPEC = {
  rootSelector: '[data-testid="technician-settings-panel"]',
  elements: [
    { name: "section title", selector: "div > div:first-child", large: true },
    { name: "helper paragraph", selector: "p", large: false },
    { name: "release heading", selector: "h3", large: true },
    { name: "technician select", selector: "select", large: false },
    {
      name: "name input",
      selector: 'input[placeholder="Technician name"]',
      large: false,
    },
    {
      name: "pin input",
      selector: 'input[placeholder="4-digit PIN"]',
      large: false,
    },
    { name: "job checkbox row", selector: "label", large: false, optional: true },
    {
      name: "technician list row",
      selector: "li span",
      large: false,
      optional: true,
    },
    {
      name: "badge preview",
      selector: '[data-testid^="technician-badge-preview-"]',
      large: false,
      optional: true,
    },
    {
      name: "permission checkbox label",
      selector: 'label:has(input[data-testid^="technician-perm-"])',
      large: false,
      optional: true,
    },
  ],
};

/** Drawer job-release panel — dispatcher per-job release (D-40 UI). */
export const JOB_RELEASE_PANEL_CONTRAST_SPEC = {
  rootSelector: '[data-testid="job-release-to-technician-panel"]',
  elements: [
    {
      name: "panel heading",
      selector: '[data-testid="job-release-panel-heading"]',
      large: true,
    },
    {
      name: "technician select",
      selector: '[data-testid="job-release-technician-select"]',
      large: false,
      optional: true,
    },
    {
      name: "release button",
      selector: '[data-testid="job-release-submit"]',
      large: false,
      optional: true,
    },
    {
      name: "edit button",
      selector: '[data-testid="job-release-edit-btn"]',
      large: false,
      optional: true,
    },
    {
      name: "cancel edit button",
      selector: '[data-testid="job-release-cancel-edit"]',
      large: false,
      optional: true,
    },
    {
      name: "current release badge",
      selector: '[data-testid^="job-release-current-badge-"]',
      large: false,
      optional: true,
    },
    {
      name: "not released hint",
      selector: '[data-testid="job-release-current-empty"]',
      large: false,
      optional: true,
    },
  ],
};

/** Deliveries table Released To badge. */
export const RELEASED_TO_BADGE_CONTRAST_SPEC = {
  rootSelector: "table tbody tr",
  elements: [
    {
      name: "released to badge",
      selector: '[data-testid^="released-to-badge-"]',
      large: false,
      optional: true,
    },
  ],
};
