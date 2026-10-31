-- Fix: anonymous visitors get "permission denied for table restaurant_members"
-- when reading categories / menu_items.
--
-- Cause: the SELECT policies "Read restaurant categories" and
-- "Read restaurant menu items" apply to {anon, authenticated} and combine
-- "restaurant is published" OR EXISTS(... restaurant_members ...). Postgres
-- checks table privileges for every table a policy references, as the
-- querying role, before evaluating the OR. anon has no privilege on
-- restaurant_members, so the whole query fails.
--
-- Fix: split each policy in two, with identical combined meaning:
--   * public policy  (anon, authenticated): published restaurants only,
--     no reference to restaurant_members;
--   * member policy  (authenticated only):  membership via restaurant_members.
-- INSERT / UPDATE / DELETE policies, grants and RLS settings are untouched.
--
-- The whole migration is one transaction. The checks below abort it (and
-- change nothing) if the database is not in the expected state.

begin;

-- ---------------------------------------------------------------------------
-- Pre-checks
-- ---------------------------------------------------------------------------
do $$
begin
  -- The policies being replaced must exist exactly as inspected.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'categories'
       and policyname = 'Read restaurant categories'
       and cmd = 'SELECT'
       and roles @> array['anon', 'authenticated']::name[]
       and qual like '%restaurant_members%'
       and qual like '%is_published%'
  ) then
    raise exception 'Pre-check failed: policy "Read restaurant categories" not found as expected';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'menu_items'
       and policyname = 'Read restaurant menu items'
       and cmd = 'SELECT'
       and roles @> array['anon', 'authenticated']::name[]
       and qual like '%restaurant_members%'
       and qual like '%is_published%'
  ) then
    raise exception 'Pre-check failed: policy "Read restaurant menu items" not found as expected';
  end if;

  -- No duplicates: the new policy names must not exist yet.
  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and (tablename, policyname) in (
         ('categories', 'Public can read categories of published restaurants'),
         ('categories', 'Members can read their restaurant categories'),
         ('menu_items', 'Public can read menu items of published restaurants'),
         ('menu_items', 'Members can read their restaurant menu items'))
  ) then
    raise exception 'Pre-check failed: one of the new policy names already exists';
  end if;

  -- RLS must already be enabled on both tables (this migration never changes it).
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname in ('categories', 'menu_items')
       and not c.relrowsecurity
  ) then
    raise exception 'Pre-check failed: RLS is not enabled on categories or menu_items';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------
drop policy "Read restaurant categories" on public.categories;

-- Anyone may read categories of published restaurants. The subquery on
-- restaurants is itself subject to restaurants' RLS.
create policy "Public can read categories of published restaurants"
  on public.categories
  for select
  to anon, authenticated
  using (
    exists (
      select 1
        from public.restaurants r
       where r.id = categories.restaurant_id
         and r.is_published = true
    )
  );

-- Signed-in members (owners/staff) may read their own restaurant's
-- categories, published or not.
create policy "Members can read their restaurant categories"
  on public.categories
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.restaurant_members m
       where m.restaurant_id = categories.restaurant_id
         and m.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- menu_items
-- ---------------------------------------------------------------------------
drop policy "Read restaurant menu items" on public.menu_items;

create policy "Public can read menu items of published restaurants"
  on public.menu_items
  for select
  to anon, authenticated
  using (
    exists (
      select 1
        from public.restaurants r
       where r.id = menu_items.restaurant_id
         and r.is_published = true
    )
  );

create policy "Members can read their restaurant menu items"
  on public.menu_items
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.restaurant_members m
       where m.restaurant_id = menu_items.restaurant_id
         and m.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Post-checks: the error must be gone for anon, with nothing extra exposed.
-- ---------------------------------------------------------------------------
do $$
begin
  -- No SELECT/ALL policy that applies to anon (directly or via PUBLIC) may
  -- still reference restaurant_members on these tables.
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename in ('categories', 'menu_items')
       and cmd in ('SELECT', 'ALL')
       and (roles @> array['anon']::name[] or roles @> array['public']::name[])
       and coalesce(qual, '') like '%restaurant_members%'
  ) then
    raise exception 'Post-check failed: a policy visible to anon still references restaurant_members';
  end if;

  -- anon must still have no privilege on restaurant_members.
  if has_table_privilege('anon', 'public.restaurant_members', 'SELECT') then
    raise exception 'Post-check failed: anon has SELECT on restaurant_members';
  end if;
end $$;

commit;
