// Grill House dashboard (/grill-admin/): real browser + FAKE Supabase.
//
// Real: Chrome/Edge (puppeteer-core), the dashboard and public page files,
// the supabase-js client from the CDN and every shared/ module, over HTTP.
// Fake: the backend (tests/support/fake-supabase.mjs), with row rules
// modelled on the project's policies. These tests prove the pages and their
// client code; they do NOT prove the real database's RLS.
//
// Run:  cd tests && npm install && npm test

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { writeFile, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer } from "./dev-server.mjs";
import { USERS, GRILL_HOUSE_ID } from "./support/fake-supabase.mjs";

const CHROME = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((p) => p && existsSync(p));
const SKIP = !CHROME && "no Chrome/Edge found";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDK+mmyAAAAABJRU5ErkJggg==", "base64");
let browser, files;

before(async () => {
  if (!CHROME) return;
  const puppeteer = (await import("puppeteer-core")).default;
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const dir = await mkdtemp(path.join(os.tmpdir(), "grill-admin-test-"));
  files = { png1: path.join(dir, "one.png"), png2: path.join(dir, "two.png"), text: path.join(dir, "notes.txt") };
  await writeFile(files.png1, PNG);
  await writeFile(files.png2, PNG);
  await writeFile(files.text, "not an image");
});

after(async () => {
  if (browser) await browser.close();
});

// ---------- helpers ----------

async function open(t, { itemVisibility = false, socialsFunction = true, path: start = "/grill-admin/", width = 1366 } = {}) {
  const { server, url, fake } = await startServer({ mock: true, itemVisibility, socialsFunction });
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width, height: 900 });
  const errors = [];
  const requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => requests.push(r.url().replace(url, "")));
  t.after(async () => {
    await context.close();
    server.close();
  });
  await page.goto(url + start, { waitUntil: "networkidle0" });
  return { page, url, fake, errors, requests, context };
}

async function until(check, message, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error("Timed out waiting for: " + message);
}

const idle = (page) => page.waitForFunction(() => !document.body.classList.contains("is-busy"));

async function fill(page, selector, value) {
  await page.$eval(selector, (node) => { node.value = ""; });
  if (value) await page.type(selector, value);
}

async function signIn(page, user) {
  await page.waitForSelector("#view-login:not([hidden])");
  await fill(page, "#login-email", user.email);
  await fill(page, "#login-password", user.password);
  await page.click("#login-submit");
}

async function signedIn(t, options) {
  const env = await open(t, options);
  await signIn(env.page, USERS.admin);
  await env.page.waitForSelector(".nav-card");
  return env;
}

async function go(page, section) {
  await page.click(`.nav-link[data-section="${section}"]`);
  await page.waitForFunction((s) => document.querySelector(`.nav-link[data-section="${s}"]`).getAttribute("aria-current") === "page", {}, section);
}

const itemNamed = (fake, name) => fake.db.items.find((i) => i.name === name);
const catNamed = (fake, name) => fake.db.categories.find((c) => c.name === name);
const cats = (fake) => fake.db.categories.filter((c) => c.restaurant_id === GRILL_HOUSE_ID).sort((a, b) => a.sort_order - b.sort_order);

// A row (category or product) by its name.
const row = (page, name) => page.waitForSelector(`.row[data-name="${name}"]`);

async function rowButton(page, name, text) {
  const r = await row(page, name);
  const button = await r.evaluateHandle((node, label) => Array.from(node.querySelectorAll("button"))
    .find((b) => b.textContent.trim() === label || b.getAttribute("aria-label") === label || (b.getAttribute("aria-label") || "").startsWith(label)), text);
  assert.ok(button.asElement(), `button «${text}» in row «${name}»`);
  return button.asElement();
}

async function clickRow(page, name, text) {
  const button = await rowButton(page, name, text);
  await button.evaluate((b) => b.scrollIntoView({ block: "center" }));
  await button.click();
  await idle(page);
}

const dialogGone = (page, id) => page.waitForSelector("#" + id, { hidden: true });
const alertOf = (page, selector) => page.$eval(selector + " .alert", (n) => (n.hidden ? "" : n.textContent));
const sessionStored = (page) => page.evaluate(() => Object.keys(localStorage).some((k) => /^sb-.*-auth-token$/.test(k)));
const rowNames = (page, container) => page.$$eval(container + " .row", (rows) => rows.map((r) => r.dataset.name));

async function publicSections(url) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.goto(url + "/", { waitUntil: "networkidle0" });
  const data = await page.evaluate(() => Array.from(document.querySelectorAll(".menu-section")).map((s) => ({
    name: s.querySelector("h2").textContent.trim(),
    items: Array.from(s.querySelectorAll(".menu-card h3")).map((h) => h.textContent.trim()),
    unavailable: Array.from(s.querySelectorAll(".menu-card.is-unavailable h3")).map((h) => h.textContent.trim()),
  })));
  const address = await page.$eval('[data-profile="address"]', (n) => n.textContent);
  await context.close();
  return { sections: data, address };
}

