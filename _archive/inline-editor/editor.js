// Grill House inline editor: edit the menu on the public page itself.
//
// Loaded only for a signed-in member of Grill House (see ../manage-menu.js).
// While active, the page's own renderer (../script.js renderMenu) draws every
// category and item, hidden ones included, and this module adds editing
// controls around the same cards. Leaving editing mode reloads the public
// menu, exactly as visitors see it.
//
// All reads and writes go through shared/ data modules, scoped to this
// restaurant's id. Row Level Security and the database functions decide what
// is allowed; this module only renders, validates and reports.

import { renderMenu, applyProfile, setEditing, loadMenuFromDatabase } from "/restaurants/grill-house/script.js";
import {
  listCategories, createCategory, updateCategory, deleteCategory,
  listMenuItems, createMenuItem, updateMenuItem, setMenuItemAvailability, deleteMenuItem,
  setCategoryOrder, setCategoryVisibility, setMenuItemOrder, setMenuItemVisibility, supportsItemVisibility,
  checkImageFile, uploadItemImage, removeItemImage, menuImageUrl,
  categorySlug, CATEGORY_ICONS, IMAGE_TYPES,
} from "/shared/data/menu.js";
import { updateRestaurantProfile, PROFILE_LIMITS, PROFILE_PHONE_PATTERN } from "/shared/data/restaurants.js";
import { getMyRestaurants } from "/shared/auth/authorization.js";
import { signOut, changePassword } from "/shared/auth/session.js";
import { publicMenuUrl } from "/shared/utils/restaurant.js";
import { format, formatPrice } from "/shared/utils/format.js";
import { h, field, setAlert, openDialog, closeDialog, toast, removeToast, spriteIcon } from "./ui.js";

