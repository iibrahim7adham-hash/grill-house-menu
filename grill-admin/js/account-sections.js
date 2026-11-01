// "إعدادات المطعم" and "كلمة المرور".
//
// The profile is saved only through public.update_my_restaurant_profile()
// (shared/data/restaurants.js), which checks membership in the database and
// changes only name, tagline, phone, address and hours.

import { updateRestaurantProfile, updateRestaurantSocials, PROFILE_LIMITS, PROFILE_PHONE_PATTERN } from "/shared/data/restaurants.js";
import { normalizeSocial, SOCIAL_PLATFORMS, SOCIAL_URL_MAX, MAPS_URL_MAX } from "/shared/utils/socials.js";
import { getMyRestaurants } from "/shared/auth/authorization.js";
import { changePassword } from "/shared/auth/session.js";
import { publicMenuUrl } from "/shared/utils/restaurant.js";
import { format } from "/shared/utils/format.js";
import { h, field, setAlert, clearInvalid, invalid } from "./ui.js";
import { errorMessage, NETWORK } from "./errors.js";

const PROFILE_FIELDS = [
  ["name", "اسم المطعم"],
  ["tagline", "العبارة التعريفية"],
  ["phone", "الهاتف"],
  ["address", "العنوان"],
  ["hours", "ساعات العمل"],
];
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function optional(value) {
  const trimmed = String(value || "").trim();
  return trimmed === "" ? null : trimmed;
}

function validateProfile(values) {
  if (!values.name) return { key: "name", message: "يرجى إدخال اسم المطعم." };
  for (const [key, label] of PROFILE_FIELDS) {
    const value = values[key];
    if (value === null) continue;
    if (value.length > PROFILE_LIMITS[key]) {
      return { key, message: format("حقل «{label}» أطول من الحد المسموح ({max} حرفاً).", { label, max: PROFILE_LIMITS[key] }) };
    }
    if (CONTROL_CHARS.test(value)) return { key, message: format("حقل «{label}» يحتوي على أحرف غير مسموحة.", { label }) };
  }
  if (values.phone && !PROFILE_PHONE_PATTERN.test(values.phone)) {
    return { key: "phone", message: "رقم الهاتف غير صالح. استخدم الأرقام والمسافات والرموز + - ( ) فقط (5 إلى 30 خانة)." };
  }
  return null;
}

function profileErrorMessage(error) {
  if (error.code === "PGRST202") return "تعديل معلومات المطعم غير مفعّل في قاعدة البيانات بعد.";
  if (error.code === "42501" || error.code === "denied") return "لا تملك صلاحية تعديل معلومات هذا المطعم.";
  if (error.code === "22023") return "بعض البيانات غير صالحة. يرجى مراجعة الحقول.";
  return errorMessage(error);
}

function submitButton(label) {
  return h("button", { type: "submit", className: "btn btn-primary", textContent: label });
}

const SOCIALS = {
  maps: { label: "الموقع على خرائط Google", placeholder: "https://maps.app.goo.gl/…",
    invalid: "رابط خرائط Google غير صالح. انسخ رابط المشاركة من تطبيق خرائط Google، مثال: https://maps.app.goo.gl/abc123",
    hint: "يظهر في المنيو زر «الموقع على الخريطة»." },
  instagram: { label: "Instagram", placeholder: "https://instagram.com/grillhouse",
    invalid: "رابط Instagram غير صالح. مثال: https://instagram.com/grillhouse" },
  tiktok: { label: "TikTok", placeholder: "https://www.tiktok.com/@grillhouse",
    invalid: "رابط TikTok غير صالح. مثال: https://www.tiktok.com/@grillhouse" },
  facebook: { label: "Facebook", placeholder: "https://www.facebook.com/grillhouse",
    invalid: "رابط Facebook غير صالح. مثال: https://www.facebook.com/grillhouse" },
  whatsapp: { label: "WhatsApp", placeholder: "+964 750 123 4567",
    invalid: "رقم WhatsApp غير صالح. اكتبه مع رمز الدولة، مثال: ‎+964 750 123 4567",
    hint: "رقم الهاتف مع رمز الدولة. يفتح محادثة مباشرة مع المطعم." },
};

