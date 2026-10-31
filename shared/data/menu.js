// Menu data access for the Grill House inline editor: categories, menu items and their images.
//
// Every query is scoped to one restaurant_id. That scoping keeps the UI
// correct, but it is NOT the security boundary: Row Level Security in the
// database decides what a user may read or change. An update or delete that
// RLS refuses simply matches no rows, so those calls ask for the affected
// rows back and report "denied" when none came back.
//
// Every function returns { data, error } like supabase-js; `error` may carry
// code "denied" (no row matched / not allowed) or "invalid_image".

export const IMAGE_BUCKET = "restaurant-images";
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const CATEGORY_COLUMNS = "id, restaurant_id, slug, name, icon, sort_order, is_visible";

// Icons a category may use. Restaurant designs map these names to their own
// artwork (Grill House: its SVG sprite); unknown values fall back to "list".
export const CATEGORY_ICONS = ["bowl", "skewer", "burger", "pizza", "cup", "cake", "flame", "list"];

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// A URL-safe slug for a new category, unique within `existingSlugs`.
// Latin letters and digits are kept; names without any (e.g. Arabic) become
// "category". The slug is used for in-page anchors, so it is set once and
// not changed when the category is renamed.
export function categorySlug(name, existingSlugs) {
  const taken = new Set(existingSlugs || []);
  const base = String(name || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "") || "category";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    if (!taken.has(base + "-" + n)) return base + "-" + n;
  }
}

export function isValidSlug(slug) {
  return SLUG_RE.test(slug);
}
const ITEM_COLUMNS =
  "id, restaurant_id, category_id, name, description, price, image_path, is_available, sort_order";

const DENIED = { code: "denied", message: "No matching row, or not allowed." };

function oneRow(result) {
  if (result.error) return { data: null, error: result.error };
  const rows = result.data || [];
  return rows.length ? { data: rows[0], error: null } : { data: null, error: DENIED };
}

// ---------- Categories ----------

