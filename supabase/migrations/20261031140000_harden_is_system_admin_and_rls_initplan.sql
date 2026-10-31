-- Hardening and RLS performance fixes (F2, F3, F4, F5).
--
--   F2  Revoke EXECUTE on public.is_system_admin() from anon only.
--   F3  Pin public.is_system_admin() to an empty search_path.
--   F4  Wrap auth.uid() and public.is_system_admin() in RLS policies as
--       (SELECT ...) so Postgres evaluates them once per statement instead of
--       once per row (Supabase advisor lint "auth_rls_initplan").
--   F5  Index restaurant_members(user_id), used by every membership check.
--
-- Default privileges (F6) are deliberately NOT touched.
--
-- How F4 preserves policy logic exactly: no policy text is hard-coded here.
-- Each policy's *live* expression is read from pg_policies, only the two
-- function calls are wrapped, and the result is applied with ALTER POLICY.
-- ALTER POLICY without a TO clause keeps the policy's roles, command and
-- PERMISSIVE/RESTRICTIVE mode. No policy is created, dropped or merged.
-- Public menu-read policies (SELECT policies on restaurants, categories and
-- menu_items that apply to anon or PUBLIC) are skipped entirely.
--
-- Atomic: the whole migration is a single DO statement, so it always runs in
-- one transaction, even in the Supabase SQL Editor (which may not keep a
-- multi-statement script in one session). Any failed check raises an
-- exception and rolls back everything; nothing is left half-applied.
-- Snapshots for the post-checks are kept in local variables, not temporary
-- tables, for the same reason.
--
-- Re-runnable: every step is idempotent (ALTER FUNCTION SET, REVOKE, GRANT,
-- F5 creates the index only if no equivalent exists, and F4 only alters
-- policies that still contain an unwrapped call).

do $migration$
declare
  -- Deparsed forms of calls that are already wrapped in (SELECT ...).
  c_uid_wrapped   constant text := '( SELECT auth.uid() AS uid)';
  c_admin_wrapped constant text := '( SELECT public.is_system_admin() AS is_system_admin)';
  c_uid_mark      constant text := pg_catalog.chr(1) || 'UID' || pg_catalog.chr(1);
  c_admin_mark    constant text := pg_catalog.chr(1) || 'ADMIN' || pg_catalog.chr(1);

  v_fn regprocedure;
  v_src text;
  v_bad text;
  v_existing text;
  v_policies_before pg_catalog.pg_policies[];
  v_exec_before name[];
  v_public_has_execute boolean;
  r record;
  v_expr text;
  v_new_qual text;
  v_new_check text;
  v_needs_change boolean;
  v_sql text;
  v_altered integer := 0;
  i integer;