// ---------- public page ----------

test("public page, visitor: database menu, no admin link, no admin code or auth request", { skip: SKIP }, async (t) => {
  const { page, fake, errors, requests } = await open(t, { path: "/" });
  assert.ok(await page.$(".menu-card"));
  assert.equal(await page.$(".manage-btn"), null);
  assert.ok(!requests.some((u) => u.includes("/grill-admin/")));
  assert.ok(!fake.log.some((l) => l.path.startsWith("/auth/") || l.path.includes("/rpc/")));
  assert.deepEqual(errors, []);
});

test("public page: ?admin opens the dashboard; a signed-in member gets an «إدارة المطعم» link", { skip: SKIP }, async (t) => {
  const { page, url } = await open(t, { path: "/?admin" });
  await page.waitForSelector("#view-login:not([hidden])");
  assert.equal(new URL(page.url()).pathname, "/grill-admin/");
  await signIn(page, USERS.admin);
  await page.waitForSelector(".nav-card");
  await page.goto(url + "/", { waitUntil: "networkidle0" });
  await page.waitForSelector(".manage-btn");
  assert.equal(await page.$eval(".manage-btn", (a) => a.getAttribute("href")), "/grill-admin/");
  assert.equal(await page.$eval(".manage-btn", (a) => a.textContent.trim()), "إدارة المطعم");
});

for (const [label, width, mobile] of [["desktop", 1366, false], ["mobile", 390, true]]) {
  test(`public page, ${label}: «إدارة المطعم» at the bottom of the drawer opens the dashboard sign-in; only members get in`, { skip: SKIP }, async (t) => {
    const { page, url, errors, requests } = await open(t, { path: "/", width });
    if (mobile) await page.setViewport({ width, height: 844, isMobile: true, hasTouch: true });

    // Customer navigation is unchanged; the staff entry sits after it, apart.
    assert.deepEqual(await page.$$eval(".nav-drawer-links .nav-drawer-link", (l) => l.map((n) => n.textContent.trim())),
      ["الرئيسية", "المنيو", "عن المطعم", "تواصل معنا", "Instagram"]);
    const entry = await page.$eval("#nav-drawer .nav-drawer-footer", (footer) => {
      const link = footer.querySelector("a");
      return {
        last: footer === footer.parentElement.lastElementChild,
        divider: getComputedStyle(footer).borderTopStyle !== "none" && parseFloat(getComputedStyle(footer).borderTopWidth) > 0,
        insideCustomerNav: Boolean(footer.closest(".nav-drawer-links")),
        icon: link.querySelector("use").getAttribute("href"),
        lockDefined: Boolean(document.getElementById("icon-lock")),
        href: link.getAttribute("href"),
        text: link.textContent.trim(),
        links: footer.querySelectorAll("a").length,
      };
    });
    assert.deepEqual(entry, { last: true, divider: true, insideCustomerNav: false, icon: "#icon-lock", lockDefined: true,
      href: "/grill-admin/", text: "إدارة المطعم", links: 1 });
    assert.ok(!requests.some((u) => u.includes("/grill-admin/")), "dashboard not loaded before the click");

    // Open the drawer: the entry is visible at the bottom of the panel.
    await page.click("#hamburger-btn");
    await page.waitForSelector("#nav-drawer:not([hidden])");
    const box = await page.evaluate(() => {
      const panel = document.querySelector(".nav-drawer-panel").getBoundingClientRect();
      const link = document.getElementById("nav-admin-link").getBoundingClientRect();
      const last = document.querySelector(".nav-drawer-links").getBoundingClientRect();
      return { visible: link.width > 0 && link.height > 0, inPanel: link.left >= panel.left - 1 && link.right <= panel.right + 1,
        nearBottom: panel.bottom - link.bottom < 40, belowCustomer: link.top >= last.bottom };
    });
    assert.deepEqual(box, { visible: true, inPanel: true, nearBottom: true, belowCustomer: true });

    // Same-domain navigation to the dashboard, which asks a visitor to sign in.
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("#nav-admin-link")]);
    assert.equal(page.url(), url + "/grill-admin/");
    await page.waitForSelector("#view-login:not([hidden])");
    assert.equal(await page.$eval("#view-app", (n) => n.hidden), true);
    assert.equal(await page.$$eval("#section *", (n) => n.length), 0, "no dashboard content before sign-in");

    // A signed-in account that is not a Grill House member is refused.
    await signIn(page, USERS.other);
    await page.waitForSelector("#login-message:not([hidden])");
    assert.match(await page.$eval("#login-message", (n) => n.textContent), /لا يملك صلاحية إدارة مطعم GRILL HOUSE/);
    await until(async () => !(await sessionStored(page)), "unauthorized session cleared");
    assert.equal(await page.$eval("#view-app", (n) => n.hidden), true);

    // The Grill House owner gets in.
    await signIn(page, USERS.admin);
    await page.waitForSelector(".nav-card");
    assert.equal(await page.$eval("#view-login", (n) => n.hidden), true);
    assert.deepEqual(errors, []);
  });
}

