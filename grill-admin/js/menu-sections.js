// "الأقسام" and "المنتجات": categories and menu items of this restaurant.
//
// Every call goes through shared/data/menu.js with the restaurant's id;
// Row Level Security decides what is allowed. Images are uploaded to the
// restaurant's own Storage folder; images shipped with the site are never
// deleted (removeItemImage refuses paths outside that folder).

import {
  createCategory, updateCategory, deleteCategory,
  createMenuItem, updateMenuItem, setMenuItemAvailability, deleteMenuItem,
  setCategoryOrder, setCategoryVisibility, setMenuItemOrder, setMenuItemVisibility,
  checkImageFile, uploadItemImage, removeItemImage, menuImageUrl,
  categorySlug, CATEGORY_ICONS, IMAGE_TYPES,
} from "/shared/data/menu.js";
import { format, formatPrice } from "/shared/utils/format.js";
import { h, icon, field, setAlert, invalid, formDialog, toast } from "./ui.js";
import { errorMessage, uploadErrorMessage, isNetworkError, NETWORK } from "./errors.js";

const ICON_LABELS = {
  bowl: "طبق (مقبلات)", skewer: "سيخ (مشويات)", burger: "برغر", pizza: "بيتزا",
  cup: "كوب (مشروبات)", cake: "كعكة (حلويات)", flame: "لهب", list: "قائمة",
};
const CURRENCY = "د.ع";
const VISIBILITY_NOTE = "إخفاء المنتجات عن الزوار غير مفعّل في قاعدة البيانات بعد (يتطلب تطبيق ترحيل menu_item_visibility).";

// Products filter, kept while the section re-renders.
const filter = { category: "", search: "" };

// ---------- Helpers ----------

function optional(value) {
  const trimmed = String(value || "").trim();
  return trimmed === "" ? null : trimmed;
}

// "" -> fallback; otherwise a whole number >= 0, or NaN when invalid.
function wholeNumber(raw, fallback) {
  const text = String(raw).trim();
  if (text === "") return fallback;
  if (!/^\d+$/.test(text)) return NaN;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : NaN;
}

function nextSortOrder(rows) {
  return rows.reduce((max, row) => Math.max(max, Number(row.sort_order) || 0), 0) + 1;
}

function itemsIn(ctx, categoryId) {
  return ctx.items.filter((item) => item.category_id === categoryId);
}

function countLabel(n) {
  return n + " " + (n === 1 ? "منتج" : "منتجات");
}

function moveButtons(onMove, index, count) {
  return [
    h("button", { type: "button", className: "icon-button", "aria-label": "نقل للأعلى", title: "نقل للأعلى",
      disabled: index === 0, onclick: () => onMove(-1) }, icon("up")),
    h("button", { type: "button", className: "icon-button", "aria-label": "نقل للأسفل", title: "نقل للأسفل",
      disabled: index === count - 1, onclick: () => onMove(1) }, icon("down")),
  ];
}

function chip(text, pressed, label, onClick, disabled) {
  return h("button", { type: "button", className: "chip", textContent: text, "aria-pressed": String(pressed),
    "aria-label": label, title: label, disabled: Boolean(disabled), onclick: onClick });
}

// Throws after refreshing, so ctx.run() reports the error.
async function check(ctx, result) {
  if (result.error) {
    await ctx.reload();
    ctx.refresh();
    throw result.error;
  }
  return result.data;
}

async function done(ctx, message) {
  await ctx.reload();
  ctx.refresh();
  if (message) toast(message, "success");
}

// Renumbers `rows` 1..n in their new order, writing only rows that changed.
async function saveOrder(ctx, rows, setOrder) {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].sort_order === i + 1) continue;
    await check(ctx, await setOrder(ctx.supabase, ctx.restaurant.id, rows[i].id, i + 1));
  }
  await done(ctx, "تم حفظ الترتيب.");
}

function swapped(rows, index, delta) {
  const target = index + delta;
  if (target < 0 || target >= rows.length) return null;
  const copy = rows.slice();
  [copy[index], copy[target]] = [copy[target], copy[index]];
  return copy;
}

function confirmDelete(text, action, after) {
  formDialog({
    title: "تأكيد الحذف",
    id: "confirm-dialog",
    narrow: true,
    body: h("p", { className: "confirm-text", textContent: text }),
    submitLabel: "حذف",
    savingLabel: "جارٍ الحذف…",
    networkMessage: NETWORK,
    onSubmit: async (dialog) => {
      dialog.setBusy(true);
      const failure = await action();
      dialog.setBusy(false);
      if (failure) {
        setAlert(dialog.alert, failure);
        return false;
      }
      if (after) after();
      return true;
    },
  });
}

