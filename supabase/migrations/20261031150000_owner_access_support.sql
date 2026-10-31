-- Owner access support: what the owner dashboard and the owner-account
-- workflow need from the database, plus write guards that make tenant
-- isolation hold no matter how the existing permissive policies are written.
--
-- Adds (all SECURITY DEFINER, search_path = '', EXECUTE for authenticated only):
--   public.current_user_is_member(uuid)     -> is the caller a member of it?
--   public.get_my_restaurants()             -> the caller's restaurants only
--   public.admin_list_restaurant_owners()   -> members + account status, admins only
--
-- Adds a partial unique index: at most one 'owner' member per restaurant.
--
-- Adds RESTRICTIVE write policies ("Guard: ..."). A restrictive policy can
-- only take access away: a write must pass it AND an existing permissive
-- policy. So these never grant anything new; they guarantee that:
--   * only system admins write restaurants, restaurant_members (no owner can
--     assign themselves to another restaurant) and nobody writes
--     system_admins from the API (no one can make themselves an admin);
--   * categories / menu_items are written only for restaurants the caller
--     is a member of (or by a system admin), for the old and the new row.
-- SELECT policies (including public menu reads) and Storage are untouched.
-- The service role (Edge Function) and table owners bypass RLS as before.
--
-- Why functions instead of relying on existing SELECT policies: an owner of an
-- unpublished restaurant may not be able to read its row or their own
-- membership row under the current policies, and account emails live in
-- auth.users, which the browser must never read directly.
--
-- Re-runnable: functions use CREATE OR REPLACE (guarded so an unrelated
-- function with the same name is never overwritten), policies are dropped by
-- their exact "Guard: ..." name and recreated. One transaction.

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Pre-checks
-- ---------------------------------------------------------------------------
do $$
declare
  v_marker constant text := 'owner-access-support';
  v_name text;
begin
  -- Never replace a same-named function that this migration did not create.
  foreach v_name in array array[
    'public.current_user_is_member(uuid)',
    'public.get_my_restaurants()',
    'public.admin_list_restaurant_owners()'
  ] loop
    if pg_catalog.to_regprocedure(v_name) is not null
       and coalesce(pg_catalog.obj_description(pg_catalog.to_regprocedure(v_name), 'pg_proc'), '')
           not like v_marker || '%' then
      raise exception 'Pre-check failed: % already exists and was not created by this migration', v_name;
    end if;
  end loop;

  -- A same-named policy must be one of ours (restrictive).
  if exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'public' and policyname like 'Guard: %' and permissive <> 'RESTRICTIVE'
  ) then
    raise exception 'Pre-check failed: a non-restrictive policy named "Guard: ..." exists';
  end if;

  -- The one-owner index below must not fail half-way: refuse if data
  -- already has a restaurant with two owners.
  if exists (
    select 1 from public.restaurant_members
     where role = 'owner'
     group by restaurant_id having count(*) > 1
  ) then
    raise exception 'Pre-check failed: a restaurant already has more than one owner; resolve it first';
  end if;

  if pg_catalog.to_regprocedure('public.is_system_admin()') is null then
    raise exception 'Pre-check failed: public.is_system_admin() not found';
  end if;

  -- Columns this migration relies on (verified against the live API; checked again here).
  if (select count(*) from pg_catalog.pg_attribute
       where attrelid = 'public.restaurant_members'::regclass and not attisdropped
         and attname in ('restaurant_id', 'user_id', 'role', 'created_at')) <> 4 then
    raise exception 'Pre-check failed: restaurant_members does not have restaurant_id, user_id, role, created_at';
  end if;
  if not exists (select 1 from pg_catalog.pg_attribute
                  where attrelid = 'public.categories'::regclass and attname = 'restaurant_id' and not attisdropped)
     or not exists (select 1 from pg_catalog.pg_attribute
                  where attrelid = 'public.menu_items'::regclass and attname = 'restaurant_id' and not attisdropped) then
    raise exception 'Pre-check failed: categories/menu_items.restaurant_id not found';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- At most one owner per restaurant
-- ---------------------------------------------------------------------------
-- The Edge Function checks this before inserting, but two simultaneous
-- requests could both pass that check. This index makes the database the
-- final judge (the second insert fails with 23505).
create unique index if not exists restaurant_members_one_owner_idx
  on public.restaurant_members (restaurant_id)
  where role = 'owner';

