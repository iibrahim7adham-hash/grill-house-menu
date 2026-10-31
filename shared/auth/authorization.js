// Shared authorization checks.
//
// These only decide what the browser *shows*. Real protection always comes
// from Row Level Security and SECURITY DEFINER functions in the database,
// because anything in the browser can be bypassed.

// public.is_system_admin() checks the caller's own auth.uid() in the
// database, so system_admins never has to be readable from the browser.
export async function isSystemAdmin(supabase) {
  const { data, error } = await supabase.rpc("is_system_admin");
  if (error) throw error;
  return data === true;
}

// Restaurants the signed-in user is a member of (owner dashboard).
// public.get_my_restaurants() filters by the caller's own auth.uid() in the
// database, so it can never return another owner's restaurant.
// Returns { restaurants, error }.
export async function getMyRestaurants(supabase) {
  const { data, error } = await supabase.rpc("get_my_restaurants");
  return { restaurants: data || [], error: error || null };
}
