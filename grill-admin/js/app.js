// Grill House dashboard (/grill-admin/): sign-in, layout and navigation.
//
// Manages one restaurant only: the one named by <meta name="restaurant-slug">.
// Only a member of it may enter (checked by the database through
// shared/auth/restaurant-access.js); any other account is signed out.
// Every read and write is scoped to this restaurant's id and enforced by Row
// Level Security; the checks here only decide what to show.
//
// Sections load inside the same layout and are addressed by the URL hash
// (#home, #categories, #products, #settings, #password).

import { supabase } from "/shared/supabase/client.js";
import { getVerifiedUser, hasStoredSession, signIn, signOut, signInErrorReason } from "/shared/auth/session.js";
import { getRestaurantAccess } from "/shared/auth/restaurant-access.js";
import { listCategories, listMenuItems, supportsItemVisibility } from "/shared/data/menu.js";
import { h, icon, setAlert, toast, closeAllDialogs } from "./ui.js";
import { errorMessage, NETWORK } from "./errors.js";
import { renderCategories, renderProducts } from "./menu-sections.js";
import { renderSettings, renderPassword } from "./account-sections.js";

const SLUG = document.querySelector('meta[name="restaurant-slug"]').getAttribute("content");

const LOGIN_MESSAGES = {
  required: "يرجى إدخال البريد الإلكتروني وكلمة المرور.",
  invalidCredentials: "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
  emailNotConfirmed: "لم يتم تأكيد البريد الإلكتروني لهذا الحساب بعد.",
  rateLimited: "محاولات كثيرة. يرجى الانتظار قليلاً ثم المحاولة مجدداً.",
  network: NETWORK,
  generic: "تعذر تسجيل الدخول. يرجى المحاولة مجدداً.",
  notAuthorized: "هذا الحساب لا يملك صلاحية إدارة مطعم GRILL HOUSE. تم تسجيل الخروج.",
  sessionCheckFailed: "تعذر التحقق من الجلسة السابقة. يرجى تسجيل الدخول.",
  signedOut: "تم تسجيل الخروج.",
  checking: "جارٍ التحقق…",
  submit: "تسجيل الدخول",
};

const SECTIONS = {
  home: { title: "الرئيسية", desc: "مرحباً بك في لوحة تحكم مطعم GRILL HOUSE", render: renderHome },
  categories: { title: "الأقسام", desc: "إضافة الأقسام وتعديلها وترتيبها وإظهارها أو إخفاؤها.", render: renderCategories },
  products: { title: "المنتجات", desc: "إدارة المنتجات والصور والأسعار والتوفر.", render: renderProducts },
  settings: { title: "إعدادات المطعم", desc: "معلومات المطعم وبيانات التواصل الظاهرة في المنيو.", render: renderSettings },
  password: { title: "كلمة المرور", desc: "تغيير كلمة مرور حسابك.", render: renderPassword },
};

// [section, title, description, icon, decorative photo from the public menu's assets]
const ASSETS = "/restaurants/grill-house/assets/";
const HOME_CARDS = [
  ["categories", "الأقسام", "إضافة الأقسام وتعديلها وترتيبها.", "list", ASSETS + "appetizers/hummus.webp"],
  ["products", "المنتجات", "إدارة المنتجات والصور والأسعار والتوفر.", "burger", ASSETS + "burgers/classic-burger.webp"],
  ["settings", "إعدادات المطعم", "معلومات المطعم وبيانات التواصل.", "info", ASSETS + "hero/hero.webp"],
  ["password", "كلمة المرور", "تغيير كلمة مرور الحساب.", "lock", ASSETS + "grills/grilled-beef-fillet.webp"],
];

const $ = (id) => document.getElementById(id);
const el = {
  loading: $("view-loading"),
  login: $("view-login"),
  app: $("view-app"),
  loginForm: $("login-form"),
  loginMessage: $("login-message"),
  loginSubmit: $("login-submit"),
  email: $("user-email"),
  brandName: $("brand-name"),
  storeLink: $("store-link"),
  logout: $("logout-btn"),
  sidebar: $("sidebar"),
  navToggle: $("nav-toggle"),
  navClose: $("nav-close"),
  backdrop: $("nav-backdrop"),
  content: $("content"),
  title: $("page-title"),
  desc: $("page-desc"),
  section: $("section"),
};

// Shared with the section modules.
const ctx = {
  supabase,
  user: null,
  restaurant: null,
  categories: [],
  items: [],
  withVisibility: false,
  loaded: false,           // true once categories and items were read
  reload,
  run,
  refresh: () => renderSection(false),
  setRestaurant(row) {
    ctx.restaurant = row;
    el.brandName.textContent = String(row.name || "GRILL HOUSE").toUpperCase();
  },
};