begin
  -- Fail fast instead of queueing behind long-running queries for the
  -- ACCESS EXCLUSIVE locks taken by ALTER POLICY.
  perform pg_catalog.set_config('lock_timeout', '5s', true);

  -- With an empty search_path, pg_policies prints every non-pg_catalog object
  -- fully qualified (auth.uid(), public.is_system_admin(), public.<table>), so
  -- the text matching in F4 is unambiguous and the rewritten expressions
  -- resolve to exactly the same objects. Transaction-local (is_local = true).
  perform pg_catalog.set_config('search_path', '', true);

  -- -------------------------------------------------------------------------
  -- Pre-checks (abort and change nothing if the database is not as expected)
  -- -------------------------------------------------------------------------

  -- Exactly one public.is_system_admin, taking no arguments.
  if (select count(*) from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'is_system_admin') <> 1 then
    raise exception 'Pre-check failed: expected exactly one function public.is_system_admin';
  end if;
  v_fn := pg_catalog.to_regprocedure('public.is_system_admin()');
  if v_fn is null then
    raise exception 'Pre-check failed: public.is_system_admin() (no arguments) not found';
  end if;

  -- F3 safety: with search_path = '' every table in the body must be
  -- schema-qualified. Refuse if system_admins appears unqualified.
  select p.prosrc into v_src from pg_catalog.pg_proc p where p.oid = v_fn;
  if v_src ~ '(^|[^.[:alnum:]_"])system_admins' then
    raise exception 'Pre-check failed: is_system_admin() references system_admins without a schema; '
      'setting search_path = '''' would break it. Qualify it as public.system_admins first.';
  end if;

  -- F2 safety: once anon loses EXECUTE, any SELECT path that anon can use and
  -- that calls is_system_admin() would fail with "permission denied for
  -- function" (function privileges are checked even inside an OR). Refuse if
  -- such a path exists, so public menu reads cannot break.
  select pg_catalog.string_agg(format('%I.%I / %s', schemaname, tablename, policyname), ', ')
    into v_bad
    from pg_catalog.pg_policies
   where schemaname in ('public', 'storage')
     and cmd in ('SELECT', 'ALL')
     and roles && array['anon', 'public']::name[]
     and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) like '%is_system_admin%'
     and pg_catalog.has_table_privilege('anon', format('%I.%I', schemaname, tablename), 'SELECT');
  if v_bad is not null then
    raise exception 'Pre-check failed: policies readable by anon call is_system_admin(): %', v_bad;
  end if;

  select pg_catalog.string_agg(p.oid::regprocedure::text, ', ')
    into v_bad
    from pg_catalog.pg_proc p
   where p.oid <> v_fn
     and not p.prosecdef
     and p.prosrc like '%is_system_admin%'
     and pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_bad is not null then
    raise exception 'Pre-check failed: SECURITY INVOKER functions callable by anon use is_system_admin(): %', v_bad;
  end if;

  select pg_catalog.string_agg(format('%I.%I', schemaname, viewname), ', ')
    into v_bad
    from pg_catalog.pg_views
   where schemaname = 'public'
     and definition like '%is_system_admin%'
     and pg_catalog.has_table_privilege('anon', format('%I.%I', schemaname, viewname), 'SELECT');
  if v_bad is not null then
    raise exception 'Pre-check failed: views readable by anon use is_system_admin(): %', v_bad;
  end if;

  -- F5: the column must exist, and the index name must not be taken by a
  -- different index.
  if not exists (
    select 1 from pg_catalog.pg_attribute
     where attrelid = pg_catalog.to_regclass('public.restaurant_members')
       and attname = 'user_id' and not attisdropped
  ) then
    raise exception 'Pre-check failed: column public.restaurant_members.user_id not found';
  end if;

  if exists (
    select 1 from pg_catalog.pg_indexes
     where schemaname = 'public' and indexname = 'restaurant_members_user_id_idx'
       and (tablename <> 'restaurant_members' or indexdef !~ '\(user_id\)$')
  ) then
    raise exception 'Pre-check failed: an index named restaurant_members_user_id_idx exists with a different definition';
  end if;

  -- -------------------------------------------------------------------------
  -- Snapshots used by the post-checks (local variables, no temp tables)
  -- -------------------------------------------------------------------------

  -- Every policy's identity, roles, command, mode and expressions.
  select pg_catalog.array_agg(p)
    into v_policies_before
    from pg_catalog.pg_policies p
   where p.schemaname in ('public', 'storage');

  -- Roles that can execute is_system_admin() now: all except anon must keep it.
  -- Built-in pg_* roles are excluded: they cannot log in, are never used by
  -- the app, and are not given explicit grants in F2.
  select pg_catalog.array_agg(ro.rolname)
    into v_exec_before
    from pg_catalog.pg_roles ro
   where ro.rolname !~ '^pg_'
     and pg_catalog.has_function_privilege(ro.oid, v_fn, 'EXECUTE');

  -- -------------------------------------------------------------------------
  -- F3: empty search_path for is_system_admin()
  -- -------------------------------------------------------------------------
  -- Prevents a caller from changing which objects the function resolves by
  -- setting their own search_path (Supabase lint "function_search_path_mutable").
  -- The body must use fully qualified names (checked above, tested below).
  alter function public.is_system_admin() set search_path = '';

  -- -------------------------------------------------------------------------
  -- F2: anon may no longer execute is_system_admin()
  -- -------------------------------------------------------------------------
  -- Visitors who are not signed in never need it: the admin page calls it only
  -- after sign-in, and delete_restaurant() is SECURITY DEFINER and not granted
  -- to anon.
  --
  -- If EXECUTE is held by PUBLIC (the Postgres default for new functions),
  -- anon inherits it from PUBLIC and "REVOKE ... FROM anon" alone has no
  -- effect. In that case every role that currently has EXECUTE through PUBLIC
  -- (except anon) first gets an explicit grant, then PUBLIC is revoked. Net
  -- effect: anon is the only application role that loses EXECUTE (built-in
  -- pg_* roles also lose the PUBLIC grant; they cannot log in and the app never
  -- uses them). The post-checks verify it.
  select p.proacl is null  -- NULL ACL means the default: EXECUTE to PUBLIC
      or exists (select 1 from pg_catalog.aclexplode(p.proacl) a
                  where a.grantee = 0 and a.privilege_type = 'EXECUTE')
    into v_public_has_execute
    from pg_catalog.pg_proc p
   where p.oid = v_fn;

  if v_public_has_execute then
    for r in
      select ro.rolname
        from pg_catalog.pg_roles ro
       where ro.rolname <> 'anon'
         and ro.rolname !~ '^pg_'
         and not ro.rolsuper
         and ro.oid <> (select p.proowner from pg_catalog.pg_proc p where p.oid = v_fn)
         and pg_catalog.has_function_privilege(ro.oid, v_fn, 'EXECUTE')
    loop
      execute format('grant execute on function public.is_system_admin() to %I', r.rolname);
      raise notice 'F2: explicit EXECUTE granted to % (previously held via PUBLIC)', r.rolname;
    end loop;

    revoke execute on function public.is_system_admin() from public;
    raise notice 'F2: EXECUTE revoked from PUBLIC';
  end if;

  revoke execute on function public.is_system_admin() from anon;

  -- -------------------------------------------------------------------------
  -- F4: evaluate auth.uid() / is_system_admin() once per statement in RLS
  -- -------------------------------------------------------------------------
  -- In pg_policies, a call that is already wrapped is printed as
  -- "( SELECT auth.uid() AS uid)". Wrapped calls are swapped for placeholders,
  -- the remaining bare calls are wrapped, then the placeholders are restored,
  -- so nothing is ever double-wrapped. Only the public schema is changed.
  for r in
    select schemaname, tablename, policyname, cmd, roles, qual, with_check
      from pg_catalog.pg_policies
     where schemaname = 'public'
       and (coalesce(qual, '') || ' ' || coalesce(with_check, ''))
           ~ '(auth\.uid\(\)|public\.is_system_admin\(\))'
     order by tablename, policyname
  loop
    -- Never touch public menu-read policies.
    if r.cmd = 'SELECT'
       and r.tablename in ('restaurants', 'categories', 'menu_items')
       and r.roles && array['anon', 'public']::name[] then
      raise notice 'F4: skipped public menu-read policy %.% / %', r.schemaname, r.tablename, r.policyname;
      continue;
    end if;

    v_needs_change := false;
    v_new_qual := r.qual;
    v_new_check := r.with_check;

    for i in 1..2 loop
      v_expr := case i when 1 then r.qual else r.with_check end;
      continue when v_expr is null;

      v_expr := replace(v_expr, c_uid_wrapped, c_uid_mark);
      v_expr := replace(v_expr, c_admin_wrapped, c_admin_mark);

      if strpos(v_expr, 'auth.uid()') > 0 or strpos(v_expr, 'public.is_system_admin()') > 0 then
        v_needs_change := true;
      end if;

      v_expr := replace(v_expr, 'auth.uid()', '(SELECT auth.uid())');
      v_expr := replace(v_expr, 'public.is_system_admin()', '(SELECT public.is_system_admin())');
      v_expr := replace(v_expr, c_uid_mark, '(SELECT auth.uid())');
      v_expr := replace(v_expr, c_admin_mark, '(SELECT public.is_system_admin())');

      if i = 1 then v_new_qual := v_expr; else v_new_check := v_expr; end if;
    end loop;

    continue when not v_needs_change;  -- already optimized (re-run)

    -- USING is only valid when the policy has one (not for INSERT policies);
    -- WITH CHECK only when the policy has one. Roles are not repeated, so
    -- ALTER POLICY keeps them unchanged.
    v_sql := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if v_new_qual is not null then
      v_sql := v_sql || ' using (' || v_new_qual || ')';
    end if;
    if v_new_check is not null then
      v_sql := v_sql || ' with check (' || v_new_check || ')';
    end if;

    execute v_sql;
    v_altered := v_altered + 1;
    raise notice 'F4: altered policy %.% / % (%)', r.schemaname, r.tablename, r.policyname, r.cmd;
  end loop;

  raise notice 'F4: % policies altered', v_altered;

  -- -------------------------------------------------------------------------
  -- F5: index for membership lookups by user
  -- -------------------------------------------------------------------------
  -- Owner policies look up restaurant_members by user_id = auth.uid(). A
  -- composite unique key that starts with restaurant_id cannot serve that.
  -- Not CONCURRENTLY: that cannot run inside a transaction, and the table is
  -- small, so the brief write lock is acceptable.
  --
  -- No duplicates: skipped when the index already exists (re-run; its
  -- definition was verified in the pre-checks) or when another valid,
  -- non-partial btree index already starts with user_id and so serves the
  -- same lookups.
  if pg_catalog.to_regclass('public.restaurant_members_user_id_idx') is not null then
    raise notice 'F5: restaurant_members_user_id_idx already exists';
  else
    select pg_catalog.string_agg(c.relname, ', ')
      into v_existing
      from pg_catalog.pg_index ix
      join pg_catalog.pg_class c on c.oid = ix.indexrelid
      join pg_catalog.pg_am am on am.oid = c.relam
      join pg_catalog.pg_attribute a
        on a.attrelid = ix.indrelid and a.attname = 'user_id' and not a.attisdropped
     where ix.indrelid = 'public.restaurant_members'::regclass
       and ix.indkey[0] = a.attnum
       and ix.indpred is null
       and ix.indisvalid
       and am.amname = 'btree';

    if v_existing is not null then
      raise notice 'F5: skipped, existing index(es) already start with user_id: %', v_existing;
    else
      create index restaurant_members_user_id_idx
        on public.restaurant_members using btree (user_id);
      raise notice 'F5: created restaurant_members_user_id_idx';
    end if;
  end if;

  -- -------------------------------------------------------------------------
  -- Post-checks (any failure rolls back everything above)
  -- -------------------------------------------------------------------------

  -- No policy was created, dropped or merged, and no policy's roles, command
  -- or mode changed.
  if exists (
    (select b.schemaname, b.tablename, b.policyname, b.permissive, b.roles, b.cmd
       from pg_catalog.unnest(v_policies_before) b
     except
     select schemaname, tablename, policyname, permissive, roles, cmd
       from pg_catalog.pg_policies
      where schemaname in ('public', 'storage'))
    union all
    (select schemaname, tablename, policyname, permissive, roles, cmd
       from pg_catalog.pg_policies
      where schemaname in ('public', 'storage')
     except
     select b.schemaname, b.tablename, b.policyname, b.permissive, b.roles, b.cmd
       from pg_catalog.unnest(v_policies_before) b)
  ) then
    raise exception 'Post-check failed: the set of policies or their roles/command/mode changed';
  end if;

  -- Public menu-read policies and all storage policies are byte-for-byte unchanged.
  if exists (
    select 1
      from pg_catalog.unnest(v_policies_before) b
      join pg_catalog.pg_policies a
        on a.schemaname = b.schemaname and a.tablename = b.tablename and a.policyname = b.policyname
     where (b.schemaname = 'storage'
            or (b.cmd = 'SELECT'
                and b.tablename in ('restaurants', 'categories', 'menu_items')
                and b.roles && array['anon', 'public']::name[]))
       and (a.qual is distinct from b.qual or a.with_check is distinct from b.with_check)
  ) then
    raise exception 'Post-check failed: a public menu-read or storage policy expression changed';
  end if;

  -- No unwrapped call left in the policies F4 is responsible for.
  select pg_catalog.string_agg(format('%I / %s', tablename, policyname), ', ')
    into v_bad
    from pg_catalog.pg_policies
   where schemaname = 'public'
     and not (cmd = 'SELECT'
              and tablename in ('restaurants', 'categories', 'menu_items')
              and roles && array['anon', 'public']::name[])
     and (replace(replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
                          c_uid_wrapped, ''),
                  c_admin_wrapped, '')
          ~ '(auth\.uid\(\)|public\.is_system_admin\(\))');
  if v_bad is not null then
    raise exception 'Post-check failed: unwrapped calls remain in: %', v_bad;
  end if;

  -- F4 logic proof: with the (SELECT ...) wrappers removed, every public
  -- policy expression must be identical to its original. Any difference other
  -- than the wrapping itself aborts the migration.
  select pg_catalog.string_agg(format('%I / %s', b.tablename, b.policyname), ', ')
    into v_bad
    from pg_catalog.unnest(v_policies_before) b
    join pg_catalog.pg_policies a
      on a.schemaname = b.schemaname and a.tablename = b.tablename and a.policyname = b.policyname
   where b.schemaname = 'public'
     and (replace(replace(a.qual, c_uid_wrapped, 'auth.uid()'), c_admin_wrapped, 'public.is_system_admin()')
            is distinct from
          replace(replace(b.qual, c_uid_wrapped, 'auth.uid()'), c_admin_wrapped, 'public.is_system_admin()')
       or replace(replace(a.with_check, c_uid_wrapped, 'auth.uid()'), c_admin_wrapped, 'public.is_system_admin()')
            is distinct from
          replace(replace(b.with_check, c_uid_wrapped, 'auth.uid()'), c_admin_wrapped, 'public.is_system_admin()'));
  if v_bad is not null then
    raise exception 'Post-check failed: policy logic changed beyond the (SELECT ...) wrapping: %', v_bad;
  end if;

  -- F3: search_path is pinned, and the function still runs with it. Here
  -- auth.uid() is NULL, so this must simply return without error.
  if not exists (
    select 1 from pg_catalog.pg_proc p
     where p.oid = v_fn and 'search_path=""' = any (p.proconfig)
  ) then
    raise exception 'Post-check failed: search_path of is_system_admin() is not empty';
  end if;
  perform public.is_system_admin();

  -- F2: anon has lost EXECUTE; every other role that had it still has it.
  if pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE') then
    raise exception 'Post-check failed: anon can still execute is_system_admin()';
  end if;

  select pg_catalog.string_agg(b.rolname, ', ')
    into v_bad
    from pg_catalog.unnest(v_exec_before) as b(rolname)
   where b.rolname <> 'anon'
     and not pg_catalog.has_function_privilege(b.rolname, v_fn, 'EXECUTE');
  if v_bad is not null then
    raise exception 'Post-check failed: roles lost EXECUTE on is_system_admin(): %', v_bad;
  end if;

  if not pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception 'Post-check failed: authenticated cannot execute is_system_admin()';
  end if;

  -- F5: a valid, non-partial btree index starting with user_id exists
  -- (the new one, or an equivalent that was already there).
  if not exists (
    select 1
      from pg_catalog.pg_index ix
      join pg_catalog.pg_class c on c.oid = ix.indexrelid
      join pg_catalog.pg_am am on am.oid = c.relam
      join pg_catalog.pg_attribute a
        on a.attrelid = ix.indrelid and a.attname = 'user_id' and not a.attisdropped
     where ix.indrelid = 'public.restaurant_members'::regclass
       and ix.indkey[0] = a.attnum
       and ix.indpred is null
       and ix.indisvalid
       and am.amname = 'btree'
  ) then
    raise exception 'Post-check failed: no usable index on restaurant_members(user_id)';
  end if;

  raise notice 'Migration completed: all post-checks passed';
end
$migration$;