// ---------- Categories ----------

export function renderCategories(ctx, root) {
  const add = h("button", { type: "button", className: "btn btn-primary", id: "add-category",
    textContent: "+ إضافة قسم", onclick: () => openCategoryDialog(ctx, null) });
  const panel = h("section", { className: "panel" },
    h("div", { className: "panel-head" },
      h("h2", { className: "panel-title", textContent: "جميع الأقسام (" + ctx.categories.length + ")" }), add));

  if (!ctx.categories.length) {
    panel.append(h("p", { className: "empty", textContent: "لا توجد أقسام بعد. أضف قسماً لتبدأ بإضافة المنتجات." }));
  } else {
    panel.append(h("ul", { className: "rows", id: "category-rows" }, ctx.categories.map((category, index) => {
      const visible = category.is_visible !== false;
      const count = itemsIn(ctx, category.id).length;
      return h("li", { className: "row" + (visible ? "" : " is-dim"), "data-id": category.id, "data-name": category.name },
        h("div", { className: "row-main" },
          h("div", { className: "row-text" },
            h("span", { className: "row-title", textContent: category.name }),
            h("span", { className: "row-meta", textContent: (ICON_LABELS[category.icon] || ICON_LABELS.list) + " · " + countLabel(count) }))),
        h("div", { className: "row-actions" },
          moveButtons((delta) => ctx.run(async () => {
            const rows = swapped(ctx.categories, index, delta);
            if (rows) await saveOrder(ctx, rows, setCategoryOrder);
          }), index, ctx.categories.length),
          chip(visible ? "ظاهر" : "مخفي", visible, "إظهار القسم «" + category.name + "» أو إخفاؤه", () => ctx.run(async () => {
            await check(ctx, await setCategoryVisibility(ctx.supabase, ctx.restaurant.id, category.id, !visible));
            await done(ctx, format("تم حفظ «{name}».", category));
          })),
          h("button", { type: "button", className: "btn btn-outline btn-small", textContent: "تعديل",
            onclick: () => openCategoryDialog(ctx, category) }),
          h("button", { type: "button", className: "btn btn-danger btn-small", textContent: "حذف",
            onclick: () => confirmDeleteCategory(ctx, category) })));
    })));
  }
  root.append(panel);
}

function openCategoryDialog(ctx, category) {
  const name = field({ label: "اسم القسم", name: "name", value: category ? category.name : "", maxLength: 80, required: true });
  const iconField = field({ label: "الأيقونة في المنيو", name: "icon",
    choices: CATEGORY_ICONS.map((value) => [value, ICON_LABELS[value] || value]),
    value: category && CATEGORY_ICONS.includes(category.icon) ? category.icon : "list" });
  const visible = field({ label: "ظاهر في المنيو العام", name: "is_visible", type: "checkbox",
    checked: category ? category.is_visible !== false : true });

  const api = formDialog({
    title: category ? "تعديل القسم" : "قسم جديد",
    id: "category-dialog",
    narrow: true,
    body: [name.row, iconField.row, visible.row],
    submitLabel: "حفظ",
    savingLabel: "جارٍ الحفظ…",
    networkMessage: NETWORK,
    extra: category ? [h("button", { type: "button", className: "btn btn-danger", textContent: "حذف القسم",
      onclick: () => confirmDeleteCategory(ctx, category, () => api.close()) })] : [],
    onSubmit: async (dialog) => {
      const values = {
        name: name.input.value.trim(),
        icon: CATEGORY_ICONS.includes(iconField.input.value) ? iconField.input.value : "list",
        is_visible: visible.input.checked,
      };
      if (!values.name) return invalid(dialog.alert, name.input, "يرجى إدخال اسم القسم.");
      dialog.setBusy(true);
      try {
        const fields = Object.assign({}, values, {
          sort_order: category ? category.sort_order : nextSortOrder(ctx.categories),
        });
        // New categories get a unique, stable slug (used for the menu's anchors).
        if (!category) fields.slug = categorySlug(values.name, ctx.categories.map((c) => c.slug));
        const { error } = category
          ? await updateCategory(ctx.supabase, ctx.restaurant.id, category.id, fields)
          : await createCategory(ctx.supabase, ctx.restaurant.id, fields);
        if (error) {
          console.error(error);
          setAlert(dialog.alert, errorMessage(error));
          if (error.code === "denied") await done(ctx);
          return false;
        }
        await done(ctx, format("تم حفظ القسم «{name}».", values));
        return true;
      } finally {
        dialog.setBusy(false);
      }
    },
  });
  name.input.focus();
}

