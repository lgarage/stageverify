/**
 * Lint Firestore fixture document IDs in scripts/test-*.mjs for per-suite prefixes.
 * CLI: node scripts/lint-fixture-ids.mjs [--fix]
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/** @typedef {{ file: string, line: number, message: string }} Violation */
/** @typedef {{ filename: string, source: string }} FixtureSourceFile */

const EXEMPT_IDS = new Set([
  "appSettings/config",
  "emailProviderConnections/gmail",
  "emailProviderSecrets/gmail",
]);

const PIN_DOC_ID_CALLEES = new Set([
  "accessPinSecretDocId",
  "legacyAccessPinUniquenessDocId",
]);

const PIN_DOC_ID_SKIP_PREFIX = new Set(["accessPinUniquenessDocId"]);

/**
 * @param {string} filename
 */
export function suiteFixturePrefix(filename) {
  const base = path.basename(filename).replace(/\.mjs$/, "");
  const slug = base.startsWith("test-") ? base.slice("test-".length) : base;
  if (!slug || slug.includes(":") || slug.includes("_")) {
    throw new Error(`bad suite name: ${filename}`);
  }
  return `${slug}_`;
}

/** @param {string} id */
function isDigitPinLiteral(id) {
  return /^\d{4,6}$/.test(id);
}

/**
 * Session tokens and pin codes are charset-constrained. They stay unprefixed
 * and are still compared across suites for collisions.
 * @param {string} id
 */
function isFormatConstrainedId(id) {
  return isDigitPinLiteral(id) || /^[a-f0-9]{32}$/.test(id) || /^[a-f0-9]{64}$/.test(id);
}

/**
 * `"a".repeat(64)` when both the text and the count are literals.
 * @param {ts.Expression} expr
 * @returns {string | null}
 */
function repeatedStringValue(expr) {
  if (!ts.isCallExpression(expr) || !ts.isPropertyAccessExpression(expr.expression)) {
    return null;
  }
  if (expr.expression.name.text !== "repeat" || expr.arguments.length !== 1) return null;
  const base = stringLiteralText(expr.expression.expression);
  const countExpr = expr.arguments[0];
  if (base === null || !ts.isNumericLiteral(countExpr)) return null;
  const count = Number(countExpr.text);
  if (!Number.isInteger(count) || count < 0 || count > 256) return null;
  return base.repeat(count);
}

/**
 * @param {string} collection
 * @param {string} id
 */
function isExemptPair(collection, id) {
  if (collection === "vendorBusinessInvoiceKeys" && id.startsWith("key:")) {
    return true;
  }
  return EXEMPT_IDS.has(`${collection}/${id}`);
}

/**
 * @param {ts.SourceFile} sf
 * @param {ts.Node} node
 */
function lineOf(sf, node) {
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return line + 1;
}

/**
 * @param {ts.Node} node
 * @returns {string | null}
 */
function stringLiteralText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return null;
}

/**
 * @param {ts.CallExpression} call
 * @returns {string | null}
 */
function callExpressionName(call) {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

/**
 * @param {ts.Expression} idExpr
 * @param {FileContext} ctx
 * @returns {{ values: string[], hasUnknown: boolean }}
 */
function resolveDocIdSlotValues(idExpr, ctx) {
  if (ts.isCallExpression(idExpr)) {
    const name = callExpressionName(idExpr);
    if (name && PIN_DOC_ID_SKIP_PREFIX.has(name)) {
      return { values: [], hasUnknown: true };
    }
    if (name && PIN_DOC_ID_CALLEES.has(name)) {
      const arg = idExpr.arguments[1] ?? idExpr.arguments[0];
      return arg
        ? resolveStringValues(arg, ctx, new Set())
        : { values: [], hasUnknown: true };
    }
  }
  return resolveStringValues(idExpr, ctx, new Set());
}

/**
 * @typedef {{
 *   sf: ts.SourceFile,
 *   bindings: Map<string, { node: ts.Node, kind: 'var'|'param'|'for' }>,
 *   firestoreDocNames: Set<string>,
 * }} FileContext

/**
 * @param {ts.SourceFile} sf
 * @returns {FileContext}
 */
function buildFileContext(sf) {
  const firestoreDocNames = new Set(["doc"]);
  const bindings = new Map();

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && stmt.importClause?.namedBindings) {
      const mod = stmt.moduleSpecifier;
      const modText = ts.isStringLiteral(mod) ? mod.text : "";
      if (
        modText === "firebase/firestore" ||
        modText.endsWith("/firestore") ||
        modText === "firebase-admin/firestore"
      ) {
        if (ts.isNamedImports(stmt.importClause.namedBindings)) {
          for (const el of stmt.importClause.namedBindings.elements) {
            const name = (el.name ?? el.propertyName)?.text;
            if (name === "doc") firestoreDocNames.add(el.name.text);
          }
        }
      }
    }
  }

  /** @param {ts.Node} node */
  function trackBindings(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (node.initializer) {
        bindings.set(node.name.text, { node: node.initializer, kind: "var" });
      }
    }
    ts.forEachChild(node, trackBindings);
  }
  ts.forEachChild(sf, trackBindings);

  return { sf, bindings, firestoreDocNames };
}

/**
 * @param {ts.Node} expr
 * @param {FileContext} ctx
 * @param {Set<ts.Node>} visited
 * @param {number} depth
 * @returns {{ values: string[], hasUnknown: boolean }}
 */
/**
 * @param {ts.ObjectLiteralExpression} obj
 * @param {string} prop
 * @returns {ts.Expression | null}
 */
/**
 * @param {ts.ObjectLiteralExpression} obj
 * @param {string} prop
 * @param {FileContext} ctx
 * @param {Set<ts.Node>} seen
 * @returns {ts.Expression[]}
 */
function objectPropertyExprs(obj, prop, ctx, seen) {
  /** @type {ts.Expression[]} */
  const found = [];
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p)) {
      const key =
        ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null;
      if (key === prop) found.push(p.initializer);
    } else if (ts.isShorthandPropertyAssignment(p) && p.name.text === prop) {
      found.push(p.name);
    } else if (ts.isSpreadAssignment(p)) {
      for (const spreadObj of collectObjectExprs(p.expression, ctx, seen)) {
        found.push(...objectPropertyExprs(spreadObj, prop, ctx, seen));
      }
    }
  }
  return found;
}

/**
 * Object literals that `base` refers to, including array elements and
 * object literals returned from a called helper.
 * @param {ts.Expression} base
 * @param {FileContext} ctx
 * @param {Set<ts.Node>} seen
 * @returns {ts.ObjectLiteralExpression[]}
 */
