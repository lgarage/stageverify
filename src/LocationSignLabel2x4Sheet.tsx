import {
  buildPermanentLocationUrl,
} from "./receiveQrUrls";
import { EslQrCode } from "./EslQrCode";
import { normalizeLocationSignCode } from "./LocationSignPrintSheet";
import { CATCH_ALL_SIGN_HEADLINE } from "./locationSignPrintSort";

/** 2in label − 0.25in top − 0.25in bottom QR clearance ≈ 1.5in @ 96dpi */
export const ESL_QR_SIZE_2X4_LABEL = 144;

export type LocationSignLabel2x4Entry = {
  locationCode: string;
  headlineText?: string;
};

const LABELS_PER_PAGE = 8;

function chunk<T>(items: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    pages.push(items.slice(i, i + size));
  }
  return pages;
}

type LabelCellProps = {
  entry: LocationSignLabel2x4Entry | null;
};

function Label2x4Cell({ entry }: LabelCellProps) {
  if (!entry) {
    return (
      <div
        className="location-sign-2x4-label location-sign-2x4-label--blank"
        data-testid="location-sign-2x4-label"
        data-blank="true"
        aria-hidden
      />
    );
  }
  const code = normalizeLocationSignCode(entry.locationCode);
  const headline = entry.headlineText?.trim() || code;
  const qrUrl = code ? buildPermanentLocationUrl(code, { forPrint: true }) : "";
  if (!code) return null;

  const isCatchAll = headline === CATCH_ALL_SIGN_HEADLINE;
  const codeClassName = isCatchAll
    ? "location-sign-2x4-label-code location-sign-2x4-label-code--catch-all"
    : "location-sign-2x4-label-code";

  return (
    <div
      className="location-sign-2x4-label"
      data-testid="location-sign-2x4-label"
      data-location-code={code}
      data-sign-headline={headline}
      data-permanent-url={qrUrl}
    >
      <div className={codeClassName} data-testid="location-sign-code">
        {headline}
      </div>
      <div className="location-sign-2x4-label-qr">
        <EslQrCode
          value={qrUrl}
          variant="print"
          size={ESL_QR_SIZE_2X4_LABEL}
        />
      </div>
    </div>
  );
}

type PageProps = {
  entries: LocationSignLabel2x4Entry[];
  pageIndex: number;
  totalPages: number;
};

function LocationSignLabel2x4Page({ entries, pageIndex, totalPages }: PageProps) {
  const cells: (LocationSignLabel2x4Entry | null)[] = [...entries];
  while (cells.length < LABELS_PER_PAGE) {
    cells.push(null);
  }

  const rows: [(LocationSignLabel2x4Entry | null), (LocationSignLabel2x4Entry | null)][] =
    [];
  for (let r = 0; r < 4; r++) {
    rows.push([cells[r * 2] ?? null, cells[r * 2 + 1] ?? null]);
  }

  return (
    <div
      className="location-sign-2x4-page location-sign-print-sheet--batch"
      data-testid="location-sign-2x4-page"
      data-page-index={pageIndex}
      data-page-count={totalPages}
    >
      <div className="location-sign-2x4-letter">
        <div className="location-sign-2x4-block">
          {rows.map((pair, rowIdx) => (
            <div key={rowIdx} className="location-sign-2x4-row-wrap">
              {rowIdx > 0 ? (
                <div
                  className="location-sign-2x4-row-gutter"
                  aria-hidden
                />
              ) : null}
              <div className="location-sign-2x4-row">
                <Label2x4Cell entry={pair[0]} />
                <div className="location-sign-2x4-col-gutter" aria-hidden />
                <Label2x4Cell entry={pair[1]} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** US Letter pages of 2×4 grid (8 labels per page, 4in×2in each). */
export function LocationSignLabel2x4Pages({
  entries,
}: {
  entries: LocationSignLabel2x4Entry[];
}) {
  if (entries.length === 0) return null;
  const pages = chunk(entries, LABELS_PER_PAGE);
  return (
    <>
      {pages.map((pageEntries, idx) => (
        <LocationSignLabel2x4Page
          key={`2x4-page-${idx}`}
          entries={pageEntries}
          pageIndex={idx}
          totalPages={pages.length}
        />
      ))}
    </>
  );
}

export const LOCATION_SIGN_2X4_PRINT_STYLES = `
  .location-sign-2x4-letter {
    box-sizing: border-box;
    min-height: 11in;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    margin: 0;
  }
  .location-sign-2x4-block {
    position: relative;
    box-sizing: border-box;
  }
  .location-sign-2x4-block::before {
    content: "";
    position: absolute;
    left: calc(4in + 0.125in);
    top: 0;
    bottom: 0;
    width: 0;
    border-left: 1px dotted #000;
    pointer-events: none;
    z-index: 2;
  }
  .location-sign-2x4-row {
    display: flex;
    flex-direction: row;
    align-items: stretch;
    justify-content: flex-start;
    flex-shrink: 0;
    width: calc(4in + 0.25in + 4in);
    box-sizing: border-box;
  }
  .location-sign-2x4-col-gutter {
    flex: 0 0 0.25in;
    width: 0.25in;
    min-width: 0.25in;
    flex-shrink: 0;
  }
  .location-sign-2x4-row-gutter {
    width: calc(4in + 0.25in + 4in);
    height: 0.125in;
    margin: 0 auto;
    border-bottom: 1px dotted #000;
    box-sizing: content-box;
    padding-bottom: 0.125in;
  }
  .location-sign-2x4-label {
    position: relative;
    top: 0.125in;
    box-sizing: border-box;
    flex: 0 0 4in;
    flex-shrink: 0;
    width: 4in;
    min-width: 4in;
    height: 2in;
    border: 2px solid #000;
    background: #fff;
    color: #000;
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    column-gap: 0.06in;
    padding: 0.25in 0.25in 0.25in 0;
    overflow: hidden;
  }
  .location-sign-2x4-label--blank {
    border-color: transparent;
    background: transparent;
  }
  .location-sign-2x4-label-code {
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: clamp(36px, 8vw, 72px);
    font-weight: 900;
    line-height: 1.05;
    letter-spacing: -0.03em;
    color: #000;
    text-align: center;
  }
  .location-sign-2x4-label-code--catch-all {
    font-size: clamp(36px, 8vw, 72px);
    line-height: 1.08;
    letter-spacing: -0.02em;
  }
  .location-sign-2x4-label-qr {
    flex-shrink: 0;
    line-height: 0;
    background: #fff;
  }

  @media print {
    .location-sign-2x4-row,
    .location-sign-2x4-label,
    .location-sign-2x4-col-gutter {
      flex-shrink: 0 !important;
    }
    .location-sign-2x4-page {
      break-after: page;
      page-break-after: always;
    }
    .location-sign-2x4-page:last-child {
      break-after: auto;
      page-break-after: auto;
    }
    .location-sign-print-page[data-batch-label-size="label2x4"] .location-sign-2x4-page {
      page: label2x4;
    }
  }
`;