// Why a category delete failed. It is atomic, so a failure deleted nothing.
// Not errorMessage(): its data-error text points at form fields, and this
// dialog has none.
function deleteCategoryError(error) {
  if (error.code === "denied" || error.code === "42501" || isNetworkError(error)) return errorMessage(error);
  if (error.code === "23503") return "تعذر حذف القسم لأن قاعدة البيانات رفضت حذف المنتجات التابعة له. لم يتم حذف أي شيء.";
  return "تعذر حذف القسم. لم يتم حذف أي شيء. يرجى المحاولة مجدداً.";
}

// Deleting a category also deletes all of its products (ON DELETE CASCADE).
function confirmDeleteCategory(ctx, category, after) {
  const count = itemsIn(ctx, category.id).length;
  const values = { name: category.name, count: countLabel(count) };
  const text = count
    ? format("سيتم حذف القسم «{name}» وجميع المنتجات التابعة له ({count}) نهائياً. لا يمكن التراجع عن الحذف.", values)
    : format("هل تريد حذف القسم «{name}» نهائياً؟ القسم لا يحتوي على منتجات. لا يمكن التراجع عن الحذف.", values);
  confirmDelete(text, async () => {
    const { data, error } = await deleteCategory(ctx.supabase, ctx.restaurant.id, category.id);
    if (error) {
      console.error(error);
      if (error.code === "denied") await done(ctx);
      return deleteCategoryError(error);
    }
    for (const path of data.imagePaths) await removeItemImage(ctx.supabase, ctx.restaurant.id, path);
    await done(ctx, count
      ? format("تم حذف القسم «{name}» مع {count}.", values)
      : format("تم حذف القسم «{name}».", values));
    return null;
  }, after);
}

// ---------- Products ----------

export function renderProducts(ctx, root) {
  if (filter.category && !ctx.categories.some((c) => c.id === filter.category)) filter.category = "";

  const categorySelect = field({ label: "القسم", name: "filter_category",
    choices: [["", "جميع الأقسام"]].concat(ctx.categories.map((c) => [c.id, c.name])), value: filter.category });
  const search = field({ label: "بحث", name: "search", type: "search", value: filter.search, placeholder: "اسم المنتج" });
  const add = h("button", { type: "button", className: "btn btn-primary toolbar-action", id: "add-product",
    textContent: "+ إضافة منتج", onclick: () => openItemDialog(ctx, null, filter.category || null) });
  const list = h("div", { id: "product-list" });

  categorySelect.input.addEventListener("change", () => { filter.category = categorySelect.input.value; paint(); });
  search.input.addEventListener("input", () => { filter.search = search.input.value; paint(); });

  function paint() {
    const query = filter.search.trim().toLowerCase();
    const groups = ctx.categories.filter((c) => !filter.category || c.id === filter.category);
    const blocks = [];
    for (const category of groups) {
      const all = itemsIn(ctx, category.id);
      const shown = all.filter((item) => !query || item.name.toLowerCase().includes(query));
      if (query && !shown.length) continue;
      blocks.push(h("h3", { className: "group-title", textContent: category.name + " (" + all.length + ")" + (category.is_visible === false ? " — قسم مخفي" : "") }));
      blocks.push(shown.length
        ? h("ul", { className: "rows", "data-category": category.id }, shown.map((item) => productRow(ctx, item, all, Boolean(query))))
        : h("p", { className: "empty", textContent: "لا توجد منتجات في هذا القسم." }));
    }
    if (!ctx.categories.length) blocks.push(h("p", { className: "empty", textContent: "أضف قسماً أولاً من صفحة الأقسام." }));
    else if (!blocks.length) blocks.push(h("p", { className: "empty", textContent: "لا توجد نتائج مطابقة." }));
    list.replaceChildren(...blocks);
  }

  add.disabled = !ctx.categories.length;
  const panel = h("section", { className: "panel" },
    h("div", { className: "toolbar" }, categorySelect.row, search.row, add), list);
  if (!ctx.withVisibility) panel.append(h("p", { className: "note", textContent: VISIBILITY_NOTE }));
  root.append(panel);
  paint();
}