/**
 * @param {ts.Expression} expr
 * @returns {string | null}
 */
function propertyNameOf(expr) {
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) return expr.name.text;
  if (ts.isElementAccessExpression(expr) && expr.argumentExpression) {
    return stringLiteralText(expr.argumentExpression);
  }
  return null;
}

function collectObjectExprs(base, ctx, seen) {
  if (seen.has(base)) return [];
  seen.add(base);
  if (ts.isParenthesizedExpression(base)) {
    return collectObjectExprs(base.expression, ctx, seen);
  }
  if (
    ts.isBinaryExpression(base) &&
    (base.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      base.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return [
      ...collectObjectExprs(base.left, ctx, seen),
      ...collectObjectExprs(base.right, ctx, seen),
    ];
  }
  if (ts.isObjectLiteralExpression(base)) return [base];
  if (ts.isArrayLiteralExpression(base)) {
    return base.elements.flatMap((el) =>
      ts.isOmittedExpression(el) ? [] : collectObjectExprs(el, ctx, seen),
    );
  }
  if (ts.isIdentifier(base)) {
    const preferred = preferredIdExpr(base);
    if (preferred) return collectObjectExprs(preferred, ctx, seen);
    const paramSite = resolveParameterAtSite(base, ctx.sf);
    if (!paramSite) return [];
    /** @type {ts.ObjectLiteralExpression[]} */
    const out = [];
    collectCallSiteArgValuesForFunction(
      paramSite.fn,
      paramSite.paramIndex,
      base.text,
      ctx.sf,
      (arg) => {
        out.push(...collectObjectExprs(arg, ctx, seen));
      },
    );
    return out;
  }
  const propName = propertyNameOf(base);
  if (propName) {
    /** @type {ts.ObjectLiteralExpression[]} */
    const nested = [];
    for (const obj of collectObjectExprs(/** @type {ts.PropertyAccessExpression} */ (base).expression, ctx, seen)) {
      for (const propExpr of objectPropertyExprs(obj, propName, ctx, seen)) {
        nested.push(...collectObjectExprs(propExpr, ctx, seen));
      }
    }
    return nested;
  }
  if (ts.isCallExpression(base) && ts.isIdentifier(base.expression)) {
    const fn = findFunctionDecl(base.expression.text, ctx.sf);
    if (!fn) return [];
    /** @type {ts.ObjectLiteralExpression[]} */
    const out = [];
    /** @param {ts.Node} node */
    function visit(node) {
      if (ts.isReturnStatement(node) && node.expression && ts.isObjectLiteralExpression(node.expression)) {
        out.push(node.expression);
      }
      ts.forEachChild(node, visit);
    }
    if (fn.body) visit(fn.body);
    return out;
  }
  return [];
}

/**
 * @param {ts.Expression} base
 * @param {string} prop
 * @param {FileContext} ctx
 * @param {Set<ts.Node>} visited
 * @param {number} depth
 * @returns {{ values: string[], hasUnknown: boolean }}
 */
function resolvePropertyValues(base, prop, ctx, visited, depth) {
  const objects = collectObjectExprs(base, ctx, new Set());
  /** @type {string[]} */
  const vals = [];
  let unknown = objects.length === 0;
  for (const obj of objects) {
    const propExprs = objectPropertyExprs(obj, prop, ctx, new Set());
    if (propExprs.length === 0) {
      unknown = true;
      continue;
    }
    for (const propExpr of propExprs) {
      const r = resolveStringValues(propExpr, ctx, visited, depth + 1);
      vals.push(...r.values);
      unknown = unknown || r.hasUnknown;
    }
  }
  return { values: vals, hasUnknown: unknown && vals.length === 0 };
}

/**
 * `const { id } = expr` / `const { id: docId } = expr` before this use.
 * @param {ts.Identifier} ident
 * @returns {{ obj: ts.Expression, key: string, pos: number } | null}
 */
function destructuredInitializer(ident) {
  /** @type {ts.Node | undefined} */
  let current = ident.parent;
  /** @type {{ obj: ts.Expression, key: string, pos: number } | null} */
  let found = null;
  while (current) {
    const statements =
      ts.isSourceFile(current) || ts.isBlock(current) || ts.isModuleBlock(current)
        ? current.statements
        : null;
    if (statements) {
      for (const stmt of statements) {
        if (!ts.isVariableStatement(stmt)) continue;
        for (const decl of stmt.declarationList.declarations) {
          if (!ts.isObjectBindingPattern(decl.name) || !decl.initializer) continue;
          for (const el of decl.name.elements) {
            if (
              !ts.isBindingElement(el) ||
              !ts.isIdentifier(el.name) ||
              el.name.text !== ident.text ||
              el.name === ident ||
              el.name.getStart() > ident.getStart()
            ) {
              continue;
            }
            const key =
              el.propertyName &&
              (ts.isIdentifier(el.propertyName) || ts.isStringLiteral(el.propertyName))
                ? el.propertyName.text
                : el.name.text;
            found = { obj: decl.initializer, key, pos: el.name.getStart() };
          }
        }
      }
    }
    current = current.parent;
  }
  return found;
}

function resolveStringValues(expr, ctx, visited, depth = 0) {
  if (depth > 12) return { values: [], hasUnknown: true };

  if (ts.isParenthesizedExpression(expr)) {
    return resolveStringValues(expr.expression, ctx, visited, depth + 1);
  }

  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) {
    return resolvePropertyValues(expr.expression, expr.name.text, ctx, visited, depth);
  }

  if (ts.isElementAccessExpression(expr) && expr.argumentExpression) {
    const key = stringLiteralText(expr.argumentExpression);
    if (key !== null) {
      return resolvePropertyValues(expr.expression, key, ctx, visited, depth);
    }
  }

  if (
    ts.isBinaryExpression(expr) &&
    (expr.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    const left = resolveStringValues(expr.left, ctx, visited, depth + 1);
    const right = resolveStringValues(expr.right, ctx, visited, depth + 1);
    return {
      values: [...left.values, ...right.values],
      hasUnknown: (left.hasUnknown && right.hasUnknown) || (left.values.length + right.values.length === 0),
    };
  }

  const lit = stringLiteralText(expr);
  if (lit !== null) return { values: [lit], hasUnknown: false };

  if (ts.isArrayLiteralExpression(expr)) {
    /** @type {string[]} */
    const all = [];
    let unknown = false;
    for (const el of expr.elements) {
      if (ts.isOmittedExpression(el)) continue;
      const r = resolveStringValues(el, ctx, visited, depth + 1);
      all.push(...r.values);
      unknown = unknown || r.hasUnknown;
    }
    return { values: all, hasUnknown: unknown };
  }

  if (ts.isTemplateExpression(expr) || ts.isTemplateLiteral(expr)) {
    if (ts.isNoSubstitutionTemplateLiteral(expr)) {
      return { values: [expr.text], hasUnknown: false };
    }
    return { values: [], hasUnknown: true };
  }

  if (ts.isIdentifier(expr)) {
    const preferred = preferredIdExpr(expr);
    const destructured = destructuredInitializer(expr);
    if (
      destructured &&
      (!preferred || destructured.pos > preferred.getStart())
    ) {
      return resolvePropertyValues(destructured.obj, destructured.key, ctx, visited, depth);
    }
    if (preferred) {
      if (visited.has(preferred)) return { values: [], hasUnknown: true };
      visited.add(preferred);
      return resolveStringValues(preferred, ctx, visited, depth + 1);
    }

    const paramSite = resolveParameterAtSite(expr, ctx.sf);
    if (paramSite) {
      /** @type {string[]} */
      const vals = [];
      let unknown = false;
      const param = paramSite.fn.parameters[paramSite.paramIndex];
      const defaultVal = defaultValueForParam(param, expr.text);
      if (defaultVal) {
        const r = resolveStringValues(defaultVal, ctx, new Set(visited), depth + 1);
        vals.push(...r.values);
        unknown = unknown || r.hasUnknown;
      }
      collectCallSiteArgValuesForFunction(
        paramSite.fn,
        paramSite.paramIndex,
        expr.text,
        ctx.sf,
        (argExpr) => {
          const r = resolveStringValues(argExpr, ctx, new Set(visited), depth + 1);
          vals.push(...r.values);
          unknown = unknown || r.hasUnknown;
        },
      );
      return { values: vals, hasUnknown: unknown && vals.length === 0 };
    }

    const bindingDefault = bindingElementDefault(expr) ?? parameterPropertyDefault(expr);
    if (bindingDefault) {
      return resolveStringValues(bindingDefault, ctx, visited, depth + 1);
    }

    return { values: [], hasUnknown: true };
  }

  if (ts.isCallExpression(expr)) {
    const repeated = repeatedStringValue(expr);
    if (repeated !== null) return { values: [repeated], hasUnknown: false };
    // Method and helper calls are not document ids. Descending into arguments
    // treated digest("hex") as the id "hex".
    return { values: [], hasUnknown: true };
  }

  if (ts.isConditionalExpression(expr)) {
    const t = resolveStringValues(expr.whenTrue, ctx, visited, depth + 1);
    const f = resolveStringValues(expr.whenFalse, ctx, visited, depth + 1);
    return {
      values: [...t.values, ...f.values],
      hasUnknown: t.hasUnknown || f.hasUnknown,
    };
  }

  return { values: [], hasUnknown: true };
}

/**
 * @param {ts.Identifier} ident
 * @param {ts.SourceFile} sf
 * @returns {{ fn: ts.FunctionLikeDeclaration, paramIndex: number } | null}
 */
/**
 * @param {ts.Identifier} ident
 * @param {ts.SourceFile} sf
 * @returns {ts.Expression | null}
 */
/**
 * Nearest `const`/`let` initializer for `ident` that is in scope and appears
 * before the use. Avoids a file-wide last-wins binding map.
 * @param {ts.Identifier} ident
 * @returns {ts.Expression | null}
 */
function initializerInScope(ident) {
  /** @type {ts.Node | undefined} */
  let current = ident.parent;
  while (current) {
    const statements =
      ts.isSourceFile(current) || ts.isBlock(current) || ts.isModuleBlock(current)
        ? current.statements
        : null;
    if (statements) {
      /** @type {ts.Expression | null} */
      let found = null;
      for (const stmt of statements) {
        if (!ts.isVariableStatement(stmt)) continue;
        for (const decl of stmt.declarationList.declarations) {
          if (
            ts.isIdentifier(decl.name) &&
            decl.name.text === ident.text &&
            decl.initializer &&
            decl.name.getStart() < ident.getStart()
          ) {
            found = decl.initializer;
          }
        }
      }
      if (found) return found;
    }
    current = current.parent;
  }
  return null;
}

/**
 * Default for a destructured parameter property used in the function body.
 * @param {ts.Identifier} ident
 * @returns {ts.Expression | null}
 */
function parameterPropertyDefault(ident) {
  /** @type {ts.Node | undefined} */
  let current = ident.parent;
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current)
    ) {
      for (const param of current.parameters) {
        if (!ts.isObjectBindingPattern(param.name)) continue;
        for (const el of param.name.elements) {
          if (
            ts.isBindingElement(el) &&
            ts.isIdentifier(el.name) &&
            el.name.text === ident.text &&
            el.initializer &&
            el.name !== ident
          ) {
            return el.initializer;
          }
        }
      }
      return null;
    }
    current = current.parent;
  }
  return null;
}

