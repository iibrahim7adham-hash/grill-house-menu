-- Security / performance hardening from the Supabase advisor audit.
--
--   F2  Revoke EXECUTE on public.is_system_admin() from anon.
--       No anon-facing policy, view or function depends on it; the browser
--       only calls it after sign-in. authenticated keeps EXECUTE (RLS needs it).
--   F3  Set search_path = '' on public.is_system_admin(). Its body is already
--       fully qualified; body, return type, language, volatility and
--       SECURITY DEFINER are left untouched (ALTER FUNCTION, not CREATE).
--   F4  Rewrite 12 RLS policies so auth.uid() / public.is_system_admin() are
--       evaluated once per query instead of once per row:
--       auth.uid() -> (select auth.uid()), is_system_admin() ->
--       (select public.is_system_admin()). ALTER POLICY keeps each policy's
--       name, command, roles and permissive mode; the logic is identical.
--       The public-read / member-read SELECT policies from
--       20261031130000_fix_public_menu_read.sql are not touched.
--   F5  Index restaurant_members (user_id) for user_id-only lookups and the
--       ON DELETE CASCADE from auth.users.
--
-- No table, column, foreign key, Storage or Auth setting is changed.
--
-- The whole migration is one transaction. The pre-checks abort it (and
-- change nothing) if the database is not exactly in the audited state; the
-- post-checks abort it if the result is not exactly as intended.
--
-- Expressions are compared as Postgres deparses them in pg_policies, with
-- whitespace collapsed. search_path is pinned to public for the transaction
-- so that deparsing is deterministic (public objects unqualified, auth.*
-- qualified) and matches the audited text.

begin;

set local search_path = public;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- Expected policy state: every policy on the five public tables, before and
-- after. Rows with before = after must not change.
-- ---------------------------------------------------------------------------
create temporary table _expected_policies (
  tbl          name   not null,
  pol          name   not null,
  cmd          text   not null,
  roles        name[] not null,
  qual_before  text,
  check_before text,
  qual_after   text,
  check_after  text
) on commit drop;

