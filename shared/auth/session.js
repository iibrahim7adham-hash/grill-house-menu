// Shared authentication helpers (Supabase Auth, email/password).
//
// Used by the Grill House inline editor (restaurants/grill-house/admin/). These
// helpers only identify the user; what they may do is decided by
// authorization.js and, ultimately, by Row Level Security in the database.

// Verifies the session with the Supabase Auth server and returns the user, or
// null when there is no valid session. getUser() validates the token
// server-side; getSession() alone only reads what is stored in the browser.
export async function getVerifiedUser(supabase) {
  const { data, error } = await supabase.auth.getUser();
  const user = data && data.user;
  return error || !user ? null : user;
}

// Returns true when the browser holds a stored session (not yet verified).
export async function hasStoredSession(supabase) {
  const { data } = await supabase.auth.getSession();
  return Boolean(data.session);
}

// Maps a Supabase sign-in error to a stable reason code the UI can translate.
export function signInErrorReason(error) {
  if (error.code === "invalid_credentials") return "invalidCredentials";
  if (error.code === "email_not_confirmed") return "emailNotConfirmed";
  if (error.status === 429) return "rateLimited";
  if (error.name === "AuthRetryableFetchError" || error.status === 0) return "network";
  return "generic";
}

// Email/password sign-in. Resolves to { user, error }.
export async function signIn(supabase, email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { user: (data && data.user) || null, error: error || null };
}

// Signs out this browser. Never throws: a failed request still clears the
// local session.
export async function signOut(supabase) {
  try {
    await supabase.auth.signOut();
  } catch (error) {
    console.warn("Sign-out failed", error);
  }
}

// Changes the signed-in user's own password. Resolves to { error }.
export async function changePassword(supabase, password) {
  const { error } = await supabase.auth.updateUser({ password });
  return { error: error || null };
}