function bindingElementDefault(ident) {
  const el = ident.parent;
  if (!ts.isBindingElement(el) || el.name !== ident || !el.initializer) return null;
  return el.initializer;
}

/**
 * @param {ts.Expression} expr
 * @returns {ts.ArrayLiteralExpression | null}
 */
function arrayLiteralFrom(expr) {
  if (ts.isArrayLiteralExpression(expr)) return expr;
  if (ts.isIdentifier(expr)) {
    const init = initializerInScope(expr);
    if (init) return arrayLiteralFrom(init);
  }
  return null;
}

/**
 * Expression that supplies `ident` when it is bound by an enclosing for-of,
 * including a tuple column (`for (const [coll, docId] of [[...]])`).
 * @param {ts.Identifier} ident
 * @returns {{ expr: ts.Expression, stmtPos: number } | null}
 */
function forOfBoundValuesExpr(ident) {
  /** @type {ts.Node | undefined} */
  let current = ident.parent;
  while (current) {
    if (ts.isForOfStatement(current)) {
      const init = current.initializer;
      if (ts.isVariableDeclarationList(init)) {
        for (const decl of init.declarations) {
          if (ts.isIdentifier(decl.name) && decl.name.text === ident.text) {
            return { expr: current.expression, stmtPos: current.getStart() };
          }
          const sourceArray = arrayLiteralFrom(current.expression);
          if (ts.isArrayBindingPattern(decl.name) && sourceArray) {
            const index = decl.name.elements.findIndex(
              (el) =>
                ts.isBindingElement(el) &&
                ts.isIdentifier(el.name) &&
                el.name.text === ident.text,
            );
            if (index >= 0) {
              return {
                stmtPos: current.getStart(),
                expr: ts.factory.createArrayLiteralExpression(
                  sourceArray.elements.flatMap((el) => {
                    if (!ts.isArrayLiteralExpression(el)) return [];
                    const cell = el.elements[index];
                    return cell ? [cell] : [];
                  }),
                ),
              };
            }
          }
        }
      }
    }
    current = current.parent;
  }
  return null;
}

