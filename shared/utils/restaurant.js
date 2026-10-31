// Shared helpers for restaurant slugs and public URLs.
//
// A restaurant's slug is the same everywhere: the restaurants.slug column,
// its folder restaurants/<slug>/ and its public URL /r/<slug> (see vercel.json).

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Absolute public menu URL for a restaurant, e.g. https://host/r/grill-house
export function publicMenuUrl(slug) {
  return new URL("/r/" + encodeURIComponent(slug), window.location.origin).href;
}
