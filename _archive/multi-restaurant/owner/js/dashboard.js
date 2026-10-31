// Owner dashboard: restaurant information, categories and menu items.
//
// Uses the signed-in owner's Supabase client (publishable key + session).
// Every query is scoped to the selected restaurant's id, and Row Level
// Security in the database enforces that an owner can only read or change
// restaurants they are a member of. This module only renders and validates.

import {
  listCategories, createCategory, updateCategory, deleteCategory,
  listMenuItems, createMenuItem, updateMenuItem, setMenuItemAvailability, deleteMenuItem,
  checkImageFile, uploadItemImage, removeItemImage, menuImageUrl,
  categorySlug, CATEGORY_ICONS,
} from "../../shared/data/menu.js?v=20261031-3";
import { updateRestaurantProfile, PROFILE_LIMITS, PROFILE_PHONE_PATTERN } from "../../shared/data/restaurants.js?v=20261031-3";
import { getMyRestaurants } from "../../shared/auth/authorization.js?v=20261031-3";
import { publicMenuUrl } from "../../shared/utils/restaurant.js?v=20261031-3";
import { format, formatPrice } from "../../shared/utils/format.js?v=20261031-3";

const MESSAGES = {
  loading: "جارٍ التحميل…",
  loadFailed: "تعذر تحميل بيانات المنيو. يرجى المحاولة مجدداً.",
  noCategories: "لا توجد أقسام بعد. أضف قسماً لتبدأ بإضافة الأصناف.",
  noItems: "لا توجد أصناف بعد.",
  needCategory: "أضف قسماً أولاً قبل إضافة الأصناف.",
  published: "منشور",
  unpublished: "غير منشور",
  available: "متوفر",
  unavailable: "غير متوفر",
  makeAvailable: "إتاحة",
  makeUnavailable: "إيقاف",
  edit: "تعديل",
  delete: "حذف",
  uncategorized: "بدون قسم",
  hiddenCategory: "مخفي من المنيو العام",
  saving: "جارٍ الحفظ…",
  deleting: "جارٍ الحذف…",
  nameRequired: "يرجى إدخال الاسم.",
  categoryRequired: "يرجى اختيار القسم.",
  priceInvalid: "يرجى إدخال سعر صحيح (رقم صحيح لا يقل عن صفر).",
  sortInvalid: "الترتيب يجب أن يكون رقماً صحيحاً لا يقل عن صفر.",
  imageType: "نوع الصورة غير مدعوم. استخدم JPG أو PNG أو WebP.",
  imageSize: "حجم الصورة أكبر من 5 ميغابايت.",
  uploadDenied: "تم رفض رفع الصورة. تحقق من صلاحيات التخزين لهذا المطعم.",
  uploadFailed: "تعذر رفع الصورة. يرجى المحاولة مجدداً.",
  categorySaved: "تم حفظ القسم «{name}».",
  categoryDeleted: "تم حذف القسم «{name}».",
  categoryInUse: "لا يمكن حذف هذا القسم لأنه يحتوي على أصناف. انقل الأصناف أو احذفها أولاً.",
  itemSaved: "تم حفظ الصنف «{name}».",
  itemDeleted: "تم حذف الصنف «{name}».",
  deleteCategoryConfirm: "هل تريد حذف القسم «{name}»؟",
  deleteItemConfirm: "هل تريد حذف الصنف «{name}»؟ لا يمكن التراجع عن الحذف.",
  denied: "العنصر غير موجود أو لا تملك صلاحية تعديله. تم تحديث القائمة.",
  forbidden: "لا تملك صلاحية تنفيذ هذه العملية.",
  duplicate: "يوجد عنصر بنفس البيانات مسبقاً.",
  invalidData: "بعض البيانات غير صالحة. يرجى مراجعة الحقول.",
  network: "تعذر الاتصال بالخادم. تحقق من الاتصال بالإنترنت وحاول مجدداً.",
  saveFailed: "تعذر حفظ التغييرات. يرجى المحاولة مجدداً.",
  passwordShort: "كلمة المرور يجب أن تكون 10 أحرف على الأقل.",
  passwordMismatch: "كلمتا المرور غير متطابقتين.",
  passwordSaved: "تم تحديث كلمة المرور.",
  passwordFailed: "تعذر تحديث كلمة المرور. يرجى المحاولة مجدداً.",
  newCategory: "إضافة قسم",
  newItem: "صنف جديد",
  editItem: "تعديل الصنف",
  restaurantNameRequired: "يرجى إدخال اسم المطعم.",
  fieldTooLong: "حقل «{label}» أطول من الحد المسموح ({max} حرفاً).",
  fieldInvalid: "حقل «{label}» يحتوي على أحرف غير مسموحة.",
  phoneInvalid: "رقم الهاتف غير صالح. استخدم الأرقام والمسافات والرموز + - ( ) فقط (5 إلى 30 خانة).",
  profileSaved: "تم حفظ معلومات المطعم «{name}».",
  profileUnchanged: "لم يتم تغيير أي معلومات.",
  profileForbidden: "لا تملك صلاحية تعديل معلومات هذا المطعم.",
  profileUnavailable: "لا توجد بيانات مطعم محمّلة لتعديلها. أعد تحميل الصفحة.",
  profileNotEnabled: "تعديل معلومات المطعم غير مفعّل في قاعدة البيانات بعد. تواصل مع مسؤول النظام.",
};

