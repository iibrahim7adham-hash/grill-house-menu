// Arabic messages for errors returned by the shared data modules.

export const NETWORK = "تعذر الاتصال بالخادم. تحقق من الاتصال بالإنترنت وحاول مجدداً.";

export function isNetworkError(error) {
  return !error.code && /fetch|network/i.test(error.message || "");
}

export function errorMessage(error) {
  if (!error) return "تعذر حفظ التغييرات. يرجى المحاولة مجدداً.";
  if (error.code === "denied") return "العنصر غير موجود أو لا تملك صلاحية تعديله. تم تحديث البيانات.";
  if (error.code === "42501") return "لا تملك صلاحية تنفيذ هذه العملية.";
  if (error.code === "23505") return "يوجد عنصر بنفس البيانات مسبقاً.";
  if (["23514", "23502", "22001", "22P02", "22003", "23503"].includes(error.code)) return "بعض البيانات غير صالحة. يرجى مراجعة الحقول.";
  if (isNetworkError(error)) return NETWORK;
  return "تعذر حفظ التغييرات. يرجى المحاولة مجدداً.";
}

export function uploadErrorMessage(error) {
  if (error.code === "invalid_image") {
    return error.reason === "size" ? "حجم الصورة أكبر من 5 ميغابايت." : "نوع الصورة غير مدعوم. استخدم JPG أو PNG أو WebP.";
  }
  const status = Number(error.statusCode || error.status);
  if (status === 401 || status === 403 || /row-level security|unauthorized/i.test(error.message || "")) {
    return "تم رفض رفع الصورة. لا تملك صلاحية التخزين لهذا المطعم.";
  }
  if (isNetworkError(error)) return NETWORK;
  return "تعذر رفع الصورة. يرجى المحاولة مجدداً.";
}
