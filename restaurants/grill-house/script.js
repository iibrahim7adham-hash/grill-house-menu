// GRILL HOUSE menu — small, dependency-free UI behaviors, plus loading the
// menu from the shared database.
// Anchor scrolling itself is handled natively via CSS `scroll-behavior: smooth`.
//
// Menu data: the menu in index.html is the starting content (and stays as-is
// if the database cannot be used). Once the published menu for this
// restaurant's slug is loaded, the category bar and the menu sections are
// rebuilt from it with exactly the same markup, so the design is unchanged.
// The restaurant's contact details are filled in from the same row, so
// changes saved in the dashboard (/grill-admin/) appear here.

var SVG_NS = "http://www.w3.org/2000/svg";
var CURRENCY = "د.ع";
var MESSAGES = {
  unavailable: "غير متوفر حالياً",
  empty: "المنيو قيد التحديث، يرجى العودة لاحقاً.",
};
// Ids already used by this page; a category slug must not collide with them.
var RESERVED_IDS = ["top", "hero", "categories", "menu-items", "contact", "nav-drawer", "image-lightbox", "image-lightbox-img", "hamburger-btn"];

var categoryNav = document.getElementById("categories");
var categoryList = document.querySelector(".category-list");
var menuMain = document.getElementById("menu-items");

function slice(list) {
  return Array.prototype.slice.call(list);
}

function categoryLinks() {
  return slice(document.querySelectorAll(".category-link"));
}

function setActive(list, target) {
  list.forEach(function (el) {
    el.classList.toggle("is-active", el === target);
  });
}

// ---------- Category bar (event delegation: works for rebuilt links too) ----------

if (categoryList) {
  categoryList.addEventListener("click", function (event) {
    var link = event.target.closest(".category-link");
    if (!link) return;
    setActive(categoryLinks(), link);
    link.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  });
}

// Highlight the category nav link as its section scrolls into view.
var sectionObserver = null;

function observeSections() {
  if (sectionObserver) sectionObserver.disconnect();
  var links = categoryLinks();
  var sectionToLink = {};
  links.forEach(function (link) {
    sectionToLink[link.getAttribute("data-category")] = link;
  });

  var sections = slice(document.querySelectorAll(".menu-section"));
  if (!("IntersectionObserver" in window) || !sections.length) return;
  sectionObserver = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var link = sectionToLink[entry.target.id];
          if (link) {
            setActive(links, link);
            link.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
          }
        }
      });
    },
    { rootMargin: "-45% 0px -50% 0px", threshold: 0 }
  );
  sections.forEach(function (section) {
    sectionObserver.observe(section);
  });
}

observeSections();

// ---------- Image lightbox: click any menu-card food image to preview it larger ----------

var lightbox = document.getElementById("image-lightbox");
var lightboxImg = document.getElementById("image-lightbox-img");
var lastFocusedEl = null;

function openLightbox(img) {
  lastFocusedEl = document.activeElement;
  lightboxImg.src = img.src;
  lightboxImg.alt = img.alt || "";
  lightbox.hidden = false;
  document.body.classList.add("lightbox-open");
}

function closeLightbox() {
  lightbox.hidden = true;
  lightboxImg.src = "";
  document.body.classList.remove("lightbox-open");
  if (lastFocusedEl && typeof lastFocusedEl.focus === "function") {
    lastFocusedEl.focus();
  }
}

if (lightbox && lightboxImg) {
  if (menuMain) {
    menuMain.addEventListener("click", function (event) {
      var img = event.target.closest(".menu-card-image img");
      if (!img) return;
      event.stopPropagation();
      openLightbox(img);
    });
  }

  slice(lightbox.querySelectorAll("[data-lightbox-close]")).forEach(function (el) {
    el.addEventListener("click", function (event) {
      event.stopPropagation();
      closeLightbox();
    });
  });

  lightbox.querySelector(".image-lightbox-content").addEventListener("click", function (event) {
    event.stopPropagation();
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !lightbox.hidden) {
      closeLightbox();
    }
  });
}

// ---------- Navigation drawer ----------
// Opened from the header hamburger button, holds the links that used to live
// in the bottom navigation bar.

var hamburgerBtn = document.getElementById("hamburger-btn");
var drawer = document.getElementById("nav-drawer");
var drawerLastFocusedEl = null;

function openDrawer() {
  drawerLastFocusedEl = document.activeElement;
  drawer.hidden = false;
  document.body.classList.add("drawer-open");
  hamburgerBtn.setAttribute("aria-expanded", "true");
}