function productRow(ctx, item, siblings, searching) {
  const index = siblings.findIndex((i) => i.id === item.id);
  const available = item.is_available !== false;
  const visible = item.is_visible !== false;
  const url = menuImageUrl(ctx.supabase, item.image_path);
  return h("li", { className: "row" + (visible ? "" : " is-dim"), "data-id": item.id, "data-name": item.name },
    h("div", { className: "row-main" },
      h("div", { className: "thumb" }, url ? h("img", { src: url, alt: "", loading: "lazy" }) : icon("image")),
      h("div", { className: "row-text" },
        h("span", { className: "row-title", textContent: item.name }),
        h("span", { className: "row-meta" },
          h("span", { className: "price", textContent: formatPrice(item.price) + " " + CURRENCY }),
          item.description ? " · " + item.description : ""))),
    h("div", { className: "row-actions" },
      searching ? null : moveButtons((delta) => ctx.run(async () => {
        const rows = swapped(siblings, index, delta);
        if (rows) await saveOrder(ctx, rows, setMenuItemOrder);
      }), index, siblings.length),
      chip(available ? "متوفر" : "غير متوفر", available, "تبديل حالة التوفر لـ «" + item.name + "»", () => ctx.run(async () => {
        await check(ctx, await setMenuItemAvailability(ctx.supabase, ctx.restaurant.id, item.id, !available));
        await done(ctx, format("تم حفظ «{name}».", item));
      })),
      chip(visible ? "ظاهر" : "مخفي", visible,
        ctx.withVisibility ? "إظهار «" + item.name + "» للزوار أو إخفاؤه" : VISIBILITY_NOTE,
        () => ctx.run(async () => {
          await check(ctx, await setMenuItemVisibility(ctx.supabase, ctx.restaurant.id, item.id, !visible));
          await done(ctx, format("تم حفظ «{name}».", item));
        }), !ctx.withVisibility),
      h("button", { type: "button", className: "btn btn-outline btn-small", textContent: "تعديل",
        onclick: () => openItemDialog(ctx, item) }),
      h("button", { type: "button", className: "btn btn-danger btn-small", textContent: "حذف",
        onclick: () => confirmDeleteItem(ctx, item) })));
}