function socialsErrorMessage(error) {
  if (error.code === "PGRST202") {
    return "حفظ الموقع وروابط التواصل غير مفعّل في قاعدة البيانات بعد (يتطلب تطبيق ترحيل owner_update_restaurant_links).";
  }
  if (error.code === "42501" || error.code === "denied") return "لا تملك صلاحية تعديل معلومات هذا المطعم.";
  if (error.code === "22023") return "أحد الروابط غير صالح. يرجى مراجعة الحقول.";
  return errorMessage(error);
}

// ---------- Social links ----------

// Shown only when the database has the links function
// (supabase/migrations/20261101120000_owner_update_restaurant_links.sql),
// detected at start-up as ctx.withLinks; without it every save would fail.
function socialsPanel(ctx) {
  const stored = () => ctx.restaurant.socials || {};
  const inputs = {};
  const rows = SOCIAL_PLATFORMS.map((key) => {
    const f = field({ label: SOCIALS[key].label, name: key, icon: key, dir: "ltr",
      type: key === "whatsapp" ? "tel" : "url", inputMode: key === "whatsapp" ? "tel" : "url",
      maxLength: key === "maps" ? MAPS_URL_MAX : SOCIAL_URL_MAX, placeholder: SOCIALS[key].placeholder,
      value: stored()[key] || "", hint: SOCIALS[key].hint });
    inputs[key] = f.input;
    return f.row;
  });
  const alert = h("p", { className: "alert", role: "alert", hidden: true });
  const save = submitButton("حفظ الروابط");
  const form = h("form", { className: "form", id: "socials-form", noValidate: true },
    h("div", { className: "social-grid" }, rows), alert,
    h("p", { className: "hint", textContent: "جميع الحقول اختيارية. المنصات الفارغة لا تظهر في المنيو." }),
    h("div", { className: "form-actions" }, save));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (save.disabled) return;
    setAlert(alert, "");
    clearInvalid(form);
    const values = {};
    for (const key of SOCIAL_PLATFORMS) {
      const result = normalizeSocial(key, inputs[key].value);
      if (result.error) return invalid(alert, inputs[key], SOCIALS[key].invalid);
      values[key] = result.value;
    }
    if (SOCIAL_PLATFORMS.every((key) => normalizeSocial(key, stored()[key]).value === values[key])) {
      SOCIAL_PLATFORMS.forEach((key) => { inputs[key].value = values[key] || ""; });
      return setAlert(alert, "لم يتم تغيير أي رابط.", "success");
    }

    save.disabled = true;
    save.textContent = "جارٍ الحفظ…";
    try {
      const { data, error } = await updateRestaurantSocials(ctx.supabase, ctx.restaurant.id, values);
      if (error) {
        console.error(error);
        if (error.code === "22023" && inputs[error.hint]) inputs[error.hint].setAttribute("aria-invalid", "true");
        return setAlert(alert, socialsErrorMessage(error));
      }
      ctx.setRestaurant(data);
      SOCIAL_PLATFORMS.forEach((key) => { inputs[key].value = (data.socials || {})[key] || ""; });
      setAlert(alert, "تم حفظ الموقع وروابط التواصل. تظهر في المنيو مباشرة.", "success");
    } catch (error) {
      console.error(error);
      setAlert(alert, NETWORK);
    } finally {
      save.disabled = false;
      save.textContent = "حفظ الروابط";
    }
  });

  return h("section", { className: "panel", id: "socials-panel" },
    h("div", { className: "panel-head" }, h("h2", { className: "panel-title", textContent: "الموقع وروابط التواصل" })),
    form);
}

// ---------- Restaurant settings ----------