const INFO_FIELDS = [
  ["name", "الاسم"],
  ["slug", "المعرّف"],
  ["tagline", "الشعار النصي"],
  ["phone", "الهاتف"],
  ["address", "العنوان"],
  ["hours", "ساعات العمل"],
];

// The only restaurant columns an owner may edit (see update_my_restaurant_profile).
const PROFILE_FIELDS = ["name", "tagline", "phone", "address", "hours"];
const FIELD_LABELS = Object.fromEntries(INFO_FIELDS);
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

const $ = (id) => document.getElementById(id);
const el = {
  message: $("dashboard-message"),
  title: $("restaurant-title"),
  switcher: $("restaurant-switcher"),
  select: $("restaurant-select"),
  status: $("restaurant-status"),
  info: $("restaurant-info"),
  publicLink: $("restaurant-public-link"),
  editProfileBtn: $("edit-profile-btn"),
  profileForm: $("profile-form"),
  profileFormMessage: $("profile-form-message"),
  profileSubmit: $("profile-submit"),
  profileCancel: $("profile-cancel"),
  addCategoryBtn: $("add-category-btn"),
  categoryForm: $("category-form"),
  categoryFormMessage: $("category-form-message"),
  categorySubmit: $("category-submit"),
  categoryCancel: $("category-cancel"),
  categoryStatus: $("category-list-status"),
  categoryList: $("category-list"),
  addItemBtn: $("add-item-btn"),
  itemStatus: $("item-list-status"),
  itemGroups: $("item-groups"),
  itemDialog: $("item-dialog"),
  itemDialogTitle: $("item-dialog-title"),
  itemForm: $("item-form"),
  itemFormMessage: $("item-form-message"),
  itemSubmit: $("item-submit"),
  itemCancel: $("item-cancel"),
  itemPreview: $("item-image-preview"),
  itemRemoveImageRow: $("item-remove-image-row"),
  confirmDialog: $("confirm-dialog"),
  confirmForm: $("confirm-form"),
  confirmText: $("confirm-text"),
  confirmMessage: $("confirm-message"),
  confirmOk: $("confirm-ok"),
  confirmCancel: $("confirm-cancel"),
  passwordForm: $("password-form"),
  passwordMessage: $("password-message"),
  passwordSubmit: $("password-submit"),
};

let supabase = null;
let eventsBound = false;
let restaurants = [];
let current = null;          // selected restaurant row
let categories = [];
let items = [];
let loadToken = 0;           // newer loads win over slower, older ones
let editingCategory = null;  // category being edited, or null for "new"
let editingItem = null;      // item being edited, or null for "new"
let pendingConfirm = null;   // async function run when the delete is confirmed
const busy = { profile: false, category: false, item: false, confirm: false, password: false, toggle: new Set() };

// ---------- Helpers ----------

function setAlert(target, text, kind) {
  target.textContent = text || "";
  target.hidden = !text;
  target.classList.toggle("admin-alert-success", kind === "success");
}