const MESSAGES = {
  barTitle: "وضع التعديل",
  barLabel: "أدوات إدارة المطعم",
  addCategory: "قسم جديد",
  profile: "معلومات المطعم",
  password: "كلمة المرور",
  publicMenu: "عرض المنيو العام",
  logout: "تسجيل الخروج",
  done: "إنهاء التعديل",
  loading: "جارٍ تحميل المنيو للتعديل…",
  editingOn: "وضع التعديل مفعّل. اضغط على أي صنف لتعديله.",
  loadFailed: "تعذر تحميل بيانات المنيو. يرجى المحاولة مجدداً.",
  signedOut: "تم تسجيل الخروج.",
  moveUp: "تقديم",
  moveDown: "تأخير",
  hide: "إخفاء",
  show: "إظهار",
  edit: "تعديل",
  delete: "حذف",
  available: "متوفر",
  unavailable: "غير متوفر",
  visible: "ظاهر",
  hidden: "مخفي",
  hiddenBadge: "مخفي عن الزوار",
  toggleAvailability: "تبديل حالة التوفر لـ «{name}»",
  toggleVisibility: "إظهار «{name}» للزوار أو إخفاؤه",
  categoryTools: "أدوات القسم «{name}»",
  itemTools: "أدوات الصنف «{name}»",
  editItemNamed: "تعديل «{name}»",
  addItemTo: "إضافة صنف إلى «{name}»",
  addCategoryLong: "إضافة قسم جديد",
  visibilityUnavailable: "إخفاء الأصناف غير مفعّل في قاعدة البيانات بعد (يتطلب تطبيق ترحيل menu_item_visibility).",
  needCategory: "أضف قسماً أولاً قبل إضافة الأصناف.",
  newItem: "صنف جديد",
  editItem: "تعديل الصنف",
  newCategory: "قسم جديد",
  editCategory: "تعديل القسم",
  itemName: "اسم الصنف",
  description: "الوصف",
  price: "السعر (د.ع)",
  category: "القسم",
  isAvailable: "متوفر حالياً",
  isVisible: "ظاهر للزوار",
  image: "الصورة",
  chooseImage: "اختيار صورة",
  replaceImage: "تغيير الصورة",
  removeImage: "إزالة الصورة",
  imageHint: "JPG أو PNG أو WebP، حتى 5 ميغابايت.",
  categoryName: "اسم القسم",
  icon: "الأيقونة",
  categoryVisible: "ظاهر في المنيو العام",
  save: "حفظ",
  cancel: "إلغاء",
  saving: "جارٍ الحفظ…",
  deleting: "جارٍ الحذف…",
  deleteItem: "حذف الصنف",
  deleteCategory: "حذف القسم",
  hiddenSuffix: " (مخفي)",
  nameRequired: "يرجى إدخال الاسم.",
  categoryRequired: "يرجى اختيار القسم.",
  priceInvalid: "يرجى إدخال سعر صحيح (رقم صحيح لا يقل عن صفر).",
  imageType: "نوع الصورة غير مدعوم. استخدم JPG أو PNG أو WebP.",
  imageSize: "حجم الصورة أكبر من 5 ميغابايت.",
  uploadDenied: "تم رفض رفع الصورة. لا تملك صلاحية التخزين لهذا المطعم.",
  uploadFailed: "تعذر رفع الصورة. يرجى المحاولة مجدداً.",
  categorySaved: "تم حفظ القسم «{name}».",
  categoryDeleted: "تم حذف القسم «{name}».",
  categoryInUse: "لا يمكن حذف هذا القسم لأنه يحتوي على أصناف. انقل الأصناف أو احذفها أولاً.",
  itemSaved: "تم حفظ الصنف «{name}».",
  itemDeleted: "تم حذف الصنف «{name}».",
  orderSaved: "تم حفظ الترتيب.",
  statusSaved: "تم حفظ «{name}».",
  deleteCategoryConfirm: "هل تريد حذف القسم «{name}»؟",
  deleteItemConfirm: "هل تريد حذف الصنف «{name}»؟ لا يمكن التراجع عن الحذف.",
  confirmTitle: "تأكيد الحذف",
  denied: "العنصر غير موجود أو لا تملك صلاحية تعديله. تم تحديث المنيو.",
  forbidden: "لا تملك صلاحية تنفيذ هذه العملية.",
  duplicate: "يوجد عنصر بنفس البيانات مسبقاً.",
  invalidData: "بعض البيانات غير صالحة. يرجى مراجعة الحقول.",
  network: "تعذر الاتصال بالخادم. تحقق من الاتصال بالإنترنت وحاول مجدداً.",
  saveFailed: "تعذر حفظ التغييرات. يرجى المحاولة مجدداً.",
  profileTitle: "معلومات المطعم",
  restaurantNameRequired: "يرجى إدخال اسم المطعم.",
  fieldTooLong: "حقل «{label}» أطول من الحد المسموح ({max} حرفاً).",
  fieldInvalid: "حقل «{label}» يحتوي على أحرف غير مسموحة.",
  phoneInvalid: "رقم الهاتف غير صالح. استخدم الأرقام والمسافات والرموز + - ( ) فقط (5 إلى 30 خانة).",
  profileSaved: "تم حفظ معلومات المطعم.",
  profileUnchanged: "لم يتم تغيير أي معلومات.",
  profileForbidden: "لا تملك صلاحية تعديل معلومات هذا المطعم.",
  profileNotEnabled: "تعديل معلومات المطعم غير مفعّل في قاعدة البيانات بعد.",
  profileNote: "المعرّف وحالة النشر لا يمكن تغييرهما من هنا.",
  passwordTitle: "تغيير كلمة المرور",
  newPassword: "كلمة المرور الجديدة",
  confirmPassword: "تأكيد كلمة المرور",
  passwordShort: "كلمة المرور يجب أن تكون 10 أحرف على الأقل.",
  passwordMismatch: "كلمتا المرور غير متطابقتين.",
  passwordSaved: "تم تحديث كلمة المرور.",
  passwordFailed: "تعذر تحديث كلمة المرور. يرجى المحاولة مجدداً.",
};

const PROFILE_FIELDS = [
  ["name", "اسم المطعم"],
  ["tagline", "العبارة التعريفية"],
  ["phone", "الهاتف"],
  ["address", "العنوان"],
  ["hours", "ساعات العمل"],
];
const PROFILE_LABELS = Object.fromEntries(PROFILE_FIELDS);
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

const ICON_LABELS = {
  bowl: "طبق (مقبلات)", skewer: "سيخ (مشويات)", burger: "برغر", pizza: "بيتزا",
  cup: "كوب (مشروبات)", cake: "كعكة (حلويات)", flame: "لهب", list: "قائمة",
};

const menuMain = document.getElementById("menu-items");
const categoryList = document.querySelector(".category-list");

// { supabase, restaurant, categories, items, withVisibility, onStop, onSignedOut }
let state = null;
let busy = false;
let loadToken = 0;
let bar = null;
const openDialogs = new Set();

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

function isNetworkError(error) {
  return !error.code && /fetch|network/i.test(error.message || "");
}

function errorMessage(error) {
  if (!error) return MESSAGES.saveFailed;
  if (error.code === "denied") return MESSAGES.denied;
  if (error.code === "42501") return MESSAGES.forbidden;
  if (error.code === "23505") return MESSAGES.duplicate;
  if (["23514", "23502", "22001", "22P02", "22003", "23503"].includes(error.code)) return MESSAGES.invalidData;
  if (isNetworkError(error)) return MESSAGES.network;
  return MESSAGES.saveFailed;
}

