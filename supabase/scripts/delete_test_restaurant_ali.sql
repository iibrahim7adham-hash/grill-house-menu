-- One-off cleanup of the test restaurant "ياعلي" (slug: ali).
--
-- Preferred: apply migrations/20261031120000_delete_restaurant.sql, then
-- delete it from the admin dashboard (that also tests the real flow).
-- Use this script only as a fallback, in the Supabase SQL editor.

-- STEP 1 — read-only verification. Expect exactly one row: name ياعلي,
-- slug ali. Note its id and the related-row counts.
select r.id,
       r.name,
       r.slug,
       r.is_published,
       r.created_at,
       (select count(*) from public.categories c where c.restaurant_id = r.id)         as categories,
       (select count(*) from public.menu_items m where m.restaurant_id = r.id)         as menu_items,
       (select count(*) from public.restaurant_members rm where rm.restaurant_id = r.id) as restaurant_members
  from public.restaurants r
 where r.slug = 'ali' or r.name = 'ياعلي';

-- STEP 2 — delete. Paste the id from step 1 below, then run this block on its
-- own. It is atomic: if any check fails, nothing is deleted.
do $$
declare
  v_id constant uuid := 'PASTE-THE-ID-FROM-STEP-1';
begin
  if (select count(*) from public.restaurants
       where id = v_id and slug = 'ali' and name = 'ياعلي') <> 1 then
    raise exception 'Verification failed: no restaurant with this id, slug ali and name ياعلي';
  end if;

  if exists (
    select 1
      from public.menu_items m
      join public.categories c on c.id = m.category_id
     where c.restaurant_id = v_id
       and m.restaurant_id is distinct from v_id
  ) then
    raise exception 'Another restaurant''s menu items use these categories; aborting';
  end if;

  delete from public.menu_items where restaurant_id = v_id;
  delete from public.categories where restaurant_id = v_id;
  delete from public.restaurant_members where restaurant_id = v_id;
  delete from public.restaurants where id = v_id;

  raise notice 'Deleted test restaurant % (ali)', v_id;
end $$;