function button(label, className, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "admin-btn admin-btn-small " + className;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function optional(value) {
  const trimmed = value.trim();
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

// ---------- Restaurant ----------

function renderSwitcher() {
  el.select.replaceChildren.apply(el.select, restaurants.map(function (r) {
    const option = document.createElement("option");
    option.value = r.id;
    option.textContent = r.name;
    return option;
  }));
  el.switcher.hidden = restaurants.length < 2;
}

function renderInfo() {
  el.title.textContent = current.name;
  el.status.textContent = current.is_published ? MESSAGES.published : MESSAGES.unpublished;
  el.status.classList.toggle("is-published", Boolean(current.is_published));

  const nodes = [];
  INFO_FIELDS.forEach(function ([key, label]) {
    if (current[key] === null || current[key] === undefined || current[key] === "") return;
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = current[key];
    if (key === "slug" || key === "phone") dd.dir = "ltr";
    nodes.push(dt, dd);
  });
  el.info.replaceChildren.apply(el.info, nodes);
  el.publicLink.href = publicMenuUrl(current.slug);
}

function selectRestaurant(id) {
  current = restaurants.find((r) => r.id === id) || restaurants[0];
  el.select.value = current.id;
  closeProfileForm();
  closeCategoryForm();
  closeItemDialog();
  setAlert(el.message, "");
  renderInfo();
  loadMenu();
}

// ---------- Restaurant profile ----------

function profileField(name) {
  return el.profileForm.elements.namedItem(name);
}

function clearProfileInvalid() {
  PROFILE_FIELDS.forEach((key) => profileField(key).removeAttribute("aria-invalid"));
}

function openProfileForm() {
  if (!current) {
    setAlert(el.message, MESSAGES.profileUnavailable);
    return;
  }
  el.profileForm.reset();
  clearProfileInvalid();
  setAlert(el.profileFormMessage, "");
  setAlert(el.message, "");
  PROFILE_FIELDS.forEach((key) => { profileField(key).value = current[key] || ""; });
  el.profileForm.hidden = false;
  el.editProfileBtn.hidden = true;
  profileField("name").focus();
}

function closeProfileForm() {
  el.profileForm.reset();
  clearProfileInvalid();
  el.profileForm.hidden = true;
  el.editProfileBtn.hidden = false;
  setAlert(el.profileFormMessage, "");
}

function setProfileBusy(value) {
  busy.profile = value;
  el.profileSubmit.disabled = value;
  el.profileCancel.disabled = value;
  el.profileSubmit.textContent = value ? MESSAGES.saving : "حفظ المعلومات";
}

function readProfileForm() {
  return {
    name: profileField("name").value.trim(),
    tagline: optional(profileField("tagline").value),
    phone: optional(profileField("phone").value),
    address: optional(profileField("address").value),
    hours: optional(profileField("hours").value),
  };
}

// Returns { field, message } for the first invalid field, or null.
// The database function repeats these checks.
function validateProfile(values) {
  if (!values.name) return { field: "name", message: MESSAGES.restaurantNameRequired };
  for (const key of PROFILE_FIELDS) {
    const value = values[key];
    if (value === null) continue;
    if (value.length > PROFILE_LIMITS[key]) {
      return { field: key, message: format(MESSAGES.fieldTooLong, { label: FIELD_LABELS[key], max: PROFILE_LIMITS[key] }) };
    }
    if (CONTROL_CHARS.test(value)) {
      return { field: key, message: format(MESSAGES.fieldInvalid, { label: FIELD_LABELS[key] }) };
    }
  }
  if (values.phone && !PROFILE_PHONE_PATTERN.test(values.phone)) {
    return { field: "phone", message: MESSAGES.phoneInvalid };
  }
  return null;
}

function profileErrorMessage(error) {
  if (error.code === "PGRST202") return MESSAGES.profileNotEnabled;
  if (error.code === "42501" || error.code === "denied") return MESSAGES.profileForbidden;
  if (error.code === "22023") return MESSAGES.invalidData;
  return errorMessage(error);
}

// Replaces one restaurant row in the local state.
function applyRestaurant(row) {
  restaurants = restaurants.map((r) => (r.id === row.id ? row : r));
  if (current && current.id === row.id) current = row;
}

// Shows the saved row at once, then re-reads it from the database so the
// dashboard reflects exactly what is stored.
async function refreshRestaurantInfo(savedRow) {
  applyRestaurant(savedRow);
  try {
    const { restaurants: fresh, error } = await getMyRestaurants(supabase);
    if (error) console.error(error);
    const row = !error && fresh.find((r) => r.id === savedRow.id);
    if (row) applyRestaurant(row);
  } catch (error) {
    console.error(error);
  }
  if (!current) return;
  renderSwitcher();
  el.select.value = current.id;
  renderInfo();
}

async function handleProfileSubmit(event) {
  event.preventDefault();
  if (busy.profile || !current) return;
  setAlert(el.profileFormMessage, "");
  clearProfileInvalid();

  const values = readProfileForm();
  const invalid = validateProfile(values);
  if (invalid) {
    profileField(invalid.field).setAttribute("aria-invalid", "true");
    setAlert(el.profileFormMessage, invalid.message);
    profileField(invalid.field).focus();
    return;
  }

  const editing = current;
  if (PROFILE_FIELDS.every((key) => (editing[key] || null) === values[key])) {
    closeProfileForm();
    setAlert(el.message, MESSAGES.profileUnchanged, "success");
    return;
  }

  setProfileBusy(true);
  try {
    const { data, error } = await updateRestaurantProfile(supabase, editing.id, values);
    if (error) {
      console.error(error);
      if (error.code === "22023" && PROFILE_FIELDS.includes(error.hint)) {
        profileField(error.hint).setAttribute("aria-invalid", "true");
      }
      setAlert(el.profileFormMessage, profileErrorMessage(error));
      return;
    }
    // The owner may have switched restaurant while this was saving.
    if (current && current.id === editing.id) closeProfileForm();
    await refreshRestaurantInfo(data);
    if (current) setAlert(el.message, format(MESSAGES.profileSaved, data), "success");
  } catch (error) {
    console.error(error);
    setAlert(el.profileFormMessage, MESSAGES.network);
  } finally {
    setProfileBusy(false);
  }
}

// ---------- Loading ----------

async function loadMenu() {
  const token = ++loadToken;
  const restaurantId = current.id;
  categories = [];
  items = [];
  el.categoryList.replaceChildren();
  el.itemGroups.replaceChildren();
  el.categoryStatus.textContent = MESSAGES.loading;
  el.itemStatus.textContent = MESSAGES.loading;

  let results;
  try {
    results = await Promise.all([listCategories(supabase, restaurantId), listMenuItems(supabase, restaurantId)]);
  } catch (error) {
    results = [{ error }, { error }];
  }
  if (token !== loadToken) return;

  const [catResult, itemResult] = results;
  if (catResult.error || itemResult.error) {
    console.error(catResult.error || itemResult.error);
    el.categoryStatus.textContent = MESSAGES.loadFailed;
    el.itemStatus.textContent = MESSAGES.loadFailed;
    return;
  }

  // Defence in depth: never render rows of another restaurant, even if a
  // policy were misconfigured to return them.
  categories = (catResult.data || []).filter((c) => c.restaurant_id === restaurantId);
  items = (itemResult.data || []).filter((i) => i.restaurant_id === restaurantId);
  renderCategories();
  renderItems();
}

// ---------- Categories ----------

function renderCategories() {
  el.categoryStatus.textContent = categories.length ? "" : MESSAGES.noCategories;
  el.categoryList.replaceChildren.apply(el.categoryList, categories.map(function (category) {
    const li = document.createElement("li");
    li.className = "owner-row";
    li.dataset.id = category.id;

    const main = document.createElement("div");
    main.className = "owner-row-text";
    const title = document.createElement("span");
    title.className = "owner-row-title";
    title.textContent = category.name;
    const meta = document.createElement("span");
    meta.className = "owner-row-meta";
    const count = items.filter((i) => i.category_id === category.id).length;
    meta.textContent = "الترتيب: " + category.sort_order + " · الأصناف: " + count
      + (category.is_visible === false ? " · " + MESSAGES.hiddenCategory : "");
    main.append(title, meta);

    const actions = document.createElement("div");
    actions.className = "owner-row-actions";
    actions.append(
      button(MESSAGES.edit, "admin-btn-outline", () => openCategoryForm(category)),
      button(MESSAGES.delete, "admin-btn-danger-outline", () => confirmDeleteCategory(category)),
    );

    li.append(main, actions);
    return li;
  }));
  el.addItemBtn.disabled = categories.length === 0;
}

function categoryField(name) {
  return el.categoryForm.elements.namedItem(name);
}

function openCategoryForm(category) {
  editingCategory = category || null;
  el.categoryForm.reset();
  setAlert(el.categoryFormMessage, "");
  categoryField("name").value = category ? category.name : "";
  categoryField("sort_order").value = category ? category.sort_order : nextSortOrder(categories);
  categoryField("icon").value = category && CATEGORY_ICONS.includes(category.icon) ? category.icon : "list";
  categoryField("is_visible").checked = category ? category.is_visible !== false : true;
  el.categoryForm.hidden = false;
  el.addCategoryBtn.hidden = true;
  categoryField("name").focus();
}

function closeCategoryForm() {
  editingCategory = null;
  el.categoryForm.reset();
  el.categoryForm.hidden = true;
  el.addCategoryBtn.hidden = false;
  setAlert(el.categoryFormMessage, "");
}

function setCategoryBusy(value) {
  busy.category = value;
  el.categorySubmit.disabled = value;
  el.categoryCancel.disabled = value;
  el.categorySubmit.textContent = value ? MESSAGES.saving : "حفظ القسم";
}

async function handleCategorySubmit(event) {
  event.preventDefault();
  if (busy.category || !current) return;
  setAlert(el.categoryFormMessage, "");

  const name = categoryField("name").value.trim();
  const sortOrder = wholeNumber(categoryField("sort_order").value, nextSortOrder(categories));
  if (!name) {
    setAlert(el.categoryFormMessage, MESSAGES.nameRequired);
    categoryField("name").focus();
    return;
  }
  if (Number.isNaN(sortOrder)) {
    setAlert(el.categoryFormMessage, MESSAGES.sortInvalid);
    return;
  }

  const restaurantId = current.id;
  const editing = editingCategory;
  setCategoryBusy(true);
  try {
    const icon = categoryField("icon").value;
    const fields = {
      name,
      sort_order: sortOrder,
      icon: CATEGORY_ICONS.includes(icon) ? icon : "list",
      is_visible: categoryField("is_visible").checked,
    };
    // New categories get a unique, stable slug (used for public menu anchors).
    if (!editing) fields.slug = categorySlug(name, categories.map((c) => c.slug));
    const { error } = editing
      ? await updateCategory(supabase, restaurantId, editing.id, fields)
      : await createCategory(supabase, restaurantId, fields);
    if (error) {
      console.error(error);
      setAlert(el.categoryFormMessage, errorMessage(error));
      if (error.code === "denied") loadMenu();
      return;
    }
    closeCategoryForm();
    setAlert(el.message, format(MESSAGES.categorySaved, { name }), "success");
    await loadMenu();
  } catch (error) {
    console.error(error);
    setAlert(el.categoryFormMessage, MESSAGES.network);
  } finally {
    setCategoryBusy(false);
  }
}

function confirmDeleteCategory(category) {
  openConfirm(format(MESSAGES.deleteCategoryConfirm, category), async function () {
    const { error } = await deleteCategory(supabase, current.id, category.id);
    if (error) {
      if (error.code === "23503") return MESSAGES.categoryInUse;
      if (error.code === "denied") loadMenu();
      return errorMessage(error);
    }
    setAlert(el.message, format(MESSAGES.categoryDeleted, category), "success");
    await loadMenu();
    return null;
  });
}

// ---------- Menu items ----------

function renderItems() {
  el.itemStatus.textContent = items.length ? "" : (categories.length ? MESSAGES.noItems : MESSAGES.needCategory);

  const groups = categories.map((c) => ({ title: c.name, rows: items.filter((i) => i.category_id === c.id) }));
  const known = new Set(categories.map((c) => c.id));
  const orphans = items.filter((i) => !known.has(i.category_id));
  if (orphans.length) groups.push({ title: MESSAGES.uncategorized, rows: orphans });

  el.itemGroups.replaceChildren.apply(el.itemGroups, groups.filter((g) => g.rows.length).map(function (group) {
    const section = document.createElement("section");
    const heading = document.createElement("h3");
    heading.className = "owner-group-title";
    heading.textContent = group.title;
    const list = document.createElement("ul");
    list.className = "owner-list";
    list.append.apply(list, group.rows.map(renderItem));
    section.append(heading, list);
    return section;
  }));
}

function renderItem(item) {
  const li = document.createElement("li");
  li.className = "owner-row";
  li.dataset.id = item.id;

  const main = document.createElement("div");
  main.className = "owner-row-main";
  if (item.image_path) {
    const img = document.createElement("img");
    img.className = "owner-thumb";
    img.alt = "";
    img.loading = "lazy";
    img.src = menuImageUrl(supabase, item.image_path);
    main.append(img);
  }
  const text = document.createElement("div");
  text.className = "owner-row-text";
  const title = document.createElement("span");
  title.className = "owner-row-title";
  title.textContent = item.name;
  const meta = document.createElement("span");
  meta.className = "owner-row-meta";
  meta.textContent = formatPrice(item.price) + (item.description ? " · " + item.description : "");
  text.append(title, meta);
  main.append(text);

  const badge = document.createElement("span");
  badge.className = "status-badge" + (item.is_available ? " is-published" : " is-unavailable");
  badge.textContent = item.is_available ? MESSAGES.available : MESSAGES.unavailable;

  const actions = document.createElement("div");
  actions.className = "owner-row-actions";
  const toggle = button(item.is_available ? MESSAGES.makeUnavailable : MESSAGES.makeAvailable,
    "admin-btn-outline", () => toggleAvailability(item, toggle));
  toggle.disabled = busy.toggle.has(item.id);
  actions.append(
    badge,
    toggle,
    button(MESSAGES.edit, "admin-btn-outline", () => openItemDialog(item)),
    button(MESSAGES.delete, "admin-btn-danger-outline", () => confirmDeleteItem(item)),
  );

  li.append(main, actions);
  return li;
}

async function toggleAvailability(item, control) {
  if (busy.toggle.has(item.id)) return;
  busy.toggle.add(item.id);
  control.disabled = true;
  try {
    const { error } = await setMenuItemAvailability(supabase, current.id, item.id, !item.is_available);
    if (error) {
      console.error(error);
      setAlert(el.message, errorMessage(error));
    }
    await loadMenu();
  } catch (error) {
    console.error(error);
    setAlert(el.message, MESSAGES.network);
  } finally {
    busy.toggle.delete(item.id);
    control.disabled = false;
  }
}

function itemField(name) {
  return el.itemForm.elements.namedItem(name);
}

function openItemDialog(item) {
  if (!categories.length) {
    setAlert(el.message, MESSAGES.needCategory);
    return;
  }
  editingItem = item || null;
  el.itemForm.reset();
  setAlert(el.itemFormMessage, "");
  el.itemDialogTitle.textContent = item ? MESSAGES.editItem : MESSAGES.newItem;

  const select = itemField("category_id");
  select.replaceChildren.apply(select, categories.map(function (c) {
    const option = document.createElement("option");
    option.value = c.id;
    option.textContent = c.name;
    return option;
  }));

  itemField("name").value = item ? item.name : "";
  select.value = item && categories.some((c) => c.id === item.category_id) ? item.category_id : categories[0].id;
  itemField("description").value = item && item.description ? item.description : "";
  itemField("price").value = item ? item.price : "";
  itemField("sort_order").value = item ? item.sort_order : nextSortOrder(items);
  itemField("is_available").checked = item ? Boolean(item.is_available) : true;

  const hasImage = Boolean(item && item.image_path);
  el.itemPreview.hidden = !hasImage;
  el.itemPreview.src = hasImage ? menuImageUrl(supabase, item.image_path) : "";
  el.itemRemoveImageRow.hidden = !hasImage;

  if (typeof el.itemDialog.showModal === "function") el.itemDialog.showModal();
  else el.itemDialog.setAttribute("open", "");
  itemField("name").focus();
}

function closeItemDialog() {
  editingItem = null;
  if (el.itemDialog.open) el.itemDialog.close();
}

function setItemBusy(value) {
  busy.item = value;
  el.itemSubmit.disabled = value;
  el.itemCancel.disabled = value;
  el.itemSubmit.textContent = value ? MESSAGES.saving : "حفظ الصنف";
}

function readItemForm() {
  const file = itemField("image").files && itemField("image").files[0];
  return {
    name: itemField("name").value.trim(),
    category_id: itemField("category_id").value,
    description: optional(itemField("description").value),
    price: wholeNumber(itemField("price").value, NaN),
    sort_order: wholeNumber(itemField("sort_order").value, nextSortOrder(items)),
    is_available: itemField("is_available").checked,
    file: file || null,
    removeImage: itemField("remove_image").checked,
  };
}

function validateItem(values) {
  if (!values.name) return { field: "name", message: MESSAGES.nameRequired };
  if (!categories.some((c) => c.id === values.category_id)) {
    return { field: "category_id", message: MESSAGES.categoryRequired };
  }
  if (Number.isNaN(values.price)) return { field: "price", message: MESSAGES.priceInvalid };
  if (Number.isNaN(values.sort_order)) return { field: "sort_order", message: MESSAGES.sortInvalid };
  if (values.file) {
    const invalid = checkImageFile(values.file);
    if (invalid) return { field: "image", message: uploadErrorMessage(invalid) };
  }
  return null;
}

async function handleItemSubmit(event) {
  event.preventDefault();
  if (busy.item || !current) return;
  setAlert(el.itemFormMessage, "");
  Array.prototype.forEach.call(el.itemForm.elements, (input) => input.removeAttribute("aria-invalid"));

  const values = readItemForm();
  const invalid = validateItem(values);
  if (invalid) {
    itemField(invalid.field).setAttribute("aria-invalid", "true");
    setAlert(el.itemFormMessage, invalid.message);
    return;
  }

  const restaurantId = current.id;
  const editing = editingItem;
  const oldPath = editing ? editing.image_path : null;
  let uploadedPath = null;

  setItemBusy(true);
  try {
    // 1. Upload a new image first, so the row never points at a missing file.
    if (values.file) {
      const upload = await uploadItemImage(supabase, restaurantId, values.file);
      if (upload.error) {
        console.error(upload.error);
        setAlert(el.itemFormMessage, uploadErrorMessage(upload.error));
        return;
      }
      uploadedPath = upload.data.path;
    }

    // 2. Save the row.
    const imagePath = uploadedPath || (values.removeImage ? null : oldPath);
    const fields = {
      category_id: values.category_id,
      name: values.name,
      description: values.description,
      price: values.price,
      is_available: values.is_available,
      sort_order: values.sort_order,
      image_path: imagePath,
    };
    const { error } = editing
      ? await updateMenuItem(supabase, restaurantId, editing.id, fields)
      : await createMenuItem(supabase, restaurantId, fields);

    if (error) {
      console.error(error);
      if (uploadedPath) await removeItemImage(supabase, restaurantId, uploadedPath);
      setAlert(el.itemFormMessage, errorMessage(error));
      if (error.code === "denied") loadMenu();
      return;
    }

    // 3. Only now remove the image it replaced.
    if (oldPath && oldPath !== imagePath) await removeItemImage(supabase, restaurantId, oldPath);

    closeItemDialog();
    setAlert(el.message, format(MESSAGES.itemSaved, values), "success");
    await loadMenu();
  } catch (error) {
    console.error(error);
    if (uploadedPath) await removeItemImage(supabase, restaurantId, uploadedPath);
    setAlert(el.itemFormMessage, MESSAGES.network);
  } finally {
    setItemBusy(false);
  }
}

function confirmDeleteItem(item) {
  openConfirm(format(MESSAGES.deleteItemConfirm, item), async function () {
    const { data, error } = await deleteMenuItem(supabase, current.id, item.id);
    if (error) {
      if (error.code === "denied") loadMenu();
      return errorMessage(error);
    }
    await removeItemImage(supabase, current.id, data.image_path);
    setAlert(el.message, format(MESSAGES.itemDeleted, item), "success");
    await loadMenu();
    return null;
  });
}

// ---------- Delete confirmation ----------

// `action` resolves to null on success or to an error message.
function openConfirm(text, action) {
  pendingConfirm = action;
  el.confirmText.textContent = text;
  setAlert(el.confirmMessage, "");
  setAlert(el.message, "");
  el.confirmOk.disabled = false;
  if (typeof el.confirmDialog.showModal === "function") el.confirmDialog.showModal();
  else el.confirmDialog.setAttribute("open", "");
}

function closeConfirm() {
  pendingConfirm = null;
  if (el.confirmDialog.open) el.confirmDialog.close();
}

async function handleConfirm(event) {
  event.preventDefault();
  if (busy.confirm || !pendingConfirm) return;
  const action = pendingConfirm;
  busy.confirm = true;
  el.confirmOk.disabled = true;
  el.confirmCancel.disabled = true;
  el.confirmOk.textContent = MESSAGES.deleting;
  try {
    const failure = await action();
    if (failure) setAlert(el.confirmMessage, failure);
    else closeConfirm();
  } catch (error) {
    console.error(error);
    setAlert(el.confirmMessage, MESSAGES.network);
  } finally {
    busy.confirm = false;
    el.confirmOk.disabled = false;
    el.confirmCancel.disabled = false;
    el.confirmOk.textContent = MESSAGES.delete;
  }
}

// ---------- Password ----------

async function handlePasswordSubmit(event) {
  event.preventDefault();
  if (busy.password) return;
  const password = el.passwordForm.elements.namedItem("password").value;
  const confirm = el.passwordForm.elements.namedItem("confirm").value;
  setAlert(el.passwordMessage, "");
  if (password.length < 10) return setAlert(el.passwordMessage, MESSAGES.passwordShort);
  if (password !== confirm) return setAlert(el.passwordMessage, MESSAGES.passwordMismatch);

  busy.password = true;
  el.passwordSubmit.disabled = true;
  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      console.error(error);
      setAlert(el.passwordMessage, MESSAGES.passwordFailed);
      return;
    }
    el.passwordForm.reset();
    setAlert(el.passwordMessage, MESSAGES.passwordSaved, "success");
  } catch (error) {
    console.error(error);
    setAlert(el.passwordMessage, MESSAGES.network);
  } finally {
    busy.password = false;
    el.passwordSubmit.disabled = false;
  }
}

