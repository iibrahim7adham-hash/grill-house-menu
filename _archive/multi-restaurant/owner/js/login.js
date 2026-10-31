// Owner login: Supabase email/password sign-in for restaurant owners.
//
// Access is granted only to accounts that are members of at least one
// restaurant, as reported by the database (public.get_my_restaurants()).
// This page only decides what to *show*; every read and write is enforced by
// Row Level Security, because anything in the browser can be bypassed.
//
// The session is stored by supabase-js in this browser, so a returning owner
// goes straight to the dashboard until they sign out or the session expires.

import { showDashboard, resetDashboard } from "./dashboard.js?v=20261031-3";
import { getVerifiedUser, hasStoredSession, signInErrorReason } from "../../shared/auth/session.js?v=20261031-3";
import { getMyRestaurants, isSystemAdmin } from "../../shared/auth/authorization.js?v=20261031-3";

const shell = document.querySelector(".admin-shell");
const views = {
  loading: document.getElementById("view-loading"),
  login: document.getElementById("view-login"),
  denied: document.getElementById("view-denied"),
  dashboard: document.getElementById("view-dashboard"),
};
const form = document.getElementById("login-form");
const emailInput = document.getElementById("login-email");
const passwordInput = document.getElementById("login-password");
const submitBtn = document.getElementById("login-submit");
const messageEl = document.getElementById("login-message");
const ownerEmailEl = document.getElementById("owner-email");
const logoutBtn = document.getElementById("logout-btn");
const deniedMessageEl = document.getElementById("denied-message");
const deniedAdminHint = document.getElementById("denied-admin-hint");
const deniedLogoutBtn = document.getElementById("denied-logout-btn");

const MESSAGES = {
  missingFields: "يرجى إدخال البريد الإلكتروني وكلمة المرور.",
  invalidCredentials: "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
  emailNotConfirmed: "لم يتم تأكيد البريد الإلكتروني بعد.",
  rateLimited: "محاولات كثيرة. يرجى الانتظار قليلاً ثم المحاولة مجدداً.",
  network: "تعذر الاتصال بالخادم. تحقق من الاتصال بالإنترنت وحاول مجدداً.",
  noRestaurant: "هذا الحساب غير مرتبط بأي مطعم. تواصل مع مسؤول النظام.",
  notEnabled: "لوحة المالك غير مفعّلة في قاعدة البيانات بعد. تواصل مع مسؤول النظام.",
  checkFailed: "تعذر التحقق من الصلاحيات. يرجى المحاولة لاحقاً.",
  notConfigured: "لم يتم إعداد الاتصال بالخادم بشكل صحيح.",
  generic: "حدث خطأ غير متوقع. يرجى المحاولة مجدداً.",
};

let signingIn = false;

function showView(name) {
  Object.keys(views).forEach(function (key) {
    views[key].hidden = key !== name;
  });
  shell.classList.toggle("is-wide", name === "dashboard");
  document.title = name === "dashboard" ? "لوحة المطعم" : "لوحة المطعم — تسجيل الدخول";
}

function setMessage(text) {
  messageEl.textContent = text || "";
  messageEl.hidden = !text;
}

function setBusy(busy) {
  signingIn = busy;
  submitBtn.disabled = busy;
  submitBtn.textContent = busy ? "جارٍ الدخول…" : "دخول";
}

function showLogin(message) {
  resetDashboard();
  ownerEmailEl.textContent = "";
  showView("login");
  setMessage(message || "");
}

let supabase;
try {
  ({ supabase } = await import("../../shared/supabase/client.js?v=20261031-3"));
} catch (error) {
  console.error(error);
  showView("login");
  setMessage(MESSAGES.notConfigured);
  submitBtn.disabled = true;
}

// Verifies the session with the Supabase Auth server, then asks the database
// which restaurants this user may manage. No restaurant -> no dashboard.
async function enterOwnerArea() {
  const user = await getVerifiedUser(supabase);
  if (!user) {
    showLogin();
    return;
  }

  const { restaurants, error } = await getMyRestaurants(supabase);
  if (error) {
    console.error(error);
    if (error.code === "PGRST202") {
      showDenied(MESSAGES.notEnabled, false);
    } else {
      showLogin(MESSAGES.checkFailed);
    }
    return;
  }

  if (!restaurants.length) {
    let admin = false;
    try {
      admin = await isSystemAdmin(supabase);
    } catch (checkError) {
      console.error(checkError);
    }
    showDenied(MESSAGES.noRestaurant, admin);
    return;
  }

  ownerEmailEl.textContent = user.email || "";
  setMessage("");
  showView("dashboard");
  showDashboard(supabase, restaurants);
}

function showDenied(text, isAdmin) {
  resetDashboard();
  deniedMessageEl.textContent = text;
  deniedAdminHint.hidden = !isAdmin;
  showView("denied");
}

async function signOut() {
  try {
    await supabase.auth.signOut();
  } finally {
    showLogin();
  }
}

if (supabase) {
  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (signingIn) return;
    setMessage("");

    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) {
      setMessage(MESSAGES.missingFields);
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setMessage(MESSAGES[signInErrorReason(error)]);
        return;
      }
      passwordInput.value = "";
      await enterOwnerArea();
    } catch (error) {
      console.error(error);
      setMessage(MESSAGES.network);
    } finally {
      setBusy(false);
    }
  });

  logoutBtn.addEventListener("click", async function () {
    logoutBtn.disabled = true;
    try {
      await signOut();
    } finally {
      logoutBtn.disabled = false;
    }
  });
  deniedLogoutBtn.addEventListener("click", signOut);

  // Session ended elsewhere (other tab, expiry): back to the login screen.
  // No Supabase calls inside this callback, as the client docs advise.
  supabase.auth.onAuthStateChange(function (event) {
    if (event === "SIGNED_OUT") showLogin();
  });

  if (await hasStoredSession(supabase)) {
    await enterOwnerArea();
  } else {
    showView("login");
  }
}
