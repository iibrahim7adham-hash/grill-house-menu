// Whole-number price with thousands separators, e.g. 12500 -> "12,500".
export function formatPrice(value) {
  return Number.isFinite(value) ? new Intl.NumberFormat("en-US").format(value) : "";
}

// Fills {key} placeholders in a message template, e.g.
// format("Saved «{name}»", { name: "Grill House" }).
export function format(template, values) {
  return template.replace(/\{(\w+)\}/g, function (_, key) {
    return values[key];
  });
}
