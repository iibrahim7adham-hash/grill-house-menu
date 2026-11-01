// Location and social links of a restaurant (restaurants.socials, jsonb):
//   { maps, instagram, tiktok, facebook: "https://..." , whatsapp: "+9647501234567" }
//
// Used by the dashboard (to validate before saving) and by the public menu
// (to build links). The database function update_my_restaurant_socials()
// repeats the same rules, because the browser can be bypassed.

export const SOCIAL_PLATFORMS = ["maps", "instagram", "facebook", "tiktok", "whatsapp"];

// Accepted hosts per platform; links always use https.
const HOSTS = {
  instagram: ["instagram.com", "www.instagram.com"],
  tiktok: ["tiktok.com", "www.tiktok.com", "vm.tiktok.com"],
  facebook: ["facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com", "fb.com", "www.fb.com"],
};
const PATH_RE = /^\/[A-Za-z0-9._~@%/+-]+$/;   // a profile path, no query or fragment
const PHONE_RE = /^\+[1-9][0-9]{7,14}$/;      // E.164: + country code and number
export const SOCIAL_URL_MAX = 200;

// Google Maps links: a place / share link, optionally with a query
// (?q=..., coordinates). Non-ASCII text arrives percent-encoded.
//   https://www.google.com/maps/place/...   https://maps.google.com/?q=...
//   https://maps.app.goo.gl/<id>           https://goo.gl/maps/<id>
export const MAPS_URL_MAX = 500;
const MAPS_PATH_RE = /^[A-Za-z0-9._~@%/+,!:=*()-]*$/;
const MAPS_QUERY_RE = /^(\?[A-Za-z0-9._~@%/+,!:=&*()-]*)?$/;
const MAPS_HOSTS = {
  "google.com": /^\/maps(\/|$)/,
  "www.google.com": /^\/maps(\/|$)/,
  "maps.google.com": /^/,
  "maps.app.goo.gl": /^\/./,
  "goo.gl": /^\/maps\/./,
};

function normalizeMaps(text) {
  if (text.length > MAPS_URL_MAX) return { error: "invalid" };
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : "https://" + text);
  } catch {
    return { error: "invalid" };
  }
  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, "");
  const query = url.search === "?" ? "" : url.search;
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port
    || !MAPS_HOSTS[host] || !MAPS_HOSTS[host].test(path) || !MAPS_PATH_RE.test(path) || !MAPS_QUERY_RE.test(query)
    || (!path && !query)) {
    return { error: "invalid" };
  }
  const value = "https://" + host + path + query;
  return value.length > MAPS_URL_MAX ? { error: "invalid" } : { value };
}

// Normalizes what an admin typed. Resolves to { value } (null when empty) or
// { error: "invalid" }.
//   URLs:   "instagram.com/name" -> "https://instagram.com/name"
//   Phone:  "00964 750 123-4567" -> "+9647501234567"
export function normalizeSocial(platform, raw) {
  const text = String(raw || "").trim();
  if (!text) return { value: null };
  if (platform === "whatsapp") {
    const phone = text.replace(/[\s().-]/g, "").replace(/^00/, "+");
    return PHONE_RE.test(phone) ? { value: phone } : { error: "invalid" };
  }
  if (platform === "maps") return normalizeMaps(text);
  if (!HOSTS[platform] || text.length > SOCIAL_URL_MAX) return { error: "invalid" };
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : "https://" + text);
  } catch {
    return { error: "invalid" };
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port
    || !HOSTS[platform].includes(url.hostname.toLowerCase()) || !path || !PATH_RE.test(path)) {
    return { error: "invalid" };
  }
  return { value: "https://" + url.hostname.toLowerCase() + path };
}

// Safe link for a stored value, or "" when it is missing or not valid
// (stored data is checked again before it becomes a link).
export function socialHref(platform, stored) {
  const { value } = normalizeSocial(platform, stored);
  if (!value) return "";
  return platform === "whatsapp" ? "https://wa.me/" + value.slice(1) : value;
}