insert into _expected_policies values
  -- categories: rewritten
  ('categories', 'Owners insert categories', 'INSERT', '{authenticated}',
   null,
   '(EXISTS ( SELECT 1 FROM restaurant_members rm WHERE ((rm.restaurant_id = categories.restaurant_id) AND (rm.user_id = auth.uid()))))',
   null,
   '(EXISTS ( SELECT 1 FROM restaurant_members rm WHERE ((rm.restaurant_id = categories.restaurant_id) AND (rm.user_id = ( SELECT auth.uid() AS uid)))))'),
  ('categories', 'Owners update categories', 'UPDATE', '{authenticated}',
   '(EXISTS ( SELECT 1 FROM restaurant_members rm WHERE ((rm.restaurant_id = categories.restaurant_id) AND (rm.user_id = auth.uid()))))',
   '(EXISTS ( SELECT 1 FROM restaurant_members rm WHERE ((rm.restaurant_id = categories.restaurant_id) AND (rm.user_id = auth.uid()))))',
   '(EXISTS ( SELECT 1 FROM restaurant_members rm WHERE ((rm.restaurant_id = categories.restaurant_id) AND (rm.user_id = ( SELECT auth.uid() AS uid)))))',
   '(EXISTS ( SELECT 1 FROM restaurant_members rm WHERE ((rm.restaurant_id = categories.restaurant_id) AND (rm.user_id = ( SELECT auth.uid() AS uid)))))'),
  ('categories', 'Owners delete categories', 'DELETE', '{authenticated}',
   '(EXISTS ( SELECT 1 FROM restaurant_members rm WHERE ((rm.restaurant_id = categories.restaurant_id) AND (rm.user_id = auth.uid()))))',
   null,
   '(EXISTS ( SELECT 1 FROM restaurant_members rm WHERE ((rm.restaurant_id = categories.restaurant_id) AND (rm.user_id = ( SELECT auth.uid() AS uid)))))',
   null),
  -- categories: unchanged
  ('categories', 'Public can read categories of published restaurants', 'SELECT', '{anon,authenticated}',
   '(EXISTS ( SELECT 1 FROM restaurants r WHERE ((r.id = categories.restaurant_id) AND (r.is_published = true))))', null,
   '(EXISTS ( SELECT 1 FROM restaurants r WHERE ((r.id = categories.restaurant_id) AND (r.is_published = true))))', null),
  ('categories', 'Members can read their restaurant categories', 'SELECT', '{authenticated}',
   '(EXISTS ( SELECT 1 FROM restaurant_members m WHERE ((m.restaurant_id = categories.restaurant_id) AND (m.user_id = ( SELECT auth.uid() AS uid)))))', null,
   '(EXISTS ( SELECT 1 FROM restaurant_members m WHERE ((m.restaurant_id = categories.restaurant_id) AND (m.user_id = ( SELECT auth.uid() AS uid)))))', null),

  -- menu_items: rewritten
  ('menu_items', 'Owners insert menu items', 'INSERT', '{authenticated}',
   null,
   '(EXISTS ( SELECT 1 FROM restaurant_members rm WHERE ((rm.restaurant_id = menu_items.restaurant_id) AND (rm.user_id = auth.uid()))))',
   null,
   '(EXISTS ( SELECT 1 FROM restaurant_members rm WHERE ((rm.restaurant_id = menu_items.restaurant_id) AND (rm.user_id = ( SELECT auth.uid() AS uid)))))'),
  ('menu_items', 'Owners update menu items', 'UPDATE', '{authenticated}',
   '(EXISTS ( SELECT 1 FROM restaurant_members rm WHERE ((rm.restaurant_id = menu_items.restaurant_id) AND (rm.user_id = auth.uid()))))',
   '(EXISTS ( SELECT 1 FROM restaurant_members rm WHERE ((rm.restaurant_id = menu_items.restaurant_id) AND (rm.user_id = auth.uid()))))',
   '(EXISTS ( SELECT 1 FROM restaurant_members rm WHERE ((rm.restaurant_id = menu_items.restaurant_id) AND (rm.user_id = ( SELECT auth.uid() AS uid)))))',
   '(EXISTS ( SELECT 1 FROM restaurant_members rm WHERE ((rm.restaurant_id = menu_items.restaurant_id) AND (rm.user_id = ( SELECT auth.uid() AS uid)))))'),
  ('menu_items', 'Owners delete menu items', 'DELETE', '{authenticated}',
   '(EXISTS ( SELECT 1 FROM restaurant_members rm WHERE ((rm.restaurant_id = menu_items.restaurant_id) AND (rm.user_id = auth.uid()))))',
   null,
   '(EXISTS ( SELECT 1 FROM restaurant_members rm WHERE ((rm.restaurant_id = menu_items.restaurant_id) AND (rm.user_id = ( SELECT auth.uid() AS uid)))))',
   null),
  -- menu_items: unchanged
  ('menu_items', 'Public can read menu items of published restaurants', 'SELECT', '{anon,authenticated}',
   '(EXISTS ( SELECT 1 FROM restaurants r WHERE ((r.id = menu_items.restaurant_id) AND (r.is_published = true))))', null,
   '(EXISTS ( SELECT 1 FROM restaurants r WHERE ((r.id = menu_items.restaurant_id) AND (r.is_published = true))))', null),
  ('menu_items', 'Members can read their restaurant menu items', 'SELECT', '{authenticated}',
   '(EXISTS ( SELECT 1 FROM restaurant_members m WHERE ((m.restaurant_id = menu_items.restaurant_id) AND (m.user_id = ( SELECT auth.uid() AS uid)))))', null,
   '(EXISTS ( SELECT 1 FROM restaurant_members m WHERE ((m.restaurant_id = menu_items.restaurant_id) AND (m.user_id = ( SELECT auth.uid() AS uid)))))', null),

  -- restaurant_members: rewritten
  ('restaurant_members', 'Users can view their own memberships', 'SELECT', '{authenticated}',
   '(user_id = auth.uid())', null,
   '(user_id = ( SELECT auth.uid() AS uid))', null),

  -- restaurants: rewritten
  ('restaurants', 'Owners can view their restaurants', 'SELECT', '{authenticated}',
   '(EXISTS ( SELECT 1 FROM restaurant_members rm WHERE ((rm.restaurant_id = restaurants.id) AND (rm.user_id = auth.uid()))))', null,
   '(EXISTS ( SELECT 1 FROM restaurant_members rm WHERE ((rm.restaurant_id = restaurants.id) AND (rm.user_id = ( SELECT auth.uid() AS uid)))))', null),
  ('restaurants', 'System admins can view all restaurants', 'SELECT', '{authenticated}',
   'is_system_admin()', null,
   '( SELECT is_system_admin() AS is_system_admin)', null),
  ('restaurants', 'System admins can insert restaurants', 'INSERT', '{authenticated}',
   null, 'is_system_admin()',
   null, '( SELECT is_system_admin() AS is_system_admin)'),
  ('restaurants', 'System admins can update restaurants', 'UPDATE', '{authenticated}',
   'is_system_admin()', 'is_system_admin()',
   '( SELECT is_system_admin() AS is_system_admin)', '( SELECT is_system_admin() AS is_system_admin)'),
  -- restaurants: unchanged
  ('restaurants', 'Public can view published restaurants', 'SELECT', '{anon,authenticated}',
   '(is_published = true)', null,
   '(is_published = true)', null),

  -- system_admins: rewritten
  ('system_admins', 'Admins can verify their own identity', 'SELECT', '{authenticated}',
   '(user_id = auth.uid())', null,
   '(user_id = ( SELECT auth.uid() AS uid))', null);