// ---------- sign-in ----------

test("sign-in: a wrong password is rejected", { skip: SKIP }, async (t) => {
  const { page } = await open(t);
  await signIn(page, { email: USERS.admin.email, password: "wrong-password" });
  await page.waitForSelector("#login-message:not([hidden])");
  assert.match(await page.$eval("#login-message", (n) => n.textContent), /غير صحيحة/);
  assert.equal(await sessionStored(page), false);
  assert.equal(await page.$eval("#view-app", (n) => n.hidden), true);
});

for (const [label, user] of [["the owner of another restaurant", USERS.other], ["a system admin who is not a member", USERS.sysadmin]]) {
  test(`sign-in: ${label} is rejected and signed out`, { skip: SKIP }, async (t) => {
    const { page, fake } = await open(t);
    await signIn(page, user);
    await page.waitForSelector("#login-message:not([hidden])");
    assert.match(await page.$eval("#login-message", (n) => n.textContent), /لا يملك صلاحية إدارة مطعم GRILL HOUSE/);
    await until(async () => !(await sessionStored(page)), "session cleared");
    assert.ok(fake.log.some((l) => l.path.startsWith("/auth/v1/logout")));
    assert.equal(await page.$eval("#view-app", (n) => n.hidden), true);
  });
}

// ---------- layout and navigation ----------

test("layout: header, right sidebar, home cards; sections load inside the same layout", { skip: SKIP }, async (t) => {
  const { page, errors } = await signedIn(t);
  assert.equal(await page.$eval("#user-email", (n) => n.textContent), USERS.admin.email);
  assert.equal(await page.$eval(".brand-sub", (n) => n.textContent), "لوحة التحكم");
  assert.equal(await page.$eval("#store-link", (a) => a.querySelector(".label-long").textContent + "|" + a.getAttribute("href")), "عرض المنيو العام|/");
  assert.deepEqual(await page.$$eval(".nav-link", (l) => l.map((n) => n.textContent)), ["الرئيسية", "الأقسام", "المنتجات", "إعدادات المطعم", "كلمة المرور"]);
  assert.deepEqual(await page.$$eval(".nav-card-title", (l) => l.map((n) => n.textContent)), ["الأقسام", "المنتجات", "إعدادات المطعم", "كلمة المرور"]);

  // Sidebar on the right, content to its left.
  const box = await page.evaluate(() => ({
    sidebar: document.querySelector(".sidebar").getBoundingClientRect().toJSON(),
    content: document.querySelector(".content").getBoundingClientRect().toJSON(),
  }));
  assert.ok(box.sidebar.right >= 1360 && box.sidebar.width >= 280 && box.sidebar.width <= 320, "sidebar on the right, 280-320px");
  assert.ok(box.content.right <= box.sidebar.left + 1, "content left of the sidebar");

  // Card -> section, same shell
  const header = await page.$("header.topbar");
  await page.click('[data-card="products"]');
  await page.waitForSelector("#product-list");
  assert.equal(new URL(page.url()).hash, "#products");
  assert.equal(await page.$eval("#page-title", (n) => n.textContent), "المنتجات");
  assert.equal(await page.$eval('.nav-link[aria-current="page"]', (n) => n.textContent), "المنتجات");
  assert.ok(await header.evaluate((n) => n.isConnected), "header kept, not reloaded");

  await go(page, "settings");
  await page.waitForSelector("#settings-form");
  await page.goBack();
  await page.waitForSelector("#product-list");

  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector("#product-list");
  assert.deepEqual(errors, []);
});

test("mobile: the sidebar becomes a slide-out drawer", { skip: SKIP }, async (t) => {
  const { page, errors } = await signedIn(t, { width: 390 });
  const visible = () => page.$eval(".sidebar", (n) => getComputedStyle(n).visibility === "visible" && n.getBoundingClientRect().left < 390);
  assert.equal(await visible(), false, "drawer closed");
  await page.click("#nav-toggle");
  await until(visible, "drawer open");
  await page.click('.nav-link[data-section="categories"]');
  await page.waitForSelector("#category-rows");
  await until(async () => !(await visible()), "drawer closes after navigating");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no horizontal scroll");
  assert.deepEqual(errors, []);
});

// ---------- categories ----------

