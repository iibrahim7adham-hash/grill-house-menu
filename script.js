// GRILL HOUSE menu — small, dependency-free UI behaviors.
// Anchor scrolling itself is handled natively via CSS `scroll-behavior: smooth`.

(function () {
  "use strict";

  var categoryLinks = Array.prototype.slice.call(document.querySelectorAll(".category-link"));

  function setActive(list, target) {
    list.forEach(function (el) {
      el.classList.toggle("is-active", el === target);
    });
  }

  categoryLinks.forEach(function (link) {
    link.addEventListener("click", function () {
      setActive(categoryLinks, link);
      link.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    });
  });

  // Highlight the category nav link as its section scrolls into view.
  var sectionToLink = {};
  categoryLinks.forEach(function (link) {
    sectionToLink[link.getAttribute("data-category")] = link;
  });

  var sections = Array.prototype.slice.call(document.querySelectorAll(".menu-section"));
  if ("IntersectionObserver" in window && sections.length) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            var link = sectionToLink[entry.target.id];
            if (link) {
              setActive(categoryLinks, link);
              link.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
            }
          }
        });
      },
      { rootMargin: "-45% 0px -50% 0px", threshold: 0 }
    );
    sections.forEach(function (section) {
      observer.observe(section);
    });
  }

  // Image lightbox: click any menu-card food image to preview it larger.
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
    Array.prototype.slice
      .call(document.querySelectorAll(".menu-card-image img"))
      .forEach(function (img) {
        img.addEventListener("click", function (event) {
          event.stopPropagation();
          openLightbox(img);
        });
      });

    Array.prototype.slice
      .call(lightbox.querySelectorAll("[data-lightbox-close]"))
      .forEach(function (el) {
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

  // Navigation drawer: opened from the header hamburger button, holds the
  // links that used to live in the bottom navigation bar.
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

    Array.prototype.slice
      .call(drawer.querySelectorAll("[data-drawer-close]"))
      .forEach(function (el) {
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
})();
