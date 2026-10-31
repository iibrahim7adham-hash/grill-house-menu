// Request handling for the admin-create-owner Edge Function.
//
// Plain JavaScript with no Deno-specific APIs, so the same code runs on the
// Edge runtime (index.ts) and under Node for tests. Supabase clients are
// passed in through `deps`:
//   deps.createUserClient(authorization) -> client acting as the caller
//   deps.createAdminClient()             -> service-role client (server only)
//   deps.allowedOrigins                  -> CORS allow-list; empty = any origin
//
// Rules enforced here, on the server:
//   * the caller must be a signed-in system admin (checked in the database);
//   * input is validated (restaurant id, email, optional password);
//   * a restaurant has at most one owner, and a user is never added twice;
//   * an existing account is linked only when the admin explicitly asked to
//     (link_existing: true), its password is never changed, and system
//     admin accounts are never linked as owners;
//   * a newly created account is deleted again if the membership insert fails.

export const OWNER_ROLE = "owner";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 10;
const PASSWORD_MAX = 72; // bcrypt limit used by Supabase Auth
const LIST_PAGE_SIZE = 200;
const LIST_MAX_PAGES = 50;

// No look-alike characters (0/O, 1/l/I), so it can be read out or typed.
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

// Cryptographically random password with no modulo bias.
export function generatePassword(length = 16) {
  const n = PASSWORD_ALPHABET.length;
  const limit = 256 - (256 % n);
  let out = "";
  const buf = new Uint8Array(length * 2);
  while (out.length < length) {
    crypto.getRandomValues(buf);
    for (const byte of buf) {
      if (byte < limit && out.length < length) out += PASSWORD_ALPHABET[byte % n];
    }
  }
  return out;
}

// Returns { value } or { error: { status, code, message } }.
export function validateInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail(400, "invalid_body", "Request body must be a JSON object.");
  }

  const restaurantId = typeof body.restaurant_id === "string" ? body.restaurant_id.trim() : "";
  if (!UUID_RE.test(restaurantId)) {
    return fail(400, "invalid_restaurant_id", "restaurant_id must be a UUID.");
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    return fail(400, "invalid_email", "A valid email address is required.");
  }

  let password = null;
  if (body.password !== undefined && body.password !== null && body.password !== "") {
    if (typeof body.password !== "string"
        || body.password.length < PASSWORD_MIN
        || body.password.length > PASSWORD_MAX
        || /^\s|\s$/.test(body.password)) {
      return fail(400, "invalid_password",
        `Password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters without leading or trailing spaces.`);
    }
    password = body.password;
  }

  if (body.link_existing !== undefined && typeof body.link_existing !== "boolean") {
    return fail(400, "invalid_body", "link_existing must be true or false.");
  }

  return { value: { restaurantId, email, password, linkExisting: body.link_existing === true } };
}

function fail(status, code, message) {
  return { error: { status, code, message } };
}

function corsHeaders(req, allowedOrigins) {
  const headers = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  const origin = req.headers.get("Origin");
  if (!allowedOrigins || allowedOrigins.length === 0) {
    headers["Access-Control-Allow-Origin"] = "*";
  } else if (origin && allowedOrigins.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function json(status, payload, cors) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, cors),
  });
}

function errorResponse(err, cors) {
  return json(err.status, { ok: false, code: err.code, message: err.message }, cors);
}

// A unique violation (23505) on the membership insert means either this user
// is already a member, or another owner was added at the same moment (the
// one-owner-per-restaurant index). Tell the two apart.
async function duplicateMembershipResponse(admin, restaurantId, userId, cors) {
  const { data } = await admin
    .from("restaurant_members").select("user_id")
    .eq("restaurant_id", restaurantId).eq("role", OWNER_ROLE).limit(1);
  if (data && data.length && data[0].user_id !== userId) {
    return errorResponse({ status: 409, code: "restaurant_has_owner",
      message: "This restaurant already has an owner." }, cors);
  }
  return errorResponse({ status: 409, code: "already_member",
    message: "This account is already linked to this restaurant." }, cors);
}

// Supabase Auth has no lookup by email in the JS admin API, so page through
// the users list. Fine for the expected number of accounts.
async function findUserByEmail(admin, email) {
  for (let page = 1; page <= LIST_MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: LIST_PAGE_SIZE });
    if (error) throw error;
    const users = (data && data.users) || [];
    const match = users.find((u) => (u.email || "").toLowerCase() === email);
    if (match) return match;
    if (users.length < LIST_PAGE_SIZE) return null;
  }
  throw new Error("User list too long to search");
}

