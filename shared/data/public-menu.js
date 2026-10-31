// Read-only menu loading for public restaurant pages.
//
// Returns plain data only; every restaurant renders it with its own HTML and
// CSS. Row Level Security decides what a visitor can read: only published
// restaurants, and only their categories and items.

import { menuImageUrl } from "./menu.js";

const RESTAURANT_COLUMNS = "id, slug, name, tagline, phone, address, hours, socials, logo_image, hero_image, is_published";
const CATEGORY_COLUMNS = "id, restaurant_id, slug, name, icon, sort_order, is_visible";
// "*" rather than a column list so that menu_items.is_visible is picked up once
// its migration is applied (20261031170000_menu_item_visibility.sql), without
// breaking the page before then. Rows without the column count as visible.
const ITEM_COLUMNS = "*";

function bySortOrder(a, b) {
  return (a.sort_order - b.sort_order) || String(a.name).localeCompare(String(b.name));
}

// Resolves to one of:
//   { status: "ok", restaurant, categories: [{ ...category, items: [...] }] }
//     - only visible categories, in sort_order; visible items in sort_order, each with
//       an `imageUrl`; categories without items are left out
//   { status: "not_found" }  - no published restaurant with this slug
//   { status: "error", error }
export async function loadPublicMenu(supabase, slug) {
  try {
    const restaurantResult = await supabase
      .from("restaurants")
      .select(RESTAURANT_COLUMNS)
      .eq("slug", slug)
      .limit(1);
    if (restaurantResult.error) return { status: "error", error: restaurantResult.error };
    const restaurant = (restaurantResult.data || [])[0];
    if (!restaurant) return { status: "not_found" };

    const [categoryResult, itemResult] = await Promise.all([
      supabase.from("categories").select(CATEGORY_COLUMNS)
        .eq("restaurant_id", restaurant.id).order("sort_order", { ascending: true }),
      supabase.from("menu_items").select(ITEM_COLUMNS)
        .eq("restaurant_id", restaurant.id).order("sort_order", { ascending: true }),
    ]);
    if (categoryResult.error) return { status: "error", error: categoryResult.error };
    if (itemResult.error) return { status: "error", error: itemResult.error };

    const items = (itemResult.data || [])
      .filter((item) => item.restaurant_id === restaurant.id && item.is_visible !== false)
      .map((item) => Object.assign({}, item, { imageUrl: menuImageUrl(supabase, item.image_path) }))
      .sort(bySortOrder);

    const categories = (categoryResult.data || [])
      .filter((category) => category.restaurant_id === restaurant.id && category.is_visible !== false)
      .sort(bySortOrder)
      .map((category) => Object.assign({}, category, {
        items: items.filter((item) => item.category_id === category.id),
      }))
      .filter((category) => category.items.length > 0);

    return { status: "ok", restaurant, categories };
  } catch (error) {
    return { status: "error", error };
  }
}