function uploadErrorMessage(error) {
  if (error.code === "invalid_image") return error.reason === "size" ? MESSAGES.imageSize : MESSAGES.imageType;
  const status = Number(error.statusCode || error.status);
  if (status === 401 || status === 403 || /row-level security|unauthorized/i.test(error.message || "")) {
    return MESSAGES.uploadDenied;
  }
  if (isNetworkError(error)) return MESSAGES.network;
  return MESSAGES.uploadFailed;
}

function itemsIn(categoryId) {
  return state.items.filter((item) => item.category_id === categoryId);
}

function badge(text) {
  return h("span", { className: "gh-badge", textContent: text });
}

// A small control in a category or item toolbar. Never lets the click reach
// the card (which would open the item editor) or the page's lightbox.
function toolButton({ text, icon, flip, label, pressed, disabled, danger, onClick }) {
  const button = h("button", {
    type: "button",
    className: "gh-tool" + (danger ? " gh-tool-danger" : ""),
    title: label || text,
    "aria-label": label || text,
    "aria-pressed": pressed === undefined ? undefined : String(Boolean(pressed)),
    disabled: Boolean(disabled),
  });
  if (icon) {
    const svg = spriteIcon(icon, 14);
    if (flip) svg.classList.add("gh-flip");
    button.append(svg);
  }
  if (text) button.append(h("span", { textContent: text }));
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

// Runs one change at a time; the page is marked busy meanwhile.
async function run(task) {
  if (busy || !state) return;
  busy = true;
  document.body.classList.add("gh-busy");
  try {
    await task();
  } catch (error) {
    console.error(error);
    toast(errorMessage(error), "error");
  } finally {
    busy = false;
    document.body.classList.remove("gh-busy");
  }
}

// Throws the error after refreshing, so run() reports it.
async function check(result) {
  if (result.error) {
    await reload();
    throw result.error;
  }
  return result.data;
}

// ---------- Loading and rendering ----------

async function reload() {
  const s = state;
  if (!s) return false;
  const token = ++loadToken;
  const restaurantId = s.restaurant.id;
  let results;
  try {
    results = await Promise.all([
      listCategories(s.supabase, restaurantId),
      listMenuItems(s.supabase, restaurantId, { withVisibility: s.withVisibility }),
    ]);
  } catch (error) {
    results = [{ error }, { error }];
  }
  if (state !== s || token !== loadToken) return false;

  const [categoryResult, itemResult] = results;
  if (categoryResult.error || itemResult.error) {
    console.error(categoryResult.error || itemResult.error);
    toast(MESSAGES.loadFailed, "error");
    return false;
  }
  // Defence in depth: never render rows of another restaurant.
  s.categories = (categoryResult.data || []).filter((c) => c.restaurant_id === restaurantId);
  s.items = (itemResult.data || []).filter((i) => i.restaurant_id === restaurantId);
  render();
  return true;
}

function render() {
  const y = window.scrollY;
  const categories = state.categories.map((category) => Object.assign({}, category, {
    items: itemsIn(category.id).map((item) =>
      Object.assign({}, item, { imageUrl: menuImageUrl(state.supabase, item.image_path) })),
  }));
  renderMenu(categories, formatPrice); // the page's own markup and design
  decorate(categories);
  window.scrollTo({ top: y, behavior: "instant" });
}

function decorate(categories) {
  const sections = menuMain.querySelectorAll(".menu-section");
  const links = categoryList.querySelectorAll(".category-link");
  categories.forEach((category, index) => {
    const section = sections[index];
    if (!section) return;
    const hidden = category.is_visible === false;
    section.classList.add("gh-section");
    section.classList.toggle("gh-is-hidden", hidden);
    section.setAttribute("data-gh-category", category.id);
    if (links[index]) links[index].classList.toggle("gh-is-hidden", hidden);
    if (hidden) section.querySelector(".section-heading h2").append(badge(MESSAGES.hiddenBadge));
    section.querySelector(".section-heading").after(categoryTools(category, index, categories.length));

    const list = section.querySelector(".menu-list");
    list.querySelectorAll(".menu-card").forEach((card, i) => {
      if (category.items[i]) decorateCard(card, category.items[i], i, category.items.length);
    });
    list.append(h("button", {
      type: "button",
      className: "gh-add gh-add-item",
      onclick: () => openItemDialog(null, category),
    }, "+ ", format(MESSAGES.addItemTo, category)));
  });

  menuMain.append(h("div", { className: "gh-add-section" },
    h("button", { type: "button", className: "gh-add", onclick: () => openCategoryDialog(null) },
      "+ ", MESSAGES.addCategoryLong)));
}

function categoryTools(category, index, count) {
  const visible = category.is_visible !== false;
  return h("div", { className: "gh-tools gh-category-tools", role: "toolbar", "aria-label": format(MESSAGES.categoryTools, category) },
    toolButton({ icon: "arrow-down", flip: true, label: MESSAGES.moveUp, disabled: index === 0,
      onClick: () => run(() => moveCategory(index, -1)) }),
    toolButton({ icon: "arrow-down", label: MESSAGES.moveDown, disabled: index === count - 1,
      onClick: () => run(() => moveCategory(index, 1)) }),
    toolButton({ text: visible ? MESSAGES.hide : MESSAGES.show,
      onClick: () => run(() => toggleCategoryVisibility(category)) }),
    toolButton({ text: MESSAGES.edit, onClick: () => openCategoryDialog(category) }),
    toolButton({ text: MESSAGES.delete, danger: true, onClick: () => confirmDeleteCategory(category) }));
}

function decorateCard(card, item, index, count) {
  const hidden = item.is_visible === false;
  card.classList.add("gh-card");
  card.classList.toggle("gh-is-hidden", hidden);
  card.setAttribute("data-gh-item", item.id);
  card.title = format(MESSAGES.editItemNamed, item);
  if (hidden) card.querySelector(".menu-card-body").append(badge(MESSAGES.hiddenBadge));

  // A mouse click anywhere on the card opens its editor (instead of the
  // lightbox); keyboard users use the toolbar's "تعديل" button.
  card.addEventListener("click", (event) => {
    event.stopPropagation();
    if (event.target.closest(".gh-tools")) return;
    openItemDialog(item);
  });

  const available = item.is_available !== false;
  card.append(h("div", { className: "gh-tools gh-item-tools", role: "toolbar", "aria-label": format(MESSAGES.itemTools, item) },
    toolButton({ icon: "arrow-down", flip: true, label: MESSAGES.moveUp, disabled: index === 0,
      onClick: () => run(() => moveItem(item, -1)) }),
    toolButton({ icon: "arrow-down", label: MESSAGES.moveDown, disabled: index === count - 1,
      onClick: () => run(() => moveItem(item, 1)) }),
    toolButton({ text: available ? MESSAGES.available : MESSAGES.unavailable, pressed: available,
      label: format(MESSAGES.toggleAvailability, item),
      onClick: () => run(() => toggleAvailability(item)) }),
    toolButton({ text: hidden ? MESSAGES.hidden : MESSAGES.visible, pressed: !hidden,
      label: state.withVisibility ? format(MESSAGES.toggleVisibility, item) : MESSAGES.visibilityUnavailable,
      disabled: !state.withVisibility,
      onClick: () => run(() => toggleItemVisibility(item)) }),
    toolButton({ text: MESSAGES.edit, label: format(MESSAGES.editItemNamed, item), onClick: () => openItemDialog(item) })));
}

// ---------- Quick changes ----------

// Renumbers `rows` 1..n in their new order, writing only rows that changed.
async function saveOrder(rows, setOrder) {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].sort_order === i + 1) continue;
    await check(await setOrder(state.supabase, state.restaurant.id, rows[i].id, i + 1));
  }
  await reload();
  toast(MESSAGES.orderSaved, "success");
}