test("categories: add, edit, hide, reorder, delete", { skip: SKIP }, async (t) => {
  const { page, fake, url, errors } = await signedIn(t);
  await go(page, "categories");

  await page.click("#add-category");
  await page.waitForSelector("#category-dialog[open]");
  await fill(page, "#category-dialog input[name=name]", "السلطات");
  await page.select("#category-dialog select[name=icon]", "bowl");
  await page.click("#category-dialog button[type=submit]");
  await dialogGone(page, "category-dialog");
  await row(page, "السلطات");
  const created = catNamed(fake, "السلطات");
  assert.deepEqual([created.slug, created.icon, created.sort_order, created.is_visible], ["category", "bowl", 5, true]);

  await clickRow(page, "السلطات", "تعديل");
  await page.waitForSelector("#category-dialog[open]");
  await fill(page, "#category-dialog input[name=name]", "سلطات طازجة");
  await page.click("#category-dialog button[type=submit]");
  await dialogGone(page, "category-dialog");
  await row(page, "سلطات طازجة");
  assert.equal(created.name, "سلطات طازجة");
  assert.equal(created.slug, "category", "slug never changes");

  await clickRow(page, "سلطات طازجة", "إظهار القسم");
  await until(() => created.is_visible === false, "category hidden");
  await page.waitForSelector('.row.is-dim[data-name="سلطات طازجة"]');
  await clickRow(page, "المقبلات", "إظهار القسم");
  await until(() => catNamed(fake, "المقبلات").is_visible === false, "appetizers hidden");
  assert.ok(!(await publicSections(url)).sections.some((s) => s.name === "المقبلات"), "hidden category not public");
  await clickRow(page, "المقبلات", "إظهار القسم");
  await until(() => catNamed(fake, "المقبلات").is_visible === true, "appetizers shown");

  await clickRow(page, "سلطات طازجة", "نقل للأعلى");
  await until(() => cats(fake).map((c) => c.name).join() === "المقبلات,المشويات,البرغر,سلطات طازجة,الحلويات", "order saved");
  assert.deepEqual(await rowNames(page, "#category-rows"), ["المقبلات", "المشويات", "البرغر", "سلطات طازجة", "الحلويات"]);
  assert.deepEqual((await publicSections(url)).sections.map((s) => s.name), ["المقبلات", "المشويات", "البرغر", "الحلويات"]);

  // A category with products: the dialog names it and counts its products;
  // Cancel deletes nothing.
  const appetizers = catNamed(fake, "المقبلات");
  const itemCount = () => fake.db.items.length;
  const before = itemCount();
  await clickRow(page, "المقبلات", "حذف");
  await page.waitForSelector("#confirm-dialog[open]");
  const text = await page.$eval("#confirm-dialog .confirm-text", (el) => el.textContent);
  assert.match(text, /«المقبلات»/);
  assert.match(text, /3 منتجات/);
  assert.match(text, /نهائياً/);
  await page.click("#confirm-dialog .btn-outline");
  await dialogGone(page, "confirm-dialog");
  assert.ok(catNamed(fake, "المقبلات"), "cancel keeps the category");
  assert.equal(itemCount(), before, "cancel keeps the products");

  // Confirming deletes the category and all of its products, nothing else.
  await clickRow(page, "المقبلات", "حذف");
  await page.waitForSelector("#confirm-dialog[open]");
  await page.click("#confirm-dialog button[type=submit]");
  await dialogGone(page, "confirm-dialog");
  await until(() => !catNamed(fake, "المقبلات"), "category with products deleted");
  assert.equal(fake.db.items.filter((i) => i.category_id === appetizers.id).length, 0, "no orphaned products");
  assert.equal(itemCount(), before - 3, "only that category's products deleted");
  await page.waitForSelector('.row[data-name="المقبلات"]', { hidden: true });
  assert.equal(await page.$eval(".toast", (n) => n.textContent), "تم حذف القسم «المقبلات» مع 3 منتجات.");
  assert.ok(!(await publicSections(url)).sections.some((s) => s.name === "المقبلات"), "deleted category not public");
  await go(page, "products");
  assert.equal(await page.$('.row[data-name="حمص"]'), null, "products list refreshed");
  await go(page, "categories");

  // An empty category.
  await clickRow(page, "سلطات طازجة", "حذف");
  await page.waitForSelector("#confirm-dialog[open]");
  assert.match(await page.$eval("#confirm-dialog .confirm-text", (el) => el.textContent), /لا يحتوي على منتجات/);
  await page.click("#confirm-dialog button[type=submit]");
  await dialogGone(page, "confirm-dialog");
  await until(() => !catNamed(fake, "سلطات طازجة"), "category deleted");
  await page.waitForSelector('.row[data-name="سلطات طازجة"]', { hidden: true });
  assert.equal(itemCount(), before - 3);
  assert.deepEqual(errors, []);
});

