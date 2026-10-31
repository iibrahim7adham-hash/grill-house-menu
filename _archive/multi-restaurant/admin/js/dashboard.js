// Super Admin dashboard: list restaurants and add new ones.
//
// Uses the signed-in user's Supabase client (publishable key + session).
// What an admin may read or insert is decided by Row Level Security in the
// database; this module only renders and validates input.

import { SLUG_PATTERN, publicMenuUrl } from "../../shared/utils/restaurant.js";
import { format } from "../../shared/utils/format.js";
import { loadOwners, renderOwnerBlock, openOwnerDialog, closeOwnerDialog } from "./owners.js";

const PHONE_PATTERN = /^[+0-9\s()-]{5,30}$/;

const MESSAGES = {
  loading: "جارٍ تحميل المطاعم…",
  empty: "لا توجد مطاعم بعد. استخدم زر «إضافة مطعم» لإضافة أول مطعم.",
  loadFailed: "تعذر تحميل قائمة المطاعم. يرجى المحاولة مجدداً.",
  nameRequired: "يرجى إدخال اسم المطعم.",
  slugRequired: "يرجى إدخال المعرّف (slug).",
  slugInvalid:
    "المعرّف (slug) يجب أن يحتوي فقط على أحرف إنجليزية صغيرة وأرقام وشرطات (-)، وأن يبدأ وينتهي بحرف أو رقم.",
  phoneInvalid: "رقم الهاتف غير صالح. استخدم الأرقام والرمز + فقط.",
  saving: "جارٍ الحفظ…",
  saved: "تمت إضافة المطعم «{name}» بنجاح.",
  slugTaken: "المعرّف (slug) «{slug}» مستخدم لمطعم آخر. اختر معرّفاً مختلفاً.",
  forbidden: "لا تملك صلاحية إضافة مطاعم. يرجى تسجيل الدخول بحساب مسؤول النظام.",
  invalidData: "بعض البيانات غير صالحة. يرجى مراجعة الحقول والمحاولة مجدداً.",
  network: "تعذر الاتصال بالخادم. تحقق من الاتصال بالإنترنت وحاول مجدداً.",
  saveFailed: "تعذر حفظ المطعم. يرجى المحاولة مجدداً.",
  published: "منشور",
  unpublished: "غير منشور",
  viewMenu: "عرض المنيو",
  deleteRestaurant: "حذف المطعم",
  deleteConfirm: "حذف نهائي",
  deleting: "جارٍ الحذف…",
  deleted: "تم حذف المطعم «{name}» وجميع بياناته نهائياً.",
  deleteMismatch: "المعرّف المكتوب لا يطابق معرّف المطعم.",
  deleteForbidden: "لا تملك صلاحية حذف المطاعم. هذه العملية متاحة لمسؤولي النظام فقط.",
  deleteNotFound: "هذا المطعم غير موجود، ربما تم حذفه مسبقاً. تم تحديث القائمة.",
  deleteRelated:
    "تعذر الحذف لأن بيانات أخرى مرتبطة بهذا المطعم. لم يتم حذف أي شيء.",
  deleteNotInstalled:
    "ميزة الحذف غير مفعّلة في قاعدة البيانات بعد (الدالة delete_restaurant غير موجودة).",
  deleteFailed: "تعذر حذف المطعم. لم يتم حذف أي شيء. يرجى المحاولة مجدداً.",
};

const el = {
  message: document.getElementById("dashboard-message"),
  addBtn: document.getElementById("add-restaurant-btn"),
  formCard: document.getElementById("restaurant-form-card"),
  form: document.getElementById("restaurant-form"),
  formMessage: document.getElementById("restaurant-form-message"),
  submitBtn: document.getElementById("restaurant-submit"),
  cancelBtn: document.getElementById("restaurant-cancel"),
  listStatus: document.getElementById("restaurant-list-status"),
  list: document.getElementById("restaurant-list"),
  deleteDialog: document.getElementById("delete-dialog"),
  deleteForm: document.getElementById("delete-form"),
  deleteName: document.getElementById("delete-restaurant-name"),
  deleteSlug: document.getElementById("delete-restaurant-slug"),
  deleteInput: document.getElementById("delete-confirm-input"),
  deleteMessage: document.getElementById("delete-message"),
  deleteConfirmBtn: document.getElementById("delete-confirm-btn"),
  deleteCancelBtn: document.getElementById("delete-cancel-btn"),
};