export async function handleRequest(req, deps) {
  const cors = corsHeaders(req, deps.allowedOrigins);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") {
    return errorResponse({ status: 405, code: "method_not_allowed", message: "Use POST." }, cors);
  }

  try {
    // 1. Authenticate the caller with their own token.
    const authorization = req.headers.get("Authorization") || "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (!token) {
      return errorResponse({ status: 401, code: "unauthorized", message: "Sign in first." }, cors);
    }
    const caller = deps.createUserClient(authorization);
    const { data: userData, error: userError } = await caller.auth.getUser(token);
    if (userError || !userData || !userData.user) {
      return errorResponse({ status: 401, code: "unauthorized", message: "Session is not valid." }, cors);
    }

    // 2. Authorize: the database decides who is a system admin, using the
    //    caller's own identity (never the service role).
    const { data: isAdmin, error: adminError } = await caller.rpc("is_system_admin");
    if (adminError) throw adminError;
    if (isAdmin !== true) {
      return errorResponse({ status: 403, code: "forbidden", message: "System administrators only." }, cors);
    }

    // 3. Validate input.
    let body;
    try {
      body = await req.json();
    } catch {
      return errorResponse({ status: 400, code: "invalid_json", message: "Body must be valid JSON." }, cors);
    }
    const input = validateInput(body);
    if (input.error) return errorResponse(input.error, cors);
    const { restaurantId, email, password, linkExisting } = input.value;

    const admin = deps.createAdminClient();

    // 4. The restaurant must exist.
    const { data: restaurant, error: restaurantError } = await admin
      .from("restaurants").select("id, name, slug").eq("id", restaurantId).maybeSingle();
    if (restaurantError) throw restaurantError;
    if (!restaurant) {
      return errorResponse({ status: 404, code: "restaurant_not_found", message: "Restaurant not found." }, cors);
    }

    // 5. One owner per restaurant.
    const { data: owners, error: ownersError } = await admin
      .from("restaurant_members").select("user_id")
      .eq("restaurant_id", restaurantId).eq("role", OWNER_ROLE).limit(1);
    if (ownersError) throw ownersError;
    if (owners && owners.length) {
      return errorResponse({ status: 409, code: "restaurant_has_owner",
        message: "This restaurant already has an owner." }, cors);
    }

    // 6. Existing account: link only on explicit request, never change it.
    const existing = await findUserByEmail(admin, email);
    if (existing) {
      if (!linkExisting) {
        return errorResponse({ status: 409, code: "user_exists",
          message: "An account with this email already exists. Confirm to link it to this restaurant." }, cors);
      }

      const { data: adminRow, error: adminRowError } = await admin
        .from("system_admins").select("user_id").eq("user_id", existing.id).limit(1);
      if (adminRowError) throw adminRowError;
      if (adminRow && adminRow.length) {
        return errorResponse({ status: 409, code: "cannot_link_admin",
          message: "System administrator accounts cannot be restaurant owners." }, cors);
      }

      const { data: membership, error: membershipError } = await admin
        .from("restaurant_members").select("user_id")
        .eq("restaurant_id", restaurantId).eq("user_id", existing.id).limit(1);
      if (membershipError) throw membershipError;
      if (membership && membership.length) {
        return errorResponse({ status: 409, code: "already_member",
          message: "This account is already linked to this restaurant." }, cors);
      }

      const { error: linkError } = await admin
        .from("restaurant_members")
        .insert({ restaurant_id: restaurantId, user_id: existing.id, role: OWNER_ROLE });
      if (linkError) {
        if (linkError.code === "23505") {
          return duplicateMembershipResponse(admin, restaurantId, existing.id, cors);
        }
        throw linkError;
      }

      return json(200, { ok: true, status: "linked", user_id: existing.id, email,
        temporary_password: null }, cors);
    }

    // 7. New account, confirmed so the owner can sign in straight away
    //    (public sign-up stays disabled; only this function creates owners).
    const generated = password === null;
    const finalPassword = generated ? generatePassword() : password;
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: finalPassword,
      email_confirm: true,
    });
    if (createError) {
      if (createError.code === "email_exists" || createError.status === 422) {
        return errorResponse({ status: 409, code: "user_exists",
          message: "An account with this email already exists. Confirm to link it to this restaurant." }, cors);
      }
      if (createError.code === "weak_password") {
        return errorResponse({ status: 400, code: "invalid_password", message: createError.message }, cors);
      }
      throw createError;
    }
    const newUser = created && created.user;
    if (!newUser) throw new Error("createUser returned no user");

    const { error: insertError } = await admin
      .from("restaurant_members")
      .insert({ restaurant_id: restaurantId, user_id: newUser.id, role: OWNER_ROLE });
    if (insertError) {
      // Do not leave an account without a restaurant behind.
      await admin.auth.admin.deleteUser(newUser.id);
      if (insertError.code === "23505") {
        return duplicateMembershipResponse(admin, restaurantId, newUser.id, cors);
      }
      throw insertError;
    }

    return json(201, {
      ok: true,
      status: "created",
      user_id: newUser.id,
      email,
      // Returned once, only when the server generated it.
      temporary_password: generated ? finalPassword : null,
    }, cors);
  } catch (error) {
    console.error("admin-create-owner failed:", error && (error.message || error));
    return errorResponse({ status: 500, code: "internal_error", message: "Could not complete the request." }, cors);
  }
}
