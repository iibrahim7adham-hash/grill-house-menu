// In-memory stand-in for the parts of Supabase the Grill House page uses,
// served over HTTP so the real supabase-js client and the real shared/
// modules run unchanged against it. For local trials and tests only; it is
// NOT the real database and proves nothing about the real RLS policies.
//
//   PostgREST  /rest/v1/<table>, /rest/v1/rpc/<fn>
//              select / eq filters / order / limit; insert, update, delete
//              with Prefer: return=representation. Row rules mirror the
//              project's policies: anyone reads published restaurants' menus,
//              members read and write their own restaurant only; writes by
//              others match no rows (update/delete) or fail with 42501
//              (insert). Constraints: unique category slug (23505), item
//              category FK (23503 on insert/update, ON DELETE CASCADE when a
//              category is deleted), price >= 0 (23514), unknown columns
//              (42703 / PGRST204), e.g. menu_items.is_visible unless enabled.
//   RPC        get_my_restaurants, is_system_admin, update_my_restaurant_profile,
//              update_my_restaurant_socials (unless options.socialsFunction === false,
//              i.e. its migration not applied)
//   GoTrue     /auth/v1/token (password, refresh_token), /auth/v1/user (GET, PUT),
//              /auth/v1/logout
//   Storage    upload, remove and public read in the restaurant-images bucket;
//              writes only inside "<restaurant_id>/" of a member.

import { randomUUID, createHash } from "node:crypto";
import { normalizeSocial, SOCIAL_PLATFORMS } from "../../shared/utils/socials.js";

export const PUBLISHABLE_KEY = "sb_publishable_fake_local_only";
export const GRILL_HOUSE_ID = "00000000-0000-4000-8000-000000000001";
export const OTHER_RESTAURANT_ID = "00000000-0000-4000-8000-000000000002";

export const USERS = {
  admin: { email: "admin@grillhouse.test", password: "GrillAdmin-2026" },
  other: { email: "owner@other.test", password: "OtherOwner-2026" },
  sysadmin: { email: "sysadmin@platform.test", password: "SysAdmin-2026" },
};

const ASSETS = "/restaurants/grill-house/assets/";
const BUCKET = "restaurant-images";
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const COLUMNS = {
  restaurants: ["id", "slug", "name", "tagline", "phone", "address", "hours", "socials", "logo_image", "hero_image", "theme", "is_published", "created_at"],
  restaurant_members: ["restaurant_id", "user_id", "role", "created_at"],
  categories: ["id", "restaurant_id", "slug", "name", "icon", "sort_order", "is_visible"],
  menu_items: ["id", "restaurant_id", "category_id", "name", "description", "price", "image_path", "is_available", "sort_order", "created_at", "updated_at"],
  system_admins: ["user_id", "created_at"],
};