// ---------- Wiring ----------

function bindEvents() {
  el.select.addEventListener("change", () => selectRestaurant(el.select.value));
  el.editProfileBtn.addEventListener("click", openProfileForm);
  el.editProfileBtn.setAttribute("data-ready", "true"); // see the fallback script in owner/index.html
  el.profileCancel.addEventListener("click", closeProfileForm);
  el.profileForm.addEventListener("submit", handleProfileSubmit);
  el.addCategoryBtn.addEventListener("click", () => openCategoryForm(null));
  el.categoryCancel.addEventListener("click", closeCategoryForm);
  el.categoryForm.addEventListener("submit", handleCategorySubmit);
  el.addItemBtn.addEventListener("click", () => openItemDialog(null));
  el.itemCancel.addEventListener("click", closeItemDialog);
  el.itemForm.addEventListener("submit", handleItemSubmit);
  el.itemDialog.addEventListener("cancel", (event) => { if (busy.item) event.preventDefault(); });
  el.itemDialog.addEventListener("close", () => { editingItem = null; });
  el.confirmForm.addEventListener("submit", handleConfirm);
  el.confirmCancel.addEventListener("click", closeConfirm);
  el.confirmDialog.addEventListener("cancel", (event) => { if (busy.confirm) event.preventDefault(); });
  el.confirmDialog.addEventListener("close", () => { pendingConfirm = null; });
  el.passwordForm.addEventListener("submit", handlePasswordSubmit);
}

