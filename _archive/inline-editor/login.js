// Sign-in dialog for Grill House admins, opened by /?admin.
//
// After a successful sign-in the account must be a member of this restaurant
// (checked by the database through shared/auth/restaurant-access.js).
// Any other account is signed out again at once.

import { signIn, signOut, signInErrorReason } from "/shared/auth/session.js";
import { getRestaurantAccess } from "/shared/auth/restaurant-access.js";
import { h, field, setAlert, openDialog, closeDialog } from "./ui.js";

const MESSAGES = {
  title: "تسجيل دخول إدارة المطعم",
  intro: "هذه الصفحة مخصصة لإدارة منيو GRILL HOUSE.",
  email: "البريد الإلكتروني",
  password: "كلمة المرور",
  submit: "تسجيل الدخول",
  checking: "جارٍ التحقق…",
  cancel: "إلغاء",
  required: "يرجى إدخال البريد الإلكتروني وكلمة المرور.",
  invalidCredentials: "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
  emailNotConfirmed: "لم يتم تأكيد البريد الإلكتروني لهذا الحساب بعد.",
  rateLimited: "محاولات كثيرة. يرجى الانتظار قليلاً ثم المحاولة مجدداً.",
  network: "تعذر الاتصال بالخادم. تحقق من الاتصال بالإنترنت وحاول مجدداً.",
  generic: "تعذر تسجيل الدخول. يرجى المحاولة مجدداً.",
  notAuthorized: "هذا الحساب لا يملك صلاحية إدارة مطعم GRILL HOUSE. تم تسجيل الخروج.",
};

let dialog = null;

export function openLogin({ supabase, slug, onAuthorized, onCancel }) {
  if (dialog) dialog.remove();
  let busy = false;

  const alert = h("p", { className: "gh-alert", role: "alert", hidden: true });
  const email = field({ label: MESSAGES.email, name: "email", type: "email", autocomplete: "username", required: true, dir: "ltr" });
  const password = field({ label: MESSAGES.password, name: "password", type: "password", autocomplete: "current-password", required: true, dir: "ltr" });
  const submit = h("button", { type: "submit", className: "gh-btn gh-btn-primary", textContent: MESSAGES.submit });
  const cancel = h("button", { type: "button", className: "gh-btn", textContent: MESSAGES.cancel });

  const form = h("form", { className: "gh-form", noValidate: true },
    h("p", { className: "gh-muted", textContent: MESSAGES.intro }),
    email.row, password.row, alert,
    h("div", { className: "gh-actions" }, cancel, submit));

  dialog = h("dialog", { className: "gh-dialog gh-dialog-narrow", id: "gh-login-dialog", dir: "rtl", lang: "ar" },
    h("h2", { className: "gh-dialog-title", textContent: MESSAGES.title }), form);
  document.body.appendChild(dialog);

  function setBusy(value) {
    busy = value;
    submit.disabled = value;
    cancel.disabled = value;
    submit.textContent = value ? MESSAGES.checking : MESSAGES.submit;
  }

  function close() {
    closeDialog(dialog);
    dialog.remove();
    dialog = null;
  }

  cancel.addEventListener("click", () => {
    close();
    if (onCancel) onCancel();
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (!busy) cancel.click();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    setAlert(alert, "");
    const values = { email: email.input.value.trim(), password: password.input.value };
    if (!values.email || !values.password) {
      setAlert(alert, MESSAGES.required);
      return;
    }

    setBusy(true);
    try {
      const { error } = await signIn(supabase, values.email, values.password);
      if (error) {
        setAlert(alert, MESSAGES[signInErrorReason(error)] || MESSAGES.generic);
        return;
      }
      const access = await getRestaurantAccess(supabase, slug);
      if (access.role !== "owner" || !access.restaurant) {
        await signOut(supabase);
        password.input.value = "";
        setAlert(alert, MESSAGES.notAuthorized);
        return;
      }
      close();
      await onAuthorized(access);
    } catch (error) {
      console.error(error);
      setAlert(alert, MESSAGES.network);
    } finally {
      if (dialog) setBusy(false);
    }
  });

  openDialog(dialog);
  email.input.focus();
}
