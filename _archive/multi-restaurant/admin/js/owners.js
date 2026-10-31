// Super Admin: restaurant owner accounts.
//
// Owner accounts are created only by the admin-create-owner Edge Function,
// which runs on the server with the service-role key and re-checks that the
// caller is a system admin. The browser only sends the admin's own session
// token; it never holds a privileged key and never creates accounts itself.
//
// Owner emails and account status come from the admin-only database function
// public.admin_list_restaurant_owners().

import { format } from "../../shared/utils/format.js";

export const CREATE_OWNER_FUNCTION = "admin-create-owner";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MESSAGES = {
  noOwner: "لا يوجد مالك",
  addOwner: "إضافة مالك",
  ownersUnavailable: "تعذر تحميل بيانات المالك.",
  ownersNotInstalled: "بيانات المالكين غير مفعّلة في قاعدة البيانات بعد.",
  statusActive: "نشط",
  statusNeverSignedIn: "لم يسجّل الدخول بعد",
  statusUnconfirmed: "غير مؤكد",
  statusBanned: "موقوف",
  emailRequired: "يرجى إدخال بريد إلكتروني صحيح.",
  passwordShort: "كلمة المرور المؤقتة يجب أن تكون 10 أحرف على الأقل.",
  passwordLong: "كلمة المرور المؤقتة طويلة جداً (72 حرفاً كحد أقصى).",
  creating: "جارٍ الإنشاء…",
  linking: "جارٍ الربط…",
  created: "تم إنشاء حساب المالك {email} وربطه بالمطعم.",
  createdOwnPassword: "تم إنشاء حساب المالك {email} بكلمة المرور التي أدخلتها. أرسلها للمالك بطريقة آمنة.",
  linked: "تم ربط الحساب {email} بالمطعم كمالك.",
  user_exists: "",
  restaurant_has_owner: "هذا المطعم لديه مالك بالفعل.",
  already_member: "هذا الحساب مرتبط بهذا المطعم بالفعل.",
  cannot_link_admin: "لا يمكن ربط حساب مسؤول نظام كمالك مطعم.",
  restaurant_not_found: "المطعم غير موجود، ربما تم حذفه.",
  forbidden: "لا تملك صلاحية إنشاء حسابات المالكين.",
  unauthorized: "انتهت الجلسة. يرجى تسجيل الدخول مجدداً.",
  invalid_email: "البريد الإلكتروني غير صالح.",
  invalid_password: "كلمة المرور غير مقبولة. استخدم 10 أحرف على الأقل.",
  notDeployed: "خدمة إنشاء الحسابات غير منشورة بعد (Edge Function: admin-create-owner).",
  network: "تعذر الاتصال بالخادم. تحقق من الاتصال بالإنترنت وحاول مجدداً.",
  failed: "تعذر إنشاء حساب المالك. لم يتم تغيير أي شيء.",
};

// ---------- Owner list ----------

// Returns { byRestaurant: Map<restaurant_id, member[]>, error, notInstalled }.
export async function loadOwners(supabase) {
  let result;
  try {
    result = await supabase.rpc("admin_list_restaurant_owners");
  } catch (error) {
    result = { data: null, error };
  }
  const byRestaurant = new Map();
  if (result.error) {
    return { byRestaurant, error: result.error, notInstalled: result.error.code === "PGRST202" };
  }
  (result.data || []).forEach(function (member) {
    if (!byRestaurant.has(member.restaurant_id)) byRestaurant.set(member.restaurant_id, []);
    byRestaurant.get(member.restaurant_id).push(member);
  });
  return { byRestaurant, error: null, notInstalled: false };
}

export function accountStatus(member) {
  if (member.banned_until && new Date(member.banned_until) > new Date()) return MESSAGES.statusBanned;
  if (!member.email_confirmed_at) return MESSAGES.statusUnconfirmed;
  if (!member.last_sign_in_at) return MESSAGES.statusNeverSignedIn;
  return MESSAGES.statusActive;
}

// Fills a restaurant card's owner area. `state` is the loadOwners() result,
// or null while loading.
export function renderOwnerBlock(container, restaurant, state, onAddOwner) {
  const nodes = [];
  if (!state) {
    container.replaceChildren();
    return;
  }
  if (state.error) {
    const p = document.createElement("p");
    p.className = "admin-hint";
    p.textContent = state.notInstalled ? MESSAGES.ownersNotInstalled : MESSAGES.ownersUnavailable;
    container.replaceChildren(p);
    return;
  }

  const members = state.byRestaurant.get(restaurant.id) || [];
  members.forEach(function (member) {
    const row = document.createElement("p");
    row.className = "restaurant-owner-row";
    const email = document.createElement("span");
    email.className = "admin-email";
    email.dir = "ltr";
    email.textContent = member.email || member.user_id;
    const status = document.createElement("span");
    status.className = "status-badge";
    status.textContent = accountStatus(member);
    row.append(email, status);
    nodes.push(row);
  });

  if (!members.some((m) => m.role === "owner")) {
    if (!members.length) {
      const none = document.createElement("p");
      none.className = "admin-hint";
      none.textContent = MESSAGES.noOwner;
      nodes.push(none);
    }
    const add = document.createElement("button");
    add.type = "button";
    add.className = "admin-btn admin-btn-small admin-btn-outline";
    add.textContent = MESSAGES.addOwner;
    add.addEventListener("click", () => onAddOwner(restaurant));
    nodes.push(add);
  }
  container.replaceChildren.apply(container, nodes);
}

// ---------- Create owner dialog ----------

const el = {};
let client = null;
let target = null;      // restaurant the dialog is for
let onDone = null;      // called after a successful create/link
let submitting = false;
let bound = false;