let current = null;
let busy = false;
let loadToken = 0;

// Upper bound for one round of Auth / database calls. supabase-js can wait
// indefinitely (an unanswered request, its internal session lock), and no
// screen may wait forever.
const REQUEST_TIMEOUT_MS = 15000;

function withTimeout(promise, ms = REQUEST_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("Timed out after " + ms + " ms"), { code: "timeout" })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ---------- Views ----------

function showView(name) {
  el.loading.hidden = name !== "loading";
  el.login.hidden = name !== "login";
  el.app.hidden = name !== "app";
  // Start-up reached a usable screen: stop the guard in index.html.
  if (name !== "loading" && window.grillAdminBoot) window.grillAdminBoot.done();
}

function showLogin(message, kind) {
  closeAllDialogs();
  closeNav();
  ctx.user = null;
  ctx.restaurant = null;
  ctx.categories = [];
  ctx.items = [];
  ctx.loaded = false;
  loadToken++;
  el.loginForm.reset();
  setAlert(el.loginMessage, message || "", kind);
  showView("login");
  el.loginForm.elements.namedItem("email").focus();
}

async function enterApp(access) {
  ctx.user = access.user;
  ctx.setRestaurant(access.restaurant);
  el.email.textContent = access.user.email || "";
  el.email.title = access.user.email || "";
  showView("app");
  el.section.replaceChildren(h("p", { className: "muted", textContent: "جارٍ تحميل البيانات…" }));
  try {
    ctx.withVisibility = await withTimeout(supportsItemVisibility(supabase));
  } catch (error) {
    console.error(error);
    ctx.withVisibility = false;
  }
  try {
    await withTimeout(reload());
  } catch (error) {
    console.error(error);
    toast("تعذر تحميل البيانات. يرجى المحاولة مجدداً.", "error");
  }
  renderSection(false);
}

// ---------- Data ----------

// Reads this restaurant's categories and items. Resolves to true on success.
async function reload() {
  const restaurantId = ctx.restaurant && ctx.restaurant.id;
  if (!restaurantId) return false;
  const token = ++loadToken;
  let results;
  try {
    results = await Promise.all([
      listCategories(supabase, restaurantId),
      listMenuItems(supabase, restaurantId, { withVisibility: ctx.withVisibility }),
    ]);
  } catch (error) {
    results = [{ error }, { error }];
  }
  if (token !== loadToken) return false;
  const [categoryResult, itemResult] = results;
  if (categoryResult.error || itemResult.error) {
    console.error(categoryResult.error || itemResult.error);
    toast("تعذر تحميل البيانات. يرجى المحاولة مجدداً.", "error");
    return false;
  }
  // Defence in depth: never show rows of another restaurant.
  ctx.categories = (categoryResult.data || []).filter((c) => c.restaurant_id === restaurantId);
  ctx.items = (itemResult.data || []).filter((i) => i.restaurant_id === restaurantId);
  ctx.loaded = true;
  return true;
}

// Runs one change at a time and reports failures.
async function run(task) {
  if (busy || !ctx.restaurant) return;
  busy = true;
  document.body.classList.add("is-busy");
  try {
    await task();
  } catch (error) {
    console.error(error);
    toast(errorMessage(error), "error");
  } finally {
    busy = false;
    document.body.classList.remove("is-busy");
  }
}

// ---------- Navigation ----------