/**
 * Nearest in-scope initializer: a for-of binding closer than a const, or the
 * nearest const/let that appears before the use. File-wide last-wins maps
 * are not used.
 * @param {ts.Identifier} ident
 * @returns {ts.Expression | null}
 */
function preferredIdExpr(ident) {
  const scoped = initializerInScope(ident);
  const forBound = forOfBoundValuesExpr(ident);
  if (forBound && scoped) {
    return scoped.getStart() > forBound.stmtPos ? scoped : forBound.expr;
  }
  return forBound?.expr ?? scoped;
}

/**
 * @param {ts.Expression} expr
 * @param {FileContext} ctx
 * @param {string} prefix
 */
function templateEmbedsPrefix(expr, ctx, prefix) {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return expr.text.includes(prefix);
  }
  if (!ts.isTemplateExpression(expr)) return false;
  if (expr.head.text.includes(prefix)) return true;
  for (const span of expr.templateSpans) {
    if (span.literal.text.includes(prefix)) return true;
  }
  let carried = false;
  for (const span of expr.templateSpans) {
    const resolved = resolveStringValues(span.expression, ctx, new Set());
    if (resolved.values.length > 0) {
      const bare = resolved.values.filter((v) => idNeedsPrefix(prefix, v, null));
      if (bare.length > 0) return false;
      if (resolved.values.some((v) => v.includes(prefix))) carried = true;
      continue;
    }
    if (
      ts.isTemplateExpression(span.expression) ||
      ts.isNoSubstitutionTemplateLiteral(span.expression)
    ) {
      if (!templateEmbedsPrefix(span.expression, ctx, prefix)) return false;
      carried = true;
    }
  }
  return carried;
}

function resolveParameterAtSite(ident, sf) {
  /** @type {ts.Node | undefined} */
  let current = ident.parent;
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current)
    ) {
      const fn = current;
      for (let i = 0; i < fn.parameters.length; i++) {
        const p = fn.parameters[i];
        if (ts.isIdentifier(p.name) && p.name.text === ident.text) {
          return { fn, paramIndex: i };
        }
        if (ts.isObjectBindingPattern(p.name)) {
          for (const el of p.name.elements) {
            if (
              ts.isBindingElement(el) &&
              ts.isIdentifier(el.name) &&
              el.name.text === ident.text
            ) {
              return { fn, paramIndex: i };
            }
          }
        }
      }
    }
    current = current.parent;
  }
  return null;
}

/**
 * @param {ts.ParameterDeclaration} param
 * @param {string} propName
 * @returns {ts.Expression | null}
 */
function defaultValueForParam(param, propName) {
  if (ts.isIdentifier(param.name) && param.initializer) {
    return param.initializer;
  }
  if (ts.isObjectBindingPattern(param.name)) {
    for (const el of param.name.elements) {
      if (
        ts.isBindingElement(el) &&
        ts.isIdentifier(el.name) &&
        el.name.text === propName &&
        el.initializer
      ) {
        return el.initializer;
      }
    }
    if (param.initializer && ts.isObjectLiteralExpression(param.initializer)) {
      for (const prop of param.initializer.properties) {
        if (
          ts.isPropertyAssignment(prop) &&
          ((ts.isIdentifier(prop.name) && prop.name.text === propName) ||
            (ts.isStringLiteral(prop.name) && prop.name.text === propName))
        ) {
          return prop.initializer;
        }
      }
    }
  }
  return null;
}

/**
 * @param {ts.FunctionLikeDeclaration} fnDecl
 * @param {number} paramIndex
 * @param {ts.SourceFile} sf
 * @param {(arg: ts.Expression) => void} fn
 */