let supabase = null;
let eventsBound = false;
// Incremented on every load/reset so a slow response can't overwrite newer state.
let loadToken = 0;
// Restaurant shown in the delete dialog ({ id, name, slug }), or null.
let pendingDelete = null;
let deleting = false;
// True while a new restaurant is being checked and saved.
let saving = false;

function setAlert(target, text, kind) {
  target.textContent = text || "";
  target.hidden = !text;
  target.classList.toggle("admin-alert-success", kind === "success");
}

// ---------- Restaurant list ----------

function renderRestaurant(restaurant) {
  const item = document.createElement("li");
  item.className = "restaurant-item";

  const head = document.createElement("div");
  head.className = "restaurant-item-head";

  const name = document.createElement("h3");
  name.className = "restaurant-name";
  name.textContent = restaurant.name;

  const badge = document.createElement("span");
  badge.className = "status-badge" + (restaurant.is_published ? " is-published" : "");
  badge.textContent = restaurant.is_published ? MESSAGES.published : MESSAGES.unpublished;

  head.append(name, badge);

  const slug = document.createElement("span");
  slug.className = "restaurant-slug";
  slug.dir = "ltr";
  slug.textContent = restaurant.slug;

  const link = document.createElement("a");
  link.className = "restaurant-link";
  link.href = publicMenuUrl(restaurant.slug);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = MESSAGES.viewMenu;

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "admin-btn admin-btn-small admin-btn-danger-outline";
  deleteBtn.textContent = MESSAGES.deleteRestaurant;
  deleteBtn.addEventListener("click", function () {
    openDeleteDialog(restaurant);
  });

  const actions = document.createElement("div");
  actions.className = "restaurant-item-actions";
  actions.append(link, deleteBtn);

  // Owner email/status, filled in by refreshOwners().
  const owner = document.createElement("div");
  owner.className = "restaurant-owner";
  owners.blocks.set(restaurant.id, { container: owner, restaurant: restaurant });

  item.append(head, slug, owner, actions);
  return item;
}

// ---------- Owners ----------

const owners = { blocks: new Map(), state: null };

function paintOwners() {
  owners.blocks.forEach(function (block) {
    renderOwnerBlock(block.container, block.restaurant, owners.state, function (restaurant) {
      setAlert(el.message, "");
      openOwnerDialog(supabase, restaurant, refreshOwners);
    });
  });
}

async function refreshOwners() {
  const token = loadToken;
  const state = await loadOwners(supabase);
  if (token !== loadToken) return;
  if (state.error) console.error(state.error);
  owners.state = state;
  paintOwners();
}

async function loadRestaurants() {
  const token = ++loadToken;
  el.listStatus.textContent = MESSAGES.loading;

  let result;
  try {
    result = await supabase
      .from("restaurants")
      .select("id, name, slug, is_published, created_at")
      .order("created_at", { ascending: false });
  } catch (error) {
    result = { data: null, error: error };
  }
  if (token !== loadToken) return;

  if (result.error) {
    console.error(result.error);
    el.list.replaceChildren();
    el.listStatus.textContent = MESSAGES.loadFailed;
    return;
  }

  const restaurants = result.data || [];
  owners.blocks.clear();
  el.list.replaceChildren.apply(el.list, restaurants.map(renderRestaurant));
  el.listStatus.textContent = restaurants.length ? "" : MESSAGES.empty;
  if (restaurants.length) refreshOwners();
}

// ---------- Add restaurant form ----------

function field(name) {
  return el.form.elements.namedItem(name);
}

function clearFieldErrors() {
  Array.prototype.forEach.call(el.form.elements, function (input) {
    input.removeAttribute("aria-invalid");
  });
}

function openForm() {
  el.form.reset();
  clearFieldErrors();
  setAlert(el.formMessage, "");
  setAlert(el.message, "");
  el.formCard.hidden = false;
  el.addBtn.hidden = true;
  field("name").focus();
}

