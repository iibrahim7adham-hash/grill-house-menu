-- Owner social links editing (Instagram, TikTok, Facebook, WhatsApp).
--
-- NOT APPLIED YET. Run once in the Supabase SQL editor (or `supabase db push`)
-- after review. Until then the dashboard's "روابط التواصل الاجتماعي" save
-- reports that the feature is not enabled, and the public menu keeps showing
-- whatever restaurants.socials already holds.
--
-- Adds (SECURITY DEFINER, search_path = '', EXECUTE for authenticated only):
--   public.update_my_restaurant_socials(uuid, text, text, text, text)
--     -> sets the instagram / tiktok / facebook / whatsapp keys of
--        restaurants.socials for ONE restaurant the caller is a member of,
--        and returns the updated row.
--
-- Uses the existing restaurants.socials (jsonb) column: no table or column
-- is added. Same reasoning as update_my_restaurant_profile: the restrictive
-- policy "Guard: only admins update restaurants" stays as it is, and this
-- function is a narrow write path that:
--   * checks membership of the calling user (auth.uid()) itself;
--   * changes only the socials column, and in it only these four keys
--     (any other key already stored is kept);
--   * validates every value (the dashboard checks the same rules first):
--       instagram  https://(www.)instagram.com/<path>
--       tiktok     https://(www.|vm.)tiktok.com/<path>
--       facebook   https://(www.|m.|web.)facebook.com/<path> or (www.)fb.com/<path>
--       whatsapp   +<country code><number>, 8 to 15 digits (E.164)
--     Empty or NULL removes the key.
-- No table, policy, grant or existing function is changed.
--
-- Errors (SQLSTATE):
--   42501  not signed in, or not a member of this restaurant
--   22023  invalid value; HINT names the field (instagram, tiktok, facebook, whatsapp)

begin;

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure('public.current_user_is_member(uuid)') is null then
    raise exception 'Pre-check failed: public.current_user_is_member(uuid) not found; apply 20261031150000_owner_access_support.sql first';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'restaurants'
       and column_name = 'socials' and data_type = 'jsonb'
  ) then
    raise exception 'Pre-check failed: public.restaurants.socials (jsonb) not found';
  end if;
end $$;

create or replace function public.update_my_restaurant_socials(
  p_restaurant_id uuid,
  p_instagram text,
  p_tiktok text,
  p_facebook text,
  p_whatsapp text
)
returns public.restaurants
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_instagram text := nullif(pg_catalog.btrim(p_instagram), '');
  v_tiktok    text := nullif(pg_catalog.btrim(p_tiktok), '');
  v_facebook  text := nullif(pg_catalog.btrim(p_facebook), '');
  v_whatsapp  text := nullif(pg_catalog.btrim(p_whatsapp), '');
  v_path constant text := '/[A-Za-z0-9._~@%/+-]+$';
  v_row public.restaurants;
begin
  if (select auth.uid()) is null
     or p_restaurant_id is null
     or not public.current_user_is_member(p_restaurant_id) then
    raise exception 'Not allowed to edit this restaurant'
      using errcode = '42501';
  end if;

  if v_instagram is not null and (pg_catalog.char_length(v_instagram) > 200
     or v_instagram !~ ('^https://(www\.)?instagram\.com' || v_path)) then
    raise exception 'Invalid Instagram link' using errcode = '22023', hint = 'instagram';
  end if;
  if v_tiktok is not null and (pg_catalog.char_length(v_tiktok) > 200
     or v_tiktok !~ ('^https://(www\.|vm\.)?tiktok\.com' || v_path)) then
    raise exception 'Invalid TikTok link' using errcode = '22023', hint = 'tiktok';
  end if;
  if v_facebook is not null and (pg_catalog.char_length(v_facebook) > 200
     or v_facebook !~ ('^https://((www\.|m\.|web\.)?facebook\.com|(www\.)?fb\.com)' || v_path)) then
    raise exception 'Invalid Facebook link' using errcode = '22023', hint = 'facebook';
  end if;
  if v_whatsapp is not null and v_whatsapp !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Invalid WhatsApp number' using errcode = '22023', hint = 'whatsapp';
  end if;

  update public.restaurants r
     set socials = (coalesce(r.socials, '{}'::jsonb) - array['instagram', 'tiktok', 'facebook', 'whatsapp'])
                   || pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
                        'instagram', v_instagram,
                        'tiktok', v_tiktok,
                        'facebook', v_facebook,
                        'whatsapp', v_whatsapp))
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

comment on function public.update_my_restaurant_socials(uuid, text, text, text, text) is
  'owner-restaurant-socials: members update instagram, tiktok, facebook, whatsapp in socials of their own restaurant';

revoke all on function public.update_my_restaurant_socials(uuid, text, text, text, text) from public;
revoke all on function public.update_my_restaurant_socials(uuid, text, text, text, text) from anon;
grant execute on function public.update_my_restaurant_socials(uuid, text, text, text, text) to authenticated;

do $$
declare
  v_fn constant regprocedure :=
    pg_catalog.to_regprocedure('public.update_my_restaurant_socials(uuid,text,text,text,text)');
begin
  if not exists (
    select 1 from pg_catalog.pg_proc p
     where p.oid = v_fn and p.prosecdef and 'search_path=""' = any (p.proconfig)
  ) then
    raise exception 'Post-check failed: update_my_restaurant_socials is not SECURITY DEFINER with an empty search_path';
  end if;
  if pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE') then
    raise exception 'Post-check failed: anon can execute update_my_restaurant_socials';
  end if;
  if not pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception 'Post-check failed: authenticated cannot execute update_my_restaurant_socials';
  end if;
end $$;

commit;
