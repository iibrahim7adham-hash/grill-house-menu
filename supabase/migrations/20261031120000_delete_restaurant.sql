-- Super Admin restaurant deletion.
--
-- Run once in the Supabase SQL editor (or with `supabase db push`).
-- It adds one function and changes no table, foreign key or RLS policy.
--
-- Why a function: deleting a restaurant must also remove its menu_items,
-- categories and restaurant_members in one transaction, and only a system
-- admin may do it. The function runs as its owner (SECURITY DEFINER) so it
-- works regardless of how each table's RLS and ON DELETE rules are set up,
-- and it checks public.is_system_admin() for the *calling* user first.
-- The browser only ever calls it with the user's own session (publishable
-- key), never with a service-role key.

create or replace function public.delete_restaurant(
  p_restaurant_id uuid,
  p_confirm_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_slug text;
  v_menu_items integer;
  v_categories integer;
  v_members integer;
begin
  -- Only authenticated system admins (checked via the caller's auth.uid()).
  if auth.uid() is null or not public.is_system_admin() then
    raise exception 'Only system administrators can delete restaurants'
      using errcode = '42501';
  end if;

  -- Lock the row so it can't change while its children are removed.
  select r.name, r.slug
    into v_name, v_slug
    from public.restaurants r
   where r.id = p_restaurant_id
   for update;

  if not found then
    raise exception 'Restaurant % not found', p_restaurant_id
      using errcode = 'P0002';
  end if;

  -- Second safeguard against deleting the wrong row: the caller must also
  -- send the slug the admin typed to confirm.
  if p_confirm_slug is distinct from v_slug then
    raise exception 'Confirmation slug does not match restaurant %', p_restaurant_id
      using errcode = '22023';
  end if;

  -- Never touch another restaurant's data: refuse if any other restaurant's
  -- menu item points at one of this restaurant's categories.
  if exists (
    select 1
      from public.menu_items m
      join public.categories c on c.id = m.category_id
     where c.restaurant_id = p_restaurant_id
       and m.restaurant_id is distinct from p_restaurant_id
  ) then
    raise exception 'Menu items of another restaurant use categories of restaurant %', p_restaurant_id
      using errcode = '23503';
  end if;

  -- Children first, so this works whether the foreign keys cascade or restrict.
  delete from public.menu_items where restaurant_id = p_restaurant_id;
  get diagnostics v_menu_items = row_count;

  delete from public.categories where restaurant_id = p_restaurant_id;
  get diagnostics v_categories = row_count;

  delete from public.restaurant_members where restaurant_id = p_restaurant_id;
  get diagnostics v_members = row_count;

  delete from public.restaurants where id = p_restaurant_id;

  return jsonb_build_object(
    'id', p_restaurant_id,
    'name', v_name,
    'slug', v_slug,
    'menu_items', v_menu_items,
    'categories', v_categories,
    'restaurant_members', v_members
  );
end;
$$;

-- Callable only by signed-in users; the function itself then requires a
-- system admin. Supabase grants EXECUTE to anon by default, so revoke it.
revoke all on function public.delete_restaurant(uuid, text) from public;
revoke all on function public.delete_restaurant(uuid, text) from anon;
grant execute on function public.delete_restaurant(uuid, text) to authenticated;