test("categories: a failed delete shows the real reason, deletes nothing, and can be retried", { skip: SKIP }, async (t) => {
  const { page, fake, errors } = await signedIn(t);
  // The server refuses category deletes while `refusal` is set.
  let refusal = null;
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    if (r.isInterceptResolutionHandled()) return;
    if (refusal && r.method() === "DELETE" && r.url().includes("/rest/v1/categories")) {
      r.respond({ status: refusal.status, contentType: "application/json", body: JSON.stringify(refusal.body) });
    } else r.continue();
  });
  await go(page, "categories");
  const before = fake.db.items.length;
  const expectText = async () => {
    const text = await page.$eval("#confirm-dialog .confirm-text", (el) => el.textContent);
    assert.match(text, /«المقبلات»/);
    assert.match(text, /3 منتجات/);
  };

  await clickRow(page, "المقبلات", "حذف");
  await page.waitForSelector("#confirm-dialog[open]");
  assert.equal(await alertOf(page, "#confirm-dialog"), "", "no error before confirming");

  // Foreign key refusal (what a stale mock or a non-cascading FK returns).
  refusal = { status: 409, body: { code: "23503", message: "violates foreign key constraint" } };
  await page.click("#confirm-dialog button[type=submit]");
  await page.waitForSelector("#confirm-dialog .alert:not([hidden])");
  const fkAlert = await alertOf(page, "#confirm-dialog");
  assert.match(fkAlert, /تعذر حذف القسم/);
  assert.match(fkAlert, /لم يتم حذف أي شيء/);
  assert.doesNotMatch(fkAlert, /مراجعة الحقول/, "no form-validation text");
  await expectText();

  // Any other server error.
  refusal = { status: 500, body: { code: "XX000", message: "internal error" } };
  await page.click("#confirm-dialog button[type=submit]");
  await until(async () => (await alertOf(page, "#confirm-dialog")) === "تعذر حذف القسم. لم يتم حذف أي شيء. يرجى المحاولة مجدداً.", "generic delete error");
  await expectText();
  assert.ok(catNamed(fake, "المقبلات"), "category kept");
  assert.equal(fake.db.items.length, before, "products kept");

  // Retrying once the server accepts: the dialog closes, everything goes.
  refusal = null;
  await page.click("#confirm-dialog button[type=submit]");
  await dialogGone(page, "confirm-dialog");
  await until(() => !catNamed(fake, "المقبلات"), "category deleted on retry");
  assert.equal(fake.db.items.length, before - 3);
  await page.waitForSelector('.row[data-name="المقبلات"]', { hidden: true });
  assert.equal(await page.$eval(".toast", (n) => n.textContent), "تم حذف القسم «المقبلات» مع 3 منتجات.");
  assert.deepEqual(errors, []);
});

// ---------- products ----------

test("products: add with image, edit, price, availability, reorder, move, filter, delete", { skip: SKIP }, async (t) => {
  const { page, fake, url, errors } = await signedIn(t);
  await go(page, "products");

  await page.click("#add-product");
  await page.waitForSelector("#item-dialog[open]");
  await fill(page, "#item-dialog input[name=name]", "برغر دجاج");
  await fill(page, "#item-dialog textarea[name=description]", "صدر دجاج مقرمش");
  await fill(page, "#item-dialog input[name=price]", "-5");
  await page.select("#item-dialog select[name=category_id]", catNamed(fake, "البرغر").id);
  await (await page.$("#item-dialog input[type=file]")).uploadFile(files.png1);
  await page.waitForSelector("#item-dialog .image-preview img[src^='blob:']");
  await page.click("#item-dialog button[type=submit]");
  assert.match(await alertOf(page, "#item-dialog"), /سعر صحيح/);
  assert.ok(!itemNamed(fake, "برغر دجاج"), "nothing saved");
  await fill(page, "#item-dialog input[name=price]", "8500");
  await page.click("#item-dialog button[type=submit]");
  await dialogGone(page, "item-dialog");
  await until(() => itemNamed(fake, "برغر دجاج"), "product created");
  const item = itemNamed(fake, "برغر دجاج");
  assert.deepEqual([item.price, item.description, item.sort_order], [8500, "صدر دجاج مقرمش", 2]);
  assert.match(item.image_path, new RegExp("^" + GRILL_HOUSE_ID + "/items/[0-9a-f-]+\\.png$"));
  assert.ok(fake.storage.has(item.image_path));
  await page.waitForSelector('.row[data-name="برغر دجاج"] .thumb img[src*="/storage/v1/object/public/restaurant-images/"]');

  // Edit price and name
  await clickRow(page, "برغر دجاج", "تعديل");
  await page.waitForSelector("#item-dialog[open]");
  await fill(page, "#item-dialog input[name=price]", "9000");
  await fill(page, "#item-dialog input[name=name]", "برغر الدجاج المقرمش");
  await page.click("#item-dialog button[type=submit]");
  await dialogGone(page, "item-dialog");
  await until(() => item.price === 9000 && item.name === "برغر الدجاج المقرمش", "product updated");
  assert.match(await (await row(page, "برغر الدجاج المقرمش")).evaluate((n) => n.textContent), /9,000/);

  // Availability
  await clickRow(page, "برغر الدجاج المقرمش", "تبديل حالة التوفر");
  await until(() => item.is_available === false, "unavailable");

  // Reorder within «المقبلات»
  await clickRow(page, "حمص", "نقل للأسفل");
  await until(() => ["سلطة سيزر", "حمص", "ناتشوز"].every((n, i) => itemNamed(fake, n).sort_order === i + 1), "order saved");
  assert.deepEqual(await rowNames(page, `[data-category="${catNamed(fake, "المقبلات").id}"]`), ["سلطة سيزر", "حمص", "ناتشوز"]);

  // Move to «المشويات»
  await clickRow(page, "برغر الدجاج المقرمش", "تعديل");
  await page.waitForSelector("#item-dialog[open]");
  await page.select("#item-dialog select[name=category_id]", catNamed(fake, "المشويات").id);
  await page.click("#item-dialog button[type=submit]");
  await dialogGone(page, "item-dialog");
  await until(() => item.category_id === catNamed(fake, "المشويات").id && item.sort_order === 3, "moved");

  // The public menu shows it all
  const menu = await publicSections(url);
  const grills = menu.sections.find((s) => s.name === "المشويات");
  assert.deepEqual(grills.items, ["مشاوي مشكلة", "شيش طاووق", "برغر الدجاج المقرمش"]);
  assert.deepEqual(grills.unavailable, ["برغر الدجاج المقرمش"]);
  assert.deepEqual(menu.sections.find((s) => s.name === "المقبلات").items, ["سلطة سيزر", "حمص", "ناتشوز"]);

  // Filter and search
  await page.select("select[name=filter_category]", catNamed(fake, "المشويات").id);
  assert.deepEqual(await rowNames(page, "#product-list"), ["مشاوي مشكلة", "شيش طاووق", "برغر الدجاج المقرمش"]);
  await page.select("select[name=filter_category]", "");
  await page.type("input[name=search]", "حمص");
  assert.deepEqual(await rowNames(page, "#product-list"), ["حمص"]);
  await fill(page, "input[name=search]", "");
  await page.$eval("input[name=search]", (n) => n.dispatchEvent(new Event("input")));

  // Delete (uploaded image removed too)
  const imagePath = item.image_path;
  await clickRow(page, "برغر الدجاج المقرمش", "حذف");
  await page.waitForSelector("#confirm-dialog[open]");
  await page.click("#confirm-dialog button[type=submit]");
  await dialogGone(page, "confirm-dialog");
  await until(() => !itemNamed(fake, "برغر الدجاج المقرمش") && !fake.storage.has(imagePath), "deleted with image");
  assert.deepEqual(errors, []);
});

