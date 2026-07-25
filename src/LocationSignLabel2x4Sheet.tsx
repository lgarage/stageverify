import {
  buildPermanentLocationUrl,
  ESL_QR_SIZE_PRINT,
} from "./receiveQrUrls";
import { EslQrCode } from "./EslQrCode";
import { normalizeLocationSignCode } from "./LocationSignPrintSheet";

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

  return (
    <div
      className="location-sign-2x4-label"
      data-testid="location-sign-2x4-label"
      data-location-code={code}
      data-sign-headline={headline}
      data-permanent-url={qrUrl}
    >
      <div
        className="location-sign-2x4-label-code"
        data-testid="location-sign-code"
      >
        {headline}
      </div>
      <div className="location-sign-2x4-label-qr">
        <EslQrCode value={qrUrl} variant="print" size={ESL_QR_SIZE_PRINT} />
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
    justify-content: center;
  }
  .location-sign-2x4-col-gutter {
    flex: 0 0 0.25in;
    width: 0.25in;
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
    box-sizing: border-box;
    width: 4in;
    height: 2in;
    border: 2px solid #000;
    background: #fff;
    color: #000;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 0.08in;
    padding: 0.1in 0.12in;
    overflow: hidden;
  }
  .location-sign-2x4-label--blank {
    border-color: transparent;
    background: transparent;
  }
  .location-sign-2x4-label-code {
    flex: 1 1 auto;
    min-width: 0;
    font-size: clamp(18px, 4vw, 36px);
    font-weight: 900;
    line-height: 1.05;
    letter-spacing: -0.03em;
    color: #000;
    text-align: left;
  }
  .location-sign-2x4-label-qr {
    flex: 0 0 auto;
    line-height: 0;
    border: 1px solid #000;
    padding: 2px;
    background: #fff;
  }

  @media print {
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
