# Archived: inline editing on the public menu page (replaced 2026-10-31)

Replaced by the Grill House dashboard at /grill-admin/. Kept for reference;
not served (`_archive/` is in /.vercelignore).

- editor.js, login.js, admin.css: lived in restaurants/grill-house/admin/
  (ui.js moved to grill-admin/js/ui.js)
- manage-menu.js: the public page's entry point for inline editing
- tests/: its browser tests (used tests/dev-server.mjs --mock)

editor.js imported renderMenu / applyProfile / setEditing /
loadMenuFromDatabase from restaurants/grill-house/script.js, which no longer
exports them.
