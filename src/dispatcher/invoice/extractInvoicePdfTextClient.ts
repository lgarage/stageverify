import { normalizeExtractedPageText } from "./pdfTextAdapter";

/** Extract plain text per page from a PDF in the browser (Slice 3 upload preview). */
export async function extractInvoicePdfTextClient(
  data: ArrayBuffer,
): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const pages: string[] = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const raw = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    pages.push(normalizeExtractedPageText(raw));
  }
  return pages.filter(Boolean);
}
