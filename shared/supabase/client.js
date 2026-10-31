// Shared Supabase client for every restaurant frontend and the admin dashboard.
// Import it with an absolute path: import { supabase } from "/shared/supabase/client.js";
// Uses only the publishable (public) key: access control is enforced by
// Row Level Security in the database. Never put a secret or service-role
// key in any file that is sent to the browser.
//
// Imported from a pinned CDN build so no package install is required.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../config.js";

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || SUPABASE_PUBLISHABLE_KEY === "PASTE_YOUR_PUBLISHABLE_KEY_HERE") {
  throw new Error("Supabase is not configured: set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in shared/config.js.");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
