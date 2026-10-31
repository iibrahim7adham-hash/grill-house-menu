# Archived: multi-restaurant frontend (disabled 2026-10-31)

The project now focuses on Grill House only. These parts of the
multi-restaurant system were moved here unchanged, so they are kept but no
longer served (`_archive/` is listed in `/.vercelignore`).

```
admin/                       Super Admin dashboard (was /admin/)
                             restaurant list / add / delete, owner accounts
owner/                       generic Owner dashboard (was /owner/)
                             restaurant switcher, profile, categories, items, images
templates/restaurant-starter/  starter folder for adding a new restaurant
tests/                       jsdom + puppeteer tests for owner/
```

They are frozen reference code: the relative `../../shared/` imports and the
tests only work from their original location.

## What was NOT touched

Database tables, data, accounts, RLS policies, migrations (`/supabase/migrations/`)
and the `admin-create-owner` Edge Function (`/supabase/functions/`) are
unchanged. The deployed Edge Function still exists in Supabase; it only
answers system admins.

## Restore

Move the folders back to the project root and re-add the routes:

```
mv _archive/multi-restaurant/admin _archive/multi-restaurant/owner _archive/multi-restaurant/templates .
mv _archive/multi-restaurant/tests/*.mjs tests/
```

- `vercel.json`: re-add the `/admin.html` -> `/admin/` redirect and the
  `/owner/(.*)` no-cache header.
- `restaurants/grill-house/index.html`: re-add the `manage-menu.js` script tag
  (see the comment at the end of the page).

A full copy of the project from before the separation (including `.git`) is in
`C:\Users\ARDJOOD\Desktop\Restaurant-backup-2026-10-31-pre-grill-house-separation`.
