-- Owner restaurant profile editing.
--
-- Run once in the Supabase SQL editor (or with `supabase db push`).
--
-- Adds (SECURITY DEFINER, search_path = '', EXECUTE for authenticated only):
--   public.update_my_restaurant_profile(uuid, text, text, text, text, text)
--     -> updates name, tagline, phone, address and hours of ONE restaurant
--        the caller is a member of, and returns the updated row.
--
-- Why a function and not a policy change: the restrictive policy
-- "Guard: only admins update restaurants" (owner_access_support migration)
-- deliberately blocks every non-admin UPDATE on public.restaurants. Relaxing
-- it for members would let an owner change *any* column through the API
-- (slug, is_published, theme, ...), because RLS works per row, not per
-- column, and column GRANTs would also restrict system admins (same
-- `authenticated` role). Instead this function is the only owner write path:
--   * it checks membership of the *calling* user (auth.uid()) itself;
--   * its UPDATE names exactly five columns, so id, slug, is_published,
--     socials, logo/hero images, theme and created_at can never change here;
--   * it never touches restaurant_members or system_admins.
-- No table, policy, grant or existing function is changed. All RLS policies,
-- including the restrictive guards, stay exactly as they are.
--
-- The browser calls it with the owner's own session (publishable key),
-- never with a service-role key.
--
-- Re-runnable: CREATE OR REPLACE, guarded so an unrelated function with the
-- same name is never overwritten. One transaction.

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Pre-checks
-- ---------------------------------------------------------------------------
do $$
declare
  v_marker constant text := 'owner-restaurant-profile';
  v_fn constant text := 'public.update_my_restaurant_profile(uuid,text,text,text,text,text)';
begin
  if pg_catalog.to_regprocedure(v_fn) is not null
     and coalesce(pg_catalog.obj_description(pg_catalog.to_regprocedure(v_fn), 'pg_proc'), '')
         not like v_marker || '%' then
    raise exception 'Pre-check failed: % already exists and was not created by this migration', v_fn;
  end if;

  if pg_catalog.to_regprocedure('public.current_user_is_member(uuid)') is null then
    raise exception 'Pre-check failed: public.current_user_is_member(uuid) not found; apply 20261031150000_owner_access_support.sql first';
  end if;

  if (select count(*) from pg_catalog.pg_attribute
       where attrelid = 'public.restaurants'::regclass and not attisdropped
         and attname in ('id', 'name', 'tagline', 'phone', 'address', 'hours')
         and atttypid = case when attname = 'id' then 'uuid'::regtype else 'text'::regtype end) <> 6 then
    raise exception 'Pre-check failed: restaurants must have id uuid and text columns name, tagline, phone, address, hours';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- public.update_my_restaurant_profile(...)
-- ---------------------------------------------------------------------------
-- Every argument is the full new value: empty or blank optional fields are
-- stored as NULL. The limits match the dashboards' form validation; they are
-- repeated here because the browser can be bypassed.
--
-- Errors (SQLSTATE):
--   42501  not signed in, or not a member of this restaurant (also used when
--          the restaurant does not exist, so ids of other restaurants leak nothing)
--   22023  invalid value; HINT names the field (name, tagline, phone, address, hours)
create or replace function public.update_my_restaurant_profile(
  p_restaurant_id uuid,
  p_name text,
  p_tagline text,
  p_phone text,
  p_address text,
  p_hours text
)
returns public.restaurants
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_name    text := nullif(pg_catalog.btrim(p_name), '');
  v_tagline text := nullif(pg_catalog.btrim(p_tagline), '');
  v_phone   text := nullif(pg_catalog.btrim(p_phone), '');
  v_address text := nullif(pg_catalog.btrim(p_address), '');
  v_hours   text := nullif(pg_catalog.btrim(p_hours), '');
  v_row public.restaurants;
begin
  if (select auth.uid()) is null
     or p_restaurant_id is null
     or not public.current_user_is_member(p_restaurant_id) then
    raise exception 'Not allowed to edit this restaurant'
      using errcode = '42501';
  end if;

  -- Validation (single-line text, no control characters).
  if v_name is null or pg_catalog.char_length(v_name) > 120 or v_name ~ '[[:cntrl:]]' then
    raise exception 'Invalid restaurant name' using errcode = '22023', hint = 'name';
  end if;
  if v_tagline is not null and (pg_catalog.char_length(v_tagline) > 160 or v_tagline ~ '[[:cntrl:]]') then
    raise exception 'Invalid tagline' using errcode = '22023', hint = 'tagline';
  end if;
  if v_phone is not null and v_phone !~ '^[-+0-9 ()]{5,30}$' then
    raise exception 'Invalid phone number' using errcode = '22023', hint = 'phone';
  end if;
  if v_address is not null and (pg_catalog.char_length(v_address) > 200 or v_address ~ '[[:cntrl:]]') then
    raise exception 'Invalid address' using errcode = '22023', hint = 'address';
  end if;
  if v_hours is not null and (pg_catalog.char_length(v_hours) > 120 or v_hours ~ '[[:cntrl:]]') then
    raise exception 'Invalid business hours' using errcode = '22023', hint = 'hours';
  end if;

  -- Only these five columns. The membership condition is repeated in the
  -- WHERE clause so the row is only touched while the caller is a member.
  update public.restaurants r
     set name    = v_name,
         tagline = v_tagline,
         phone   = v_phone,
         address = v_address,
         hours   = v_hours
   where r.id = p_restaurant_id
     and exists (
       select 1
         from public.restaurant_members m
        where m.restaurant_id = r.id
          and m.user_id = (select auth.uid())
     )
  returning r.* into v_row;

  if not found then
    raise exception 'Not allowed to edit this restaurant'
      using errcode = '42501';
  end if;

  return v_row;
end;
$$;

comment on function public.update_my_restaurant_profile(uuid, text, text, text, text, text) is
  'owner-restaurant-profile: members update name, tagline, phone, address, hours of their own restaurant';

revoke all on function public.update_my_restaurant_profile(uuid, text, text, text, text, text) from public;
revoke all on function public.update_my_restaurant_profile(uuid, text, text, text, text, text) from anon;
grant execute on function public.update_my_restaurant_profile(uuid, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Post-checks
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn constant regprocedure :=
    pg_catalog.to_regprocedure('public.update_my_restaurant_profile(uuid,text,text,text,text,text)');
begin
  if not exists (
    select 1 from pg_catalog.pg_proc p
     where p.oid = v_fn
       and p.prosecdef
       and 'search_path=""' = any (p.proconfig)
  ) then
    raise exception 'Post-check failed: update_my_restaurant_profile is not SECURITY DEFINER with an empty search_path';
  end if;
  if pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE') then
    raise exception 'Post-check failed: anon can execute update_my_restaurant_profile';
  end if;
  if not pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception 'Post-check failed: authenticated cannot execute update_my_restaurant_profile';
  end if;

  -- The admin-only update guard must still be in place: owners keep having
  -- no direct UPDATE access to public.restaurants.
  if not exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'public' and tablename = 'restaurants'
       and policyname = 'Guard: only admins update restaurants'
       and permissive = 'RESTRICTIVE' and cmd = 'UPDATE'
  ) then
    raise warning 'Restrictive policy "Guard: only admins update restaurants" is missing; owners may be able to update restaurants directly. Review RLS on public.restaurants.';
  end if;
end $$;

commit;