function setAlert(node, text) {
  node.textContent = text || "";
  node.hidden = !text;
}

function field(name) {
  return el.form.elements.namedItem(name);
}

function bind() {
  Object.assign(el, {
    dialog: document.getElementById("owner-dialog"),
    form: document.getElementById("owner-form"),
    restaurantName: document.getElementById("owner-restaurant-name"),
    inputs: document.getElementById("owner-inputs"),
    existing: document.getElementById("owner-existing"),
    result: document.getElementById("owner-result"),
    resultText: document.getElementById("owner-result-text"),
    passwordRow: document.getElementById("owner-password-row"),
    password: document.getElementById("owner-password"),
    message: document.getElementById("owner-message"),
    submit: document.getElementById("owner-submit"),
    linkBtn: document.getElementById("owner-link-btn"),
    closeBtn: document.getElementById("owner-close-btn"),
  });
  el.form.addEventListener("submit", function (event) {
    event.preventDefault();
    submit(false);
  });
  el.linkBtn.addEventListener("click", () => submit(true));
  el.closeBtn.addEventListener("click", closeOwnerDialog);
  el.form.addEventListener("input", function () {
    // Editing the email after a "user exists" answer cancels the link offer.
    el.existing.hidden = true;
    el.linkBtn.hidden = true;
    el.submit.hidden = false;
  });
  el.dialog.addEventListener("cancel", (event) => { if (submitting) event.preventDefault(); });
  el.dialog.addEventListener("close", function () {
    // Never keep a temporary password on the page after the dialog closes.
    el.password.textContent = "";
    target = null;
  });
  bound = true;
}

export function openOwnerDialog(supabase, restaurant, afterSuccess) {
  if (!bound) bind();
  client = supabase;
  target = restaurant;
  onDone = afterSuccess;
  el.form.reset();
  el.restaurantName.textContent = restaurant.name;
  el.inputs.hidden = false;
  el.existing.hidden = true;
  el.result.hidden = true;
  el.passwordRow.hidden = true;
  el.password.textContent = "";
  el.submit.hidden = false;
  el.linkBtn.hidden = true;
  setAlert(el.message, "");
  setBusy(false);
  if (typeof el.dialog.showModal === "function") el.dialog.showModal();
  else el.dialog.setAttribute("open", "");
  field("email").focus();
}

export function closeOwnerDialog() {
  if (submitting) return;
  if (el.dialog && el.dialog.open) el.dialog.close();
}

function setBusy(busy, linking) {
  submitting = busy;
  el.submit.disabled = busy;
  el.linkBtn.disabled = busy;
  el.closeBtn.disabled = busy;
  el.submit.textContent = busy && !linking ? MESSAGES.creating : "إنشاء الحساب";
  el.linkBtn.textContent = busy && linking ? MESSAGES.linking : "نعم، اربط الحساب الموجود";
}

// Same rules as the server; the server validates again.
export function validateOwnerForm(email, password) {
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) return MESSAGES.emailRequired;
  if (password && password.length < 10) return MESSAGES.passwordShort;
  if (password && password.length > 72) return MESSAGES.passwordLong;
  return null;
}

// Reads the JSON error body of a failed function call.
async function functionError(error) {
  const response = error && error.context;
  if (response && typeof response.json === "function") {
    try {
      const body = await response.json();
      return { status: response.status, code: body && body.code };
    } catch {
      return { status: response.status, code: null };
    }
  }
  return { status: 0, code: null };
}

async function submit(linkExisting) {
  if (submitting || !target) return;
  setAlert(el.message, "");

  const email = field("email").value.trim().toLowerCase();
  const password = field("password").value;
  const invalid = validateOwnerForm(email, password);
  if (invalid) {
    setAlert(el.message, invalid);
    return;
  }

  const restaurant = target;
  setBusy(true, linkExisting);
  try {
    const body = { restaurant_id: restaurant.id, email: email, link_existing: linkExisting };
    if (password && !linkExisting) body.password = password;

    const { data, error } = await client.functions.invoke(CREATE_OWNER_FUNCTION, { body });
    if (error) {
      const info = await functionError(error);
      console.error(error, info);
      if (info.code === "user_exists" && !linkExisting) {
        el.existing.hidden = false;
        el.linkBtn.hidden = false;
        el.submit.hidden = true;
        return;
      }
      if (info.code && MESSAGES[info.code]) setAlert(el.message, MESSAGES[info.code]);
      else if (info.status === 404) setAlert(el.message, MESSAGES.notDeployed);
      // supabase-js reports "could not reach the function" as FunctionsFetchError.
      else if (error.name === "FunctionsFetchError" || /fetch|network|send a request/i.test(error.message || "")) {
        setAlert(el.message, MESSAGES.network);
      }
      else setAlert(el.message, MESSAGES.failed);
      return;
    }

    el.inputs.hidden = true;
    el.existing.hidden = true;
    el.submit.hidden = true;
    el.linkBtn.hidden = true;
    field("password").value = "";
    el.result.hidden = false;
    if (data && data.status === "linked") {
      el.resultText.textContent = format(MESSAGES.linked, { email });
    } else if (data && data.temporary_password) {
      el.resultText.textContent = format(MESSAGES.created, { email });
      el.password.textContent = data.temporary_password;
      el.passwordRow.hidden = false;
    } else {
      el.resultText.textContent = format(MESSAGES.createdOwnPassword, { email });
    }
    if (onDone) onDone();
  } catch (error) {
    console.error(error);
    setAlert(el.message, MESSAGES.network);
  } finally {
    setBusy(false);
  }
}