-- ---------------------------------------------------------------------------
-- public.current_user_is_member(restaurant_id)
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so it works inside policies even where the caller cannot
-- read restaurant_members. It only ever answers about the caller's own uid.
create or replace function public.current_user_is_member(p_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.restaurant_members m
     where m.restaurant_id = p_restaurant_id
       and m.user_id = (select auth.uid())
  );
$$;

comment on function public.current_user_is_member(uuid) is
  'owner-access-support: true when the calling user is a member of the restaurant';

revoke all on function public.current_user_is_member(uuid) from public;
revoke all on function public.current_user_is_member(uuid) from anon;
grant execute on function public.current_user_is_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.get_my_restaurants()
-- ---------------------------------------------------------------------------
-- The restaurants the caller is a member of, published or not. Returns the
-- table's own row type, so no column type is assumed here.
create or replace function public.get_my_restaurants()
returns setof public.restaurants
language sql
stable
security definer
set search_path = ''
as $$
  select r.*
    from public.restaurants r
   where exists (
     select 1
       from public.restaurant_members m
      where m.restaurant_id = r.id
        and m.user_id = (select auth.uid())
   )
   order by r.name;
$$;

comment on function public.get_my_restaurants() is
  'owner-access-support: restaurants the calling user is a member of';

revoke all on function public.get_my_restaurants() from public;
revoke all on function public.get_my_restaurants() from anon;
grant execute on function public.get_my_restaurants() to authenticated;