function swapped(rows, index, delta) {
  const target = index + delta;
  if (target < 0 || target >= rows.length) return null;
  const copy = rows.slice();
  [copy[index], copy[target]] = [copy[target], copy[index]];
  return copy;
}

async function moveCategory(index, delta) {
  const rows = swapped(state.categories, index, delta);
  if (rows) await saveOrder(rows, setCategoryOrder);
}

async function moveItem(item, delta) {
  const siblings = itemsIn(item.category_id);
  const rows = swapped(siblings, siblings.findIndex((i) => i.id === item.id), delta);
  if (rows) await saveOrder(rows, setMenuItemOrder);
}

async function toggleCategoryVisibility(category) {
  await check(await setCategoryVisibility(state.supabase, state.restaurant.id, category.id, category.is_visible === false));
  await reload();
  toast(format(MESSAGES.statusSaved, category), "success");
}

async function toggleAvailability(item) {
  await check(await setMenuItemAvailability(state.supabase, state.restaurant.id, item.id, item.is_available === false));
  await reload();
  toast(format(MESSAGES.statusSaved, item), "success");
}

async function toggleItemVisibility(item) {
  if (!state.withVisibility) return;
  await check(await setMenuItemVisibility(state.supabase, state.restaurant.id, item.id, item.is_visible === false));
  await reload();
  toast(format(MESSAGES.statusSaved, item), "success");
}

// ---------- Dialogs ----------