-- ---------------------------------------------------------------------------
-- Pre-checks
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_fn oid := to_regprocedure('public.is_system_admin()');
begin
  -- is_system_admin(): exists and matches the audited definition.
  if v_fn is null then
    raise exception 'Pre-check failed: function public.is_system_admin() not found';
  end if;

  if not exists (
    select 1
      from pg_proc p
      join pg_language l on l.oid = p.prolang
     where p.oid = v_fn
       and p.prosecdef
       and p.provolatile = 's'
       and l.lanname = 'sql'
       and p.prorettype = 'boolean'::regtype
       and pg_get_userbyid(p.proowner) = 'postgres'
       and p.proconfig = array['search_path=public']
       and btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
           = 'SELECT EXISTS ( SELECT 1 FROM public.system_admins WHERE user_id = auth.uid() );'
  ) then
    raise exception 'Pre-check failed: public.is_system_admin() differs from the audited definition';
  end if;

  if not has_function_privilege('anon', v_fn, 'EXECUTE')
     or not has_function_privilege('authenticated', v_fn, 'EXECUTE')
     or has_function_privilege('public', v_fn, 'EXECUTE') then
    raise exception 'Pre-check failed: EXECUTE privileges on public.is_system_admin() differ from the audited state';
  end if;

  -- Policies: the five tables hold exactly the audited policies, no more.
  if (select count(*) from pg_policies
       where schemaname = 'public'
         and tablename in ('restaurants', 'restaurant_members', 'categories', 'menu_items', 'system_admins'))
     <> (select count(*) from _expected_policies) then
    raise exception 'Pre-check failed: the number of policies on the five tables differs from the audited state';
  end if;

  for r in
    select e.*, p.policyname as l_pol, p.cmd as l_cmd, p.roles as l_roles, p.permissive as l_perm,
           btrim(regexp_replace(p.qual, '\s+', ' ', 'g')) as l_qual,
           btrim(regexp_replace(p.with_check, '\s+', ' ', 'g')) as l_check
      from _expected_policies e
      left join pg_policies p
        on p.schemaname = 'public' and p.tablename = e.tbl and p.policyname = e.pol
  loop
    if r.l_pol is null then
      raise exception 'Pre-check failed: policy "%" on public.% not found', r.pol, r.tbl;
    end if;
    if r.l_cmd <> r.cmd or r.l_roles <> r.roles or r.l_perm <> 'PERMISSIVE'
       or r.l_qual is distinct from r.qual_before
       or r.l_check is distinct from r.check_before then
      raise exception 'Pre-check failed: policy "%" on public.% differs from the audited state (USING: %, WITH CHECK: %)',
        r.pol, r.tbl, r.l_qual, r.l_check;
    end if;
  end loop;

  -- Index name: if it already exists it must be exactly the intended index.
  if to_regclass('public.restaurant_members_user_id_idx') is not null
     and not exists (
       select 1 from pg_indexes
        where schemaname = 'public'
          and tablename = 'restaurant_members'
          and indexname = 'restaurant_members_user_id_idx'
          and indexdef = 'CREATE INDEX restaurant_members_user_id_idx ON public.restaurant_members USING btree (user_id)'
     ) then
    raise exception 'Pre-check failed: relation public.restaurant_members_user_id_idx exists but is not the expected index';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- F2 + F3: is_system_admin()
