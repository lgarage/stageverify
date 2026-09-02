/**
 * Static hosting checks for Operator Console — Firebase Hosting SPA behavior at base /.
 * Usage: npm run test:operator-static-hosting
 */
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { resolve, extname, join } from "node:path";
import { spawnSync } from "node:child_process";

let passed = 0;
let failed = 0;
const pass = (msg) => {
  passed += 1;
  console.log(`  ✓ ${msg}`);
};
const fail = (msg, detail) => {
  failed += 1;
  console.error(`  ✗ ${msg}`);
  if (detail) console.error(`    ${detail}`);
};

const root = process.cwd();
const distDir = resolve(root, "apps/operator/dist");
const indexPath = join(distDir, "index.html");

console.log("\n=== operator static hosting ===\n");

if (!existsSync(indexPath)) {
  console.log("Building operator app…");
  const build = spawnSync("npm", ["run", "build:operator"], {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });
  if (build.status !== 0) {
    fail("build:operator failed");
    process.exit(1);
  }
}

if (!existsSync(indexPath)) {
  fail("apps/operator/dist/index.html missing after build");
  process.exit(1);
}

const indexHtml = readFileSync(indexPath, "utf8");

function contentTypeFor(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function createHostingServer() {
  return createServer((req, res) => {
    const urlPath = (req.url ?? "/").split("?")[0];
    const safePath = urlPath === "/" ? "/index.html" : urlPath;
    const filePath = join(distDir, safePath);

    if (existsSync(filePath) && !filePath.endsWith("/")) {
      const body = readFileSync(filePath);
      res.writeHead(200, { "Content-Type": contentTypeFor(filePath) });
      res.end(body);
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(readFileSync(indexPath));
  });
}

function extractAssets(html) {
  const js = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  const css = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map(
    (m) => m[1],
  );
  const icons = [...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => m[1]);
  return { js, css, icons };
}

const assets = extractAssets(indexHtml);

for (const href of [...assets.js, ...assets.css, ...assets.icons]) {
  if (href.startsWith("/operator/") || href.startsWith("/stageverify/")) {
    fail(`asset URL must not use legacy base prefix: ${href}`);
  }
}
pass("no asset URL starts with /operator/ or /stageverify/");

const server = createHostingServer();
await new Promise((resolvePromise, reject) => {
  server.listen(0, "127.0.0.1", resolvePromise);
  server.on("error", reject);
});

const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

async function get(path) {
  const res = await fetch(`${base}${path}`);
  const ct = res.headers.get("content-type") ?? "";
  const body = await res.text();
  return { status: res.status, contentType: ct, body };
}

try {
  const rootRes = await get("/");
  if (rootRes.status === 200 && rootRes.contentType.includes("text/html")) {
    pass("GET / returns HTML");
  } else {
    fail("GET / returns HTML", `${rootRes.status} ${rootRes.contentType}`);
  }

  const refreshRes = await get("/");
  if (refreshRes.contentType.includes("text/html") && refreshRes.body.includes("<!doctype html")) {
    pass("HashRouter refresh (GET /) still serves index.html");
  } else {
    fail("HashRouter refresh (GET /) still serves index.html");
  }

  const spaFallbackRes = await get("/customers");
  if (
    spaFallbackRes.status === 200 &&
    spaFallbackRes.contentType.includes("text/html") &&
    spaFallbackRes.body.includes("<!doctype html")
  ) {
    pass("GET /customers (missing file) returns index.html SPA fallback");
  } else {
    fail(
      "GET /customers (missing file) returns index.html SPA fallback",
      `${spaFallbackRes.status} ${spaFallbackRes.contentType}`,
    );
  }

  for (const src of assets.js) {
    const res = await get(src);
    if (res.status === 200 && res.contentType.includes("javascript")) {
      pass(`JS asset ${src} returns JavaScript`);
    } else {
      fail(`JS asset ${src} returns JavaScript`, `${res.status} ${res.contentType}`);
    }
  }

  for (const href of assets.css) {
    const res = await get(href);
    if (res.status === 200 && res.contentType.includes("text/css")) {
      pass(`CSS asset ${href} returns CSS`);
    } else {
      fail(`CSS asset ${href} returns CSS`, `${res.status} ${res.contentType}`);
    }
  }
} finally {
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