function collectCallSiteArgValuesForFunction(
  fnDecl,
  paramIndex,
  propName,
  sf,
  fn,
) {
  const names = functionCallableNames(fnDecl, sf);
  if (names.length === 0) return;
  const param = fnDecl.parameters[paramIndex];

  /** @param {ts.Node} node */
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && names.includes(callee.text)) {
        const resolved = findFunctionDecl(callee.text, sf);
        if (!resolved || resolved.getStart() !== fnDecl.getStart()) {
          // not a call to this function
        } else {
          const arg = node.arguments[paramIndex];
          if (arg) {
            if (ts.isObjectBindingPattern(param.name)) {
              extractObjectPropertyValues(arg, propName, fn);
            } else {
              fn(arg);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
}

/**
 * @param {ts.Expression} objExpr
 * @param {string} propName
 * @param {(arg: ts.Expression) => void} fn
 */
function extractObjectPropertyValues(objExpr, propName, fn) {
  if (ts.isObjectLiteralExpression(objExpr)) {
    for (const prop of objExpr.properties) {
      if (ts.isPropertyAssignment(prop)) {
        const key =
          ts.isIdentifier(prop.name) ? prop.name.text
          : ts.isStringLiteral(prop.name) ? prop.name.text
          : null;
        if (key === propName) fn(prop.initializer);
      } else if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === propName) {
        fn(prop.name);
      }
    }
  }
}

/**
 * @param {ts.FunctionLikeDeclaration} fnDecl
 * @param {ts.SourceFile} sf
 * @returns {string[]}
 */
function functionCallableNames(fnDecl, sf) {
  /** @type {string[]} */
  const names = [];
  if (ts.isFunctionDeclaration(fnDecl) && fnDecl.name) {
    names.push(fnDecl.name.text);
  }
  /** @param {ts.Node} node */
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.initializer === fnDecl && ts.isIdentifier(node.name)) {
      names.push(node.name.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return names;
}

/**
 * @param {string} name
 * @param {ts.SourceFile} sf
 * @returns {ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | null}
 */
function findFunctionDecl(name, sf) {
  /** @type {ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | null} */
  let found = null;
  /** @param {ts.Node} node */
  function visit(node) {
    if (found) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      found = node;
      return;
    }
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.name.text === name &&
          decl.initializer &&
          (ts.isFunctionExpression(decl.initializer) ||
            ts.isArrowFunction(decl.initializer))
        ) {
          found = decl.initializer;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return found;
}

/**
 * @typedef {{
 *   file: string,
 *   line: number,
 *   collection: string | null,
 *   rawId: string,
 *   unprefixedForDup: string,
 *   node: ts.Node | null,
 *   pathLiteral: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | null,
 *   pathSegmentIndex: number | null,
 * }} DiscoveredId

/**
 * @param {ts.Node} node
 * @param {FileContext} ctx
 * @param {string} filename
 * @returns {DiscoveredId[]}
 */
function discoverFromDocCall(node, ctx, filename) {
  /** @type {DiscoveredId[]} */
  const out = [];
  const args = node.arguments;
  if (args.length === 0) return out;

  const firstLit = stringLiteralText(args[0]);
  if (firstLit !== null && !ts.isIdentifier(args[0])) {
    const segments = firstLit.split("/").filter(Boolean);
    for (let i = 1; i < segments.length; i += 2) {
      const coll = segments[i - 1] ?? null;
      const idSeg = segments[i];
      out.push({
        file: filename,
        line: lineOf(ctx.sf, args[0]),
        collection: coll,
        rawId: idSeg,
        unprefixedForDup: idSeg,
        node: args[0],
        pathLiteral: /** @type {ts.StringLiteral} */ (args[0]),
        pathSegmentIndex: i,
      });
    }
    return out;
  }

  const collectionRef = firstArgIsCollectionRef(args[0]);
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    const argLit = stringLiteralText(arg);
    const isCollectionSlot = collectionRef ? i % 2 === 0 : i % 2 === 1;
    if (argLit !== null && argLit.includes("/")) {
      const segments = argLit.split("/").filter(Boolean);
      for (let s = 0; s < segments.length; s++) {
        const isId = isCollectionSlot ? s % 2 === 1 : s % 2 === 0;
        if (!isId) continue;
        out.push({
          file: filename,
          line: lineOf(ctx.sf, arg),
          collection: s > 0 ? segments[s - 1] : null,
          rawId: segments[s],
          unprefixedForDup: segments[s],
          node: arg,
          pathLiteral:
            ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)
              ? arg
              : null,
          pathSegmentIndex: s,
        });
      }
      continue;
    }
    if (isCollectionSlot) {
      const pathIds = pathDocumentIds(arg, ctx);
      if (!pathIds) continue;
      for (const idSeg of pathIds) {
        out.push({
          file: filename,
          line: lineOf(ctx.sf, arg),
          collection: null,
          rawId: idSeg,
          unprefixedForDup: idSeg,
          node: arg,
          pathLiteral: null,
          pathSegmentIndex: null,
        });
      }
      continue;
    }

    const collExpr = args[i - 1];
    const idExpr = arg;
    const collName = stringLiteralText(collExpr);

    const idFromLiteral = stringLiteralText(idExpr);
    if (idFromLiteral !== null) {
      out.push({
        file: filename,
        line: lineOf(ctx.sf, idExpr),
        collection: collName,
        rawId: idFromLiteral,
        unprefixedForDup: idFromLiteral,
        node: idExpr,
        pathLiteral: null,
        pathSegmentIndex: null,
      });
      continue;
    }

    const resolved = resolveDocIdSlotValues(idExpr, ctx);
    if (resolved.values.length > 0 && !resolved.hasUnknown) {
      for (const v of resolved.values) {
        out.push({
          file: filename,
          line: lineOf(ctx.sf, idExpr),
          collection: collName,
          rawId: v,
          unprefixedForDup: v,
          node: idExpr,
          pathLiteral: null,
          pathSegmentIndex: null,
        });
      }
    }
  }
  return out;
}

/**
 * @param {ts.CallExpression | ts.PropertyAccessExpression} node
 * @param {FileContext} ctx
 * @param {string} filename
 * @returns {DiscoveredId[]}
 */
function discoverIdsInNode(node, ctx, filename) {
  /** @type {DiscoveredId[]} */
  const out = [];

  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    if (
      ts.isIdentifier(callee) &&
      ctx.firestoreDocNames.has(callee.text)
    ) {
      out.push(...discoverFromDocCall(node, ctx, filename));
    }
    if (
      ts.isPropertyAccessExpression(callee) &&
      callee.name.text === "doc"
    ) {
      const coll = collectionFromDocChain(callee.expression);
      const arg0 = node.arguments[0];
      if (!arg0) return out;
      const lit = stringLiteralText(arg0);
      if (lit !== null) {
        out.push({
          file: filename,
          line: lineOf(ctx.sf, arg0),
          collection: coll,
          rawId: lit,
          unprefixedForDup: lit,
          node: arg0,
          pathLiteral: null,
          pathSegmentIndex: null,
        });
      } else {
        const resolved = resolveDocIdSlotValues(arg0, ctx);
        for (const v of resolved.values) {
          out.push({
            file: filename,
            line: lineOf(ctx.sf, arg0),
            collection: coll,
            rawId: v,
            unprefixedForDup: v,
            node: arg0,
            pathLiteral: null,
            pathSegmentIndex: null,
          });
        }
      }
    }
  }
  return out;
}

/**
 * @param {ts.Expression} expr
 * @returns {string | null}
 */
function collectionFromDocChain(expr) {
  if (ts.isCallExpression(expr)) {
    const callee = expr.expression;
    if (
      ts.isPropertyAccessExpression(callee) &&
      callee.name.text === "collection" &&
      expr.arguments[0]
    ) {
      return stringLiteralText(expr.arguments[0]);
    }
  }
  if (ts.isPropertyAccessExpression(expr)) {
    return collectionFromDocChain(expr.expression);
  }
  return null;
}

/**
 * @param {string} prefix
 * @param {string} id
 * @param {string | null} collection
 */
function idNeedsPrefix(prefix, id, collection) {
  if (collection && isExemptPair(collection, id)) return false;
  if (isFormatConstrainedId(id)) return false;
  return !id.includes(prefix);
}

/**
 * @param {ts.Identifier} ident
 * @param {FileContext} ctx
 * @param {string} prefix
 */
/** @typedef {'not-param' | 'no-string-sites' | 'pass' | 'fail'} ParamPrefixStatus */

/**
 * @param {ts.Identifier} ident
 * @param {FileContext} ctx
 * @param {string} prefix
 * @returns {ParamPrefixStatus}
 */