function sectionFromHash() {
  const name = window.location.hash.replace(/^#/, "");
  return Object.prototype.hasOwnProperty.call(SECTIONS, name) ? name : "home";
}

function renderSection(focus) {
  if (!ctx.restaurant) return;
  const name = sectionFromHash();
  const section = SECTIONS[name];
  const changed = name !== current;
  current = name;
  el.title.textContent = section.title;
  el.desc.textContent = section.desc;
  document.title = section.title + " — لوحة التحكم — GRILL HOUSE";
  document.querySelectorAll(".nav-link").forEach((link) => {
    if (link.dataset.section === name) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  const y = window.scrollY;
  el.section.replaceChildren();
  section.render(ctx, el.section);
  if (changed) {
    window.scrollTo(0, 0);
    if (focus) el.content.focus({ preventScroll: true });
  } else {
    window.scrollTo(0, y);
  }
}

// Counts come from the rows actually read from the database; nothing is
// shown when they could not be loaded.
function renderHome(context, root) {
  const counts = context.loaded ? {
    categories: context.categories.length + " " + (context.categories.length === 1 ? "قسم" : "أقسام"),
    products: context.items.length + " " + (context.items.length === 1 ? "منتج" : "منتجات"),
  } : {};
  root.append(h("div", { className: "card-grid" }, HOME_CARDS.map(([key, title, desc, iconName, photo]) =>
    h("a", { className: "nav-card", href: "#" + key, "data-card": key, style: "--card-photo: url('" + photo + "')" },
      h("span", { className: "nav-card-icon" }, icon(iconName)),
      h("div", { className: "nav-card-text" },
        h("h2", { className: "nav-card-title", textContent: title }),
        h("p", { className: "nav-card-desc", textContent: desc }),
        counts[key] ? h("span", { className: "nav-card-meta", textContent: counts[key] }) : null),
      icon("arrow", "nav-card-arrow")))));
}

// ---------- Mobile drawer ----------

function openNav() {
  el.sidebar.classList.add("is-open");
  el.backdrop.hidden = false;
  el.navToggle.setAttribute("aria-expanded", "true");
  const active = el.sidebar.querySelector('[aria-current="page"]') || el.sidebar.querySelector(".nav-link");
  if (active) active.focus();
}

function closeNav() {
  if (!el.sidebar.classList.contains("is-open")) return;
  el.sidebar.classList.remove("is-open");
  el.backdrop.hidden = true;
  el.navToggle.setAttribute("aria-expanded", "false");
}

// ---------- Sign-in / sign-out ----------

async function handleLogin(event) {
  event.preventDefault();
  if (busy) return;
  const email = el.loginForm.elements.namedItem("email").value.trim();
  const password = el.loginForm.elements.namedItem("password").value;
  setAlert(el.loginMessage, "");
  if (!email || !password) return setAlert(el.loginMessage, LOGIN_MESSAGES.required);

  busy = true;
  el.loginSubmit.disabled = true;
  el.loginSubmit.textContent = LOGIN_MESSAGES.checking;
  try {
    const { error } = await withTimeout(signIn(supabase, email, password));
    if (error) {
      setAlert(el.loginMessage, LOGIN_MESSAGES[signInErrorReason(error)] || LOGIN_MESSAGES.generic);
      return;
    }
    const access = await withTimeout(getRestaurantAccess(supabase, SLUG));
    if (access.role !== "owner" || !access.restaurant) {
      await withTimeout(signOut(supabase)).catch(() => {});
      el.loginForm.elements.namedItem("password").value = "";
      setAlert(el.loginMessage, LOGIN_MESSAGES.notAuthorized);
      return;
    }
    busy = false;
    await enterApp(access);
  } catch (error) {
    console.error(error);
    setAlert(el.loginMessage, LOGIN_MESSAGES.network);
  } finally {
    busy = false;
    el.loginSubmit.disabled = false;
    el.loginSubmit.textContent = LOGIN_MESSAGES.submit;
  }
}

async function handleLogout() {
  el.logout.disabled = true;
  await signOut(supabase);
  el.logout.disabled = false;
  showLogin(LOGIN_MESSAGES.signedOut, "success");
}

// ---------- Start ----------

function bindEvents() {
  el.loginForm.addEventListener("submit", handleLogin);
  el.logout.addEventListener("click", handleLogout);
  el.navToggle.addEventListener("click", openNav);
  el.navClose.addEventListener("click", closeNav);
  el.backdrop.addEventListener("click", closeNav);
  el.sidebar.addEventListener("click", (event) => {
    if (event.target.closest(".nav-link")) closeNav();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeNav();
  });
  window.addEventListener("hashchange", () => renderSection(true));

  // Signed out in another tab (supabase-js syncs tabs).
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT" && ctx.restaurant) setTimeout(() => showLogin(LOGIN_MESSAGES.signedOut, "success"), 0);
  });
}

// What the stored session (if any) may do here: null when there is no valid
// session, otherwise the result of getRestaurantAccess().
async function checkStoredSession() {
  if (!(await hasStoredSession(supabase))) return null;
  const user = await getVerifiedUser(supabase);
  if (!user) return null;
  return getRestaurantAccess(supabase, SLUG);
}

// Always ends on the sign-in form or the dashboard: errors and timeouts
// lead to the sign-in form with a message.
async function start() {
  bindEvents();
  showView("loading");
  let access = null;
  try {
    access = await withTimeout(checkStoredSession());
  } catch (error) {
    console.error(error);
    return showLogin(error.code === "timeout" ? LOGIN_MESSAGES.network : LOGIN_MESSAGES.sessionCheckFailed);
  }
  if (access && access.role === "owner" && access.restaurant) return enterApp(access);
  if (access && access.user) {
    await withTimeout(signOut(supabase)).catch(() => {});
    return showLogin(LOGIN_MESSAGES.notAuthorized);
  }
  showLogin("");
}

start();
