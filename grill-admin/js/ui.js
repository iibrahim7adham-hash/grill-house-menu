// Small DOM helpers for the dashboard. No data access here.

const SVG_NS = "http://www.w3.org/2000/svg";
let fieldCount = 0;

// h("button", { className: "x", type: "button", onclick }, child, "text", ...)
// Known element properties are set as properties, anything else (aria-*,
// data-*) as attributes. Text is always inserted as text, never as HTML.
export function h(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else if (key in node && !key.includes("-")) node[key] = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

// An icon from the page's sprite (<symbol id="i-...">).
export function icon(name, className) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("aria-hidden", "true");
  if (className) svg.setAttribute("class", className);
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", "#i-" + name);
  svg.appendChild(use);
  return svg;
}

// A labelled form control. Returns { row, input }.
//   options: label, name, type, value, hint, required, maxLength, dir,
//            autocomplete, inputMode, multiline, choices ([[value, label]]),
//            checked (checkbox), disabled, icon (sprite name shown in the label)
export function field(options) {
  const id = "f-" + options.name + "-" + (++fieldCount);
  const type = options.type || "text";
  let input;
  if (options.choices) {
    input = h("select", { id, name: options.name },
      options.choices.map(([value, label]) => h("option", { value, textContent: label })));
    if (options.value !== undefined) input.value = options.value;
  } else if (options.multiline) {
    input = h("textarea", { id, name: options.name, rows: 3, maxLength: options.maxLength, value: options.value || "" });
  } else {
    input = h("input", {
      id, name: options.name, type,
      maxLength: options.maxLength, autocomplete: options.autocomplete, inputMode: options.inputMode,
      dir: options.dir, required: options.required, placeholder: options.placeholder,
    });
    if (type === "checkbox") input.checked = Boolean(options.checked);
    else if (options.value !== undefined && options.value !== null) input.value = options.value;
  }
  if (options.disabled) input.disabled = true;

  const label = h("label", { htmlFor: id }, options.icon ? icon(options.icon, "field-icon") : null, options.label);
  const hint = options.hint ? h("small", { className: "hint", textContent: options.hint }) : null;
  const row = type === "checkbox"
    ? h("div", { className: "field field-check" }, input, label, hint)
    : h("div", { className: "field" }, label, input, hint);
  return { row, input };
}

export function setAlert(node, text, kind) {
  node.textContent = text || "";
  node.hidden = !text;
  node.classList.toggle("alert-success", kind === "success");
}

export function clearInvalid(form) {
  form.querySelectorAll("[aria-invalid]").forEach((n) => n.removeAttribute("aria-invalid"));
}

// Marks a field invalid, shows the message, focuses it. Returns false.
export function invalid(alert, input, message) {
  input.setAttribute("aria-invalid", "true");
  setAlert(alert, message);
  input.focus();
  return false;
}

// ---------- Modal dialogs ----------

const openDialogs = new Set();

// A modal form: title, body, Save/Cancel and optional extra buttons.
// `onSubmit(api)` resolves to true to close it. Escape and "إلغاء" close it
// unless it is saving. Unexpected errors show `networkMessage`.
export function formDialog({ title, id, body, submitLabel, savingLabel, extra, narrow, onSubmit, networkMessage }) {
  const alert = h("p", { className: "alert", role: "alert", hidden: true });
  const submit = h("button", { type: "submit", className: "btn btn-primary", textContent: submitLabel });
  const cancel = h("button", { type: "button", className: "btn btn-outline", textContent: "إلغاء" });
  const extras = extra || [];
  const form = h("form", { className: "form", noValidate: true },
    body, alert,
    h("div", { className: "form-actions" }, h("div", { className: "form-actions-start" }, extras), cancel, submit));
  const dialog = h("dialog", { className: "dialog" + (narrow ? " dialog-narrow" : ""), id, dir: "rtl", lang: "ar" },
    h("h2", { className: "dialog-title", textContent: title }), form);

  const api = {
    dialog, form, alert, busy: false, onClose: null,
    setBusy(value, label) {
      api.busy = value;
      [submit, cancel].concat(extras).forEach((b) => { b.disabled = value; });
      submit.textContent = value ? (label || savingLabel) : submitLabel;
    },
    close() {
      openDialogs.delete(api);
      if (dialog.open) dialog.close();
      dialog.remove();
      if (api.onClose) api.onClose();
    },
  };

  cancel.addEventListener("click", () => { if (!api.busy) api.close(); });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (!api.busy) api.close();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (api.busy) return;
    setAlert(alert, "");
    clearInvalid(form);
    try {
      if (await onSubmit(api)) api.close();
    } catch (error) {
      console.error(error);
      setAlert(alert, networkMessage);
      api.setBusy(false);
    }
  });

  document.body.appendChild(dialog);
  openDialogs.add(api);
  dialog.showModal();
  return api;
}

export function closeAllDialogs() {
  Array.from(openDialogs).forEach((api) => api.close());
}

// ---------- Status message ----------

let toastNode = null;
let toastTimer = 0;

export function toast(text, kind) {
  if (!toastNode) {
    toastNode = h("div", { className: "toast", role: "status", "aria-live": "polite", hidden: true });
    document.body.appendChild(toastNode);
  }
  clearTimeout(toastTimer);
  toastNode.textContent = text;
  toastNode.classList.toggle("toast-error", kind === "error");
  toastNode.hidden = false;
  toastTimer = setTimeout(() => { toastNode.hidden = true; }, kind === "error" ? 7000 : 3500);
}