function parameterStringCallSitePrefixStatus(ident, ctx, prefix) {
  const paramSite = resolveParameterAtSite(ident, ctx.sf);
  if (!paramSite) return "not-param";

  /** @type {string[]} */
  const stringArgs = [];
  const param = paramSite.fn.parameters[paramSite.paramIndex];
  const def = defaultValueForParam(param, ident.text);
  if (def) {
    const lit = stringLiteralText(def);
    if (lit !== null) stringArgs.push(lit);
  }

  let templateOk = true;
  let sawTemplate = false;
  collectCallSiteArgValuesForFunction(
    paramSite.fn,
    paramSite.paramIndex,
    ident.text,
    ctx.sf,
    (argExpr) => {
      const lit = stringLiteralText(argExpr);
      if (lit !== null) {
        stringArgs.push(lit);
        return;
      }
      const repeated = repeatedStringValue(argExpr);
      if (repeated !== null) {
        stringArgs.push(repeated);
        return;
      }
      const templateExpr = templateExprOf(argExpr, ctx);
      if (templateExpr) {
        sawTemplate = true;
        if (!templateEmbedsPrefix(templateExpr, ctx, prefix)) templateOk = false;
        return;
      }
      const r = resolveStringValues(argExpr, ctx, new Set());
      stringArgs.push(...r.values);
    },
  );

  if (!templateOk) return "fail";
  if (stringArgs.length === 0) return sawTemplate ? "pass" : "no-string-sites";
  return stringArgs.every((s) => !idNeedsPrefix(prefix, s, null))
    ? "pass"
    : "fail";
}

/**
 * @param {ts.Expression} expr
 * @param {FileContext} ctx
 * @returns {ts.TemplateExpression | ts.NoSubstitutionTemplateLiteral | null}
 */
