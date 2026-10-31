// Supabase Edge Function: create (or, on explicit request, link) a restaurant
// owner account. Only signed-in system admins may call it; see handler.js for
// every rule it enforces.
//
// The service-role key exists only here, on the server, read from the
// environment Supabase provides to Edge Functions. It is never sent to or
// stored in the browser.
//
// Optional secret ALLOWED_ORIGINS: comma-separated origins allowed by CORS,
// e.g. "https://your-domain.com,http://localhost:8000". Unset = any origin
// (requests still need a valid admin token).

import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { handleRequest } from "./handler.js";

function env(...names: string[]): string {
  for (const name of names) {
    const value = Deno.env.get(name);
    if (value) return value;
  }
  throw new Error(`Missing environment variable: ${names.join(" or ")}`);
}

const SUPABASE_URL = env("SUPABASE_URL");
const PUBLIC_KEY = env("SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY");

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const noSession = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

Deno.serve((req: Request) =>
  handleRequest(req, {
    allowedOrigins,
    // Acts as the caller: used only to verify the token and ask the database
    // whether the caller is a system admin.
    createUserClient: (authorization: string) =>
      createClient(SUPABASE_URL, PUBLIC_KEY, {
        auth: noSession,
        global: { headers: { Authorization: authorization } },
      }),
    // Service role: bypasses RLS. Used only after the admin check passed.
    createAdminClient: () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: noSession }),
  })
);
