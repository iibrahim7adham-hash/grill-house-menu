// What the current browser session may do for ONE restaurant, for showing
// or hiding management controls on public pages.
//
// This only decides what to *show*. Every real read and write is still
// checked by Row Level Security and the database functions, so a control
// shown by mistake still could not change anything.
//
// The answer comes from the database, never from data stored in the browser:
//   * the session is verified with the Auth server (getVerifiedUser);
//   * membership comes from public.get_my_restaurants() (caller's own uid);
//   * admin status comes from public.is_system_admin().
// Any error means "no access" (fail closed).

import { getVerifiedUser, hasStoredSession } from "./session.js";
import { getMyRestaurants, isSystemAdmin } from "./authorization.js";

// Resolves to { role: "owner" | "admin" | null, user, restaurant }.
//   "owner": member of the restaurant with this slug
//   "admin": system admin who is not a member of it
export async function getRestaurantAccess(supabase, slug) {
  // No stored session -> anonymous visitor: no network request at all.
  if (!(await hasStoredSession(supabase))) return { role: null, user: null, restaurant: null };

  const user = await getVerifiedUser(supabase);
  if (!user) return { role: null, user: null, restaurant: null };

  const { restaurants, error } = await getMyRestaurants(supabase);
  if (!error) {
    const restaurant = restaurants.find((r) => r.slug === slug);
    if (restaurant) return { role: "owner", user, restaurant };
  }

  try {
    if (await isSystemAdmin(supabase)) return { role: "admin", user, restaurant: null };
  } catch {
    // fall through: no access
  }
  return { role: null, user, restaurant: null };
}
