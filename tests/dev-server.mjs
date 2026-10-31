// Local server for the Grill House site with the same URL rewrites as
// vercel.json ("/" and "/r/<slug>").
//
//   node tests/dev-server.mjs            real Supabase (LIVE data: edits are real)
//   node tests/dev-server.mjs --mock     in-memory fake Supabase (nothing leaves
//                                        your machine; resets on restart)
//   Options: --port 5173   --with-item-visibility (mock: behave as if the
//            menu_item_visibility migration were applied)
//            --without-socials-function (mock: behave as before the
//            owner_update_restaurant_socials migration)
//
// Like the deployment (.vercelignore), _archive/, tests/, supabase/ and dot
// files are not served.

import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createFakeSupabase, PUBLISHABLE_KEY, USERS } from "./support/fake-supabase.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const FAKE_PREFIX = "/__fake-supabase";
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon",
};
const BLOCKED = /^\/(?:_archive|tests|supabase|node_modules)(?:\/|$)|\/\./;

function rewrite(pathname) {
  if (pathname === "/") return "/restaurants/grill-house/index.html";
  const r = /^\/r\/([a-z0-9-]+)\/?$/.exec(pathname);
  if (r) return "/restaurants/" + r[1] + "/index.html";
  return pathname;
}

// Resolves to { server, url, fake } once listening.
export async function startServer({ mock = false, port = 0, itemVisibility = false, socialsFunction = true, host = "127.0.0.1" } = {}) {
  const fake = mock ? createFakeSupabase({ itemVisibility, socialsFunction }) : null;
  let origin = "";

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://local");
      if (fake && url.pathname.startsWith(FAKE_PREFIX + "/")) {
        return await fake.handle(req, res, req.url.slice(FAKE_PREFIX.length));
      }
      if (fake && url.pathname === "/shared/config.js") {
        res.writeHead(200, { "content-type": TYPES[".js"], "cache-control": "no-store" });
        return res.end(`// Served by tests/dev-server.mjs --mock: points at the local fake Supabase.\n`
          + `export const SUPABASE_URL = ${JSON.stringify(origin + FAKE_PREFIX)};\n`
          + `export const SUPABASE_PUBLISHABLE_KEY = ${JSON.stringify(PUBLISHABLE_KEY)};\n`);
      }

      let file = rewrite(decodeURIComponent(url.pathname));
      if (BLOCKED.test(file)) throw Object.assign(new Error("blocked"), { code: "ENOENT" });
      let full = path.join(ROOT, file);
      if (!full.startsWith(ROOT)) throw Object.assign(new Error("outside"), { code: "ENOENT" });
      if ((await stat(full)).isDirectory()) {
        if (!file.endsWith("/")) {
          res.writeHead(308, { location: file + "/" + url.search });
          return res.end();
        }
        full = path.join(full, "index.html");
      }
      const body = await readFile(full);
      res.writeHead(200, { "content-type": TYPES[path.extname(full).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" });
      res.end(body);
    } catch (error) {
      res.writeHead(error.code === "ENOENT" || error.code === "ENOTDIR" ? 404 : 500, { "content-type": "text/plain; charset=utf-8" });
      res.end(error.code === "ENOENT" || error.code === "ENOTDIR" ? "Not found" : "Server error");
    }
  });

  await new Promise((resolve) => server.listen(port, host, resolve));
  origin = "http://" + host + ":" + server.address().port;
  return { server, url: origin, fake };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const portIndex = args.indexOf("--port");
  const mock = args.includes("--mock");
  const { url } = await startServer({
    mock,
    port: portIndex !== -1 ? Number(args[portIndex + 1]) : 5173,
    itemVisibility: args.includes("--with-item-visibility"),
    socialsFunction: !args.includes("--without-socials-function"),
  });
  console.log(`Grill House: ${url}/`);
  console.log(`Sign in:     ${url}/?admin`);
  if (mock) {
    console.log("\nMOCK MODE: fake in-memory Supabase. Nothing is sent to the real project; data resets on restart.");
    console.log(`  Grill House admin:       ${USERS.admin.email} / ${USERS.admin.password}`);
    console.log(`  Owner of another place:  ${USERS.other.email} / ${USERS.other.password}  (must be rejected)`);
    console.log(`  System admin, no member: ${USERS.sysadmin.email} / ${USERS.sysadmin.password}  (must be rejected)`);
    if (args.includes("--with-item-visibility")) console.log("  Item visibility column: ENABLED (as if the migration were applied)");
  } else {
    console.log("\nREAL SUPABASE: signing in and saving changes edits the LIVE Grill House menu.");
  }
}