-- ---------------------------------------------------------------------------
-- public.admin_list_restaurant_owners()
-- ---------------------------------------------------------------------------
-- Members of every restaurant with their account email and status, for the
-- Super Admin dashboard. Refuses anyone who is not a system admin.
create or replace function public.admin_list_restaurant_owners()
returns table (
  restaurant_id uuid,
  user_id uuid,
  role text,
  email text,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  banned_until timestamptz,
  member_since timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_system_admin() then
    raise exception 'Only system administrators can list restaurant owners'
      using errcode = '42501';
  end if;

  return query
    select m.restaurant_id,
           m.user_id,
           m.role::text,
           u.email::text,
           u.email_confirmed_at,
           u.last_sign_in_at,
           u.banned_until,
           m.created_at::timestamptz
      from public.restaurant_members m
      left join auth.users u on u.id = m.user_id
     order by m.created_at;
end;
$$;

comment on function public.admin_list_restaurant_owners() is
  'owner-access-support: restaurant members with account status (system admins only)';

revoke all on function public.admin_list_restaurant_owners() from public;
revoke all on function public.admin_list_restaurant_owners() from anon;
grant execute on function public.admin_list_restaurant_owners() to authenticated;

-- ---------------------------------------------------------------------------
-- Restrictive write guards
-- ---------------------------------------------------------------------------

-- restaurants: only system admins insert, update or delete.
drop policy if exists "Guard: only admins insert restaurants" on public.restaurants;
create policy "Guard: only admins insert restaurants"
  on public.restaurants as restrictive for insert to authenticated
  with check ((select public.is_system_admin()));

drop policy if exists "Guard: only admins update restaurants" on public.restaurants;
create policy "Guard: only admins update restaurants"
  on public.restaurants as restrictive for update to authenticated
  using ((select public.is_system_admin()))
  with check ((select public.is_system_admin()));

drop policy if exists "Guard: only admins delete restaurants" on public.restaurants;
create policy "Guard: only admins delete restaurants"
  on public.restaurants as restrictive for delete to authenticated
  using ((select public.is_system_admin()));

-- restaurant_members: only system admins (in practice the Edge Function,
-- which uses the service role) create or change memberships.
drop policy if exists "Guard: only admins insert members" on public.restaurant_members;
create policy "Guard: only admins insert members"
  on public.restaurant_members as restrictive for insert to authenticated
  with check ((select public.is_system_admin()));

drop policy if exists "Guard: only admins update members" on public.restaurant_members;
create policy "Guard: only admins update members"
  on public.restaurant_members as restrictive for update to authenticated
  using ((select public.is_system_admin()))
  with check ((select public.is_system_admin()));

drop policy if exists "Guard: only admins delete members" on public.restaurant_members;
create policy "Guard: only admins delete members"
  on public.restaurant_members as restrictive for delete to authenticated
  using ((select public.is_system_admin()));

-- system_admins: never writable through the API. Admins are added from the
-- SQL editor (table owner), which RLS does not apply to.
drop policy if exists "Guard: no API inserts into system_admins" on public.system_admins;
create policy "Guard: no API inserts into system_admins"
  on public.system_admins as restrictive for insert to anon, authenticated
  with check (false);

drop policy if exists "Guard: no API updates to system_admins" on public.system_admins;
create policy "Guard: no API updates to system_admins"
  on public.system_admins as restrictive for update to anon, authenticated
  using (false) with check (false);

drop policy if exists "Guard: no API deletes from system_admins" on public.system_admins;
create policy "Guard: no API deletes from system_admins"
  on public.system_admins as restrictive for delete to anon, authenticated
  using (false);

-- categories: members of the row's restaurant (old and new row), or admins.
drop policy if exists "Guard: members insert own categories" on public.categories;
create policy "Guard: members insert own categories"
  on public.categories as restrictive for insert to authenticated
  with check ((select public.is_system_admin()) or public.current_user_is_member(restaurant_id));

drop policy if exists "Guard: members update own categories" on public.categories;
create policy "Guard: members update own categories"
  on public.categories as restrictive for update to authenticated
  using ((select public.is_system_admin()) or public.current_user_is_member(restaurant_id))
  with check ((select public.is_system_admin()) or public.current_user_is_member(restaurant_id));

drop policy if exists "Guard: members delete own categories" on public.categories;
create policy "Guard: members delete own categories"
  on public.categories as restrictive for delete to authenticated
  using ((select public.is_system_admin()) or public.current_user_is_member(restaurant_id));

-- menu_items: same rule.
drop policy if exists "Guard: members insert own menu items" on public.menu_items;
create policy "Guard: members insert own menu items"
  on public.menu_items as restrictive for insert to authenticated
  with check ((select public.is_system_admin()) or public.current_user_is_member(restaurant_id));

drop policy if exists "Guard: members update own menu items" on public.menu_items;
create policy "Guard: members update own menu items"
  on public.menu_items as restrictive for update to authenticated
  using ((select public.is_system_admin()) or public.current_user_is_member(restaurant_id))
  with check ((select public.is_system_admin()) or public.current_user_is_member(restaurant_id));

drop policy if exists "Guard: members delete own menu items" on public.menu_items;
create policy "Guard: members delete own menu items"
  on public.menu_items as restrictive for delete to authenticated
  using ((select public.is_system_admin()) or public.current_user_is_member(restaurant_id));

-- ---------------------------------------------------------------------------
-- Post-checks
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.current_user_is_member(uuid)',
    'public.get_my_restaurants()',
    'public.admin_list_restaurant_owners()'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_proc p
       where p.oid = pg_catalog.to_regprocedure(v_fn)
         and p.prosecdef
         and 'search_path=""' = any (p.proconfig)
    ) then
      raise exception 'Post-check failed: % is not SECURITY DEFINER with an empty search_path', v_fn;
    end if;
    if pg_catalog.has_function_privilege('anon', pg_catalog.to_regprocedure(v_fn), 'EXECUTE') then
      raise exception 'Post-check failed: anon can execute %', v_fn;
    end if;
    if not pg_catalog.has_function_privilege('authenticated', pg_catalog.to_regprocedure(v_fn), 'EXECUTE') then
      raise exception 'Post-check failed: authenticated cannot execute %', v_fn;
    end if;
  end loop;

  if (select count(*) from pg_catalog.pg_policies
       where schemaname = 'public' and policyname like 'Guard: %' and permissive = 'RESTRICTIVE') <> 15 then
    raise exception 'Post-check failed: expected 15 restrictive guard policies';
  end if;

  -- Policies only apply where RLS is enabled. Report (do not change) any
  -- guarded table without it, so it can be reviewed separately.
  for v_fn in
    select c.relname from pg_catalog.pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relname in ('restaurants', 'restaurant_members', 'system_admins', 'categories', 'menu_items')
       and not c.relrowsecurity
  loop
    raise warning 'RLS is NOT enabled on public.% - its guard policies have no effect until it is', v_fn;
  end loop;
end $$;

commit;