function closeDrawer() {
  drawer.hidden = true;
  document.body.classList.remove("drawer-open");
  hamburgerBtn.setAttribute("aria-expanded", "false");
  if (drawerLastFocusedEl && typeof drawerLastFocusedEl.focus === "function") {
    drawerLastFocusedEl.focus();
  }
}

if (hamburgerBtn && drawer) {
  hamburgerBtn.addEventListener("click", function () {
    if (drawer.hidden) {
      openDrawer();
    } else {
      closeDrawer();
    }
  });

  slice(drawer.querySelectorAll("[data-drawer-close]")).forEach(function (el) {
    el.addEventListener("click", function (event) {
      event.stopPropagation();
      closeDrawer();
    });
  });

  drawer.querySelector(".nav-drawer-panel").addEventListener("click", function (event) {
    event.stopPropagation();
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !drawer.hidden) {
      closeDrawer();
    }
  });
}

// ---------- Rendering the menu from the database ----------
// Same elements, classes and attributes as the hand-written menu in index.html.

function svgIcon(name) {
  var svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");
  var use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", "#icon-" + name);
  svg.appendChild(use);
  return svg;
}

// Only icons that exist in this page's sprite; anything else -> "list".
function iconName(value) {
  return value && /^[a-z-]+$/.test(value) && document.getElementById("icon-" + value) ? value : "list";
}

function sectionIds(categories) {
  var used = {};
  return categories.map(function (category, index) {
    var id = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(category.slug || "") ? category.slug : "category-" + (index + 1);
    if (RESERVED_IDS.indexOf(id) !== -1 || document.getElementById(id) && !document.getElementById(id).classList.contains("menu-section")) {
      id = "menu-" + id;
    }
    while (used[id]) id += "-" + (index + 1);
    used[id] = true;
    return id;
  });
}

function renderCategoryLink(category, id, active) {
  var li = document.createElement("li");
  var a = document.createElement("a");
  a.href = "#" + id;
  a.className = "category-link" + (active ? " is-active" : "");
  a.setAttribute("data-category", id);
  var span = document.createElement("span");
  span.textContent = category.name;
  a.append(svgIcon(iconName(category.icon)), span);
  li.appendChild(a);
  return li;
}

function renderCard(item, formatPrice) {
  var card = document.createElement("article");
  card.className = "menu-card" + (item.is_available === false ? " is-unavailable" : "");

  var body = document.createElement("div");
  body.className = "menu-card-body";
  var title = document.createElement("h3");
  title.textContent = item.name;
  body.appendChild(title);
  if (item.description) {
    var description = document.createElement("p");
    description.textContent = item.description;
    body.appendChild(description);
  }
  if (item.is_available === false) {
    var status = document.createElement("span");
    status.className = "menu-card-status";
    status.textContent = MESSAGES.unavailable;
    body.appendChild(status);
  }

  var media = document.createElement("div");
  media.className = "menu-card-image image-slot";
  media.setAttribute("role", "img");
  media.setAttribute("aria-label", item.name);
  if (item.imageUrl) {
    var img = document.createElement("img");
    img.setAttribute("src", item.imageUrl);
    img.setAttribute("alt", item.name);
    img.setAttribute("loading", "lazy");
    media.appendChild(img);
  } else {
    media.appendChild(svgIcon("image"));
  }

  var priceBox = document.createElement("div");
  priceBox.className = "menu-card-price";
  var price = document.createElement("span");
  price.className = "price";
  var currency = document.createElement("span");
  currency.className = "currency";
  currency.textContent = CURRENCY;
  price.append(document.createTextNode(formatPrice(item.price) + " "), currency);
  priceBox.appendChild(price);

  card.append(body, media, priceBox);
  return card;
}

function renderSection(category, id, formatPrice) {
  var section = document.createElement("section");
  section.className = "menu-section";
  section.id = id;

  var heading = document.createElement("div");
  heading.className = "section-heading";
  var h2 = document.createElement("h2");
  h2.textContent = category.name;
  var line = document.createElement("span");
  line.className = "heading-line";
  heading.append(h2, line);

  var list = document.createElement("div");
  list.className = "menu-list";
  list.setAttribute("data-category", id);
  category.items.forEach(function (item) {
    list.appendChild(renderCard(item, formatPrice));
  });

  section.append(heading, list);
  return section;
}

