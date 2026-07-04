/**
 * Extract text from a Johnstone PDF for Phase 1 field checklist baseline.
 * Usage: node scripts/extract-pdf-text.mjs <path-to.pdf>
 */
import { readFileSync } from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pdfParse = require("../functions/node_modules/pdf-parse");

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error("Usage: node scripts/extract-pdf-text.mjs <pdf-path>");
  process.exit(1);
}

const buffer = readFileSync(pdfPath);
const result = await pdfParse(buffer);
console.log(`pages: ${result.numpages}, text length: ${result.text.length}\n`);
console.log(result.text.slice(0, 2500));
console.log("\n--- field probes ---");
const text = result.text;
const probes = [
  ["Customer #", /Customer\s*#/i.test(text)],
  ["Sales Order #", /Sales Order\s*#/i.test(text)],
  ["Invoice #", /Invoice\s*#/i.test(text)],
  ["4046362", /4046362/.test(text)],
  ["54632502", /54632502/.test(text)],
  ["P411190", /P411190/.test(text)],
  ["LN QNTY ORD", /LN QNTY ORD/i.test(text)],
  ["Readable ASCII ratio", (text.replace(/[^\x20-\x7E\n\r\t]/g, "").length / Math.max(text.length, 1)) > 0.7],
];
for (const [label, ok] of probes) console.log(`  ${label}: ${ok ? "yes" : "no"}`);
