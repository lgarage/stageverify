import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  suiteFixturePrefix,
  lintFixtureSources,
} from "./lint-fixture-ids.mjs";

describe("suiteFixturePrefix", () => {
  it("derives prefix from test-*.mjs filename", () => {
    assert.equal(
      suiteFixturePrefix("scripts/test-reassign-staging-location.mjs"),
      "reassign-staging-location_",
    );
  });
});

describe("lintFixtureSources", () => {
  it("flags missing prefix including seedLocation pattern", () => {
    const source = `
import { doc, setDoc } from "firebase/firestore";
async function seedLocation(db, id, code) {
  await setDoc(doc(db, "stagingLocations", id), { id, code });
}
await seedLocation(db, "loc-g5", "G5");
`;
    const { ok, violations } = lintFixtureSources([
      { filename: "scripts/test-reassign-staging-location.mjs", source },
    ]);
    assert.equal(ok, false);
    assert.ok(
      violations.some(
        (v) =>
          v.message.includes("loc-g5") &&
          v.message.includes("reassign-staging-location_"),
      ),
    );
  });

  it("flags template seed helper with unprefixed string call site", () => {
    const source = `
import { doc, setDoc } from "firebase/firestore";
async function seed(db, id) {
  await setDoc(doc(db, "items", \`\${id}-item\`), { id });
}
await seed(db, "item-1");
`;
    const { ok, violations } = lintFixtureSources([
      { filename: "scripts/test-reassign-staging-location.mjs", source },
    ]);
    assert.equal(ok, false);
    assert.ok(violations.length > 0);
  });

  it("passes template seed helper with prefixed string call site", () => {
    const source = `
import { doc, setDoc } from "firebase/firestore";
async function seed(db, id) {
  await setDoc(doc(db, "items", \`\${id}-item\`), { id });
}
await seed(db, "reassign-staging-location_item-1");
`;
    const { ok } = lintFixtureSources([
      { filename: "scripts/test-reassign-staging-location.mjs", source },
    ]);
    assert.equal(ok, true);
  });

  it("flags duplicate ids across two suites", () => {
    const a = `
import { doc, setDoc } from "firebase/firestore";
await setDoc(doc(db, "deliveries", "shared-del"), { id: "shared-del" });
`;
    const b = `
import { doc, setDoc } from "firebase/firestore";
await setDoc(doc(db, "deliveries", "shared-del"), { id: "shared-del" });
`;
    const { ok, violations } = lintFixtureSources([
      { filename: "scripts/test-suite-a.mjs", source: a },
      { filename: "scripts/test-suite-b.mjs", source: b },
    ]);
    assert.equal(ok, false);
    assert.ok(violations.some((v) => v.message.includes("also used in")));
  });

  it("passes prefixed unique ids", () => {
    const source = `
import { doc, setDoc } from "firebase/firestore";
await setDoc(doc(db, "deliveries", "suite-a_del-1"), { id: "suite-a_del-1" });
`;
    const { ok } = lintFixtureSources([
      { filename: "scripts/test-suite-a.mjs", source },
    ]);
    assert.equal(ok, true);
  });

  it("exempts appSettings/config in multiple suites", () => {
    const snippet = `
import { doc, setDoc } from "firebase/firestore";
await setDoc(doc(db, "appSettings", "config"), { x: 1 });
`;
    const { ok } = lintFixtureSources([
      { filename: "scripts/test-one.mjs", source: snippet },
      { filename: "scripts/test-two.mjs", source: snippet },
    ]);
    assert.equal(ok, true);
  });

  it("does not exempt vendors/config", () => {
    const source = `
import { doc, setDoc } from "firebase/firestore";
await setDoc(doc(db, "vendors", "config"), { id: "config" });
`;
    const { ok, violations } = lintFixtureSources([
      { filename: "scripts/test-vendors.mjs", source },
    ]);
    assert.equal(ok, false);
    assert.ok(
      violations.some(
        (v) => v.message.includes("vendors") || v.message.includes("config"),
      ),
    );
  });

  it("accepts admin template when uid is prefixed", () => {
    const source = `
import { doc, getDoc } from "firebase/firestore";
const uid = "admin-role-auth_admin-1";
await getDoc(doc(db, "accessPinSecrets", \`admin_\${uid}\`));
`;
    const { ok } = lintFixtureSources([
      { filename: "scripts/test-admin-role-auth.mjs", source },
    ]);
    assert.equal(ok, true);
  });

  it("flags doc(db, path) ids and duplicates", () => {
    const source = `
import { doc, setDoc } from "firebase/firestore";
await setDoc(doc(db, "deliveries/del-9"), { id: "del-9" });
`;
    const one = lintFixtureSources([
      { filename: "scripts/test-suite-a.mjs", source },
    ]);
    assert.equal(one.ok, false);
    assert.ok(one.violations.some((v) => v.message.includes("del-9")));
    const two = lintFixtureSources([
      { filename: "scripts/test-suite-a.mjs", source: source.replaceAll("del-9", "suite-a_del-9") },
      { filename: "scripts/test-suite-b.mjs", source: source.replaceAll("del-9", "suite-a_del-9") },
    ]);
    assert.equal(two.ok, false);
    assert.ok(two.violations.some((v) => v.message.includes("also used in")));
  });

  it("flags for-of document id literals", () => {
    const source = `
import { doc, setDoc } from "firebase/firestore";
for (const id of ["shared-del"]) {
  await setDoc(doc(db, "deliveries", id), { id });
}
`;
    const { ok, violations } = lintFixtureSources([
      { filename: "scripts/test-suite-a.mjs", source },
    ]);
    assert.equal(ok, false);
    assert.ok(violations.some((v) => v.message.includes("shared-del")));
  });

  it("flags computed template ids that omit the suite prefix", () => {
    const bad = `
import { doc, setDoc } from "firebase/firestore";
const id = \`staging-\${code}\`;
await setDoc(doc(db, "stagingLocations", id), { id });
`;
    const badResult = lintFixtureSources([
      { filename: "scripts/test-suite-a.mjs", source: bad },
    ]);
    assert.equal(badResult.ok, false);
    const good = `
import { doc, setDoc } from "firebase/firestore";
const id = \`suite-a_staging-\${code}\`;
await setDoc(doc(db, "stagingLocations", id), { id });
`;
    const goodResult = lintFixtureSources([
      { filename: "scripts/test-suite-a.mjs", source: good },
    ]);
    assert.equal(goodResult.ok, true);
  });

  it("flags tuple for-of columns and ignores a later id binding", () => {
    const bad = `
import { doc, setDoc } from "firebase/firestore";
for (const [coll, docId] of [["trainingNoteAudit", "note-seed"]]) {
  await setDoc(doc(db, coll, docId), { id: docId });
}
const id = \`suite-a_\${code}\`;
await setDoc(doc(db, "stagingLocations", id), { id });
`;
    const badResult = lintFixtureSources([
      { filename: "scripts/test-suite-a.mjs", source: bad },
    ]);
    assert.equal(badResult.ok, false);
    assert.ok(badResult.violations.some((v) => v.message.includes("note-seed")));

    const prefixedTuple = `
import { doc, setDoc } from "firebase/firestore";
for (const [coll, docId] of [["trainingNoteAudit", "suite-a_note-seed"]]) {
  await setDoc(doc(db, coll, docId), { id: docId });
}
`;
    const prefixedResult = lintFixtureSources([
      { filename: "scripts/test-suite-a.mjs", source: prefixedTuple },
    ]);
    assert.equal(prefixedResult.ok, true);

    const laterBare = `
import { doc, setDoc } from "firebase/firestore";
for (const [coll, docId] of [["trainingNoteAudit", "suite-a_note-seed"]]) {
  await setDoc(doc(db, coll, docId), { id: docId });
}
const id = \`staging-\${code}\`;
await setDoc(doc(db, "stagingLocations", id), { id });
`;
    const laterResult = lintFixtureSources([
      { filename: "scripts/test-suite-a.mjs", source: laterBare },
    ]);
    assert.equal(laterResult.ok, false);
    assert.ok(
      laterResult.violations.some((v) => v.message.includes("computed document id")),
    );
    assert.equal(
      laterResult.violations.some((v) => v.message.includes("note-seed")),
      false,
    );
  });

  it("flags an earlier unprefixed template when a later id embeds the prefix", () => {
    const source = `
import { doc, setDoc } from "firebase/firestore";
const id = \`staging-\${code}\`;
await setDoc(doc(db, "stagingLocations", id), { id });
const id2 = \`suite-a_staging-\${code}\`;
await setDoc(doc(db, "stagingLocations", id2), { id: id2 });
const id = \`suite-a_\${code}\`;
await setDoc(doc(db, "stagingLocations", id), { id });
`;
    const { ok, violations } = lintFixtureSources([
      { filename: "scripts/test-suite-a.mjs", source },
    ]);
    assert.equal(ok, false);
    assert.ok(violations.some((v) => v.message.includes("computed document id")));
  });

  it("flags const tuple arrays, path ids, collection().doc ids, and helper args", () => {
    const tuple = `
import { doc, setDoc } from "firebase/firestore";
const ids = [["techs", "tech-resolve-1"]];
for (const [col, id] of ids) {
  await setDoc(doc(db, col, id), { id });
}
`;
    const tupleResult = lintFixtureSources([
      { filename: "scripts/test-suite-a.mjs", source: tuple },
    ]);
    assert.equal(tupleResult.ok, false);
    assert.ok(tupleResult.violations.some((v) => v.message.includes("tech-resolve-1")));

    const templateCell = `
import { doc, setDoc } from "firebase/firestore";
for (const [coll, docId] of [["deliveries", \`staging-\${code}\`]]) {
  await setDoc(doc(db, coll, docId), { id: docId });
}
`;
    const templateCellResult = lintFixtureSources([
      { filename: "scripts/test-suite-a.mjs", source: templateCell },
    ]);
    assert.equal(templateCellResult.ok, false);

    const pathIdent = `
import { doc, setDoc } from "firebase/firestore";
const path = "deliveries/del-9";
await setDoc(doc(db, path), { id: "del-9" });
`;
    const pathResult = lintFixtureSources([
      { filename: "scripts/test-suite-a.mjs", source: pathIdent },
    ]);
    assert.equal(pathResult.ok, false);
    assert.ok(pathResult.violations.some((v) => v.message.includes("del-9")));

    const pathTemplate = `
import { doc, setDoc } from "firebase/firestore";
const id = "del-9";
await setDoc(doc(db, \`deliveries/\${id}\`), { id });
`;
    const pathTemplateResult = lintFixtureSources([
      { filename: "scripts/test-suite-a.mjs", source: pathTemplate },
    ]);
    assert.equal(pathTemplateResult.ok, false);

    const collectionDoc = `
import { collection, doc, setDoc } from "firebase/firestore";
await setDoc(doc(collection(db, "deliveries"), "del-9"), { id: "del-9" });
`;
    const collectionResult = lintFixtureSources([
      { filename: "scripts/test-suite-a.mjs", source: collectionDoc },
    ]);
    assert.equal(collectionResult.ok, false);
    assert.ok(collectionResult.violations.some((v) => v.message.includes("del-9")));

    const helper = `
import { doc, setDoc } from "firebase/firestore";
function seed(db, id) {
  return setDoc(doc(db, "items", id), { id });
}
const itemId = \`item-\${n}\`;
await seed(db, itemId);
`;
    const helperResult = lintFixtureSources([
      { filename: "scripts/test-suite-a.mjs", source: helper },
    ]);
    assert.equal(helperResult.ok, false);

    const repeated = `
import { doc, setDoc } from "firebase/firestore";
await setDoc(doc(db, "vendorSessions", "a".repeat(64)), { id: "a".repeat(64) });
`;
    const repeatedResult = lintFixtureSources([
      { filename: "scripts/test-suite-a.mjs", source: repeated },
      { filename: "scripts/test-suite-b.mjs", source: repeated },
    ]);
    assert.equal(repeatedResult.ok, false);
    assert.ok(repeatedResult.violations.some((v) => v.message.includes("also used in")));
  });

  it("flags property, paren, and destructured document ids", () => {
    const source = `
import { doc, setDoc } from "firebase/firestore";
const spec = { id: "shared-del" };
await setDoc(doc(db, "deliveries", spec.id), { id: spec.id });
await setDoc(doc(db, "deliveries", ("del-9")), { id: "del-9" });
const { id } = { id: "del-8" };
await setDoc(doc(db, "deliveries", id), { id });
`;
    const { ok, violations } = lintFixtureSources([
      { filename: "scripts/test-suite-a.mjs", source },
    ]);
    assert.equal(ok, false);
    assert.ok(violations.some((v) => v.message.includes("shared-del")));
    assert.ok(violations.some((v) => v.message.includes("del-9")));
    assert.ok(violations.some((v) => v.message.includes("del-8")));
  });

  it("flags element access, spread, nested, and fallback document ids", () => {
    const cases = [
      `const spec = { id: "shared-del" }; await setDoc(doc(db, "deliveries", spec["id"]), {});`,
      `const spec = { ...{ id: "shared-del" } }; await setDoc(doc(db, "deliveries", spec.id), {});`,
      `const spec = { delivery: { id: "del-9" } }; await setDoc(doc(db, "deliveries", spec.delivery.id), {});`,
      `const spec = { id: "suite-a_del" }; const itemSpecs = spec.items ?? [{ id: "item-bare" }]; for (const item of itemSpecs) { await setDoc(doc(db, "items", item.id), {}); }`,
    ];
    for (const body of cases) {
      const source = `import { doc, setDoc } from "firebase/firestore";\n${body}\n`;
      const { ok } = lintFixtureSources([
        { filename: "scripts/test-suite-a.mjs", source },
      ]);
      assert.equal(ok, false, body);
    }
  });

  it("flags duplicate suite prefix slugs", () => {
    const source = `import { doc } from "firebase/firestore";`;
    const { ok, violations } = lintFixtureSources([
      { filename: "scripts/test-foo.mjs", source },
      { filename: "scripts/foo.mjs", source },
    ]);
    assert.equal(ok, false);
    assert.ok(violations.some((v) => v.message.includes("duplicate suite prefix")));
  });
});