function seed() {
  const now = new Date().toISOString();
  const ids = { admin: randomUUID(), other: randomUUID(), sysadmin: randomUUID() };
  const users = Object.entries(USERS).map(([key, u]) => ({
    id: ids[key], email: u.email, password: u.password, created_at: now,
  }));
  const restaurants = [
    { id: GRILL_HOUSE_ID, slug: "grill-house", name: "Grill House", tagline: null, phone: "+964 750 123 4567",
      address: "المنصور، بغداد", hours: "12:00 ظهرًا – 12:00 منتصف الليل",
      socials: { instagram: "https://www.instagram.com/kizuna.moments/" }, logo_image: null, hero_image: null,
      theme: {}, is_published: true, created_at: now },
    { id: OTHER_RESTAURANT_ID, slug: "other-place", name: "Other Place", tagline: null, phone: null, address: null,
      hours: null, socials: {}, logo_image: null, hero_image: null, theme: {}, is_published: true, created_at: now },
  ];
  const members = [
    { restaurant_id: GRILL_HOUSE_ID, user_id: ids.admin, role: "owner", created_at: now },
    { restaurant_id: OTHER_RESTAURANT_ID, user_id: ids.other, role: "owner", created_at: now },
  ];
  const cat = (slug, name, icon, order) => ({ id: randomUUID(), restaurant_id: GRILL_HOUSE_ID, slug, name, icon, sort_order: order, is_visible: true });
  const categories = [
    cat("appetizers", "المقبلات", "bowl", 1),
    cat("main-dishes", "المشويات", "skewer", 2),
    cat("burgers", "البرغر", "burger", 3),
    cat("desserts", "الحلويات", "cake", 4),
    { id: randomUUID(), restaurant_id: OTHER_RESTAURANT_ID, slug: "food", name: "Other food", icon: "list", sort_order: 1, is_visible: true },
  ];
  const [app, grills, burgers, desserts, otherCat] = categories;
  const item = (category, name, description, price, image, order) => ({
    id: randomUUID(), restaurant_id: category.restaurant_id, category_id: category.id, name, description, price,
    image_path: image, is_available: true, sort_order: order, created_at: now, updated_at: now,
  });
  const items = [
    item(app, "حمص", "حمص كريمي معد طازجاً، يقدم بزيت الزيتون.", 4000, ASSETS + "appetizers/hummus.webp", 1),
    item(app, "سلطة سيزر", "خس روماني مع صلصة السيزر.", 6000, ASSETS + "appetizers/caesar-salad.webp", 2),
    item(app, "ناتشوز", "رقائق ذرة مع جبنة ذائبة.", 7000, ASSETS + "appetizers/nachos.webp", 3),
    item(grills, "مشاوي مشكلة", "تشكيلة من المشاوي.", 25000, ASSETS + "grills/mixed-grill-platter.webp", 1),
    item(grills, "شيش طاووق", "قطع دجاج متبلة.", 12000, ASSETS + "grills/shish-tawook.webp", 2),
    item(burgers, "برغر اللحم الكلاسيكي", "لحم بقري مشوي.", 9000, ASSETS + "burgers/classic-burger.webp", 1),
    item(desserts, "براونيز", "براونيز بالشوكولاتة.", 5000, ASSETS + "desserts/brownie.webp", 1),
    item(otherCat, "Other dish", null, 1000, null, 1),
  ];
  return { users, restaurants, members, categories, items, systemAdmins: [{ user_id: ids.sysadmin, created_at: now }], ids };
}