export async function listCategories(supabase, restaurantId) {
  return supabase
    .from("categories")
    .select(CATEGORY_COLUMNS)
    .eq("restaurant_id", restaurantId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
}

// fields: { name, slug, icon, sort_order, is_visible }
export async function createCategory(supabase, restaurantId, fields) {
  return oneRow(await supabase
    .from("categories")
    .insert({
      restaurant_id: restaurantId,
      slug: fields.slug,
      name: fields.name,
      icon: fields.icon,
      sort_order: fields.sort_order,
      is_visible: fields.is_visible,
    })
    .select(CATEGORY_COLUMNS));
}

// The slug is deliberately not updatable here (stable public anchors).
export async function updateCategory(supabase, restaurantId, id, fields) {
  return oneRow(await supabase
    .from("categories")
    .update({ name: fields.name, icon: fields.icon, sort_order: fields.sort_order, is_visible: fields.is_visible })
    .eq("id", id)
    .eq("restaurant_id", restaurantId)
    .select(CATEGORY_COLUMNS));
}

// Deletes the category AND all of its menu items. The database does this in
// one statement: menu_items_restaurant_id_category_id_fkey is ON DELETE
// CASCADE, so the category and its items go together or not at all.
// The items' image paths are read first so the caller can remove uploaded
// files afterwards (removeItemImage); data: { id, imagePaths }.
export async function deleteCategory(supabase, restaurantId, id) {
  const items = await supabase
    .from("menu_items")
    .select("image_path")
    .eq("restaurant_id", restaurantId)
    .eq("category_id", id);
  if (items.error) return { data: null, error: items.error };

  const result = oneRow(await supabase
    .from("categories")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", restaurantId)
    .select("id"));
  if (result.error) return result;
  const imagePaths = (items.data || []).map((row) => row.image_path).filter(Boolean);
  return { data: { id: result.data.id, imagePaths }, error: null };
}

// ---------- Menu items ----------

// options.withVisibility: also read is_visible (see supportsItemVisibility).
export async function listMenuItems(supabase, restaurantId, options) {
  const columns = options && options.withVisibility ? ITEM_COLUMNS + ", is_visible" : ITEM_COLUMNS;
  return supabase
    .from("menu_items")
    .select(columns)
    .eq("restaurant_id", restaurantId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
}

function itemFields(fields) {
  const out = {
    category_id: fields.category_id,
    name: fields.name,
    description: fields.description,
    price: fields.price,
    is_available: fields.is_available,
    sort_order: fields.sort_order,
    image_path: fields.image_path,
  };
  // Only sent when given, so it also works before the column exists.
  if (fields.is_visible !== undefined) out.is_visible = fields.is_visible;
  return out;
}

export async function createMenuItem(supabase, restaurantId, fields) {
  return oneRow(await supabase
    .from("menu_items")
    .insert(Object.assign({ restaurant_id: restaurantId }, itemFields(fields)))
    .select(ITEM_COLUMNS));
}

export async function updateMenuItem(supabase, restaurantId, id, fields) {
  return oneRow(await supabase
    .from("menu_items")
    .update(itemFields(fields))
    .eq("id", id)
    .eq("restaurant_id", restaurantId)
    .select(ITEM_COLUMNS));
}

// Availability only, for the quick toggle.
export async function setMenuItemAvailability(supabase, restaurantId, id, isAvailable) {
  return oneRow(await supabase
    .from("menu_items")
    .update({ is_available: isAvailable })
    .eq("id", id)
    .eq("restaurant_id", restaurantId)
    .select(ITEM_COLUMNS));
}

export async function deleteMenuItem(supabase, restaurantId, id) {
  return oneRow(await supabase
    .from("menu_items")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", restaurantId)
    .select("id, image_path"));
}

// ---------- Ordering and visibility (inline editor) ----------

export async function setCategoryOrder(supabase, restaurantId, id, sortOrder) {
  return oneRow(await supabase
    .from("categories")
    .update({ sort_order: sortOrder })
    .eq("id", id)
    .eq("restaurant_id", restaurantId)
    .select(CATEGORY_COLUMNS));
}

export async function setCategoryVisibility(supabase, restaurantId, id, isVisible) {
  return oneRow(await supabase
    .from("categories")
    .update({ is_visible: isVisible })
    .eq("id", id)
    .eq("restaurant_id", restaurantId)
    .select(CATEGORY_COLUMNS));
}

export async function setMenuItemOrder(supabase, restaurantId, id, sortOrder) {
  return oneRow(await supabase
    .from("menu_items")
    .update({ sort_order: sortOrder })
    .eq("id", id)
    .eq("restaurant_id", restaurantId)
    .select(ITEM_COLUMNS));
}

// Per-item visibility needs the menu_items.is_visible column
// (supabase/migrations/20261031170000_menu_item_visibility.sql). Until that
// migration is applied, supportsItemVisibility() resolves to false and the
// editor leaves the control disabled.
export async function supportsItemVisibility(supabase) {
  try {
    const { error } = await supabase.from("menu_items").select("is_visible").limit(1);
    return !error;
  } catch {
    return false;
  }
}

export async function setMenuItemVisibility(supabase, restaurantId, id, isVisible) {
  return oneRow(await supabase
    .from("menu_items")
    .update({ is_visible: isVisible })
    .eq("id", id)
    .eq("restaurant_id", restaurantId)
    .select("id, is_visible"));
}

// ---------- Images (Storage) ----------
//
// Files live under the restaurant's own folder: <restaurant_id>/items/<uuid>.<ext>.
// The bucket's Storage policies decide who may write there; this code only
// picks the path.

export function restaurantImageFolder(restaurantId) {
  return restaurantId + "/";
}

// Returns an error object for a file that must not be uploaded, else null.
export function checkImageFile(file) {
  if (!file) return { code: "invalid_image", reason: "missing" };
  if (!Object.prototype.hasOwnProperty.call(IMAGE_TYPES, file.type)) {
    return { code: "invalid_image", reason: "type" };
  }
  if (file.size > MAX_IMAGE_BYTES) return { code: "invalid_image", reason: "size" };
  return null;
}

export async function uploadItemImage(supabase, restaurantId, file) {
  const invalid = checkImageFile(file);
  if (invalid) return { data: null, error: invalid };

  const path = restaurantImageFolder(restaurantId) + "items/" + crypto.randomUUID() + "." + IMAGE_TYPES[file.type];
  const { error } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(path, file, { contentType: file.type, cacheControl: "3600", upsert: false });
  return error ? { data: null, error } : { data: { path }, error: null };
}

// Best effort: a leftover file is harmless, so failures are only logged.
// Refuses paths outside the restaurant's folder.
export async function removeItemImage(supabase, restaurantId, path) {
  if (!path || !path.startsWith(restaurantImageFolder(restaurantId))) return;
  const { error } = await supabase.storage.from(IMAGE_BUCKET).remove([path]);
  if (error) console.warn("Could not remove image", path, error);
}

// URL for a menu item's image_path. Two kinds of path exist:
//   "/restaurants/<slug>/assets/..."  an image shipped with the site (seeded
//                                      Grill House items keep these)
//   "<restaurant_id>/items/<file>"     an uploaded file in the Storage bucket
// Anything else (absolute URLs, protocol-relative "//", "javascript:"...) is
// refused and yields "".
export function menuImageUrl(supabase, path) {
  if (!path || typeof path !== "string" || path.includes(":") || path.includes("\\") || path.includes("..")) return "";
  if (path.startsWith("/")) return path.startsWith("//") ? "" : path;
  return supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}

export const publicImageUrl = menuImageUrl;