test("images: replace (old upload removed), remove; shipped images never deleted; wrong type refused", { skip: SKIP }, async (t) => {
  const { page, fake, errors } = await signedIn(t);
  await go(page, "products");
  const hummus = itemNamed(fake, "حمص");

  await clickRow(page, "حمص", "تعديل");
  await page.waitForSelector("#item-dialog[open]");
  await (await page.$("#item-dialog input[type=file]")).uploadFile(files.text);
  await page.waitForSelector("#item-dialog .alert:not([hidden])");
  assert.match(await alertOf(page, "#item-dialog"), /نوع الصورة غير مدعوم/);
  await (await page.$("#item-dialog input[type=file]")).uploadFile(files.png1);
  await page.click("#item-dialog button[type=submit]");
  await dialogGone(page, "item-dialog");
  await until(() => !hummus.image_path.startsWith("/restaurants/"), "replaced");
  const first = hummus.image_path;
  assert.ok(!fake.log.some((l) => l.method === "DELETE" && l.path.startsWith("/storage/")), "shipped image untouched");

  await clickRow(page, "حمص", "تعديل");
  await page.waitForSelector("#item-dialog[open]");
  await (await page.$("#item-dialog input[type=file]")).uploadFile(files.png2);
  await page.click("#item-dialog button[type=submit]");
  await dialogGone(page, "item-dialog");
  await until(() => hummus.image_path !== first && !fake.storage.has(first) && fake.storage.size === 1, "old upload removed");

  await clickRow(page, "حمص", "تعديل");
  await page.waitForSelector("#item-dialog[open]");
  await page.click("#remove-image");
  await page.click("#item-dialog button[type=submit]");
  await dialogGone(page, "item-dialog");
  await until(() => hummus.image_path === null && fake.storage.size === 0, "image removed");
  await page.waitForSelector('.row[data-name="حمص"] .thumb svg');
  assert.deepEqual(errors, []);
});

test("product visibility: disabled until the migration; with the column, hidden products leave the public menu", { skip: SKIP }, async (t) => {
  const off = await signedIn(t);
  await go(off.page, "products");
  assert.equal(await (await rowButton(off.page, "حمص", "ظاهر")).evaluate((b) => b.disabled), true);
  assert.match(await off.page.$eval(".note", (n) => n.textContent), /menu_item_visibility/);

  const on = await signedIn(t, { itemVisibility: true });
  await go(on.page, "products");
  await clickRow(on.page, "ناتشوز", "إظهار «ناتشوز»");
  await until(() => itemNamed(on.fake, "ناتشوز").is_visible === false, "hidden");
  await on.page.waitForSelector('.row.is-dim[data-name="ناتشوز"]');
  assert.deepEqual((await publicSections(on.url)).sections.find((s) => s.name === "المقبلات").items, ["حمص", "سلطة سيزر"]);
});

