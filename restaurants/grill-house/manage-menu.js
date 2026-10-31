// "إدارة المطعم" — link from the public menu to the Grill House dashboard.
//
// Visitors: nothing happens. Without a stored session no request is made and
// no element is added. /?admin goes straight to the dashboard (/grill-admin/),
// which has its own sign-in.
//
// Signed-in members of this restaurant (as reported by the database) get a
// "إدارة المطعم" link in the header. Showing it is only for display: the
// dashboard and Row Level Security check every action.

var DASHBOARD_URL = "/grill-admin/";
var LABEL = "إدارة المطعم";
var SVG_NS = "http://www.w3.org/2000/svg";

var supabase = null;
var slug = "";
var checkToken = 0; // newer checks win over slower, older ones

function restaurantSlug() {
  var meta = document.querySelector('meta[name="restaurant-slug"]');
  return meta ? meta.getAttribute("content") : "";
}

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

// The header grid has three columns; the call button and this link share
// the first one, so the brand and the hamburger button keep their places.
function showLink() {
  if (document.querySelector(".site-header .manage-btn")) return;
  var contact = document.querySelector(".site-header .contact-btn");
  if (!contact) return;
  var actions = document.createElement("div");
  actions.className = "header-actions";
  contact.parentNode.insertBefore(actions, contact);

  var link = document.createElement("a");
  link.className = "btn btn-outline manage-btn";
  link.href = DASHBOARD_URL;
  link.setAttribute("aria-label", LABEL);
  var text = document.createElement("span");
  text.className = "manage-btn-label";
  text.textContent = LABEL;
  link.append(gridIcon(), text);

  actions.append(contact, link);
  document.body.setAttribute("data-manage-role", "owner");
}

// Restores the header exactly as it was.
function hideLink() {
  var actions = document.querySelector(".site-header .header-actions");
  if (actions) {
    var contact = actions.querySelector(".contact-btn");
    if (contact) actions.parentNode.insertBefore(contact, actions);
    actions.remove();
  }
  document.body.removeAttribute("data-manage-role");
}

async function refresh() {
  var token = ++checkToken;
  var role = null;
  try {
    var mod = await import("/shared/auth/restaurant-access.js");
    role = (await mod.getRestaurantAccess(supabase, slug)).role;
  } catch (error) {
    console.warn("Could not check management access", error);
  }
  if (token !== checkToken) return;
  // Only members manage the restaurant; system admins who are not are not.
  if (role === "owner") showLink();
  else hideLink();
}

async function start() {
  if (new URLSearchParams(window.location.search).has("admin")) {
    window.location.replace(DASHBOARD_URL);
    return;
  }
  slug = restaurantSlug();
  if (!slug) return;
  try {
    supabase = (await import("/shared/supabase/client.js")).supabase;
  } catch (error) {
    return; // Supabase unavailable: nothing to show.
  }

  // Sign-in/out in another tab (supabase-js syncs tabs). Supabase calls are
  // deferred out of the callback, as the client docs advise.
  supabase.auth.onAuthStateChange(function (event) {
    if (event === "SIGNED_OUT") {
      checkToken++;
      hideLink();
    } else if (event === "SIGNED_IN") {
      setTimeout(refresh, 0);
    }
  });

  var session = await import("/shared/auth/session.js");
  if (await session.hasStoredSession(supabase)) await refresh();
}

start();