function b64url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function createFakeSupabase(options = {}) {
  const db = seed();
  const columns = JSON.parse(JSON.stringify(COLUMNS));
  if (options.itemVisibility) {
    columns.menu_items.push("is_visible");
    db.items.forEach((row) => { row.is_visible = true; });
  }
  const sessions = new Map();       // access_token -> user id
  const refreshTokens = new Map();  // refresh_token -> user id
  const storage = new Map();        // path -> { bytes, contentType }
  const log = [];                   // { method, path, role, status }

  // ---------- helpers ----------

  const publicUser = (u) => ({
    id: u.id, aud: "authenticated", role: "authenticated", email: u.email,
    email_confirmed_at: u.created_at, phone: "", app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {}, identities: [], created_at: u.created_at, updated_at: new Date().toISOString(),
  });

  function issueSession(user) {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const accessToken = [b64url({ alg: "HS256", typ: "JWT" }),
      b64url({ sub: user.id, role: "authenticated", aud: "authenticated", email: user.email, exp, session_id: randomUUID() }),
      createHash("sha256").update(randomUUID()).digest("base64url")].join(".");
    const refreshToken = randomUUID();
    sessions.set(accessToken, user.id);
    refreshTokens.set(refreshToken, user.id);
    return { access_token: accessToken, token_type: "bearer", expires_in: 3600, expires_at: exp,
      refresh_token: refreshToken, user: publicUser(user) };
  }

  function caller(req) {
    const auth = req.headers.authorization || "";
    const token = auth.replace(/^Bearer\s+/i, "");
    if (!token || token === PUBLISHABLE_KEY) return { role: "anon", uid: null, token: null };
    const uid = sessions.get(token);
    return uid ? { role: "authenticated", uid, token } : { role: "invalid", uid: null, token };
  }

  const isMember = (uid, restaurantId) => Boolean(uid) && db.members.some((m) => m.user_id === uid && m.restaurant_id === restaurantId);
  const isPublished = (restaurantId) => db.restaurants.some((r) => r.id === restaurantId && r.is_published);

  function tableRows(table) {
    return { restaurants: db.restaurants, restaurant_members: db.members, categories: db.categories,
      menu_items: db.items, system_admins: db.systemAdmins }[table];
  }

  function canRead(table, row, uid) {
    switch (table) {
      case "restaurants": return row.is_published || isMember(uid, row.id);
      case "categories":
      case "menu_items": return isPublished(row.restaurant_id) || isMember(uid, row.restaurant_id);
      case "restaurant_members": return row.user_id === uid;
      default: return false;
    }
  }

  const canWrite = (table, row, uid) => (table === "categories" || table === "menu_items") && isMember(uid, row.restaurant_id);

  function parseQuery(url) {
    const filters = [];
    let select = "*";
    let order = [];
    let limit = null;
    for (const [key, value] of url.searchParams) {
      if (key === "select") select = value;
      else if (key === "order") order = value.split(",").map((part) => { const [col, dir] = part.split("."); return { col, desc: dir === "desc" }; });
      else if (key === "limit") limit = Number(value);
      else if (key === "columns") continue;
      else if (value.startsWith("eq.")) filters.push({ col: key, value: value.slice(3) });
      else if (value === "is.null") filters.push({ col: key, value: null });
    }
    return { filters, select, order, limit };
  }

  const matches = (row, filters) => filters.every((f) => (f.value === null ? row[f.col] == null : String(row[f.col]) === f.value));

  function project(table, rows, select) {
    if (select === "*" || !select) return { rows: rows.map((r) => pick(r, columns[table])) };
    const wanted = select.split(",").map((c) => c.trim()).filter(Boolean);
    const unknown = wanted.find((c) => !columns[table].includes(c));
    if (unknown) return { error: { status: 400, body: { code: "42703", details: null, hint: null, message: `column ${table}.${unknown} does not exist` } } };
    return { rows: rows.map((r) => pick(r, wanted)) };
  }

  function pick(row, cols) {
    const out = {};
    cols.forEach((c) => { out[c] = row[c] === undefined ? null : row[c]; });
    return out;
  }

  function checkBody(table, body) {
    const unknown = Object.keys(body).find((c) => !columns[table].includes(c));
    if (unknown) return { status: 400, body: { code: "PGRST204", details: null, hint: null, message: `Could not find the '${unknown}' column of '${table}' in the schema cache` } };
    return null;
  }

  function checkConstraints(table, row, ignoreId) {
    if (table === "categories") {
      if (!row.name || !row.slug) return { status: 400, body: { code: "23502", message: "null value violates not-null constraint" } };
      if (db.categories.some((c) => c.id !== ignoreId && c.restaurant_id === row.restaurant_id && c.slug === row.slug)) {
        return { status: 409, body: { code: "23505", message: "duplicate key value violates unique constraint" } };
      }
    }
    if (table === "menu_items") {
      if (!row.name) return { status: 400, body: { code: "23502", message: "null value violates not-null constraint" } };
      if (!Number.isInteger(row.price) || row.price < 0) return { status: 400, body: { code: "23514", message: "new row violates check constraint \"menu_items_price_check\"" } };
      if (!db.categories.some((c) => c.id === row.category_id && c.restaurant_id === row.restaurant_id)) {
        return { status: 409, body: { code: "23503", message: "insert or update on table \"menu_items\" violates foreign key constraint" } };
      }
    }
    return null;
  }

  function sortRows(rows, order) {
    return rows.slice().sort((a, b) => {
      for (const { col, desc } of order) {
        const x = a[col], y = b[col];
        if (x === y) continue;
        const cmp = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
        return desc ? -cmp : cmp;
      }
      return 0;
    });
  }

  // ---------- PostgREST ----------

  function rest(method, table, url, body, who, prefer) {
    const rows = tableRows(table);
    if (!rows) return { status: 404, body: { code: "42P01", message: `relation "public.${table}" does not exist` } };
    const q = parseQuery(url);
    const representation = /return=representation/.test(prefer || "");
    const respond = (status, list) => {
      if (!representation && method !== "GET") return { status: 204 };
      const projected = project(table, list, q.select);
      return projected.error || { status, body: projected.rows };
    };

    if (method === "GET") {
      let list = rows.filter((r) => matches(r, q.filters) && canRead(table, r, who.uid));
      const projected = project(table, list, q.select);
      if (projected.error) return projected.error;
      list = sortRows(list, q.order);
      if (q.limit !== null) list = list.slice(0, q.limit);
      return { status: 200, body: project(table, list, q.select).rows };
    }

    if (method === "POST") {
      const input = Array.isArray(body) ? body : [body];
      const created = [];
      for (const fields of input) {
        const bad = checkBody(table, fields);
        if (bad) return bad;
        const row = Object.assign(
          table === "categories" ? { id: randomUUID(), icon: null, sort_order: 0, is_visible: true }
            : { id: randomUUID(), description: null, image_path: null, is_available: true, sort_order: 0, price: 0,
              created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
          table === "menu_items" && columns.menu_items.includes("is_visible") ? { is_visible: true } : {},
          fields);
        if (!canWrite(table, row, who.uid)) {
          return { status: who.uid ? 403 : 401, body: { code: "42501", message: `new row violates row-level security policy for table "${table}"` } };
        }
        const broken = checkConstraints(table, row, null);
        if (broken) return broken;
        rows.push(row);
        created.push(row);
      }
      return respond(201, created);
    }

    if (method === "PATCH") {
      const bad = checkBody(table, body);
      if (bad) return bad;
      const targets = rows.filter((r) => matches(r, q.filters) && canRead(table, r, who.uid) && canWrite(table, r, who.uid));
      for (const row of targets) {
        const next = Object.assign({}, row, body);
        if (!canWrite(table, next, who.uid)) return { status: 403, body: { code: "42501", message: "new row violates row-level security policy" } };
        const broken = checkConstraints(table, next, row.id);
        if (broken) return broken;
      }
      targets.forEach((row) => {
        Object.assign(row, body);
        if (table === "menu_items") row.updated_at = new Date().toISOString();
      });
      return respond(200, targets);
    }

    if (method === "DELETE") {
      const targets = rows.filter((r) => matches(r, q.filters) && canRead(table, r, who.uid) && canWrite(table, r, who.uid));
      targets.forEach((row) => rows.splice(rows.indexOf(row), 1));
      // menu_items_restaurant_id_category_id_fkey is ON DELETE CASCADE.
      if (table === "categories") {
        const gone = new Set(targets.map((c) => c.id));
        for (let i = db.items.length - 1; i >= 0; i--) if (gone.has(db.items[i].category_id)) db.items.splice(i, 1);
      }
      return respond(200, targets);
    }
    return { status: 405, body: { message: "Method not allowed" } };
  }

  function rpc(name, args, who) {
    if (who.role === "anon") return { status: 401, body: { code: "42501", message: `permission denied for function ${name}` } };
    if (name === "is_system_admin") return { status: 200, body: db.systemAdmins.some((a) => a.user_id === who.uid) };
    if (name === "get_my_restaurants") {
      return { status: 200, body: db.restaurants.filter((r) => isMember(who.uid, r.id)).map((r) => pick(r, columns.restaurants)) };
    }
    if (name === "update_my_restaurant_profile") {
      const row = db.restaurants.find((r) => r.id === args.p_restaurant_id);
      if (!row || !isMember(who.uid, row.id)) return { status: 403, body: { code: "42501", message: "Not allowed to edit this restaurant" } };
      const clean = (v) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());
      const values = { name: clean(args.p_name), tagline: clean(args.p_tagline), phone: clean(args.p_phone), address: clean(args.p_address), hours: clean(args.p_hours) };
      const limits = { name: 120, tagline: 160, phone: 30, address: 200, hours: 120 };
      if (!values.name) return { status: 400, body: { code: "22023", message: "Invalid restaurant name", hint: "name" } };
      for (const key of Object.keys(limits)) {
        if (values[key] && values[key].length > limits[key]) return { status: 400, body: { code: "22023", message: "Invalid " + key, hint: key } };
      }
      if (values.phone && !/^[-+0-9 ()]{5,30}$/.test(values.phone)) return { status: 400, body: { code: "22023", message: "Invalid phone number", hint: "phone" } };
      Object.assign(row, values);
      return { status: 200, body: pick(row, columns.restaurants) };
    }
    if (name === "update_my_restaurant_socials" && options.socialsFunction !== false) {
      const row = db.restaurants.find((r) => r.id === args.p_restaurant_id);
      if (!row || !isMember(who.uid, row.id)) return { status: 403, body: { code: "42501", message: "Not allowed to edit this restaurant" } };
      const next = Object.assign({}, row.socials || {});
      for (const key of SOCIAL_PLATFORMS) {
        const raw = args["p_" + key];
        const text = raw === null || raw === undefined ? "" : String(raw).trim();
        // Same rule as the SQL function: the value must already be normalized.
        const { value, error } = normalizeSocial(key, text);
        if (error || (value && value !== text)) return { status: 400, body: { code: "22023", message: "Invalid " + key, hint: key } };
        if (value) next[key] = value;
        else delete next[key];
      }
      row.socials = next;
      return { status: 200, body: pick(row, columns.restaurants) };
    }
    return { status: 404, body: { code: "PGRST202", message: `Could not find the function public.${name}` } };
  }

  // ---------- GoTrue ----------

  function auth(method, path, url, body, req) {
    const authError = (status, code, msg) => ({ status, body: { code: status, error_code: code, msg } });
    if (method === "POST" && path === "token") {
      const grant = url.searchParams.get("grant_type");
      if (grant === "password") {
        const user = db.users.find((u) => u.email === String(body.email || "").toLowerCase());
        if (!user || user.password !== body.password) return authError(400, "invalid_credentials", "Invalid login credentials");
        return { status: 200, body: issueSession(user) };
      }
      if (grant === "refresh_token") {
        const uid = refreshTokens.get(body.refresh_token);
        if (!uid) return authError(400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
        refreshTokens.delete(body.refresh_token);
        return { status: 200, body: issueSession(db.users.find((u) => u.id === uid)) };
      }
      return authError(400, "validation_failed", "Unsupported grant type");
    }
    const who = caller(req);
    const user = who.uid && db.users.find((u) => u.id === who.uid);
    if (path === "user" && method === "GET") {
      return user ? { status: 200, body: publicUser(user) } : authError(403, "session_not_found", "Session not found");
    }
    if (path === "user" && method === "PUT") {
      if (!user) return authError(401, "no_authorization", "This endpoint requires a valid Bearer token");
      if (body.password !== undefined) {
        if (String(body.password).length < 6) return authError(422, "weak_password", "Password should be at least 6 characters.");
        if (body.password === user.password) return authError(422, "same_password", "New password should be different from the old password.");
        user.password = body.password;
      }
      return { status: 200, body: publicUser(user) };
    }
    if (path === "logout" && method === "POST") {
      if (who.token) sessions.delete(who.token);
      return { status: 204 };
    }
    return authError(404, "not_found", "Not found");
  }

  // ---------- Storage ----------

  function parseMultipart(req, raw) {
    const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(req.headers["content-type"] || "");
    if (!match) return { bytes: raw, contentType: req.headers["content-type"] || "application/octet-stream" };
    const boundary = Buffer.from("--" + (match[1] || match[2]));
    let file = null;
    let start = raw.indexOf(boundary);
    while (start !== -1) {
      const next = raw.indexOf(boundary, start + boundary.length);
      if (next === -1) break;
      const part = raw.subarray(start + boundary.length + 2, next - 2);
      const split = part.indexOf("\r\n\r\n");
      if (split !== -1) {
        const headers = part.subarray(0, split).toString("utf8");
        const content = part.subarray(split + 4);
        if (/name=""/.test(headers) || /filename=/.test(headers)) {
          const type = /content-type:\s*([^\r\n]+)/i.exec(headers);
          file = { bytes: Buffer.from(content), contentType: type ? type[1].trim() : "application/octet-stream" };
        }
      }
      start = next;
    }
    return file || { bytes: Buffer.alloc(0), contentType: "application/octet-stream" };
  }

  function storageRequest(method, path, body, raw, req) {
    const who = caller(req);
    const denied = { status: 403, body: { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" } };
    const allowed = (objectPath) => isMember(who.uid, objectPath.split("/")[0]);

    if (method === "GET" && path.startsWith("object/public/" + BUCKET + "/")) {
      const object = storage.get(decodeURIComponent(path.slice(("object/public/" + BUCKET + "/").length)));
      return object ? { status: 200, raw: object.bytes.length ? object.bytes : PNG_1PX, contentType: object.contentType }
        : { status: 404, body: { statusCode: "404", error: "not_found", message: "Object not found" } };
    }
    if (method === "POST" && path.startsWith("object/" + BUCKET + "/")) {
      const objectPath = decodeURIComponent(path.slice(("object/" + BUCKET + "/").length));
      if (!allowed(objectPath)) return denied;
      if (storage.has(objectPath)) return { status: 409, body: { statusCode: "409", error: "Duplicate", message: "The resource already exists" } };
      storage.set(objectPath, parseMultipart(req, raw));
      return { status: 200, body: { Id: randomUUID(), Key: BUCKET + "/" + objectPath } };
    }
    if (method === "DELETE" && path === "object/" + BUCKET) {
      const removed = [];
      for (const prefix of (body && body.prefixes) || []) {
        if (allowed(prefix) && storage.delete(prefix)) removed.push({ name: prefix, bucket_id: BUCKET });
      }
      return { status: 200, body: removed };
    }
    return { status: 404, body: { statusCode: "404", error: "not_found", message: "Not found" } };
  }

  // ---------- HTTP entry ----------

  // `path` is the part after the fake's base URL, e.g. "/rest/v1/categories".
  async function handle(req, res, path) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const url = new URL(path, "http://fake.local");
    let body = null;
    if (raw.length && /json/.test(req.headers["content-type"] || "")) {
      try { body = JSON.parse(raw.toString("utf8")); } catch { body = null; }
    }
    const who = caller(req);
    let result;
    if (req.method === "OPTIONS") result = { status: 204 };
    else if (who.role === "invalid" && url.pathname.startsWith("/rest/")) result = { status: 401, body: { code: "PGRST301", message: "JWT expired" } };
    else if (url.pathname.startsWith("/rest/v1/rpc/")) result = rpc(url.pathname.slice("/rest/v1/rpc/".length), body || {}, who);
    else if (url.pathname.startsWith("/rest/v1/")) result = rest(req.method, url.pathname.slice("/rest/v1/".length), url, body || {}, who, req.headers.prefer);
    else if (url.pathname.startsWith("/auth/v1/")) result = auth(req.method, url.pathname.slice("/auth/v1/".length), url, body || {}, req);
    else if (url.pathname.startsWith("/storage/v1/")) result = storageRequest(req.method, url.pathname.slice("/storage/v1/".length), body, raw, req);
    else result = { status: 404, body: { message: "Not found" } };

    log.push({ method: req.method, path: url.pathname + url.search, role: who.role, status: result.status });
    const headers = { "cache-control": "no-store" };
    if (result.raw) {
      res.writeHead(result.status, Object.assign(headers, { "content-type": result.contentType }));
      res.end(result.raw);
    } else if (result.status === 204 || result.body === undefined) {
      res.writeHead(result.status, headers);
      res.end();
    } else {
      res.writeHead(result.status, Object.assign(headers, { "content-type": "application/json; charset=utf-8" }));
      res.end(JSON.stringify(result.body));
    }
  }

  return { handle, db, storage, log, sessions, ids: db.ids, columns };
}
