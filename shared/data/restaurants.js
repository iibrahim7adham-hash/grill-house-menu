// Restaurant profile data access for the owner dashboard.
//
// Owners have no direct UPDATE access to public.restaurants (Row Level
// Security allows that to system admins only). Their single write path is
// public.update_my_restaurant_profile(), which checks the caller's
// membership in the database and changes only name, tagline, phone, address
// and hours. Id, slug, publication status and memberships cannot be changed
// through it, whatever the browser sends.
//
// Returns { data, error } like supabase-js; `data` is the updated row.

// Field limits, shared by the form and mirrored by the database function.
export const PROFILE_LIMITS = { name: 120, tagline: 160, phone: 30, address: 200, hours: 120 };
export const PROFILE_PHONE_PATTERN = /^[-+0-9 ()]{5,30}$/;

export async function updateRestaurantProfile(supabase, restaurantId, fields) {
  const { data, error } = await supabase.rpc("update_my_restaurant_profile", {
    p_restaurant_id: restaurantId,
    p_name: fields.name,
    p_tagline: fields.tagline,
    p_phone: fields.phone,
    p_address: fields.address,
    p_hours: fields.hours,
  });
  if (error) return { data: null, error };
  // Defence in depth: only accept the row that was asked for.
  if (!data || data.id !== restaurantId) {
    return { data: null, error: { code: "denied", message: "No matching row, or not allowed." } };
  }
  return { data, error: null };
}

// Social links: public.update_my_restaurant_socials() (migration
// 20261031180000_owner_update_restaurant_socials.sql) checks membership and
// changes only the instagram / tiktok / facebook / whatsapp keys of
// restaurants.socials. `socials` values are normalized first with
// shared/utils/socials.js; null removes a link.
export async function updateRestaurantSocials(supabase, restaurantId, socials) {
  const { data, error } = await supabase.rpc("update_my_restaurant_socials", {
    p_restaurant_id: restaurantId,
    p_instagram: socials.instagram,
    p_tiktok: socials.tiktok,
    p_facebook: socials.facebook,
    p_whatsapp: socials.whatsapp,
  });
  if (error) return { data: null, error };
  if (!data || data.id !== restaurantId) {
    return { data: null, error: { code: "denied", message: "No matching row, or not allowed." } };
  }
  return { data, error: null };
}
