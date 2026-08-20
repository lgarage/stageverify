import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const helperSource = readFileSync(
  resolve(process.cwd(), "src/dispatcher/vendorItemDisplay.ts"),
  "utf8",
);
const helperJavaScript = ts.transpileModule(helperSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const helperModule = await import(
  `data:text/javascript;base64,${Buffer.from(helperJavaScript).toString("base64")}`
);
const { getVendorItemDisplay } = helperModule;

const cases = [
  {
    name: "simple product",
    input: {
      description: "MUKIT UMBRELLA MAGNETIC KIT",
      qtyOrdered: 1,
    },
    expected: {
      title: "Mukit Umbrella Magnetic Kit",
      qtyLabel: "Qty 1",
    },
  },
  {
    name: "controller prices, note, and invoice footer",
    input: {
      description:
        "CONTROLLER, 210MN 959.00 481.01 $481.01 N (ALL TX, FTV & VMAX MODELS) *NOTE: FOR TX MODELS PRIOR TO S/N 72171, AN EXTERNAL SPARK Signature Proof of Delivery: If you have any questions about your invoice, Remit To: Taxable 0.00 Johnstone Supply Tax (30305) 0.00 335 N Weber Ave TOTAL $481.01 https://siouxfalls.billtrust.com ENROLLMENT TOKEN : PMG TRP XQF",
      qtyOrdered: 1,
    },
    expected: {
      title: "Controller",
      spec: "210MN · (ALL TX, FTV & VMAX MODELS)",
      qtyLabel: "Qty 1",
    },
  },
  {
    name: "filter drier model and manufacturer",
    input: {
      description:
        "FILTER DRIER BIFLO 195.00 61.41 $61.41 N 3/8ODM 16CU ZOOMLOCK PARKER",
      qtyOrdered: 1,
    },
    expected: {
      title: "Filter Drier Biflo",
      spec: "3/8 ODM · 16 CU · Zoomlock · Parker",
      qtyLabel: "Qty 1",
    },
  },
  {
    name: "heat compound with price columns",
    input: {
      description: "HEAT COMPOUND 38.99 15.49 $30.98 N",
      qtyOrdered: 2,
    },
    expected: {
      title: "Heat Compound",
      qtyLabel: "Qty 2",
    },
  },
  {
    name: "filter drier invoice footer",
    input: {
      description:
        "FILTER DRIER 105.00 30.79 $61.58 N LIQUID 3/8ODM 16CU ZOOMLOCK PARKER If you have any questions about your invoice,",
      qtyOrdered: 2,
    },
    expected: {
      title: "Filter Drier",
      spec: "Liquid · 3/8 ODM · 16 CU · Zoomlock · Parker",
      qtyLabel: "Qty 2",
    },
  },
  {
    name: "long legitimate filter model",
    input: {
      description:
        "ZLP20242 20X24X2 Z-LINE PLEATED FILTER MERV 10 STANDARD CAPACITY",
      qtyOrdered: 7,
    },
    expected: {
      title: "Z-Line Pleated Filter MERV 10 Standard Capacity",
      spec: "ZLP20242 · 20X24X2",
      qtyLabel: "Qty 7",
    },
  },
  {
    name: "technical driver sizes",
    input: {
      description: "MSHC1 HEX DRIVER 5/16 3/8 2I",
      qtyOrdered: 1,
    },
    expected: {
      title: "Hex Driver",
      spec: "MSHC1 · 5/16 · 3/8 · 2I",
      qtyLabel: "Qty 1",
    },
  },
  {
    name: "thermostat model",
    input: {
      description: "TH8320R1003/U THERMOSTAT PROGRAMMABLE REDLINK",
      qtyOrdered: 1,
    },
    expected: {
      title: "Thermostat Programmable Redlink",
      spec: "TH8320R1003/U",
      qtyLabel: "Qty 1",
    },
  },
];

for (const testCase of cases) {
  const snapshot = structuredClone(testCase.input);
  const actual = getVendorItemDisplay(testCase.input);
  assert.deepEqual(actual, testCase.expected, testCase.name);
  assert.deepEqual(
    testCase.input,
    snapshot,
    `${testCase.name}: helper must not mutate its input`,
  );

  const rendered = `${actual.title} ${actual.spec ?? ""}`;
  assert.doesNotMatch(rendered, /\$\d|\b\d+\.\d{2}\b/, testCase.name);
  assert.doesNotMatch(
    rendered,
    /Signature Proof|questions about your invoice|Remit To|billtrust|ENROLLMENT TOKEN|Writer:/i,
    testCase.name,
  );
  console.log(`PASS: ${testCase.name} — ${actual.title}${actual.spec ? ` | ${actual.spec}` : ""} | ${actual.qtyLabel}`);
}

console.log(`All ${cases.length} vendor item display cases passed.`);
