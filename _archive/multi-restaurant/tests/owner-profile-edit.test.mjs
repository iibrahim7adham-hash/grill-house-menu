// Regression tests for the owner dashboard's "تعديل معلومات المطعم" button.
//
// Run:  cd tests && npm install && npm test
//
// Loads the real owner/index.html and owner/js/dashboard.js in jsdom with a
// fake Supabase client (no network, no database).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel) => readFileSync(ROOT + rel, "utf8");

const RESTAURANT = {
  id: "a-1", slug: "grill-house", name: "Grill House", tagline: "Fire and flavour",
  phone: "+964 750 000 0000", address: "Erbil, 100m Street", hours: "12:00 – 00:00", is_published: true,
};

async function loadDashboard() {
  const html = read("owner/index.html").replace(/<script[^>]*><\/script>/g, "");
  const dom = new JSDOM(html, { url: "https://example.test/owner/" });
  for (const key of ["window", "document", "HTMLElement", "Node", "Event"]) globalThis[key] = dom.window[key];
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };

  const query = () => {
    const result = Promise.resolve({ data: [], error: null });
    const proxy = new Proxy(function () {}, {
      get: (_, key) => (key === "then" ? result.then.bind(result) : () => proxy),
      apply: () => proxy,
    });
    return proxy;
  };
  const supabase = {
    from: query,
    storage: { from: () => ({ getPublicUrl: (p) => ({ data: { publicUrl: p } }) }) },
    rpc: async () => ({ data: null, error: null }),
  };

  // Import the dashboard exactly as login.js does (same versioned URL).
  const spec = read("owner/js/login.js").match(/from "(\.\/dashboard\.js[^"]*)"/)[1];
  const { showDashboard, resetDashboard } = await import(new URL(spec, pathToFileURL(ROOT + "owner/js/login.js")).href);
  showDashboard(supabase, [{ ...RESTAURANT }]);
  return { document: dom.window.document, resetDashboard };
}

test("clicking «تعديل معلومات المطعم» opens the profile form with current data; cancel closes it", async () => {
  const { document, resetDashboard } = await loadDashboard();
  const button = document.getElementById("edit-profile-btn");
  const form = document.getElementById("profile-form");
  const field = (name) => form.elements.namedItem(name);

  assert.equal(document.querySelectorAll("#edit-profile-btn").length, 1, "button id is unique");
  assert.equal(document.querySelectorAll("#profile-form").length, 1, "form id is unique");
  assert.equal(button.textContent.trim(), "تعديل معلومات المطعم");
  assert.equal(form.hidden, true, "form starts hidden");

  button.click();

  assert.equal(form.hidden, false, "form opens on click");
  assert.equal(button.hidden, true, "button hides while editing");
  for (const key of ["name", "tagline", "phone", "address", "hours"]) {
    assert.equal(field(key).value, RESTAURANT[key], key + " is populated");
  }
  assert.equal(document.documentElement.dir, "rtl");

  document.getElementById("profile-cancel").click();
  assert.equal(form.hidden, true, "cancel closes the form");
  assert.equal(button.hidden, false, "button returns after cancel");

  button.click();
  assert.equal(form.hidden, false, "form reopens");
  resetDashboard();
  assert.equal(form.hidden, true, "sign-out closes the form");
});

// The original bug: a freshly loaded owner/index.html ran an older cached
// dashboard.js that had no click handler. Every owner module URL carries one
// shared ?v= token so new HTML always loads matching JS.
test("owner page loads every module with the same cache-busting version", () => {
  const entry = read("owner/index.html").match(/<script type="module" src="\/owner\/js\/login\.js\?v=([^"]+)"/);
  assert.ok(entry, "owner/index.html loads login.js with ?v=");
  const version = entry[1];

  for (const file of readdirSync(ROOT + "owner/js").filter((f) => f.endsWith(".js"))) {
    const source = read("owner/js/" + file);
    const specs = [...source.matchAll(/(?:from\s+|import\()\s*"(\.{1,2}\/[^"]+)"/g)].map((m) => m[1]);
    for (const spec of specs) {
      assert.match(spec, new RegExp("\\?v=" + version.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&") + "$"),
        `owner/js/${file} imports ${spec} without ?v=${version}`);
    }
  }
});