function openItemDialog(ctx, item, categoryId) {
  if (!ctx.categories.length) {
    toast("أضف قسماً أولاً قبل إضافة المنتجات.", "error");
    return;
  }
  const restaurantId = ctx.restaurant.id;
  let file = null;
  let removeImage = false;
  let objectUrl = "";

  const name = field({ label: "اسم المنتج", name: "name", value: item ? item.name : "", maxLength: 120, required: true });
  const description = field({ label: "الوصف", name: "description", multiline: true, maxLength: 500,
    value: item && item.description ? item.description : "" });
  const price = field({ label: "السعر (" + CURRENCY + ")", name: "price", inputMode: "numeric", dir: "ltr",
    value: item ? String(item.price) : "" });
  const category = field({ label: "القسم", name: "category_id",
    choices: ctx.categories.map((c) => [c.id, c.name + (c.is_visible === false ? " (مخفي)" : "")]),
    value: item ? item.category_id : (categoryId || ctx.categories[0].id) });
  const available = field({ label: "متوفر حالياً", name: "is_available", type: "checkbox",
    checked: item ? item.is_available !== false : true });
  const visible = field({ label: "ظاهر للزوار", name: "is_visible", type: "checkbox",
    checked: item ? item.is_visible !== false : true, disabled: !ctx.withVisibility,
    hint: ctx.withVisibility ? null : VISIBILITY_NOTE });

  // Image: choose / replace / remove, previewed before saving.
  const preview = h("div", { className: "thumb image-preview" });
  const fileInput = h("input", { type: "file", name: "image", className: "file-input", accept: Object.keys(IMAGE_TYPES).join(",") });
  const chooseText = h("span");
  const choose = h("label", { className: "btn btn-outline btn-small" }, chooseText, fileInput);
  const remove = h("button", { type: "button", className: "btn btn-danger btn-small", id: "remove-image", textContent: "إزالة الصورة" });

  function currentImageUrl() {
    if (file) return objectUrl;
    if (!removeImage && item && item.image_path) return menuImageUrl(ctx.supabase, item.image_path);
    return "";
  }
  function paintImage() {
    const url = currentImageUrl();
    preview.replaceChildren(url ? h("img", { src: url, alt: "" }) : icon("image"));
    remove.hidden = !url;
    chooseText.textContent = url ? "تغيير الصورة" : "اختيار صورة";
  }
  function dropFile() {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = "";
    file = null;
    fileInput.value = "";
  }

  const api = formDialog({
    title: item ? "تعديل المنتج" : "منتج جديد",
    id: "item-dialog",
    body: [
      h("div", { className: "image-field" }, preview,
        h("div", { className: "image-actions" },
          h("span", { className: "label", textContent: "الصورة" }),
          h("div", { className: "image-buttons" }, choose, remove),
          h("small", { className: "hint", textContent: "JPG أو PNG أو WebP، حتى 5 ميغابايت." }))),
      name.row, description.row,
      h("div", { className: "grid-2" }, price.row, category.row),
      h("div", { className: "grid-2" }, available.row, visible.row),
    ],
    submitLabel: "حفظ",
    savingLabel: "جارٍ الحفظ…",
    networkMessage: NETWORK,
    extra: item ? [h("button", { type: "button", className: "btn btn-danger", id: "delete-item", textContent: "حذف المنتج",
      onclick: () => confirmDeleteItem(ctx, item, () => api.close()) })] : [],
    onSubmit: async (dialog) => {
      const values = {
        name: name.input.value.trim(),
        description: optional(description.input.value),
        price: wholeNumber(price.input.value, NaN),
        category_id: category.input.value,
        is_available: available.input.checked,
        is_visible: visible.input.checked,
      };
      if (!values.name) return invalid(dialog.alert, name.input, "يرجى إدخال اسم المنتج.");
      if (!ctx.categories.some((c) => c.id === values.category_id)) return invalid(dialog.alert, category.input, "يرجى اختيار القسم.");
      if (Number.isNaN(values.price)) return invalid(dialog.alert, price.input, "يرجى إدخال سعر صحيح (رقم صحيح لا يقل عن صفر).");

      const oldPath = item ? item.image_path : null;
      let uploadedPath = null;
      dialog.setBusy(true);
      try {
        // 1. Upload a new image first, so the row never points at a missing file.
        if (file) {
          const upload = await uploadItemImage(ctx.supabase, restaurantId, file);
          if (upload.error) {
            console.error(upload.error);
            setAlert(dialog.alert, uploadErrorMessage(upload.error));
            return false;
          }
          uploadedPath = upload.data.path;
        }

        // 2. Save the row. A new product, or one moved to another category,
        // goes to the end of that category.
        const imagePath = uploadedPath || (removeImage ? null : oldPath);
        const moved = !item || item.category_id !== values.category_id;
        const fields = {
          category_id: values.category_id,
          name: values.name,
          description: values.description,
          price: values.price,
          is_available: values.is_available,
          sort_order: moved ? nextSortOrder(itemsIn(ctx, values.category_id)) : item.sort_order,
          image_path: imagePath,
        };
        if (ctx.withVisibility) fields.is_visible = values.is_visible;
        const { error } = item
          ? await updateMenuItem(ctx.supabase, restaurantId, item.id, fields)
          : await createMenuItem(ctx.supabase, restaurantId, fields);
        if (error) {
          console.error(error);
          if (uploadedPath) await removeItemImage(ctx.supabase, restaurantId, uploadedPath);
          uploadedPath = null;
          setAlert(dialog.alert, errorMessage(error));
          if (error.code === "denied") await done(ctx);
          return false;
        }

        // 3. Only now remove the image it replaced.
        if (oldPath && oldPath !== imagePath) await removeItemImage(ctx.supabase, restaurantId, oldPath);
        uploadedPath = null;
        await done(ctx, format("تم حفظ المنتج «{name}».", values));
        return true;
      } catch (error) {
        if (uploadedPath) await removeItemImage(ctx.supabase, restaurantId, uploadedPath);
        throw error;
      } finally {
        dialog.setBusy(false);
      }
    },
  });
  api.onClose = dropFile;

  fileInput.addEventListener("change", () => {
    const chosen = fileInput.files && fileInput.files[0];
    if (!chosen) return;
    setAlert(api.alert, "");
    const problem = checkImageFile(chosen);
    if (problem) {
      fileInput.value = "";
      setAlert(api.alert, uploadErrorMessage(problem));
      return;
    }
    dropFile();
    file = chosen;
    objectUrl = URL.createObjectURL(chosen);
    removeImage = false;
    paintImage();
  });
  remove.addEventListener("click", () => {
    if (file) dropFile();
    else removeImage = true;
    paintImage();
  });

  paintImage();
  name.input.focus();
}

function confirmDeleteItem(ctx, item, after) {
  confirmDelete(format("هل تريد حذف المنتج «{name}»؟ لا يمكن التراجع عن الحذف.", item), async () => {
    const { data, error } = await deleteMenuItem(ctx.supabase, ctx.restaurant.id, item.id);
    if (error) {
      console.error(error);
      if (error.code === "denied") await done(ctx);
      return errorMessage(error);
    }
    await removeItemImage(ctx.supabase, ctx.restaurant.id, data.image_path);
    await done(ctx, format("تم حذف المنتج «{name}».", item));
    return null;
  }, after);
}
