// "إدارة المطعم" — entry point for editing this menu page in place.
//
// Visitors: nothing happens. Without a stored session (and without ?admin in
// the URL) no request is made, no element is added and no admin code or CSS
// is downloaded.
//
// Signed-in Grill House admins (members of the restaurant, as reported by the
// database) get a "إدارة المطعم" button in the header. It switches the page
// into editing mode (admin/editor.js). Opening the page with ?admin shows the
// sign-in dialog (admin/login.js).
//
// Hiding or showing the button is only for display. Every read and write is
// checked by Row Level Security and the database functions.

var ADMIN_BASE = "/restaurants/grill-house/admin/";
var LABEL = "إدارة المطعم";
var SVG_NS = "http://www.w3.org/2000/svg";

var supabase = null;
var slug = "";
var access = null;       // { role: "owner", user, restaurant } while authorized
var button = null;       // the header button, or null while hidden
var editor = null;       // admin/editor.js once loaded
var checkToken = 0;      // newer checks win over slower, older ones

function restaurantSlug() {
  var meta = document.querySelector('meta[name="restaurant-slug"]');
  return meta ? meta.getAttribute("content") : "";
}

function wantsLogin() {
  return new URLSearchParams(window.location.search).has("admin");
}

// Removes ?admin so a reload or a shared link does not reopen the sign-in.
function forgetLoginParam() {
  if (!wantsLogin()) return;
  var url = new URL(window.location.href);
  url.searchParams.delete("admin");
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
}

// The admin stylesheet, added once and only for admins / the sign-in.
var stylesReady = null;
function loadStyles() {
  if (!stylesReady) {
    stylesReady = new Promise(function (resolve) {
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = ADMIN_BASE + "admin.css";
      link.onload = link.onerror = function () { resolve(); };
      document.head.appendChild(link);
    });
  }
  return stylesReady;
}

async function loadEditor() {
  if (!editor) {
    await loadStyles();
    editor = await import(ADMIN_BASE + "editor.js");
  }
  return editor;
}

// ---------- Header button ----------

function gridIcon() {
  var svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  [[3, 3], [13, 3], [3, 13], [13, 13]].forEach(function (p) {
    var r = document.createElementNS(SVG_NS, "rect");
    r.setAttribute("x", String(p[0]));
    r.setAttribute("y", String(p[1]));
    r.setAttribute("width", "8");
    r.setAttribute("height", "8");
    r.setAttribute("rx", "2");
    svg.appendChild(r);
  });
  return svg;
}

function setPressed(pressed) {
  if (button) button.setAttribute("aria-pressed", pressed ? "true" : "false");
}

async function toggleEditing() {
  if (!access) return;
  var mod = await loadEditor();
  if (mod.isEditing()) {
    await mod.stopEditing();
  } else {
    await mod.startEditing({
      supabase: supabase,
      restaurant: access.restaurant,
      onStop: function () { setPressed(false); },
      onSignedOut: function () { hideButton(); },
    });
    setPressed(true);
  }
}

// The header grid has three columns; the call button and this button share
// the first one, so the brand and the hamburger button keep their places.
function showButton() {
  if (button) return;
  var contact = document.querySelector(".site-header .contact-btn");
  if (!contact) return;
  var actions = document.createElement("div");
  actions.className = "header-actions";
  contact.parentNode.insertBefore(actions, contact);

  button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-outline manage-btn";
  button.setAttribute("aria-pressed", "false");
  button.setAttribute("aria-label", LABEL);
  var text = document.createElement("span");
  text.className = "manage-btn-label";
  text.textContent = LABEL;
  button.append(gridIcon(), text);
  button.addEventListener("click", function () {
    toggleEditing().catch(function (error) {
      console.error("Editing mode failed", error);
    });
  });

  actions.append(contact, button);
  document.body.setAttribute("data-manage-role", "owner");
}

// Restores the header exactly as it was.
function hideButton() {
  var actions = document.querySelector(".site-header .header-actions");
  if (actions) {
    var contact = actions.querySelector(".contact-btn");
    if (contact) actions.parentNode.insertBefore(contact, actions);
    actions.remove();
  }
  button = null;
  document.body.removeAttribute("data-manage-role");
}

async function leaveEditing() {
  if (editor && editor.isEditing()) await editor.stopEditing();
}

// ---------- Access ----------

// Only members of this restaurant may manage it ("owner" role). A system
// admin who is not a member is treated like any other signed-in visitor.
async function checkAccess() {
  try {
    var mod = await import("/shared/auth/restaurant-access.js");
    var result = await mod.getRestaurantAccess(supabase, slug);
    return result.role === "owner" && result.restaurant ? result : null;
  } catch (error) {
    console.warn("Could not check management access", error);
    return null;
  }
}

async function refresh() {
  var token = ++checkToken;
  var result = await checkAccess();
  if (token !== checkToken) return;
  access = result;
  if (access) {
    await loadStyles();
    if (token !== checkToken) return;
    showButton();
  } else {
    await leaveEditing();
    hideButton();
  }
}

async function openLogin() {
  await loadStyles();
  var login = await import(ADMIN_BASE + "login.js");
  login.openLogin({
    supabase: supabase,
    slug: slug,
    onAuthorized: async function (result) {
      checkToken++;
      access = result;
      forgetLoginParam();
      showButton();
      await toggleEditing();
    },
    onCancel: forgetLoginParam,
  });
}

async function start() {
  slug = restaurantSlug();
  if (!slug) return;
  var login = wantsLogin();

  try {
    supabase = (await import("/shared/supabase/client.js")).supabase;
  } catch (error) {
    return; // Supabase unavailable: nothing to show.
  }

  // Sign-in/out in this tab or another one (supabase-js syncs tabs).
  // Supabase calls are deferred out of the callback, as the client docs advise.
  supabase.auth.onAuthStateChange(function (event) {
    if (event === "SIGNED_OUT") {
      checkToken++;
      access = null;
      setTimeout(function () {
        leaveEditing().finally(hideButton);
      }, 0);
    } else if (event === "SIGNED_IN" || event === "USER_UPDATED") {
      setTimeout(refresh, 0);
    }
  });

  var session = await import("/shared/auth/session.js");
  var stored = await session.hasStoredSession(supabase);
  if (!stored && !login) return; // a visitor: stop here

  if (stored) await refresh();
  if (login) {
    if (access) {
      forgetLoginParam();
      if (!(editor && editor.isEditing())) await toggleEditing();
    } else {
      await openLogin();
    }
  }
}

start();
