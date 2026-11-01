-- Owner editing of the restaurant's location and social links
-- (Google Maps, Instagram, Facebook, TikTok, WhatsApp).
--
-- NOT APPLIED YET. Run once in the Supabase SQL editor after review. It
-- supersedes 20261031180000_owner_update_restaurant_socials.sql (never
-- applied): applying only this file is enough; if that one was applied
-- first, its 4-argument function is replaced here.
-- Until this is applied the dashboard hides the links panel (it detects the
-- function), and the public menu keeps showing what restaurants.socials holds.
--
-- Storage: the existing restaurants.socials (jsonb) column, keys
--   maps, instagram, facebook, tiktok, whatsapp
-- No table or column is added and no existing data is changed. The public
-- menu already reads socials for published restaurants (existing policies);
-- these keys hold only public links.
--
-- Adds (SECURITY DEFINER, search_path = '', EXECUTE for authenticated only):
--   public.update_my_restaurant_socials(uuid, text, text, text, text, text)
--     (p_restaurant_id, p_instagram, p_tiktok, p_facebook, p_whatsapp, p_maps)
--     -> sets those five keys of restaurants.socials for ONE restaurant the
--        caller is a member of (any other key is kept) and returns the row.
-- Same design as update_my_restaurant_profile: owners still have no direct
-- UPDATE on restaurants ("Guard: only admins update restaurants" is
-- unchanged); this is a narrow write path that checks membership itself and
-- validates every value (the dashboard checks the same rules first, see
-- shared/utils/socials.js):
--   instagram  https://(www.)instagram.com/<path>
--   tiktok     https://(www.|vm.)tiktok.com/<path>
--   facebook   https://(www.|m.|web.)facebook.com/<path> or (www.)fb.com/<path>
--   whatsapp   +<country code><number>, 8 to 15 digits (E.164)
--   maps       https://(www.)google.com/maps..., https://maps.google.com...,
--              https://maps.app.goo.gl/<id>, https://goo.gl/maps/<id>;
--              optional ?query; at most 500 characters
--   Empty or NULL removes the key.
--
-- Errors (SQLSTATE):
--   42501  not signed in, or not a member of this restaurant
--   22023  invalid value; HINT names the field (maps, instagram, tiktok, facebook, whatsapp)

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

-- The earlier 4-argument version (20261031180000), if it was applied.
drop function if exists public.update_my_restaurant_socials(uuid, text, text, text, text);

create or replace function public.update_my_restaurant_socials(
  p_restaurant_id uuid,
  p_instagram text,
  p_tiktok text,
  p_facebook text,
  p_whatsapp text,
  p_maps text
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
  v_maps      text := nullif(pg_catalog.btrim(p_maps), '');
  v_path constant text := '/[A-Za-z0-9._~@%/+-]+$';
  v_maps_path constant text := '[A-Za-z0-9._~@%/+,!:=*()-]';
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
  if v_maps is not null and (pg_catalog.char_length(v_maps) > 500
     or v_maps !~ ('^https://('
          || '(www\.)?google\.com/maps(/' || v_maps_path || '*)?'
          || '|maps\.google\.com(/' || v_maps_path || '*)?'
          || '|maps\.app\.goo\.gl/' || v_maps_path || '+'
          || '|goo\.gl/maps/' || v_maps_path || '+'
          || ')(\?[A-Za-z0-9._~@%/+,!:=&*()-]*)?$')
     or v_maps ~ '^https://maps\.google\.com$') then
    raise exception 'Invalid Google Maps link' using errcode = '22023', hint = 'maps';
  end if;

  update public.restaurants r
     set socials = (coalesce(r.socials, '{}'::jsonb) - array['instagram', 'tiktok', 'facebook', 'whatsapp', 'maps'])
                   || pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
                        'instagram', v_instagram,
                        'tiktok', v_tiktok,
                        'facebook', v_facebook,
                        'whatsapp', v_whatsapp,
                        'maps', v_maps))
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

comment on function public.update_my_restaurant_socials(uuid, text, text, text, text, text) is
  'owner-restaurant-links: members update maps, instagram, tiktok, facebook, whatsapp in socials of their own restaurant';

revoke all on function public.update_my_restaurant_socials(uuid, text, text, text, text, text) from public;
revoke all on function public.update_my_restaurant_socials(uuid, text, text, text, text, text) from anon;
grant execute on function public.update_my_restaurant_socials(uuid, text, text, text, text, text) to authenticated;

do $$
declare
  v_fn constant regprocedure :=
    pg_catalog.to_regprocedure('public.update_my_restaurant_socials(uuid,text,text,text,text,text)');
begin
  if v_fn is null then
    raise exception 'Post-check failed: update_my_restaurant_socials(uuid,text,text,text,text,text) not found';
  end if;
  if pg_catalog.to_regprocedure('public.update_my_restaurant_socials(uuid,text,text,text,text)') is not null then
    raise exception 'Post-check failed: the old 4-link update_my_restaurant_socials still exists';
  end if;
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