function renderMenu(categories, formatPrice) {
  if (!categories.length) {
    var empty = document.createElement("p");
    empty.className = "menu-empty";
    empty.textContent = MESSAGES.empty;
    categoryList.replaceChildren();
    categoryNav.hidden = true;
    menuMain.replaceChildren(empty);
    observeSections();
    return;
  }
  var ids = sectionIds(categories);
  categoryNav.hidden = false;
  categoryList.replaceChildren.apply(categoryList, categories.map(function (category, i) {
    return renderCategoryLink(category, ids[i], i === 0);
  }));
  menuMain.replaceChildren.apply(menuMain, categories.map(function (category, i) {
    return renderSection(category, ids[i], formatPrice);
  }));
  observeSections();
}

// The restaurant this page belongs to (its folder name and database slug).
function restaurantSlug() {
  var meta = document.querySelector('meta[name="restaurant-slug"]');
  return meta ? meta.getAttribute("content") : "";
}

// ---------- Restaurant details from the database ----------
// Elements marked data-profile="..." in index.html. An empty value hides its
// line; the built-in text stays when the database cannot be reached.

function profileNodes(name) {
  return slice(document.querySelectorAll('[data-profile="' + name + '"]'));
}

function showLine(node, visible) {
  var line = node.closest("li") || node;
  line.style.display = visible ? "" : "none";
}

// Social links (data-social="instagram" etc.): the configured account opens
// in a new tab; platforms without one are hidden. `socialHref` (from
// shared/utils/socials.js) validates the stored value again and returns ""
// for anything that is not a proper link for that platform.
function applySocials(socials, socialHref) {
  slice(document.querySelectorAll("[data-social]")).forEach(function (link) {
    var href = socialHref(link.getAttribute("data-social"), (socials || {})[link.getAttribute("data-social")]);
    if (href) {
      link.setAttribute("href", href);
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
    }
    link.style.display = href ? "" : "none";
  });
  // The location / WhatsApp button row takes no space when both are hidden.
  slice(document.querySelectorAll(".contact-actions")).forEach(function (row) {
    var any = slice(row.querySelectorAll("[data-social]")).some(function (link) { return link.style.display !== "none"; });
    row.style.display = any ? "" : "none";
  });
}

function applyProfile(restaurant, socialHref) {
  if (!restaurant) return;
  if (socialHref) applySocials(restaurant.socials, socialHref);
  if (restaurant.name) {
    profileNodes("name").forEach(function (node) {
      node.textContent = restaurant.name.toUpperCase();
    });
  }
  profileNodes("tagline").forEach(function (node) {
    if (!restaurant.tagline) return node.replaceChildren();
    var kicker = document.createElement("p");
    kicker.className = "hero-kicker";
    kicker.textContent = restaurant.tagline;
    node.replaceChildren(kicker);
  });
  ["address", "phone", "hours"].forEach(function (key) {
    profileNodes(key).forEach(function (node) {
      if (restaurant[key]) node.textContent = restaurant[key];
      showLine(node, Boolean(restaurant[key]));
    });
  });
  profileNodes("phone-link").forEach(function (link) {
    var digits = String(restaurant.phone || "").replace(/[^\d+]/g, "");
    if (digits) link.setAttribute("href", "tel:" + digits);
    link.style.display = digits ? "" : "none";
  });
}

// ---------- Loading ----------

async function loadMenuFromDatabase() {
  var slug = restaurantSlug();
  if (!slug || !menuMain || !categoryList) return;
  menuMain.setAttribute("aria-busy", "true");
  try {
    // Loaded on demand so the page keeps working even if Supabase cannot be
    // reached (the hand-written menu above simply stays in place).
    var modules = await Promise.all([
      import("/shared/supabase/client.js"),
      import("/shared/data/public-menu.js"),
      import("/shared/utils/format.js"),
      import("/shared/utils/socials.js"),
    ]);
    var result = await modules[1].loadPublicMenu(modules[0].supabase, slug);
    if (result.status === "ok") {
      applyProfile(result.restaurant, modules[3].socialHref);
      renderMenu(result.categories, modules[2].formatPrice);
    } else if (result.status === "error") {
      console.warn("Menu could not be loaded; showing the built-in menu.", result.error);
    }
    // "not_found": not in the database (or not published) yet -> built-in menu.
  } catch (error) {
    console.warn("Menu could not be loaded; showing the built-in menu.", error);
  } finally {
    menuMain.removeAttribute("aria-busy");
  }
}

loadMenuFromDatabase();
