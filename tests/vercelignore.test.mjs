// .vercelignore decides which files reach production. These checks use the
// same matching as tests/dev-server.mjs (Vercel's .gitignore rules).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parseIgnore, vercelIgnored } from "./dev-server.mjs";

const ROOT = new URL("../", import.meta.url);
const rules = parseIgnore(readFileSync(new URL(".vercelignore", ROOT), "utf8"));
const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);

test(".vercelignore keeps every file the site serves", () => {
  const site = tracked.filter((f) => /^(shared|grill-admin|restaurants)\//.test(f) || /^favicon\.(ico|svg)$/.test(f) || f === "vercel.json");
  assert.ok(site.includes("shared/supabase/client.js"));
  assert.deepEqual(site.filter((f) => vercelIgnored(rules, f)), []);
});

test(".vercelignore drops tests, the supabase/ folder, the archive, docs and local config", () => {
  for (const f of ["tests/dev-server.mjs", "supabase/migrations/x.sql", "supabase/backups/x.json", "_archive/inline-editor/editor.js",
    "README.md", ".mcp.json", ".claude/settings.local.json", ".env.local"]) {
    assert.ok(vercelIgnored(rules, f), f);
  }
});

test("matching follows .gitignore rules: an unanchored folder pattern matches at any depth", () => {
  const loose = parseIgnore("supabase/\n");
  assert.ok(vercelIgnored(loose, "shared/supabase/client.js"), "the pattern that broke production");
  assert.ok(!vercelIgnored(parseIgnore("/supabase/\n"), "shared/supabase/client.js"));
  assert.ok(!vercelIgnored(loose, "supabase"), "folder-only pattern does not match a file");
});