// A modal panel: title, form body and action buttons. `onSubmit` resolves to
// true to close it. Escape and "إلغاء" close it unless it is saving.
function createDialog({ title, id, body, actions, onSubmit, narrow }) {
  const alert = h("p", { className: "gh-alert", role: "alert", hidden: true });
  const submit = h("button", { type: "submit", className: "gh-btn gh-btn-primary", textContent: actions.submit || MESSAGES.save });
  const cancel = h("button", { type: "button", className: "gh-btn", textContent: MESSAGES.cancel });
  const extra = actions.extra || [];
  const form = h("form", { className: "gh-form", noValidate: true },
    body, alert,
    h("div", { className: "gh-actions" }, h("div", { className: "gh-actions-start" }, extra), cancel, submit));
  const dialog = h("dialog", { className: "gh-dialog" + (narrow ? " gh-dialog-narrow" : ""), id, dir: "rtl", lang: "ar" },
    h("h2", { className: "gh-dialog-title", textContent: title }), form);

  const api = {
    dialog, alert, busy: false,
    setBusy(value, label) {
      api.busy = value;
      [submit, cancel].concat(extra).forEach((b) => { b.disabled = value; });
      submit.textContent = value ? (label || MESSAGES.saving) : (actions.submit || MESSAGES.save);
    },
    close() {
      openDialogs.delete(api);
      closeDialog(dialog);
      dialog.remove();
      if (api.onClose) api.onClose();
    },
  };

  cancel.addEventListener("click", () => { if (!api.busy) api.close(); });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (!api.busy) api.close();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (api.busy) return;
    setAlert(alert, "");
    form.querySelectorAll("[aria-invalid]").forEach((n) => n.removeAttribute("aria-invalid"));
    try {
      if (await onSubmit(api)) api.close();
    } catch (error) {
      console.error(error);
      setAlert(alert, MESSAGES.network);
      api.setBusy(false);
    }
  });

  document.body.appendChild(dialog);
  openDialogs.add(api);
  openDialog(dialog);
  return api;
}

function invalid(api, input, message) {
  input.setAttribute("aria-invalid", "true");
  setAlert(api.alert, message);
  input.focus();
  return false;
}

// `action` resolves to null on success or to an error message.
function confirmDelete(text, action, after) {
  return createDialog({
    title: MESSAGES.confirmTitle,
    id: "gh-confirm-dialog",
    narrow: true,
    body: h("p", { className: "gh-confirm-text", textContent: text }),
    actions: { submit: MESSAGES.delete },
    onSubmit: async (api) => {
      api.setBusy(true, MESSAGES.deleting);
      const failure = await action();
      api.setBusy(false);
      if (failure) {
        setAlert(api.alert, failure);
        return false;
      }
      if (after) after();
      return true;
    },
  });
}

// ---------- Item editor ----------

