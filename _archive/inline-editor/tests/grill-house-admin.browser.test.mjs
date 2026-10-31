// Grill House inline editing: real browser + FAKE Supabase.
//
// What is real: Chrome/Edge (puppeteer-core), the page (index.html, style.css,
// script.js, manage-menu.js, admin/*), the supabase-js client from the CDN and
// every shared/ module, talking HTTP.
// What is fake: the backend. tests/support/fake-supabase.mjs answers the
// PostgREST, Auth and Storage calls from memory, with row rules modelled on
// the project's policies. These tests therefore prove the page and its
// client code; they do NOT prove the real database's RLS (see README).
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
  const dir = await mkdtemp(path.join(os.tmpdir(), "grill-house-test-"));
  files = { png1: path.join(dir, "one.png"), png2: path.join(dir, "two.png"), text: path.join(dir, "notes.txt") };
  await writeFile(files.png1, PNG);
  await writeFile(files.png2, PNG);
  await writeFile(files.text, "not an image");
});

after(async () => {
  if (browser) await browser.close();
});

// ---------- helpers ----------

async function open(t, { itemVisibility = false, path: start = "/", width = 1280 } = {}) {
  const { server, url, fake } = await startServer({ mock: true, itemVisibility });
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

const idle = (page) => page.waitForFunction(() => !document.body.classList.contains("gh-busy"));

async function fill(page, selector, value) {
  await page.$eval(selector, (node) => { node.value = ""; });
  if (value) await page.type(selector, value);
}

async function signIn(page, user) {
  await page.waitForSelector("#gh-login-dialog[open]");
  await fill(page, "#gh-login-dialog input[name=email]", user.email);
  await fill(page, "#gh-login-dialog input[name=password]", user.password);
  await page.click("#gh-login-dialog button[type=submit]");
}

async function openEditing(t, options = {}) {
  const env = await open(t, Object.assign({ path: "/?admin" }, options));
  await signIn(env.page, USERS.admin);
  await env.page.waitForSelector(".gh-item-tools");
  await idle(env.page);
  return env;
}

const cats = (fake) => fake.db.categories.filter((c) => c.restaurant_id === GRILL_HOUSE_ID).sort((a, b) => a.sort_order - b.sort_order);
const itemNamed = (fake, name) => fake.db.items.find((i) => i.name === name);
const catNamed = (fake, name) => fake.db.categories.find((c) => c.name === name);

function sectionHandle(page, name) {
  return page.evaluateHandle((n) => Array.from(document.querySelectorAll(".menu-section"))
    .find((s) => s.querySelector("h2").firstChild.textContent.trim() === n), name);
}

function cardHandle(page, name) {
  return page.evaluateHandle((n) => Array.from(document.querySelectorAll(".menu-card"))
    .find((c) => c.querySelector("h3").textContent.trim() === n), name);
}

// Clicks the toolbar button with this text or aria-label inside `scope`.
async function clickTool(page, scope, text) {
  const button = await scope.evaluateHandle((node, label) => Array.from(node.querySelectorAll(".gh-tools button"))
    .find((b) => b.textContent.trim() === label || b.getAttribute("aria-label") === label), text);
  assert.ok(button.asElement(), "tool button «" + text + "» exists");
  await button.asElement().click();
  await idle(page);
}

async function clickBar(page, text) {
  const button = await page.evaluateHandle((label) => Array.from(document.querySelectorAll(".gh-bar .gh-btn"))
    .find((b) => b.textContent.trim() === label), text);
  await button.asElement().click();
}

async function openCard(page, name) {
  const card = await cardHandle(page, name);
  await (await card.asElement().$("h3")).click();
  await page.waitForSelector("#gh-item-dialog[open]");
}

async function submitDialog(page, id) {
  await page.click(`#${id} button[type=submit]`);
}

const dialogGone = (page, id) => page.waitForSelector("#" + id, { hidden: true });
const alertText = (page, id) => page.$eval(`#${id} .gh-alert`, (n) => (n.hidden ? "" : n.textContent));
const sessionStored = (page) => page.evaluate(() => Object.keys(localStorage).some((k) => /^sb-.*-auth-token$/.test(k)));
const sectionNames = (page) => page.$$eval(".menu-section h2", (hs) => hs.map((h) => h.firstChild.textContent.trim()));
const cardNames = (page, section) => page.evaluate((n) => {
  const s = Array.from(document.querySelectorAll(".menu-section")).find((x) => x.querySelector("h2").firstChild.textContent.trim() === n);
  return s ? Array.from(s.querySelectorAll(".menu-card h3")).map((h) => h.textContent.trim()) : null;
}, section);

async function stopEditing(page) {
  await clickBar(page, "إنهاء التعديل");
  await page.waitForSelector(".gh-bar", { hidden: true });
  await page.waitForFunction(() => !document.querySelector(".gh-section") && !document.body.classList.contains("gh-editing"));
}

async function startEditing(page) {
  await page.click(".manage-btn");
  await page.waitForSelector(".gh-item-tools");
  await idle(page);
}

// ---------- visitors ----------

test("visitor: the menu comes from the database, with no admin control, code or request", { skip: SKIP }, async (t) => {
  const { page, fake, errors, requests } = await open(t);
  assert.deepEqual(await sectionNames(page), ["المقبلات", "المشويات", "البرغر", "الحلويات"]);
  assert.ok(await page.$(".menu-card"), "menu cards rendered");
  assert.equal(await page.$(".manage-btn"), null, "no management button");
  assert.equal(await page.$("[class*='gh-']"), null, "no admin elements");
  assert.equal(await page.$("dialog"), null, "no dialogs");
  assert.ok(!requests.some((u) => u.includes("/admin/")), "no admin module or CSS downloaded");
  assert.ok(!fake.log.some((l) => l.path.startsWith("/auth/") || l.path.includes("/rpc/")), "no auth or rpc call");
  assert.ok(!fake.log.some((l) => l.method !== "GET"), "only reads");
  assert.deepEqual(errors, []);
});

// ---------- sign-in and authorization ----------

test("sign-in: a wrong password is rejected with a clear message", { skip: SKIP }, async (t) => {
  const { page } = await open(t, { path: "/?admin" });
  await signIn(page, { email: USERS.admin.email, password: "wrong-password" });
  await page.waitForFunction(() => !document.querySelector("#gh-login-dialog .gh-alert").hidden);
  assert.match(await alertText(page, "gh-login-dialog"), /غير صحيحة/);
  assert.equal(await sessionStored(page), false);
  assert.equal(await page.$(".manage-btn"), null);
});

for (const [label, user] of [["the owner of another restaurant", USERS.other], ["a system admin who is not a member", USERS.sysadmin]]) {
  test(`sign-in: ${label} is rejected and signed out`, { skip: SKIP }, async (t) => {
    const { page, fake } = await open(t, { path: "/?admin" });
    await signIn(page, user);
    await page.waitForFunction(() => !document.querySelector("#gh-login-dialog .gh-alert").hidden);
    assert.match(await alertText(page, "gh-login-dialog"), /لا يملك صلاحية إدارة مطعم GRILL HOUSE/);
    await until(async () => !(await sessionStored(page)), "local session cleared");
    assert.ok(fake.log.some((l) => l.path.startsWith("/auth/v1/logout")), "signed out on the server");
    assert.equal(await page.$(".manage-btn"), null, "no management button");
    assert.equal(await page.$(".gh-bar"), null, "no editing mode");
  });
}

test("sign-in: a Grill House admin gets the button; it switches editing mode on and off", { skip: SKIP }, async (t) => {
  const { page, errors, url } = await openEditing(t);
  assert.equal(new URL(page.url()).search, "", "?admin removed from the address");
  assert.equal(await page.$eval(".manage-btn", (b) => b.getAttribute("aria-pressed")), "true");
  assert.equal(await page.$$eval(".gh-section", (s) => s.length), 4);
  assert.equal(await page.$eval("html", (n) => n.dir), "rtl");
  assert.equal(await page.$eval(".gh-bar", (n) => n.dir), "rtl");
  assert.equal(await page.$eval(".gh-bar-public", (a) => a.getAttribute("href")), url + "/r/grill-house");

  await stopEditing(page);
  assert.equal(await page.$eval(".manage-btn", (b) => b.getAttribute("aria-pressed")), "false");
  await startEditing(page);
  assert.ok(await page.$(".gh-bar"));

  // The session survives a reload: the button is back, editing starts off.
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector(".manage-btn");
  assert.equal(await page.$(".gh-bar"), null);
  assert.deepEqual(errors, []);
});

// ---------- categories ----------

test("categories: add, edit, hide, reorder and delete", { skip: SKIP }, async (t) => {
  const { page, fake, errors } = await openEditing(t);

  // Add
  await clickBar(page, "+ قسم جديد");
  await page.waitForSelector("#gh-category-dialog[open]");
  await fill(page, "#gh-category-dialog input[name=name]", "السلطات");
  await page.select("#gh-category-dialog select[name=icon]", "bowl");
  await submitDialog(page, "gh-category-dialog");
  await dialogGone(page, "gh-category-dialog");
  await page.waitForFunction(() => Array.from(document.querySelectorAll(".menu-section h2")).some((h) => h.textContent.startsWith("السلطات")));
  let created = catNamed(fake, "السلطات");
  assert.deepEqual([created.slug, created.icon, created.sort_order, created.is_visible], ["category", "bowl", 5, true]);
  assert.ok(await page.$$eval(".category-link span", (s) => s.some((n) => n.textContent === "السلطات")), "in the category bar");

  // Edit
  await clickTool(page, await sectionHandle(page, "السلطات"), "تعديل");
  await page.waitForSelector("#gh-category-dialog[open]");
  await fill(page, "#gh-category-dialog input[name=name]", "سلطات طازجة");
  await page.select("#gh-category-dialog select[name=icon]", "flame");
  await submitDialog(page, "gh-category-dialog");
  await dialogGone(page, "gh-category-dialog");
  await until(() => created.name === "سلطات طازجة" && created.icon === "flame", "category renamed");
  assert.equal(created.slug, "category", "slug never changes");

  // Hide: marked in editing mode, absent from the public menu
  await clickTool(page, await sectionHandle(page, "سلطات طازجة"), "إخفاء");
  await until(() => created.is_visible === false, "category hidden");
  await page.waitForSelector(".gh-section.gh-is-hidden .gh-badge");
  await stopEditing(page);
  assert.ok(!(await sectionNames(page)).includes("سلطات طازجة"), "hidden category not shown publicly");
  await startEditing(page);
  await clickTool(page, await sectionHandle(page, "سلطات طازجة"), "إظهار");
  await until(() => created.is_visible === true, "category shown again");

  // Reorder: move the new (last) category one place up
  await clickTool(page, await sectionHandle(page, "سلطات طازجة"), "تقديم");
  await until(() => cats(fake).map((c) => c.name).join() === "المقبلات,المشويات,البرغر,سلطات طازجة,الحلويات", "category order saved");
  assert.deepEqual(cats(fake).map((c) => c.sort_order), [1, 2, 3, 4, 5]);
  await page.waitForFunction(() => document.querySelectorAll(".menu-section h2")[3].textContent.startsWith("سلطات طازجة"));

  // Delete a category that still has items: refused, nothing changes
  await clickTool(page, await sectionHandle(page, "المقبلات"), "حذف");
  await page.waitForSelector("#gh-confirm-dialog[open]");
  await submitDialog(page, "gh-confirm-dialog");
  await page.waitForFunction(() => !document.querySelector("#gh-confirm-dialog .gh-alert").hidden);
  assert.match(await alertText(page, "gh-confirm-dialog"), /يحتوي على أصناف/);
  assert.ok(catNamed(fake, "المقبلات"));
  await page.click("#gh-confirm-dialog .gh-actions button[type=button]:not(.gh-btn-danger)");
  await dialogGone(page, "gh-confirm-dialog");

  // Delete the empty one (from its edit dialog)
  await clickTool(page, await sectionHandle(page, "سلطات طازجة"), "تعديل");
  await page.waitForSelector("#gh-category-dialog[open]");
  await page.click("#gh-category-dialog .gh-btn-danger");
  await page.waitForSelector("#gh-confirm-dialog[open]");
  await submitDialog(page, "gh-confirm-dialog");
  await dialogGone(page, "gh-confirm-dialog");
  await dialogGone(page, "gh-category-dialog");
  await until(() => !catNamed(fake, "سلطات طازجة"), "category deleted");
  await page.waitForFunction(() => !Array.from(document.querySelectorAll(".menu-section h2")).some((h) => h.textContent.startsWith("سلطات")));
  assert.deepEqual(errors, []);
});

// ---------- items ----------

test("items: add with image, edit name/description/price, availability, reorder, move, delete", { skip: SKIP }, async (t) => {
  const { page, fake, errors } = await openEditing(t);

  // Add to «البرغر», with an image
  const addButton = await page.evaluateHandle(() => Array.from(document.querySelectorAll(".gh-add-item")).find((b) => b.textContent.includes("البرغر")));
  await addButton.asElement().click();
  await page.waitForSelector("#gh-item-dialog[open]");
  assert.equal(await page.$eval("#gh-item-dialog select[name=category_id]", (s) => s.selectedOptions[0].textContent), "البرغر");
  await fill(page, "#gh-item-dialog input[name=name]", "برغر دجاج");
  await fill(page, "#gh-item-dialog textarea[name=description]", "صدر دجاج مقرمش");
  await fill(page, "#gh-item-dialog input[name=price]", "8500");
  await (await page.$("#gh-item-dialog input[type=file]")).uploadFile(files.png1);
  await page.waitForSelector("#gh-item-dialog .gh-image-preview img[src^='blob:']");
  await submitDialog(page, "gh-item-dialog");
  await dialogGone(page, "gh-item-dialog");
  await until(() => itemNamed(fake, "برغر دجاج"), "item created");
  let item = itemNamed(fake, "برغر دجاج");
  assert.equal(item.price, 8500);
  assert.equal(item.description, "صدر دجاج مقرمش");
  assert.equal(item.sort_order, 2, "added at the end of its category");
  assert.match(item.image_path, new RegExp("^" + GRILL_HOUSE_ID + "/items/[0-9a-f-]+\\.png$"));
  assert.ok(fake.storage.has(item.image_path), "image stored in the restaurant's folder");
  await page.waitForFunction(() => Array.from(document.querySelectorAll(".menu-card")).some((c) =>
    c.querySelector("h3").textContent === "برغر دجاج" && c.querySelector("img")?.src.includes("/storage/v1/object/public/restaurant-images/")));
  assert.deepEqual(await cardNames(page, "البرغر"), ["برغر اللحم الكلاسيكي", "برغر دجاج"]);

  // Invalid price is refused before anything is sent
  await openCard(page, "برغر دجاج");
  const writesBefore = fake.log.filter((l) => l.method !== "GET").length;
  await fill(page, "#gh-item-dialog input[name=price]", "-5");
  await submitDialog(page, "gh-item-dialog");
  assert.match(await alertText(page, "gh-item-dialog"), /سعر صحيح/);
  assert.equal(fake.log.filter((l) => l.method !== "GET").length, writesBefore);

  // Edit name and price
  await fill(page, "#gh-item-dialog input[name=price]", "9000");
  await fill(page, "#gh-item-dialog input[name=name]", "برغر الدجاج المقرمش");
  await submitDialog(page, "gh-item-dialog");
  await dialogGone(page, "gh-item-dialog");
  await until(() => item.price === 9000 && item.name === "برغر الدجاج المقرمش", "item updated");
  await page.waitForFunction(() => Array.from(document.querySelectorAll(".menu-card")).some((c) =>
    c.querySelector("h3").textContent === "برغر الدجاج المقرمش" && c.querySelector(".price").textContent.startsWith("9,000")));

  // Availability
  await clickTool(page, await cardHandle(page, "برغر الدجاج المقرمش"), "تبديل حالة التوفر لـ «برغر الدجاج المقرمش»");
  await until(() => item.is_available === false, "item unavailable");
  await page.waitForFunction(() => Array.from(document.querySelectorAll(".menu-card.is-unavailable h3")).some((h) => h.textContent === "برغر الدجاج المقرمش"));

  // Reorder inside «المقبلات»: move «حمص» one place down
  await clickTool(page, await cardHandle(page, "حمص"), "تأخير");
  await until(() => ["سلطة سيزر", "حمص", "ناتشوز"].every((n, i) => itemNamed(fake, n).sort_order === i + 1), "item order saved");
  assert.deepEqual(await cardNames(page, "المقبلات"), ["سلطة سيزر", "حمص", "ناتشوز"]);

  // Move to another category: goes to the end of «المشويات»
  await openCard(page, "برغر الدجاج المقرمش");
  await page.select("#gh-item-dialog select[name=category_id]", catNamed(fake, "المشويات").id);
  await submitDialog(page, "gh-item-dialog");
  await dialogGone(page, "gh-item-dialog");
  await until(() => item.category_id === catNamed(fake, "المشويات").id, "item moved");
  assert.equal(item.sort_order, 3);
  await page.waitForFunction(() => document.querySelectorAll(".menu-section")[1].textContent.includes("برغر الدجاج المقرمش"));

  // The public menu shows the changes after leaving editing mode
  await stopEditing(page);
  assert.deepEqual(await cardNames(page, "المشويات"), ["مشاوي مشكلة", "شيش طاووق", "برغر الدجاج المقرمش"]);
  assert.deepEqual(await cardNames(page, "المقبلات"), ["سلطة سيزر", "حمص", "ناتشوز"]);
  assert.match(await (await cardHandle(page, "برغر الدجاج المقرمش")).evaluate((c) => c.textContent), /غير متوفر حالياً/);
  assert.equal(await page.$(".gh-tools"), null);

  // Delete (removes its uploaded image too)
  await startEditing(page);
  const imagePath = item.image_path;
  await openCard(page, "برغر الدجاج المقرمش");
  await page.click("#gh-item-dialog .gh-actions-start .gh-btn-danger");
  await page.waitForSelector("#gh-confirm-dialog[open]");
  assert.match(await page.$eval("#gh-confirm-dialog .gh-confirm-text", (n) => n.textContent), /برغر الدجاج المقرمش/);
  await submitDialog(page, "gh-confirm-dialog");
  await dialogGone(page, "gh-item-dialog");
  await until(() => !itemNamed(fake, "برغر الدجاج المقرمش"), "item deleted");
  await until(() => !fake.storage.has(imagePath), "image removed from storage");
  assert.equal(await cardHandle(page, "برغر الدجاج المقرمش").then((h) => h.asElement()), null);
  assert.deepEqual(errors, []);
});

test("images: upload, replace (old upload removed), remove; shipped images never deleted; wrong type refused", { skip: SKIP }, async (t) => {
  const { page, fake, errors } = await openEditing(t);
  const hummus = itemNamed(fake, "حمص");
  assert.ok(hummus.image_path.startsWith("/restaurants/grill-house/assets/"));

  // Wrong file type: refused in the browser, nothing uploaded
  await openCard(page, "حمص");
  await (await page.$("#gh-item-dialog input[type=file]")).uploadFile(files.text);
  await page.waitForFunction(() => !document.querySelector("#gh-item-dialog .gh-alert").hidden);
  assert.match(await alertText(page, "gh-item-dialog"), /نوع الصورة غير مدعوم/);
  assert.ok(!fake.log.some((l) => l.path.startsWith("/storage/v1/object/restaurant-images/")));

  // Replace the shipped image with an upload
  await (await page.$("#gh-item-dialog input[type=file]")).uploadFile(files.png1);
  await submitDialog(page, "gh-item-dialog");
  await dialogGone(page, "gh-item-dialog");
  await until(() => !hummus.image_path.startsWith("/restaurants/"), "image replaced");
  const first = hummus.image_path;
  assert.ok(fake.storage.has(first));
  assert.ok(!fake.log.some((l) => l.method === "DELETE" && l.path.startsWith("/storage/")), "shipped image not deleted");

  // Replace again: the previous upload is removed
  await openCard(page, "حمص");
  assert.equal(await page.$eval("#gh-item-dialog .gh-image-actions label", (l) => l.textContent.trim()), "تغيير الصورة");
  await (await page.$("#gh-item-dialog input[type=file]")).uploadFile(files.png2);
  await submitDialog(page, "gh-item-dialog");
  await dialogGone(page, "gh-item-dialog");
  await until(() => hummus.image_path !== first, "image replaced again");
  await until(() => !fake.storage.has(first), "old upload removed");
  assert.equal(fake.storage.size, 1);

  // Remove the image
  await openCard(page, "حمص");
  await page.click("#gh-item-dialog .gh-image-actions .gh-btn-danger");
  await page.waitForSelector("#gh-item-dialog .gh-image-preview svg");
  await submitDialog(page, "gh-item-dialog");
  await dialogGone(page, "gh-item-dialog");
  await until(() => hummus.image_path === null, "image removed from item");
  await until(() => fake.storage.size === 0, "upload deleted");
  await page.waitForFunction(() => {
    const card = Array.from(document.querySelectorAll(".menu-card")).find((c) => c.querySelector("h3").textContent === "حمص");
    return card && !card.querySelector(".menu-card-image img") && card.querySelector(".menu-card-image svg");
  });
  assert.deepEqual(errors, []);
});

test("item visibility: disabled until the migration is applied", { skip: SKIP }, async (t) => {
  const { page, errors } = await openEditing(t);
  const tool = await (await cardHandle(page, "حمص")).evaluate((card) =>
    Array.from(card.querySelectorAll(".gh-tools button")).find((b) => b.textContent === "ظاهر").disabled);
  assert.equal(tool, true, "toolbar control disabled");
  await openCard(page, "حمص");
  assert.equal(await page.$eval("#gh-item-dialog input[name=is_visible]", (i) => i.disabled), true);
  assert.match(await page.$eval("#gh-item-dialog", (d) => d.textContent), /menu_item_visibility/);
  await page.click("#gh-item-dialog .gh-actions button[type=button]:not(.gh-btn-danger)");
  assert.deepEqual(errors, []);
});

test("item visibility (column present): hidden items stay editable but leave the public menu", { skip: SKIP }, async (t) => {
  const { page, fake, errors } = await openEditing(t, { itemVisibility: true });
  await clickTool(page, await cardHandle(page, "ناتشوز"), "إظهار «ناتشوز» للزوار أو إخفاؤه");
  await until(() => itemNamed(fake, "ناتشوز").is_visible === false, "item hidden");
  await page.waitForFunction(() => Array.from(document.querySelectorAll(".menu-card.gh-is-hidden h3")).some((h) => h.textContent === "ناتشوز"));

  await stopEditing(page);
  assert.deepEqual(await cardNames(page, "المقبلات"), ["حمص", "سلطة سيزر"]);

  // Show it again from the item dialog
  await startEditing(page);
  await openCard(page, "ناتشوز");
  await page.click("#gh-item-dialog input[name=is_visible]");
  await submitDialog(page, "gh-item-dialog");
  await dialogGone(page, "gh-item-dialog");
  await until(() => itemNamed(fake, "ناتشوز").is_visible === true, "item visible");
  assert.deepEqual(errors, []);
});

// ---------- profile, password, logout ----------

test("profile: validated, saved through update_my_restaurant_profile, shown on the page", { skip: SKIP }, async (t) => {
  const { page, fake, url, errors } = await openEditing(t);
  await clickBar(page, "معلومات المطعم");
  await page.waitForSelector("#gh-profile-dialog[open]");
  assert.equal(await page.$eval("#gh-profile-dialog input[name=phone]", (i) => i.value), "+964 750 123 4567");

  await fill(page, "#gh-profile-dialog input[name=phone]", "call me");
  await submitDialog(page, "gh-profile-dialog");
  assert.match(await alertText(page, "gh-profile-dialog"), /رقم الهاتف غير صالح/);
  assert.ok(!fake.log.some((l) => l.path.includes("update_my_restaurant_profile")));

  await fill(page, "#gh-profile-dialog input[name=phone]", "+964 770 000 0000");
  await fill(page, "#gh-profile-dialog input[name=address]", "الكرادة، بغداد");
  await fill(page, "#gh-profile-dialog input[name=hours]", "10:00 – 23:00");
  await fill(page, "#gh-profile-dialog input[name=tagline]", "مشاوي على الفحم");
  await submitDialog(page, "gh-profile-dialog");
  await dialogGone(page, "gh-profile-dialog");
  const row = fake.db.restaurants.find((r) => r.id === GRILL_HOUSE_ID);
  assert.deepEqual([row.phone, row.address, row.hours, row.tagline], ["+964 770 000 0000", "الكرادة، بغداد", "10:00 – 23:00", "مشاوي على الفحم"]);
  assert.equal(row.slug, "grill-house");

  const shown = await page.evaluate(() => ({
    address: document.querySelector('[data-profile="address"]').textContent,
    phone: document.querySelector('[data-profile="phone"]').textContent,
    hours: document.querySelector('[data-profile="hours"]').textContent,
    tel: document.querySelector(".contact-btn").getAttribute("href"),
    tagline: document.querySelector(".hero-content .hero-kicker").textContent,
  }));
  assert.deepEqual(shown, { address: "الكرادة، بغداد", phone: "+964 770 000 0000", hours: "10:00 – 23:00", tel: "tel:+9647700000000", tagline: "مشاوي على الفحم" });

  // A visitor (no session) sees the new details too
  const visitor = await browser.createBrowserContext();
  const other = await visitor.newPage();
  await other.goto(url + "/", { waitUntil: "networkidle0" });
  assert.equal(await other.$eval('[data-profile="address"]', (n) => n.textContent), "الكرادة، بغداد");
  await visitor.close();
  assert.deepEqual(errors, []);
});

test("password: checked locally, then changed through Supabase Auth", { skip: SKIP }, async (t) => {
  const { page, fake, errors } = await openEditing(t);
  await clickBar(page, "كلمة المرور");
  await page.waitForSelector("#gh-password-dialog[open]");
  await fill(page, "#gh-password-dialog input[name=password]", "short");
  await submitDialog(page, "gh-password-dialog");
  assert.match(await alertText(page, "gh-password-dialog"), /10 أحرف/);
  await fill(page, "#gh-password-dialog input[name=password]", "New-Grill-Password-1");
  await fill(page, "#gh-password-dialog input[name=confirm]", "New-Grill-Password-2");
  await submitDialog(page, "gh-password-dialog");
  assert.match(await alertText(page, "gh-password-dialog"), /غير متطابقتين/);
  assert.ok(!fake.log.some((l) => l.method === "PUT"));

  await fill(page, "#gh-password-dialog input[name=confirm]", "New-Grill-Password-1");
  await submitDialog(page, "gh-password-dialog");
  await dialogGone(page, "gh-password-dialog");
  assert.ok(fake.log.some((l) => l.method === "PUT" && l.path === "/auth/v1/user"));
  assert.equal(fake.db.users.find((u) => u.email === USERS.admin.email).password, "New-Grill-Password-1");
  assert.deepEqual(errors, []);
});

test("logout: editing ends, the button disappears, the session is gone", { skip: SKIP }, async (t) => {
  const { page, fake, errors } = await openEditing(t);
  await clickBar(page, "تسجيل الخروج");
  await page.waitForSelector(".manage-btn", { hidden: true });
  assert.equal(await page.$(".gh-bar"), null);
  assert.equal(await page.$(".gh-section"), null);
  assert.equal(await sessionStored(page), false);
  assert.ok(fake.log.some((l) => l.path.startsWith("/auth/v1/logout")));
  await page.reload({ waitUntil: "networkidle0" });
  assert.equal(await page.$(".manage-btn"), null);
  assert.deepEqual(errors, []);
});

// ---------- the database decides, not the buttons ----------

test("revoked access mid-session: saves are refused and reported, nothing changes (fake RLS)", { skip: SKIP }, async (t) => {
  const { page, fake } = await openEditing(t);
  fake.db.members.splice(fake.db.members.findIndex((m) => m.restaurant_id === GRILL_HOUSE_ID), 1);
  const hummus = itemNamed(fake, "حمص");

  await openCard(page, "حمص");
  await fill(page, "#gh-item-dialog input[name=price]", "1");
  await submitDialog(page, "gh-item-dialog");
  await page.waitForFunction(() => !document.querySelector("#gh-item-dialog .gh-alert").hidden);
  assert.match(await alertText(page, "gh-item-dialog"), /لا تملك صلاحية/);
  assert.equal(hummus.price, 4000);
  await page.click("#gh-item-dialog .gh-actions button[type=button]:not(.gh-btn-danger)");

  await clickTool(page, await cardHandle(page, "حمص"), "تبديل حالة التوفر لـ «حمص»");
  await page.waitForSelector(".gh-toast.gh-toast-error:not([hidden])");
  assert.equal(hummus.is_available, true);
});

test("bypassing the page: another owner's session cannot change Grill House (fake RLS)", { skip: SKIP }, async (t) => {
  const { page, fake } = await open(t);
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
  assert.ok(itemNamed(fake, "حمص"));
  assert.equal(fake.storage.size, 0);
});

test("mobile width: editing bar, toolbars and dialogs fit the screen", { skip: SKIP }, async (t) => {
  const { page, errors } = await openEditing(t, { width: 390 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, "no horizontal page scroll (" + overflow + "px)");
  await openCard(page, "حمص");
  const box = await page.$eval("#gh-item-dialog", (d) => { const r = d.getBoundingClientRect(); return { left: r.left, right: r.right }; });
  assert.ok(box.left >= 0 && box.right <= 390, "dialog inside the viewport");
  assert.deepEqual(errors, []);
});