// ---------- settings, password, logout ----------

test("restaurant settings: validated, saved through update_my_restaurant_profile, shown on the menu", { skip: SKIP }, async (t) => {
  const { page, fake, url, errors } = await signedIn(t);
  await page.click('[data-card="settings"]');
  await page.waitForSelector("#settings-form");
  assert.equal(await page.$eval("#settings-form input[name=phone]", (i) => i.value), "+964 750 123 4567");

  await fill(page, "#settings-form input[name=phone]", "call me");
  await page.click("#settings-form button[type=submit]");
  assert.match(await alertOf(page, "#settings-form"), /رقم الهاتف غير صالح/);
  assert.ok(!fake.log.some((l) => l.path.includes("update_my_restaurant_profile")));

  await fill(page, "#settings-form input[name=phone]", "+964 770 000 0000");
  await fill(page, "#settings-form input[name=address]", "الكرادة، بغداد");
  await page.click("#settings-form button[type=submit]");
  await page.waitForSelector("#settings-form .alert.alert-success:not([hidden])");
  const r = fake.db.restaurants.find((x) => x.id === GRILL_HOUSE_ID);
  assert.deepEqual([r.phone, r.address, r.slug], ["+964 770 000 0000", "الكرادة، بغداد", "grill-house"]);
  assert.equal((await publicSections(url)).address, "الكرادة، بغداد");
  assert.deepEqual(errors, []);
});

// The social links panel is hidden (SOCIALS_ENABLED in account-sections.js)
// until the owner_update_restaurant_socials migration is applied live. These
// two tests cover it again once it is re-enabled.
const SOCIALS_HIDDEN = SKIP || "social links panel hidden until the owner_update_restaurant_socials migration is applied";

test("social links: hidden while the migration is not applied; the rest of the settings page works", { skip: SKIP }, async (t) => {
  const { page, url, errors } = await signedIn(t);
  await go(page, "settings");
  await page.waitForSelector("#settings-form");
  assert.equal(await page.$("#socials-form"), null, "no social links form");
  assert.equal(await page.$("#socials-panel"), null, "no social links panel");
  assert.ok(!(await page.$eval("#section", (n) => n.textContent)).includes("null"), "nothing stray rendered");
  assert.equal(await page.$$eval("#section .panel", (p) => p.length), 2, "restaurant info + fixed data panels");

  // Links already stored keep showing on the public menu.
  const context = await browser.createBrowserContext();
  const visitor = await context.newPage();
  await visitor.goto(url + "/", { waitUntil: "networkidle0" });
  assert.equal(await visitor.$eval('.social-row [data-social="instagram"]', (l) => l.getAttribute("href")), "https://www.instagram.com/kizuna.moments");
  await context.close();
  assert.deepEqual(errors, []);
});

test("social links: validated, saved to restaurants.socials, shown on the menu (hidden when empty)", { skip: SOCIALS_HIDDEN }, async (t) => {
  const { page, fake, url, errors } = await signedIn(t);
  await go(page, "settings");
  await page.waitForSelector("#socials-form");
  assert.equal(await page.$eval("#socials-form input[name=instagram]", (i) => i.value), "https://www.instagram.com/kizuna.moments/");

  const save = async () => page.click("#socials-form button[type=submit]");
  await fill(page, "#socials-form input[name=facebook]", "https://facebook.com.evil.io/x");
  await save();
  assert.match(await alertOf(page, "#socials-form"), /رابط Facebook غير صالح/);
  await fill(page, "#socials-form input[name=facebook]", "facebook.com/grillhouse");
  await fill(page, "#socials-form input[name=whatsapp]", "07501234567");
  await save();
  assert.match(await alertOf(page, "#socials-form"), /رقم WhatsApp غير صالح/);
  assert.ok(!fake.log.some((l) => l.path.includes("update_my_restaurant_socials")), "nothing sent while invalid");

  await fill(page, "#socials-form input[name=whatsapp]", "00964 750 123 4567");
  await save();
  await page.waitForSelector("#socials-form .alert-success:not([hidden])");
  const r = fake.db.restaurants.find((x) => x.id === GRILL_HOUSE_ID);
  assert.deepEqual(r.socials, { instagram: "https://www.instagram.com/kizuna.moments", facebook: "https://facebook.com/grillhouse", whatsapp: "+9647501234567" });
  assert.equal(r.name, "Grill House", "other settings untouched");

  const context = await browser.createBrowserContext();
  const visitor = await context.newPage();
  await visitor.goto(url + "/", { waitUntil: "networkidle0" });
  const links = await visitor.$$eval(".social-row [data-social]", (ls) => Object.fromEntries(ls.map((l) =>
    [l.dataset.social, l.style.display === "none" ? null : [l.getAttribute("href"), l.target, l.rel]])));
  assert.deepEqual(links, {
    facebook: ["https://facebook.com/grillhouse", "_blank", "noopener noreferrer"],
    instagram: ["https://www.instagram.com/kizuna.moments", "_blank", "noopener noreferrer"],
    tiktok: null,
    whatsapp: ["https://wa.me/9647501234567", "_blank", "noopener noreferrer"],
  });
  await context.close();
  assert.deepEqual(errors, []);
});