function closeForm() {
  el.formCard.hidden = true;
  el.addBtn.hidden = false;
  el.form.reset();
  clearFieldErrors();
  setAlert(el.formMessage, "");
}

function setSaving(busy) {
  saving = busy;
  el.submitBtn.disabled = busy;
  el.cancelBtn.disabled = busy;
  el.submitBtn.textContent = busy ? MESSAGES.saving : "حفظ المطعم";
}

// Empty optional fields are stored as NULL rather than "".
function optional(value) {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function readForm() {
  return {
    name: field("name").value.trim(),
    // Slugs are case-insensitive for the user; store them lowercase.
    slug: field("slug").value.trim().toLowerCase(),
    tagline: optional(field("tagline").value),
    phone: optional(field("phone").value),
    address: optional(field("address").value),
    hours: optional(field("hours").value),
  };
}

// Returns { field, message } for the first invalid field, or null.
function validate(values) {
  if (!values.name) return { field: "name", message: MESSAGES.nameRequired };
  if (!values.slug) return { field: "slug", message: MESSAGES.slugRequired };
  if (!SLUG_PATTERN.test(values.slug)) return { field: "slug", message: MESSAGES.slugInvalid };
  if (values.phone && !PHONE_PATTERN.test(values.phone)) {
    return { field: "phone", message: MESSAGES.phoneInvalid };
  }
  return null;
}

function insertErrorMessage(error, values) {
  if (error.code === "23505") return format(MESSAGES.slugTaken, values);
  if (error.code === "42501") return MESSAGES.forbidden;
  if (error.code === "23514" || error.code === "23502" || error.code === "22001") {
    return MESSAGES.invalidData;
  }
  if (!error.code && /fetch|network/i.test(error.message || "")) return MESSAGES.network;
  return MESSAGES.saveFailed;
}

// Returns { taken, error } for a slug. This only gives an early, friendly
// message; the database's unique constraint (23505) remains the real guard,
// e.g. when two admins pick the same slug at the same moment.
async function checkSlugTaken(slug) {
  const { data, error } = await supabase
    .from("restaurants")
    .select("id")
    .eq("slug", slug)
    .limit(1);
  return { taken: Boolean(data && data.length), error: error };
}

function showSlugTaken(values) {
  const input = field("slug");
  input.setAttribute("aria-invalid", "true");
  input.focus();
  setAlert(el.formMessage, format(MESSAGES.slugTaken, values));
}

async function handleSubmit(event) {
  event.preventDefault();
  if (saving) return;
  clearFieldErrors();
  setAlert(el.formMessage, "");

  const values = readForm();
  const invalid = validate(values);
  if (invalid) {
    const input = field(invalid.field);
    input.setAttribute("aria-invalid", "true");
    input.focus();
    setAlert(el.formMessage, invalid.message);
    return;
  }

  setSaving(true);
  try {
    const check = await checkSlugTaken(values.slug);
    if (check.error) {
      console.error(check.error);
      setAlert(el.formMessage, insertErrorMessage(check.error, values));
      return;
    }
    if (check.taken) {
      showSlugTaken(values);
      return;
    }

    // New restaurants start unpublished: they have no menu yet.
    // No .select() after insert, so saving doesn't depend on read-back rights.
    const { error } = await supabase
      .from("restaurants")
      .insert(Object.assign({}, values, { is_published: false }));
    if (error) {
      console.error(error);
      if (error.code === "23505") {
        showSlugTaken(values);
      } else {
        setAlert(el.formMessage, insertErrorMessage(error, values));
      }
      return;
    }
    closeForm();
    setAlert(el.message, format(MESSAGES.saved, values), "success");
    await loadRestaurants();
  } catch (error) {
    console.error(error);
    setAlert(el.formMessage, MESSAGES.network);
  } finally {
    setSaving(false);
  }
}

// ---------- Delete restaurant ----------

// Deletion is permanent, so the admin must type the restaurant's slug before
// the button enables. The database function re-checks admin rights and the
// slug, and removes the restaurant with its related rows in one transaction.

function openDeleteDialog(restaurant) {
  pendingDelete = { id: restaurant.id, name: restaurant.name, slug: restaurant.slug };
  el.deleteName.textContent = restaurant.name;
  el.deleteSlug.textContent = restaurant.slug;
  el.deleteInput.value = "";
  el.deleteConfirmBtn.disabled = true;
  setAlert(el.deleteMessage, "");
  setAlert(el.message, "");
  el.deleteDialog.showModal();
  el.deleteInput.focus();
}

function closeDeleteDialog() {
  if (el.deleteDialog.open) el.deleteDialog.close();
}

function setDeleting(busy) {
  deleting = busy;
  el.deleteInput.disabled = busy;
  el.deleteCancelBtn.disabled = busy;
  el.deleteConfirmBtn.disabled = busy || !confirmMatches();
  el.deleteConfirmBtn.textContent = busy ? MESSAGES.deleting : MESSAGES.deleteConfirm;
}

function confirmMatches() {
  return pendingDelete !== null && el.deleteInput.value.trim() === pendingDelete.slug;
}

function deleteErrorMessage(error) {
  if (error.code === "42501") return MESSAGES.deleteForbidden;
  if (error.code === "P0002") return MESSAGES.deleteNotFound;
  if (error.code === "22023") return MESSAGES.deleteMismatch;
  if (error.code === "23503") return MESSAGES.deleteRelated;
  if (error.code === "PGRST202") return MESSAGES.deleteNotInstalled;
  if (!error.code && /fetch|network/i.test(error.message || "")) return MESSAGES.network;
  return MESSAGES.deleteFailed;
}

// Errors go in the dialog, or on the dashboard if the dialog was closed
// meanwhile (browsers don't always let a page block the Escape key).
function showDeleteError(text) {
  setAlert(el.deleteDialog.open ? el.deleteMessage : el.message, text);
}

async function handleDelete(event) {
  event.preventDefault();
  if (!pendingDelete || deleting) return;
  if (!confirmMatches()) {
    setAlert(el.deleteMessage, MESSAGES.deleteMismatch);
    return;
  }

  const target = pendingDelete;
  setAlert(el.deleteMessage, "");
  setDeleting(true);
  try {
    const { error } = await supabase.rpc("delete_restaurant", {
      p_restaurant_id: target.id,
      p_confirm_slug: el.deleteInput.value.trim(),
    });
    if (error) {
      console.error(error);
      showDeleteError(deleteErrorMessage(error));
      if (error.code === "P0002") loadRestaurants();
      return;
    }
    closeDeleteDialog();
    setAlert(el.message, format(MESSAGES.deleted, target), "success");
    await loadRestaurants();
  } catch (error) {
    console.error(error);
    showDeleteError(MESSAGES.network);
  } finally {
    setDeleting(false);
  }
}

function bindEvents() {
  el.addBtn.addEventListener("click", openForm);
  el.cancelBtn.addEventListener("click", closeForm);
  el.form.addEventListener("submit", handleSubmit);
  el.form.addEventListener("input", function (event) {
    event.target.removeAttribute("aria-invalid");
  });

  el.deleteForm.addEventListener("submit", handleDelete);
  el.deleteCancelBtn.addEventListener("click", closeDeleteDialog);
  el.deleteInput.addEventListener("input", function () {
    el.deleteConfirmBtn.disabled = deleting || !confirmMatches();
    setAlert(el.deleteMessage, "");
  });
  // Escape closes the dialog, except while a deletion is in progress.
  el.deleteDialog.addEventListener("cancel", function (event) {
    if (deleting) event.preventDefault();
  });
  el.deleteDialog.addEventListener("close", function () {
    pendingDelete = null;
  });
}

// ---------- Public API (called by login.js) ----------

// Shows the dashboard for a verified system admin.
export function showDashboard(client) {
  supabase = client;
  if (!eventsBound) {
    bindEvents();
    eventsBound = true;
  }
  closeForm();
  setAlert(el.message, "");
  loadRestaurants();
}

// Clears everything an admin could see, e.g. after sign-out.
export function resetDashboard() {
  loadToken++;
  closeOwnerDialog();
  owners.blocks.clear();
  owners.state = null;
  closeDeleteDialog();
  closeForm();
  setAlert(el.message, "");
  el.list.replaceChildren();
  el.listStatus.textContent = "";
}