export function renderSettings(ctx, root) {
  const r = ctx.restaurant;
  const inputs = {};
  const rows = PROFILE_FIELDS.map(([key, label]) => {
    const f = field({ label, name: key, value: r[key] || "", maxLength: PROFILE_LIMITS[key],
      dir: key === "phone" ? "ltr" : undefined, inputMode: key === "phone" ? "tel" : undefined, required: key === "name",
      hint: key === "tagline" ? "تظهر فوق صورة الواجهة في المنيو. اتركها فارغة لإخفائها." : undefined });
    inputs[key] = f.input;
    return f.row;
  });
  const alert = h("p", { className: "alert", role: "alert", hidden: true });
  const save = submitButton("حفظ المعلومات");
  const form = h("form", { className: "form form-narrow", id: "settings-form", noValidate: true },
    rows, alert, h("div", { className: "form-actions" }, save));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (save.disabled) return;
    setAlert(alert, "");
    clearInvalid(form);
    const values = {
      name: inputs.name.value.trim(),
      tagline: optional(inputs.tagline.value),
      phone: optional(inputs.phone.value),
      address: optional(inputs.address.value),
      hours: optional(inputs.hours.value),
    };
    const problem = validateProfile(values);
    if (problem) return invalid(alert, inputs[problem.key], problem.message);
    if (PROFILE_FIELDS.every(([key]) => (ctx.restaurant[key] || null) === values[key])) {
      return setAlert(alert, "لم يتم تغيير أي معلومات.", "success");
    }

    save.disabled = true;
    save.textContent = "جارٍ الحفظ…";
    try {
      const { data, error } = await updateRestaurantProfile(ctx.supabase, ctx.restaurant.id, values);
      if (error) {
        console.error(error);
        if (error.code === "22023" && inputs[error.hint]) inputs[error.hint].setAttribute("aria-invalid", "true");
        return setAlert(alert, profileErrorMessage(error));
      }
      // Re-read the row so the page shows exactly what is stored.
      const fresh = await getMyRestaurants(ctx.supabase);
      const row = (!fresh.error && fresh.restaurants.find((x) => x.id === data.id)) || data;
      ctx.setRestaurant(row);
      PROFILE_FIELDS.forEach(([key]) => { inputs[key].value = row[key] || ""; });
      setAlert(alert, "تم حفظ معلومات المطعم. تظهر التغييرات في المنيو مباشرة.", "success");
    } catch (error) {
      console.error(error);
      setAlert(alert, NETWORK);
    } finally {
      save.disabled = false;
      save.textContent = "حفظ المعلومات";
    }
  });

  const info = h("dl", { className: "info-list" },
    h("dt", { textContent: "المعرّف" }), h("dd", { dir: "ltr", textContent: r.slug }),
    h("dt", { textContent: "حالة النشر" }), h("dd", { textContent: r.is_published ? "منشور" : "غير منشور" }),
    h("dt", { textContent: "رابط المنيو" }),
    h("dd", {}, h("a", { href: publicMenuUrl(r.slug), target: "_blank", rel: "noopener", dir: "ltr", textContent: publicMenuUrl(r.slug) })));

  root.append(...[
    h("section", { className: "panel" }, h("div", { className: "panel-head" }, h("h2", { className: "panel-title", textContent: "معلومات المطعم" })), form),
    ctx.withLinks ? socialsPanel(ctx) : null,
    h("section", { className: "panel" },
      h("div", { className: "panel-head" }, h("h2", { className: "panel-title", textContent: "بيانات ثابتة" })),
      info,
      h("p", { className: "hint", textContent: "المعرّف وحالة النشر لا يمكن تغييرهما من لوحة التحكم." })),
  ].filter(Boolean));
}

// ---------- Password ----------

export function renderPassword(ctx, root) {
  const password = field({ label: "كلمة المرور الجديدة", name: "password", type: "password", autocomplete: "new-password", dir: "ltr",
    hint: "10 أحرف على الأقل." });
  const confirm = field({ label: "تأكيد كلمة المرور", name: "confirm", type: "password", autocomplete: "new-password", dir: "ltr" });
  const alert = h("p", { className: "alert", role: "alert", hidden: true });
  const save = submitButton("تحديث كلمة المرور");
  const form = h("form", { className: "form form-narrow", id: "password-form", noValidate: true },
    password.row, confirm.row, alert, h("div", { className: "form-actions" }, save));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (save.disabled) return;
    setAlert(alert, "");
    clearInvalid(form);
    if (password.input.value.length < 10) return invalid(alert, password.input, "كلمة المرور يجب أن تكون 10 أحرف على الأقل.");
    if (password.input.value !== confirm.input.value) return invalid(alert, confirm.input, "كلمتا المرور غير متطابقتين.");
    save.disabled = true;
    try {
      const { error } = await changePassword(ctx.supabase, password.input.value);
      if (error) {
        console.error(error);
        return setAlert(alert, "تعذر تحديث كلمة المرور. يرجى المحاولة مجدداً.");
      }
      form.reset();
      setAlert(alert, "تم تحديث كلمة المرور.", "success");
    } catch (error) {
      console.error(error);
      setAlert(alert, NETWORK);
    } finally {
      save.disabled = false;
    }
  });

  root.append(h("section", { className: "panel" },
    h("div", { className: "panel-head" }, h("h2", { className: "panel-title", textContent: "تغيير كلمة المرور" })),
    h("p", { className: "muted", textContent: "الحساب: " + (ctx.user.email || "") }),
    form));
}
