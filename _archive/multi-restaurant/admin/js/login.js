// Admin login: Supabase email/password sign-in restricted to system admins.
//
// This page only decides what to *show*. Real protection of admin data must
// come from Row Level Security in the database, because anything in the
// browser can be bypassed.

import { showDashboard, resetDashboard } from "./dashboard.js";
import { getVerifiedUser, hasStoredSession, signInErrorReason } from "../../shared/auth/session.js";
import { isSystemAdmin } from "../../shared/auth/authorization.js";

const shell = document.querySelector(".admin-shell");
const views = {
  loading: document.getElementById("view-loading"),
  login: document.getElementById("view-login"),
  dashboard: document.getElementById("view-dashboard"),
};
const form = document.getElementById("login-form");
const emailInput = document.getElementById("login-email");
const passwordInput = document.getElementById("login-password");
const submitBtn = document.getElementById("login-submit");
const messageEl = document.getElementById("login-message");
const adminEmailEl = document.getElementById("admin-email");
const logoutBtn = document.getElementById("logout-btn");

const MESSAGES = {
  missingFields: "يرجى إدخال البريد الإلكتروني وكلمة المرور.",
  invalidCredentials: "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
  emailNotConfirmed: "لم يتم تأكيد البريد الإلكتروني بعد.",
  rateLimited: "محاولات كثيرة. يرجى الانتظار قليلاً ثم المحاولة مجدداً.",
  network: "تعذر الاتصال بالخادم. تحقق من الاتصال بالإنترنت وحاول مجدداً.",
  accessDenied: "تم رفض الوصول: هذا الحساب لا يملك صلاحيات مسؤول النظام.",
  checkFailed: "تعذر التحقق من الصلاحيات. يرجى المحاولة لاحقاً.",
  notConfigured: "لم يتم إعداد الاتصال بالخادم بشكل صحيح.",
  generic: "حدث خطأ غير متوقع. يرجى المحاولة مجدداً.",
};

function showView(name) {
  Object.keys(views).forEach(function (key) {
    views[key].hidden = key !== name;
  });
  shell.classList.toggle("is-wide", name === "dashboard");
}

function setMessage(text) {
  messageEl.textContent = text || "";
  messageEl.hidden = !text;
}

function setBusy(busy) {
  submitBtn.disabled = busy;
  submitBtn.textContent = busy ? "جارٍ الدخول…" : "دخول";
}

function signInErrorMessage(error) {
  return MESSAGES[signInErrorReason(error)];
}

let supabase;
try {
  ({ supabase } = await import("../../shared/supabase/client.js"));
} catch (error) {
  console.error(error);
  showView("login");
  setMessage(MESSAGES.notConfigured);
  submitBtn.disabled = true;
}

// Verifies the session with the Supabase Auth server and lets only system
// admins through. Anyone else is signed out again (fail closed).
async function enterAdminArea() {
  const user = await getVerifiedUser(supabase);
  if (!user) {
    showView("login");
    return;
  }

  let allowed = false;
  try {
    allowed = await isSystemAdmin(supabase);
  } catch (checkError) {
    console.error(checkError);
    await supabase.auth.signOut({ scope: "local" });
    showView("login");
    setMessage(MESSAGES.checkFailed);
    return;
  }

  if (!allowed) {
    await supabase.auth.signOut({ scope: "local" });
    showView("login");
    setMessage(MESSAGES.accessDenied);
    return;
  }

  adminEmailEl.textContent = user.email || "";
  setMessage("");
  showView("dashboard");
  showDashboard(supabase);
}

if (supabase) {
  form.addEventListener("submit", async function (event) {
    event.preventDefault();
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
        setMessage(signInErrorMessage(error));
        return;
      }
      passwordInput.value = "";
      await enterAdminArea();
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
      await supabase.auth.signOut();
    } finally {
      logoutBtn.disabled = false;
      adminEmailEl.textContent = "";
      resetDashboard();
      showView("login");
    }
  });

  // Keep the page in sync when the session ends elsewhere (other tab, expiry).
  // No Supabase calls inside this callback, as the client docs advise.
  supabase.auth.onAuthStateChange(function (event) {
    if (event === "SIGNED_OUT") {
      adminEmailEl.textContent = "";
      resetDashboard();
      showView("login");
    }
  });

  if (await hasStoredSession(supabase)) {
    await enterAdminArea();
  } else {
    showView("login");
  }
}