// Shows the dashboard for a verified owner. `myRestaurants` comes from
// get_my_restaurants(), i.e. only restaurants the database says they belong to.
export function showDashboard(client, myRestaurants) {
  supabase = client;
  restaurants = myRestaurants.slice();
  if (!eventsBound) {
    bindEvents();
    eventsBound = true;
  }
  renderSwitcher();
  selectRestaurant(requestedRestaurantId());
  scrollToRequestedSection();
}

// /owner/?restaurant=<slug> preselects that restaurant (e.g. from a public
// menu's "إدارة المطعم" menu). Only the caller's own restaurants can be
// chosen; anything else falls back to the first one.
function requestedRestaurantId() {
  const slug = new URLSearchParams(window.location.search).get("restaurant");
  const match = slug && restaurants.find((r) => r.slug === slug);
  return match ? match.id : restaurants[0].id;
}

// /owner/#menu-management or #restaurant-profile scrolls to that section.
function scrollToRequestedSection() {
  const id = window.location.hash.slice(1);
  if (!/^[a-z-]+$/.test(id)) return;
  const target = document.getElementById(id);
  if (target && target.classList.contains("owner-anchor") && typeof target.scrollIntoView === "function") {
    target.scrollIntoView({ block: "start" });
  }
}

// Clears everything an owner could see, e.g. after sign-out.
export function resetDashboard() {
  loadToken++;
  closeConfirm();
  closeItemDialog();
  closeProfileForm();
  closeCategoryForm();
  restaurants = [];
  current = null;
  categories = [];
  items = [];
  setAlert(el.message, "");
  el.title.textContent = "";
  el.info.replaceChildren();
  el.select.replaceChildren();
  el.categoryList.replaceChildren();
  el.itemGroups.replaceChildren();
  el.categoryStatus.textContent = "";
  el.itemStatus.textContent = "";
  el.passwordForm.reset();
  setAlert(el.passwordMessage, "");
}