test("social links: before the migration, saving reports that it is not enabled", { skip: SOCIALS_HIDDEN }, async (t) => {
  const { page, fake } = await signedIn(t, { socialsFunction: false });
  await go(page, "settings");
  await fill(page, "#socials-form input[name=tiktok]", "https://www.tiktok.com/@grillhouse");
  await page.click("#socials-form button[type=submit]");
  await page.waitForSelector("#socials-form .alert:not([hidden]):not(.alert-success)");
  assert.match(await alertOf(page, "#socials-form"), /owner_update_restaurant_socials/);
  assert.equal(fake.db.restaurants.find((x) => x.id === GRILL_HOUSE_ID).socials.tiktok, undefined);
});

test("password: checked locally, then changed through Supabase Auth", { skip: SKIP }, async (t) => {
  const { page, fake } = await signedIn(t);
  await go(page, "password");
  await fill(page, "#password-form input[name=password]", "short");
  await page.click("#password-form button[type=submit]");
  assert.match(await alertOf(page, "#password-form"), /10 أحرف/);
  await fill(page, "#password-form input[name=password]", "New-Grill-Password-1");
  await fill(page, "#password-form input[name=confirm]", "different-password");
  await page.click("#password-form button[type=submit]");
  assert.match(await alertOf(page, "#password-form"), /غير متطابقتين/);
  assert.ok(!fake.log.some((l) => l.method === "PUT"));
  await fill(page, "#password-form input[name=confirm]", "New-Grill-Password-1");
  await page.click("#password-form button[type=submit]");
  await page.waitForSelector("#password-form .alert.alert-success:not([hidden])");
  assert.equal(fake.db.users.find((u) => u.email === USERS.admin.email).password, "New-Grill-Password-1");
});

test("logout: back to the sign-in screen, session gone", { skip: SKIP }, async (t) => {
  const { page, fake } = await signedIn(t);
  await page.click("#logout-btn");
  await page.waitForSelector("#view-login:not([hidden])");
  assert.match(await page.$eval("#login-message", (n) => n.textContent), /تم تسجيل الخروج/);
  assert.equal(await sessionStored(page), false);
  assert.ok(fake.log.some((l) => l.path.startsWith("/auth/v1/logout")));
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector("#view-login:not([hidden])");
});

// ---------- the database decides ----------

test("revoked access mid-session: saves are refused and reported, nothing changes (fake RLS)", { skip: SKIP }, async (t) => {
  const { page, fake } = await signedIn(t);
  await go(page, "products");
  fake.db.members.splice(fake.db.members.findIndex((m) => m.restaurant_id === GRILL_HOUSE_ID), 1);
  const hummus = itemNamed(fake, "حمص");
  await clickRow(page, "حمص", "تعديل");
  await page.waitForSelector("#item-dialog[open]");
  await fill(page, "#item-dialog input[name=price]", "1");
  await page.click("#item-dialog button[type=submit]");
  await page.waitForSelector("#item-dialog .alert:not([hidden])");
  assert.match(await alertOf(page, "#item-dialog"), /لا تملك صلاحية/);
  assert.equal(hummus.price, 4000);
});

test("bypassing the dashboard: another owner's session cannot change Grill House (fake RLS)", { skip: SKIP }, async (t) => {
  const { page, fake } = await open(t, { path: "/" });
  const hummus = itemNamed(fake, "حمص");
  const result = await page.evaluate(async ({ email, password, restaurantId, itemId }) => {
    const { supabase } = await import("/shared/supabase/client.js");
    const menu = await import("/shared/data/menu.js");
    await supabase.auth.signInWithPassword({ email, password });
    const update = await menu.updateMenuItem(supabase, restaurantId, itemId, { name: "hacked", price: 1, is_available: false, sort_order: 1, description: null, image_path: null, category_id: null });
    const create = await menu.createCategory(supabase, restaurantId, { name: "x", slug: "x", icon: "list", sort_order: 9, is_visible: true });
    const del = await menu.deleteMenuItem(supabase, restaurantId, itemId);
    const upload = await menu.uploadItemImage(supabase, restaurantId, new File([new Uint8Array([1])], "a.png", { type: "image/png" }));
    return { update: update.error && update.error.code, create: create.error && create.error.code, del: del.error && del.error.code, upload: Boolean(upload.error) };
  }, { email: USERS.other.email, password: USERS.other.password, restaurantId: GRILL_HOUSE_ID, itemId: hummus.id });
  assert.deepEqual(result, { update: "denied", create: "42501", del: "denied", upload: true });
  assert.equal(hummus.name, "حمص");
  assert.equal(fake.storage.size, 0);
});
