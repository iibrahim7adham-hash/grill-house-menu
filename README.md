# Grill House

Digital menu for Grill House, backed by Supabase, with a dashboard at
`/grill-admin/` that manages Grill House only. Multi-restaurant support will
come later.

Plain HTML, CSS and JavaScript (ES modules), no build step. Hosted on Vercel.

## Structure

```
restaurants/grill-house/  the public Grill House site: HTML, CSS, JS, assets
  script.js               page behaviour; loads the published menu from the
                          database and falls back to the built-in menu
  manage-menu.js          "إدارة المطعم" link to the dashboard for signed-in
                          members; /?admin opens the dashboard
grill-admin/              the dashboard (served at /grill-admin/)
  index.html, dashboard.css
  js/app.js               sign-in, membership check, layout, navigation, home
  js/menu-sections.js     الأقسام and المنتجات (incl. images)
  js/account-sections.js  إعدادات المطعم and كلمة المرور
  js/ui.js, js/errors.js  DOM helpers, Arabic error messages
shared/                   infrastructure used by the site and future dashboard
  config.js               public Supabase URL + publishable key
  supabase/client.js      the one Supabase client
  auth/                   session (who is signed in), authorization (what they may see)
  data/public-menu.js     read-only menu for the public page
  data/menu.js            categories / items / item images (dashboard writes)
  data/restaurants.js     restaurant profile updates (dashboard writes)
  utils/                  slugs, URLs, formatting
supabase/                 SQL migrations, maintenance scripts, Edge Functions
_archive/                 multi-restaurant/ (old dashboards) and inline-editor/
                          (previous inline editing); not served
tests/                    browser tests, fake Supabase, local dev server
vercel.json               URL routing
```

## Routing

| URL               | Served file                            |
| ----------------- | -------------------------------------- |
| `/`               | `restaurants/grill-house/index.html`   |
| `/r/grill-house`  | `restaurants/grill-house/index.html` (kept so existing links and QR codes still work) |
| `/grill-admin/`   | `grill-admin/index.html` (dashboard) |

`/admin/` and `/owner/` are disabled (archived).

## Security rules

- Only the publishable key is ever in the browser (`shared/config.js`).
  Never put the service-role key in any file in this repository.
- Access control is enforced by Row Level Security in the database; the
  frontend checks only decide what to display.
- Supabase, authentication and authorization code lives only in `shared/`.

Item images are stored in the `restaurant-images` bucket under
`<restaurant_id>/items/`.

## Managing the menu

Open `/grill-admin/` (or `/?admin`) and sign in with an account that is a
member of Grill House (`restaurant_members`). Other accounts, including system
admins who are not members, are signed out. Sections: الرئيسية, الأقسام,
المنتجات, إعدادات المطعم, كلمة المرور (URL hash: #categories, #products, ...).

Per-item hiding uses `supabase/migrations/20261031170000_menu_item_visibility.sql`
(applied to the live project on 2026-10-31). Saving social links needs
`supabase/migrations/20261031180000_owner_update_restaurant_socials.sql`
(not applied yet); until then the social links panel is hidden
(`SOCIALS_ENABLED` in `grill-admin/js/account-sections.js`).

## Local preview and tests

```
cd tests && npm install
node dev-server.mjs --mock     # fake in-memory Supabase, demo accounts printed
node dev-server.mjs            # REAL Supabase: edits change the live menu
npm test                       # Chrome + fake Supabase
```
