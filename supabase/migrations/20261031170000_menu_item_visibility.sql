-- Per-item visibility for the Grill House inline editor.
--
-- NOT APPLIED YET. Until it is, the editor shows the "ظاهر للزوار" control
-- disabled, and the public page shows every item (as it does today).
--
-- Adds menu_items.is_visible (default true, so every existing item stays
-- visible). Nothing else changes:
--   * the existing "Owners update menu items" policy already lets members
--     change any column of their own restaurant's items;
--   * table-level grants cover the new column;
--   * public reads keep the same row policies. Hidden items are still
--     readable through the API, like hidden categories; is_visible only
--     decides what the public page displays.

begin;

alter table public.menu_items
  add column if not exists is_visible boolean not null default true;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'menu_items'
       and column_name = 'is_visible' and data_type = 'boolean'
       and is_nullable = 'NO'
  ) then
    raise exception 'Post-check failed: menu_items.is_visible is missing or has the wrong type';
  end if;
end $$;

commit;