-- ---------------------------------------------------------------------------
revoke execute on function public.is_system_admin() from anon;

alter function public.is_system_admin() set search_path = '';

-- ---------------------------------------------------------------------------
-- F4: policies (ALTER POLICY keeps name, command, roles and permissive mode)
-- ---------------------------------------------------------------------------

-- categories
alter policy "Owners insert categories" on public.categories
  with check (
    exists (
      select 1
        from public.restaurant_members rm
       where rm.restaurant_id = categories.restaurant_id
         and rm.user_id = (select auth.uid())
    )
  );

alter policy "Owners update categories" on public.categories
  using (
    exists (
      select 1
        from public.restaurant_members rm
       where rm.restaurant_id = categories.restaurant_id
         and rm.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
        from public.restaurant_members rm
       where rm.restaurant_id = categories.restaurant_id
         and rm.user_id = (select auth.uid())
    )
  );

alter policy "Owners delete categories" on public.categories
  using (
    exists (
      select 1
        from public.restaurant_members rm
       where rm.restaurant_id = categories.restaurant_id
         and rm.user_id = (select auth.uid())
    )
  );

-- menu_items
alter policy "Owners insert menu items" on public.menu_items
  with check (
    exists (
      select 1
        from public.restaurant_members rm
       where rm.restaurant_id = menu_items.restaurant_id
         and rm.user_id = (select auth.uid())
    )
  );

alter policy "Owners update menu items" on public.menu_items
  using (
    exists (
      select 1
        from public.restaurant_members rm
       where rm.restaurant_id = menu_items.restaurant_id
         and rm.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
        from public.restaurant_members rm
       where rm.restaurant_id = menu_items.restaurant_id
         and rm.user_id = (select auth.uid())
    )
  );

alter policy "Owners delete menu items" on public.menu_items
  using (
    exists (
      select 1
        from public.restaurant_members rm
       where rm.restaurant_id = menu_items.restaurant_id
         and rm.user_id = (select auth.uid())
    )
  );

-- restaurant_members
alter policy "Users can view their own memberships" on public.restaurant_members
  using (user_id = (select auth.uid()));

-- restaurants
alter policy "Owners can view their restaurants" on public.restaurants
  using (
    exists (
      select 1
        from public.restaurant_members rm
       where rm.restaurant_id = restaurants.id
         and rm.user_id = (select auth.uid())
    )
  );

alter policy "System admins can view all restaurants" on public.restaurants
  using ((select public.is_system_admin()));

alter policy "System admins can insert restaurants" on public.restaurants
  with check ((select public.is_system_admin()));

alter policy "System admins can update restaurants" on public.restaurants
  using ((select public.is_system_admin()))
  with check ((select public.is_system_admin()));

-- system_admins
alter policy "Admins can verify their own identity" on public.system_admins
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- F5: index
-- ---------------------------------------------------------------------------
create index if not exists restaurant_members_user_id_idx
  on public.restaurant_members (user_id);