function openItemDialog(item, category) {
  if (!state || busy) return;
  if (!state.categories.length) {
    toast(MESSAGES.needCategory, "error");
    return;
  }
  const s = state;
  const restaurantId = s.restaurant.id;
  let file = null;
  let removeImage = false;
  let objectUrl = "";

  const name = field({ label: MESSAGES.itemName, name: "name", value: item ? item.name : "", maxLength: 120, required: true });
  const description = field({ label: MESSAGES.description, name: "description", multiline: true, maxLength: 500,
    value: item && item.description ? item.description : "" });
  const price = field({ label: MESSAGES.price, name: "price", inputMode: "numeric", dir: "ltr",
    value: item ? String(item.price) : "" });
  const categoryField = field({ label: MESSAGES.category, name: "category_id",
    choices: s.categories.map((c) => [c.id, c.name + (c.is_visible === false ? MESSAGES.hiddenSuffix : "")]),
    value: item ? item.category_id : (category || s.categories[0]).id });
  const available = field({ label: MESSAGES.isAvailable, name: "is_available", type: "checkbox",
    checked: item ? item.is_available !== false : true });
  const visible = field({ label: MESSAGES.isVisible, name: "is_visible", type: "checkbox",
    checked: item ? item.is_visible !== false : true, disabled: !s.withVisibility,
    hint: s.withVisibility ? null : MESSAGES.visibilityUnavailable });

  // Image: preview in the card's own round frame, choose / replace / remove.
  const preview = h("div", { className: "menu-card-image image-slot gh-image-preview" });
  const fileInput = h("input", { type: "file", name: "image", className: "gh-file-input",
    accept: Object.keys(IMAGE_TYPES).join(",") });
  const chooseText = h("span");
  const choose = h("label", { className: "gh-btn gh-btn-small" }, chooseText, fileInput);
  const remove = h("button", { type: "button", className: "gh-btn gh-btn-small gh-btn-danger", textContent: MESSAGES.removeImage });

  function currentImageUrl() {
    if (file) return objectUrl;
    if (!removeImage && item && item.image_path) return menuImageUrl(s.supabase, item.image_path);
    return "";
  }
  function paintImage() {
    const url = currentImageUrl();
    preview.replaceChildren(url ? h("img", { src: url, alt: "" }) : spriteIcon("image", 20));
    remove.hidden = !url;
    chooseText.textContent = url ? MESSAGES.replaceImage : MESSAGES.chooseImage;
  }
  function dropFile() {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = "";
    file = null;
    fileInput.value = "";
  }

  const extra = [];
  if (item) {
    extra.push(h("button", { type: "button", className: "gh-btn gh-btn-danger", textContent: MESSAGES.deleteItem,
      onclick: () => confirmDeleteItem(item, () => api.close()) }));
  }

  const api = createDialog({
    title: item ? MESSAGES.editItem : MESSAGES.newItem,
    id: "gh-item-dialog",
    body: [
      h("div", { className: "gh-image-field" }, preview,
        h("div", { className: "gh-image-actions" },
          h("span", { className: "gh-label", textContent: MESSAGES.image }),
          h("div", { className: "gh-row" }, choose, remove),
          h("small", { className: "gh-hint", textContent: MESSAGES.imageHint }))),
      name.row, description.row,
      h("div", { className: "gh-grid" }, price.row, categoryField.row),
      h("div", { className: "gh-grid" }, available.row, visible.row),
    ],
    actions: { extra },
    onSubmit: async (dialog) => {
      const values = {
        name: name.input.value.trim(),
        description: optional(description.input.value),
        price: wholeNumber(price.input.value, NaN),
        category_id: categoryField.input.value,
        is_available: available.input.checked,
        is_visible: visible.input.checked,
      };
      if (!values.name) return invalid(dialog, name.input, MESSAGES.nameRequired);
      if (!s.categories.some((c) => c.id === values.category_id)) {
        return invalid(dialog, categoryField.input, MESSAGES.categoryRequired);
      }
      if (Number.isNaN(values.price)) return invalid(dialog, price.input, MESSAGES.priceInvalid);

      const oldPath = item ? item.image_path : null;
      let uploadedPath = null;
      dialog.setBusy(true);
      try {
        // 1. Upload a new image first, so the row never points at a missing file.
        if (file) {
          const upload = await uploadItemImage(s.supabase, restaurantId, file);
          if (upload.error) {
            console.error(upload.error);
            setAlert(dialog.alert, uploadErrorMessage(upload.error));
            return false;
          }
          uploadedPath = upload.data.path;
        }

        // 2. Save the row. A new item, or one moved to another category,
        // goes to the end of that category.
        const imagePath = uploadedPath || (removeImage ? null : oldPath);
        const moved = !item || item.category_id !== values.category_id;
        const fields = {
          category_id: values.category_id,
          name: values.name,
          description: values.description,
          price: values.price,
          is_available: values.is_available,
          sort_order: moved ? nextSortOrder(itemsIn(values.category_id)) : item.sort_order,
          image_path: imagePath,
        };
        if (s.withVisibility) fields.is_visible = values.is_visible;
        const { error } = item
          ? await updateMenuItem(s.supabase, restaurantId, item.id, fields)
          : await createMenuItem(s.supabase, restaurantId, fields);
        if (error) {
          console.error(error);
          if (uploadedPath) await removeItemImage(s.supabase, restaurantId, uploadedPath);
          uploadedPath = null;
          setAlert(dialog.alert, errorMessage(error));
          if (error.code === "denied") reload();
          return false;
        }

        // 3. Only now remove the image it replaced (uploaded files only;
        // images shipped with the site are never touched).
        if (oldPath && oldPath !== imagePath) await removeItemImage(s.supabase, restaurantId, oldPath);
        uploadedPath = null;
        toast(format(MESSAGES.itemSaved, values), "success");
        await reload();
        return true;
      } catch (error) {
        if (uploadedPath) await removeItemImage(s.supabase, restaurantId, uploadedPath);
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

function confirmDeleteItem(item, after) {
  const s = state;
  confirmDelete(format(MESSAGES.deleteItemConfirm, item), async () => {
    const { data, error } = await deleteMenuItem(s.supabase, s.restaurant.id, item.id);
    if (error) {
      console.error(error);
      if (error.code === "denied") reload();
      return errorMessage(error);
    }
    await removeItemImage(s.supabase, s.restaurant.id, data.image_path);
    toast(format(MESSAGES.itemDeleted, item), "success");
    await reload();
    return null;
  }, after);
}

// ---------- Category editor ----------

function openCategoryDialog(category) {
  if (!state || busy) return;
  const s = state;
  const restaurantId = s.restaurant.id;

  const name = field({ label: MESSAGES.categoryName, name: "name", value: category ? category.name : "", maxLength: 80, required: true });
  const icon = field({ label: MESSAGES.icon, name: "icon",
    choices: CATEGORY_ICONS.map((value) => [value, ICON_LABELS[value] || value]),
    value: category && CATEGORY_ICONS.includes(category.icon) ? category.icon : "list" });
  const visible = field({ label: MESSAGES.categoryVisible, name: "is_visible", type: "checkbox",
    checked: category ? category.is_visible !== false : true });

  const extra = [];
  if (category) {
    extra.push(h("button", { type: "button", className: "gh-btn gh-btn-danger", textContent: MESSAGES.deleteCategory,
      onclick: () => confirmDeleteCategory(category, () => api.close()) }));
  }

  const api = createDialog({
    title: category ? MESSAGES.editCategory : MESSAGES.newCategory,
    id: "gh-category-dialog",
    narrow: true,
    body: [name.row, icon.row, visible.row],
    actions: { extra },
    onSubmit: async (dialog) => {
      const values = {
        name: name.input.value.trim(),
        icon: CATEGORY_ICONS.includes(icon.input.value) ? icon.input.value : "list",
        is_visible: visible.input.checked,
      };
      if (!values.name) return invalid(dialog, name.input, MESSAGES.nameRequired);

      dialog.setBusy(true);
      try {
        const fields = Object.assign({}, values, {
          sort_order: category ? category.sort_order : nextSortOrder(s.categories),
        });
        // New categories get a unique, stable slug (used for the page's anchors).
        if (!category) fields.slug = categorySlug(values.name, s.categories.map((c) => c.slug));
        const { error } = category
          ? await updateCategory(s.supabase, restaurantId, category.id, fields)
          : await createCategory(s.supabase, restaurantId, fields);
        if (error) {
          console.error(error);
          setAlert(dialog.alert, errorMessage(error));
          if (error.code === "denied") reload();
          return false;
        }
        toast(format(MESSAGES.categorySaved, values), "success");
        await reload();
        return true;
      } finally {
        dialog.setBusy(false);
      }
    },
  });
  name.input.focus();
}

function confirmDeleteCategory(category, after) {
  if (!state || busy) return;
  const s = state;
  confirmDelete(format(MESSAGES.deleteCategoryConfirm, category), async () => {
    const { error } = await deleteCategory(s.supabase, s.restaurant.id, category.id);
    if (error) {
      console.error(error);
      if (error.code === "23503") return MESSAGES.categoryInUse;
      if (error.code === "denied") reload();
      return errorMessage(error);
    }
    toast(format(MESSAGES.categoryDeleted, category), "success");
    await reload();
    return null;
  }, after);
}

// ---------- Restaurant profile ----------

function validateProfile(values) {
  if (!values.name) return { key: "name", message: MESSAGES.restaurantNameRequired };
  for (const [key, label] of PROFILE_FIELDS) {
    const value = values[key];
    if (value === null) continue;
    if (value.length > PROFILE_LIMITS[key]) {
      return { key, message: format(MESSAGES.fieldTooLong, { label, max: PROFILE_LIMITS[key] }) };
    }
    if (CONTROL_CHARS.test(value)) return { key, message: format(MESSAGES.fieldInvalid, { label }) };
  }
  if (values.phone && !PROFILE_PHONE_PATTERN.test(values.phone)) return { key: "phone", message: MESSAGES.phoneInvalid };
  return null;
}

function profileErrorMessage(error) {
  if (error.code === "PGRST202") return MESSAGES.profileNotEnabled;
  if (error.code === "42501" || error.code === "denied") return MESSAGES.profileForbidden;
  if (error.code === "22023") return MESSAGES.invalidData;
  return errorMessage(error);
}

function openProfileDialog() {
  if (!state || busy) return;
  const s = state;
  const inputs = {};
  const rows = PROFILE_FIELDS.map(([key, label]) => {
    const f = field({ label, name: key, value: s.restaurant[key] || "", maxLength: PROFILE_LIMITS[key],
      dir: key === "phone" ? "ltr" : undefined, inputMode: key === "phone" ? "tel" : undefined, required: key === "name" });
    inputs[key] = f.input;
    return f.row;
  });

  createDialog({
    title: MESSAGES.profileTitle,
    id: "gh-profile-dialog",
    body: [h("p", { className: "gh-muted", textContent: MESSAGES.profileNote }), rows],
    actions: {},
    onSubmit: async (dialog) => {
      const values = {
        name: inputs.name.value.trim(),
        tagline: optional(inputs.tagline.value),
        phone: optional(inputs.phone.value),
        address: optional(inputs.address.value),
        hours: optional(inputs.hours.value),
      };
      const problem = validateProfile(values);
      if (problem) return invalid(dialog, inputs[problem.key], problem.message);
      if (PROFILE_FIELDS.every(([key]) => (s.restaurant[key] || null) === values[key])) {
        toast(MESSAGES.profileUnchanged, "success");
        return true;
      }

      dialog.setBusy(true);
      try {
        const { data, error } = await updateRestaurantProfile(s.supabase, s.restaurant.id, values);
        if (error) {
          console.error(error);
          if (error.code === "22023" && inputs[error.hint]) inputs[error.hint].setAttribute("aria-invalid", "true");
          setAlert(dialog.alert, profileErrorMessage(error));
          return false;
        }
        s.restaurant = data;
        // Re-read the row so the page shows exactly what is stored.
        const fresh = await getMyRestaurants(s.supabase);
        const row = !fresh.error && fresh.restaurants.find((r) => r.id === data.id);
        if (row) s.restaurant = row;
        applyProfile(s.restaurant);
        toast(MESSAGES.profileSaved, "success");
        return true;
      } finally {
        dialog.setBusy(false);
      }
    },
  });
  inputs.name.focus();
}

// ---------- Password ----------

function openPasswordDialog() {
  if (!state || busy) return;
  const s = state;
  const password = field({ label: MESSAGES.newPassword, name: "password", type: "password", autocomplete: "new-password", dir: "ltr" });
  const confirm = field({ label: MESSAGES.confirmPassword, name: "confirm", type: "password", autocomplete: "new-password", dir: "ltr" });
  createDialog({
    title: MESSAGES.passwordTitle,
    id: "gh-password-dialog",
    narrow: true,
    body: [password.row, confirm.row],
    actions: {},
    onSubmit: async (dialog) => {
      if (password.input.value.length < 10) return invalid(dialog, password.input, MESSAGES.passwordShort);
      if (password.input.value !== confirm.input.value) return invalid(dialog, confirm.input, MESSAGES.passwordMismatch);
      dialog.setBusy(true);
      try {
        const { error } = await changePassword(s.supabase, password.input.value);
        if (error) {
          console.error(error);
          setAlert(dialog.alert, MESSAGES.passwordFailed);
          return false;
        }
        toast(MESSAGES.passwordSaved, "success");
        return true;
      } finally {
        dialog.setBusy(false);
      }
    },
  });
  password.input.focus();
}

// ---------- Editing bar ----------

function buildBar() {
  const barButton = (text, onClick, className) =>
    h("button", { type: "button", className: "gh-btn " + (className || ""), textContent: text, onclick: onClick });
  bar = h("div", { className: "gh-bar", id: "gh-bar", role: "region", "aria-label": MESSAGES.barLabel, dir: "rtl", lang: "ar" },
    h("span", { className: "gh-bar-title" }, spriteIcon("flame", 16), MESSAGES.barTitle),
    h("div", { className: "gh-bar-actions" },
      barButton("+ " + MESSAGES.addCategory, () => openCategoryDialog(null), "gh-bar-add"),
      barButton(MESSAGES.profile, openProfileDialog, "gh-bar-profile"),
      barButton(MESSAGES.password, openPasswordDialog, "gh-bar-password"),
      h("a", { className: "gh-btn gh-bar-public", href: publicMenuUrl(state.restaurant.slug), target: "_blank", rel: "noopener" },
        MESSAGES.publicMenu),
      barButton(MESSAGES.logout, logout, "gh-bar-logout"),
      barButton(MESSAGES.done, () => stopEditing(), "gh-btn-primary gh-bar-done")));
  document.body.appendChild(bar);
}

async function logout() {
  const s = state;
  if (!s || busy) return;
  await stopEditing();
  await signOut(s.supabase);
  if (s.onSignedOut) s.onSignedOut();
  toast(MESSAGES.signedOut, "success");
}

// ---------- Public API (used by ../manage-menu.js) ----------

export function isEditing() {
  return Boolean(state);
}

export async function startEditing({ supabase, restaurant, onStop, onSignedOut }) {
  if (state) return;
  state = { supabase, restaurant, categories: [], items: [], withVisibility: false, onStop, onSignedOut };
  setEditing(true);
  document.body.classList.add("gh-editing");
  buildBar();
  toast(MESSAGES.loading);
  const s = state;
  const withVisibility = await supportsItemVisibility(supabase);
  if (state !== s) return;
  s.withVisibility = withVisibility;
  applyProfile(restaurant);
  if (await reload()) toast(MESSAGES.editingOn, "success");
}

// Leaves editing mode and shows the menu exactly as visitors see it.
export async function stopEditing() {
  if (!state) return;
  const { onStop } = state;
  state = null;
  busy = false;
  loadToken++;
  Array.from(openDialogs).forEach((api) => api.close());
  if (bar) bar.remove();
  bar = null;
  document.body.classList.remove("gh-editing", "gh-busy");
  removeToast();
  setEditing(false);
  if (onStop) onStop();
  const status = await loadMenuFromDatabase();
  if (status !== "ok") window.location.reload(); // fall back to the built-in menu
}
