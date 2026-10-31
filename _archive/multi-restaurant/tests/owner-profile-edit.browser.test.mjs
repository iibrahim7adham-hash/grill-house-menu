// Real-browser regression tests for the owner dashboard's
// "تعديل معلومات المطعم" button (Chrome/Edge via puppeteer-core).
//
// Run:  cd tests && npm install && npm test
// Uses the installed Chrome or Edge (or CHROME_PATH). Skipped when none is found.
//
// The real owner/index.html, CSS, login.js and dashboard.js are served from
// the repo. Only /shared/supabase/client.js is replaced by a fake signed-in
// owner client that records its RPC calls, so nothing reaches Supabase.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CHROME = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((p) => p && existsSync(p));

const FAKE_CLIENT = `
const row = { id: "a-1", slug: "grill-house", name: "Grill House", tagline: "Fire and flavour",
  phone: "+964 750 000 0000", address: "Erbil, 100m Street", hours: "12:00 – 00:00", is_published: true };
window.__rpcCalls = [];
function query() {
  const result = Promise.resolve({ data: [], error: null });
  const proxy = new Proxy(function () {}, { get: (_, k) => (k === "then" ? result.then.bind(result) : () => proxy), apply: () => proxy });
  return proxy;
}
export const supabase = {
  auth: {
    getSession: async () => ({ data: { session: { access_token: "test" } } }),
    getUser: async () => ({ data: { user: { id: "u-1", email: "owner@test.local" } }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => ({ error: null }),
  },
  async rpc(name, args) {
    window.__rpcCalls.push({ name, args });
    if (name === "get_my_restaurants") return { data: [{ ...row }], error: null };
    if (name === "update_my_restaurant_profile") {
      Object.assign(row, { name: args.p_name, tagline: args.p_tagline, phone: args.p_phone, address: args.p_address, hours: args.p_hours });
      return { data: { ...row }, error: null };
    }
    return { data: false, error: null };
  },
  from: query,
  storage: { from: () => ({ getPublicUrl: (p) => ({ data: { publicUrl: p } }) }) },
};`;

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
let server, base, browser, puppeteer;
let simulateStaleDashboard = false;

// Reproduces an old cached dashboard.js: same file without the button wiring.
function staleDashboard(source) {
  return source
    .replace(/^.*el\.editProfileBtn\.addEventListener.*$/m, "")
    .replace(/^.*el\.editProfileBtn\.setAttribute\("data-ready".*$/m, "");
}

before(async () => {
  if (!CHROME) return;
  puppeteer = (await import("puppeteer-core")).default;
  server = http.createServer(async (req, res) => {
    let url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (url === "/shared/supabase/client.js") {
      res.writeHead(200, { "content-type": "text/javascript" });
      return res.end(FAKE_CLIENT);
    }
    if (url.endsWith("/")) url += "index.html";
    try {
      let body = await readFile(path.join(ROOT, url), "utf8");
      if (simulateStaleDashboard && url === "/owner/js/dashboard.js") body = staleDashboard(body);
      res.writeHead(200, { "content-type": TYPES[path.extname(url)] || "application/octet-stream", "cache-control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = "http://127.0.0.1:" + server.address().port;
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
});

after(async () => {
  if (browser) await browser.close();
  if (server) server.close();
});

async function openDashboard() {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/owner/", { waitUntil: "networkidle0" });
  await page.waitForSelector("#view-dashboard:not([hidden])");
  return { page, errors };
}

const isVisible = (page, selector) => page.$eval(selector, (node) => {
  const box = node.getBoundingClientRect();
  return !node.hidden && getComputedStyle(node).display !== "none" && box.width > 0 && box.height > 0;
});

test("clicking the real button makes the edit form visible with the current data", { skip: !CHROME && "no Chrome/Edge found" }, async () => {
  simulateStaleDashboard = false;
  const { page, errors } = await openDashboard();

  assert.equal(await isVisible(page, "#edit-profile-btn"), true, "button is visible");
  assert.equal(await isVisible(page, "#profile-form"), false, "form starts hidden");

  await page.click("#edit-profile-btn"); // real mouse click at the button's position

  assert.equal(await isVisible(page, "#profile-form"), true, "form is visible after the click");
  const values = await page.$eval("#profile-form", (form) =>
    Object.fromEntries(["name", "tagline", "phone", "address", "hours"].map((k) => [k, form.elements.namedItem(k).value])));
  assert.deepEqual(values, {
    name: "Grill House", tagline: "Fire and flavour", phone: "+964 750 000 0000",
    address: "Erbil, 100m Street", hours: "12:00 – 00:00",
  });
  assert.equal(await page.evaluate(() => document.activeElement.name), "name", "name field focused");
  assert.equal(await page.evaluate(() => document.documentElement.dir), "rtl");

  await page.click("#profile-cancel");
  assert.equal(await isVisible(page, "#profile-form"), false, "cancel hides the form");
  assert.equal(await isVisible(page, "#edit-profile-btn"), true, "button is back");

  assert.deepEqual(errors, [], "no page errors");
  await page.close();
});

test("saving uses update_my_restaurant_profile and refreshes the page", { skip: !CHROME && "no Chrome/Edge found" }, async () => {
  simulateStaleDashboard = false;
  const { page } = await openDashboard();
  await page.click("#edit-profile-btn");
  await page.$eval("#profile-form", (form) => { form.elements.namedItem("name").value = ""; });
  await page.type("#profile-form [name=name]", "Grill House Erbil");
  await page.click("#profile-submit");
  await page.waitForSelector("#profile-form[hidden]");

  const calls = await page.evaluate(() => window.__rpcCalls.filter((c) => c.name === "update_my_restaurant_profile"));
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0].args).sort(), ["p_address", "p_hours", "p_name", "p_phone", "p_restaurant_id", "p_tagline"]);
  assert.equal(calls[0].args.p_name, "Grill House Erbil");
  assert.equal(await page.$eval("#restaurant-title", (n) => n.textContent), "Grill House Erbil");
  assert.match(await page.$eval("#dashboard-message", (n) => n.textContent), /Grill House Erbil/);
  await page.close();
});

test("an un-wired button (e.g. stale cached dashboard.js) shows a visible message instead of doing nothing", { skip: !CHROME && "no Chrome/Edge found" }, async () => {
  simulateStaleDashboard = true;
  const { page } = await openDashboard();
  await page.click("#edit-profile-btn");
  assert.equal(await isVisible(page, "#dashboard-message"), true, "a message is shown");
  assert.match(await page.$eval("#dashboard-message", (n) => n.textContent), /أعد تحميل الصفحة/);
  simulateStaleDashboard = false;
  await page.close();
});