-- ---------------------------------------------------------------------------
-- Post-checks
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_fn oid := to_regprocedure('public.is_system_admin()');
begin
  -- is_system_admin(): only search_path changed.
  if not exists (
    select 1
      from pg_proc p
      join pg_language l on l.oid = p.prolang
     where p.oid = v_fn
       and p.prosecdef
       and p.provolatile = 's'
       and l.lanname = 'sql'
       and p.prorettype = 'boolean'::regtype
       and pg_get_userbyid(p.proowner) = 'postgres'
       and p.proconfig = array['search_path=""']
       and btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
           = 'SELECT EXISTS ( SELECT 1 FROM public.system_admins WHERE user_id = auth.uid() );'
  ) then
    raise exception 'Post-check failed: public.is_system_admin() is not as intended';
  end if;

  if has_function_privilege('anon', v_fn, 'EXECUTE') then
    raise exception 'Post-check failed: anon can still execute public.is_system_admin()';
  end if;
  if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception 'Post-check failed: authenticated can no longer execute public.is_system_admin()';
  end if;
  if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception 'Post-check failed: service_role can no longer execute public.is_system_admin()';
  end if;
  if has_function_privilege('public', v_fn, 'EXECUTE') then
    raise exception 'Post-check failed: PUBLIC can execute public.is_system_admin()';
  end if;

  -- Nothing that anon can trigger may depend on is_system_admin() any more.
  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and (roles @> array['anon']::name[] or roles @> array['public']::name[])
       and (coalesce(qual, '') || coalesce(with_check, '')) like '%is_system_admin%'
  ) then
    raise exception 'Post-check failed: a policy that applies to anon calls is_system_admin()';
  end if;

  -- Policies: same set, same names/commands/roles, expressions as intended.
  if (select count(*) from pg_policies
       where schemaname = 'public'
         and tablename in ('restaurants', 'restaurant_members', 'categories', 'menu_items', 'system_admins'))
     <> (select count(*) from _expected_policies) then
    raise exception 'Post-check failed: the number of policies on the five tables changed';
  end if;

  for r in
    select e.*, p.policyname as l_pol, p.cmd as l_cmd, p.roles as l_roles, p.permissive as l_perm,
           btrim(regexp_replace(p.qual, '\s+', ' ', 'g')) as l_qual,
           btrim(regexp_replace(p.with_check, '\s+', ' ', 'g')) as l_check
      from _expected_policies e
      left join pg_policies p
        on p.schemaname = 'public' and p.tablename = e.tbl and p.policyname = e.pol
  loop
    if r.l_pol is null then
      raise exception 'Post-check failed: policy "%" on public.% is missing', r.pol, r.tbl;
    end if;
    if r.l_cmd <> r.cmd or r.l_roles <> r.roles or r.l_perm <> 'PERMISSIVE'
       or r.l_qual is distinct from r.qual_after
       or r.l_check is distinct from r.check_after then
      raise exception 'Post-check failed: policy "%" on public.% is not as intended (USING: %, WITH CHECK: %)',
        r.pol, r.tbl, r.l_qual, r.l_check;
    end if;
  end loop;

  -- No bare auth.uid() / is_system_admin() left in any policy on these tables.
  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('restaurants', 'restaurant_members', 'categories', 'menu_items', 'system_admins')
       and (regexp_replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
                           'SELECT (auth\.uid|is_system_admin)\(\)', '', 'g')
            ~ '(auth\.uid|is_system_admin)\(\)')
  ) then
    raise exception 'Post-check failed: a policy still calls auth.uid() or is_system_admin() per row';
  end if;

  -- Index exists, is valid and is exactly on restaurant_members (user_id).
  if not exists (
    select 1
      from pg_indexes i
      join pg_index x on x.indexrelid = to_regclass('public.restaurant_members_user_id_idx')
     where i.schemaname = 'public'
       and i.tablename = 'restaurant_members'
       and i.indexname = 'restaurant_members_user_id_idx'
       and i.indexdef = 'CREATE INDEX restaurant_members_user_id_idx ON public.restaurant_members USING btree (user_id)'
       and x.indisvalid
  ) then
    raise exception 'Post-check failed: index public.restaurant_members_user_id_idx is missing or not as intended';
  end if;
end $$;

commit;