function templateExprOf(expr, ctx) {
  if (ts.isTemplateExpression(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return expr;
  }
  if (ts.isIdentifier(expr)) {
    const init = preferredIdExpr(expr);
    if (
      init &&
      (ts.isTemplateExpression(init) || ts.isNoSubstitutionTemplateLiteral(init))
    ) {
      return init;
    }
  }
  return ctx ? null : null;
}

/**
 * @param {ts.Expression} expr
 * @returns {boolean}
 */
function firstArgIsCollectionRef(expr) {
  if (ts.isCallExpression(expr)) {
    return callExpressionName(expr) === "collection";
  }
  return ts.isPropertyAccessExpression(expr) && expr.name.text === "collection";
}

/**
 * Odd segments of a path are document ids. Null when `expr` is not a path.
 * @param {ts.Expression} expr
 * @param {FileContext} ctx
 * @param {Set<ts.Node>} [seen]
 * @returns {string[] | null}
 */
function pathDocumentIds(expr, ctx, seen = new Set()) {
  if (seen.has(expr)) return null;
  seen.add(expr);
  const lit = stringLiteralText(expr);
  if (lit !== null) {
    if (!lit.includes("/")) return null;
    return lit.split("/").filter(Boolean).filter((_, i) => i % 2 === 1);
  }
  if (ts.isNoSubstitutionTemplateLiteral(expr)) {
    if (!expr.text.includes("/")) return null;
    return expr.text.split("/").filter(Boolean).filter((_, i) => i % 2 === 1);
  }
  if (ts.isTemplateExpression(expr)) return templatePathDocumentIds(expr, ctx);
  if (ts.isIdentifier(expr)) {
    const init = preferredIdExpr(expr);
    if (!init) return null;
    return pathDocumentIds(init, ctx, seen);
  }
  return null;
}

/**
 * @param {ts.TemplateExpression} expr
 * @param {FileContext} ctx
 * @returns {string[] | null}
 */
function templatePathDocumentIds(expr, ctx) {
  const staticHasSlash =
    expr.head.text.includes("/") ||
    expr.templateSpans.some((span) => span.literal.text.includes("/"));
  if (!staticHasSlash) return null;
  /** @type {string[]} */
  const ids = [];
  let segIndex = 0;
  let current = "";

  /** @param {string} value */
  function closeSegment(value) {
    if (segIndex % 2 === 1 && value) ids.push(value);
    segIndex += 1;
    current = "";
  }

  /** @param {string} text */
  function consumeText(text) {
    for (const ch of text) {
      if (ch === "/") closeSegment(current);
      else current += ch;
    }
  }

  consumeText(expr.head.text);
  for (const span of expr.templateSpans) {
    const resolved = resolveStringValues(span.expression, ctx, new Set());
    const wholeSegment =
      current === "" &&
      (span.literal.text === "" || span.literal.text.startsWith("/"));
    if (wholeSegment && resolved.values.length > 0) {
      for (const value of resolved.values) {
        if (value.includes("/")) {
          consumeText(value);
          continue;
        }
        if (segIndex % 2 === 1) ids.push(value);
      }
    } else if (resolved.values.length === 1 && !resolved.values[0].includes("/")) {
      current += resolved.values[0];
    } else if (segIndex % 2 === 1 && current === "") {
      ids.push("");
    }
    consumeText(span.literal.text);
  }
  if (current && segIndex % 2 === 1) ids.push(current);
  return ids;
}

/**
 * @param {ts.Expression} expr
 * @param {FileContext} ctx
 * @param {string} prefix
 * @param {Set<ts.Node>} [seen]
 * @returns {boolean}
 */
function expressionOmitsPrefix(expr, ctx, prefix, seen = new Set()) {
  if (seen.has(expr)) return false;
  seen.add(expr);
  if (ts.isParenthesizedExpression(expr)) {
    return expressionOmitsPrefix(expr.expression, ctx, prefix, seen);
  }
  if (
    ts.isBinaryExpression(expr) &&
    (expr.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return (
      expressionOmitsPrefix(expr.left, ctx, prefix, seen) ||
      expressionOmitsPrefix(expr.right, ctx, prefix, seen)
    );
  }
  const propName = propertyNameOf(expr);
  if (propName) {
    const objects = collectObjectExprs(expr.expression, ctx, new Set());
    let saw = false;
    for (const obj of objects) {
      for (const propExpr of objectPropertyExprs(obj, propName, ctx, new Set())) {
        saw = true;
        if (expressionOmitsPrefix(propExpr, ctx, prefix, seen)) return true;
      }
    }
    if (saw) return false;
  }
  const pathIds = pathDocumentIds(expr, ctx);
  if (pathIds) {
    if (pathIds.some((id) => id === "" || idNeedsPrefix(prefix, id, null))) return true;
    if (ts.isTemplateExpression(expr) || ts.isIdentifier(expr)) {
      const template = templateExprOf(expr, ctx);
      if (template && ts.isTemplateExpression(template)) {
        for (const span of template.templateSpans) {
          const resolved = resolveStringValues(span.expression, ctx, new Set());
          if (resolved.values.length === 0 && !templateEmbedsPrefix(span.expression, ctx, prefix)) {
            const staticHasSlash =
              template.head.text.includes("/") ||
              template.templateSpans.some((s) => s.literal.text.includes("/"));
            if (staticHasSlash && resolved.hasUnknown) return true;
          }
        }
      }
    }
    return false;
  }
  const lit = stringLiteralText(expr);
  if (lit !== null) return idNeedsPrefix(prefix, lit, null);
  const repeated = repeatedStringValue(expr);
  if (repeated !== null) return idNeedsPrefix(prefix, repeated, null);
  if (ts.isTemplateExpression(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return !templateEmbedsPrefix(expr, ctx, prefix);
  }
  if (ts.isArrayLiteralExpression(expr)) {
    return expr.elements.some(
      (el) => !ts.isOmittedExpression(el) && expressionOmitsPrefix(el, ctx, prefix, seen),
    );
  }
  if (ts.isIdentifier(expr)) {
    const preferred = preferredIdExpr(expr);
    if (preferred) return expressionOmitsPrefix(preferred, ctx, prefix, seen);
    const resolved = resolveStringValues(expr, ctx, new Set());
    return resolved.values.some((value) => idNeedsPrefix(prefix, value, null));
  }
  const resolved = resolveStringValues(expr, ctx, new Set());
  return resolved.values.some((value) => idNeedsPrefix(prefix, value, null));
}

/**
 * @param {FixtureSourceFile[]} files
 */
export function lintFixtureSources(files) {
  /** @type {Violation[]} */
  const violations = [];
  /** @type {Map<string, string>} */
  const prefixByFile = new Map();
  /** @type {Map<string, string>} */
  const fileByPrefix = new Map();

  for (const { filename, source } of files) {
    let prefix;
    try {
      prefix = suiteFixturePrefix(filename);
    } catch (e) {
      violations.push({
        file: filename,
        line: 1,
        message: String(e.message ?? e),
      });
      continue;
    }
    prefixByFile.set(filename, prefix);
    if (fileByPrefix.has(prefix)) {
      violations.push({
        file: filename,
        line: 1,
        message: `duplicate suite prefix ${prefix} (also ${fileByPrefix.get(prefix)})`,
      });
    } else {
      fileByPrefix.set(prefix, filename);
    }
  }

  /** @type {Map<string, { file: string, line: number }>} */
  const globalIdOwners = new Map();

  for (const { filename, source } of files) {
    const prefix = prefixByFile.get(filename);
    if (!prefix) continue;

    const sf = ts.createSourceFile(
      filename,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    const ctx = buildFileContext(sf);

    /** @type {DiscoveredId[]} */
    const discovered = [];
    /** @param {ts.Node} node */
    function visit(node) {
      if (ts.isCallExpression(node)) {
        discovered.push(...discoverIdsInNode(node, ctx, filename));
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);

    /** @type {Set<string>} */
    const fixtureIdTexts = new Set();
    for (const d of discovered) {
      if (d.collection && isExemptPair(d.collection, d.rawId)) continue;
      fixtureIdTexts.add(d.rawId);

      const key = `${d.collection ?? "?"}/${d.rawId}`;
      if (!isExemptPair(d.collection ?? "", d.rawId)) {
        const prev = globalIdOwners.get(d.rawId);
        if (prev && prev.file !== filename) {
          violations.push({
            file: filename,
            line: d.line,
            message: `document id "${d.rawId}" also used in ${prev.file}:${prev.line}`,
          });
        } else if (!prev) {
          globalIdOwners.set(d.rawId, { file: filename, line: d.line });
        }
      }

      if (idNeedsPrefix(prefix, d.rawId, d.collection)) {
        violations.push({
          file: filename,
          line: d.line,
          message: `fixture document id "${d.rawId}" must include prefix "${prefix}"`,
        });
      }
    }

    /** @param {ts.Node} node */
    function visitLiterals(node) {
      const text = stringLiteralText(node);
      if (text !== null && fixtureIdTexts.has(text)) {
        if (idNeedsPrefix(prefix, text, null)) {
          violations.push({
            file: filename,
            line: lineOf(sf, node),
            message: `string literal "${text}" matches a fixture id and must include prefix "${prefix}"`,
          });
        }
      }
      ts.forEachChild(node, visitLiterals);
    }
    visitLiterals(sf);

    // Template / call slots: validate traced prefix on identifiers used in doc id slots
    /** @param {ts.Node} node */
    function visitSlots(node) {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const isDoc =
          (ts.isIdentifier(callee) && ctx.firestoreDocNames.has(callee.text)) ||
          (ts.isPropertyAccessExpression(callee) && callee.name.text === "doc");

        if (isDoc) {
          validateSlotExprs(node, ctx, filename, prefix, violations);
        }
      }
      ts.forEachChild(node, visitSlots);
    }
    visitSlots(sf);
  }

  return { ok: violations.length === 0, violations };
}

/**
 * @param {ts.CallExpression} call
 * @param {FileContext} ctx
 * @param {string} filename
 * @param {string} prefix
 * @param {Violation[]} violations
 */
function validateSlotExprs(call, ctx, filename, prefix, violations) {
  const args = call.arguments;
  if (args.length === 0) return;

  const firstLit = stringLiteralText(args[0]);
  if (firstLit !== null && args.length === 1) return;

  /** @type {ts.Expression[]} */
  const idSlots = [];
  if (firstLit !== null && !ts.isIdentifier(args[0])) {
    return;
  }
  const collectionRef = firstArgIsCollectionRef(args[0]);
  for (let i = 1; i < args.length; i++) {
    const isId = collectionRef ? i % 2 === 1 : i % 2 === 0;
    if (isId || (!collectionRef && pathDocumentIds(args[i], ctx))) {
      idSlots.push(args[i]);
    }
  }
  if (
    ts.isPropertyAccessExpression(call.expression) &&
    call.expression.name.text === "doc" &&
    args[0]
  ) {
    idSlots.length = 0;
    idSlots.push(args[0]);
  }

  for (const slot of idSlots) {
    if (stringLiteralText(slot) !== null) continue;

    if (ts.isNoSubstitutionTemplateLiteral(slot)) {
      if (slot.text.includes(prefix)) continue;
      violations.push({
        file: filename,
        line: lineOf(ctx.sf, slot),
        message: `template document id must include suite prefix "${prefix}" or interpolate a prefixed id`,
      });
      continue;
    }
    if (ts.isTemplateExpression(slot)) {
      if (!templateEmbedsPrefix(slot, ctx, prefix)) {
        violations.push({
          file: filename,
          line: lineOf(ctx.sf, slot),
          message: `template document id must include suite prefix "${prefix}" or interpolate a prefixed id`,
        });
      }
      continue;
    }

    if (ts.isCallExpression(slot)) {
      const name = callExpressionName(slot);
      if (name && PIN_DOC_ID_SKIP_PREFIX.has(name)) continue;
      /** @type {ts.Expression[]} */
      const checkArgs =
        name && PIN_DOC_ID_CALLEES.has(name)
          ? slot.arguments.slice(1)
          : slot.arguments;
      let sawPrefixed = false;
      let sawBare = false;
      for (const arg of checkArgs) {
        if (
          ts.isTemplateExpression(arg) ||
          ts.isNoSubstitutionTemplateLiteral(arg)
        ) {
          if (templateEmbedsPrefix(arg, ctx, prefix)) sawPrefixed = true;
          else sawBare = true;
          continue;
        }
        const r = resolveStringValues(arg, ctx, new Set());
        for (const v of r.values) {
          if (isFormatConstrainedId(v)) continue;
          if (v.includes(prefix)) sawPrefixed = true;
          else sawBare = true;
        }
      }
      if ((sawBare || !sawPrefixed) && checkArgs.length > 0) {
        violations.push({
          file: filename,
          line: lineOf(ctx.sf, slot),
          message: `call expression document id must pass at least one prefixed fixture id argument`,
        });
      }
      continue;
    }

    if (ts.isIdentifier(slot)) {
      const status = parameterStringCallSitePrefixStatus(slot, ctx, prefix);
      if (status === "fail") {
        violations.push({
          file: filename,
          line: lineOf(ctx.sf, slot),
          message: `traced document id values must include prefix "${prefix}"`,
        });
        continue;
      }
      if (status === "pass") continue;

      const init = preferredIdExpr(slot) ?? slot;
      if (expressionOmitsPrefix(init, ctx, prefix)) {
        violations.push({
          file: filename,
          line: lineOf(ctx.sf, slot),
          message: `computed document id must include suite prefix "${prefix}"`,
        });
      }
      continue;
    }

    if (expressionOmitsPrefix(slot, ctx, prefix)) {
      violations.push({
        file: filename,
        line: lineOf(ctx.sf, slot),
        message: `traced document id values must include prefix "${prefix}"`,
      });
      continue;
    }

    const r = resolveStringValues(slot, ctx, new Set());
    const needsPrefix = r.values.filter((v) => idNeedsPrefix(prefix, v, null));
    if (needsPrefix.length > 0 && r.values.length > 0) {
      violations.push({
        file: filename,
        line: lineOf(ctx.sf, slot),
        message: `traced document id values must include prefix "${prefix}"`,
      });
    }
  }
}

/**
 * @param {string} source
 * @param {string} filename
 * @param {string} prefix
 * @returns {{ source: string, rewrites: Map<string, string> }}
 */
function fixSource(source, filename, prefix) {
  const sf = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const ctx = buildFileContext(sf);

  /** @type {DiscoveredId[]} */
  const discovered = [];
  /** @param {ts.Node} node */
  function visit(node) {
    if (ts.isCallExpression(node)) {
      discovered.push(...discoverIdsInNode(node, ctx, filename));
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);

  /** @type {Map<string, string>} */
  const rewrite = new Map();
  for (const d of discovered) {
    if (d.collection && isExemptPair(d.collection, d.rawId)) continue;
    if (isFormatConstrainedId(d.rawId)) continue;
    if (d.rawId.includes(prefix)) continue;
    if (!rewrite.has(d.rawId)) {
      rewrite.set(d.rawId, `${prefix}${d.rawId}`);
    }
  }

  if (rewrite.size === 0) return { source, rewrites: rewrite };

  /** @type {{ start: number, end: number, text: string }[]} */
  const edits = [];

  /** @param {ts.Node} node */
  function collectEdits(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const text = node.text;
      const rep = rewrite.get(text);
      if (rep) {
        const start = node.getStart(sf);
        const end = node.getEnd();
        const quote = source[start];
        const newText =
          quote === "'"
            ? `'${rep.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`
            : `"${rep.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
        edits.push({ start, end, text: newText });
      }
    }
    if (ts.isStringLiteral(node) && node.text.includes("/")) {
      const segments = node.text.split("/");
      let changed = false;
      for (let i = 1; i < segments.length; i += 2) {
        const rep = rewrite.get(segments[i]);
        if (rep) {
          segments[i] = rep;
          changed = true;
        }
      }
      if (changed) {
        const start = node.getStart(sf);
        const end = node.getEnd();
        const quote = source[start];
        const joined = segments.join("/");
        const newText =
          quote === "'"
            ? `'${joined.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`
            : `"${joined.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
        edits.push({ start, end, text: newText });
      }
    }
    ts.forEachChild(node, collectEdits);
  }
  collectEdits(sf);

  edits.sort((a, b) => b.start - a.start);
  let out = source;
  for (const e of edits) {
    if (out.slice(e.start, e.end) !== source.slice(e.start, e.end)) continue;
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }

  return { source: out, rewrites: rewrite };
}

function main() {
  const fix = process.argv.includes("--fix");
  const root = process.cwd();
  const paths = fs
    .readdirSync(path.join(root, "scripts"))
    .filter((f) => f.startsWith("test-") && f.endsWith(".mjs"))
    .map((f) => path.join("scripts", f))
    .sort();

  if (fix) {
    for (const rel of paths) {
      const abs = path.join(root, rel);
      const source = fs.readFileSync(abs, "utf8");
      const prefix = suiteFixturePrefix(rel);
      let current = source;
      for (let pass = 0; pass < 5; pass++) {
        const { source: next } = fixSource(current, rel, prefix);
        if (next === current) break;
        current = next;
      }
      if (current !== source) {
        fs.writeFileSync(abs, current);
        console.log(`fixed ${rel}`);
      }
    }
  }

  /** @type {FixtureSourceFile[]} */
  const files = paths.map((rel) => ({
    filename: rel,
    source: fs.readFileSync(path.join(root, rel), "utf8"),
  }));

  const { ok, violations } = lintFixtureSources(files);
  for (const v of violations) {
    console.error(`${v.file}:${v.line}: ${v.message}`);
  }
  process.exit(ok ? 0 : 1);
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  main();
}
