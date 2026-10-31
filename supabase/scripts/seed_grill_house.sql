-- Seed: make Grill House the first restaurant managed in the database.
--
-- Copies the menu that is currently hard-coded in
-- restaurants/grill-house/index.html (6 categories, 24 items, same names,
-- descriptions, prices, images, icons and order) into public.restaurants,
-- public.categories and public.menu_items.
--
-- Run it once in the Supabase SQL Editor (as the project owner). It is a
-- single DO statement, so it is atomic: any failed check rolls everything back.
--
-- Safe by design:
--   * Never creates a second Grill House: reuses the row with slug
--     'grill-house' if it exists, and aborts if that slug belongs to a
--     restaurant that is not Grill House.
--   * Never changes an existing restaurant row, category or item: rows that
--     already exist (matched by slug / by name within the category) are left
--     exactly as they are, so re-running after owners made edits changes
--     nothing.
--   * Touches no other restaurant, no owner account and no membership:
--     assigning an owner is done later in the Super Admin dashboard.
--   * Images keep their current site paths (/restaurants/grill-house/assets/...);
--     the public menu and the owner dashboard both understand these paths.
--
-- The restaurant is created published, because the Grill House menu is
-- already public today; anonymous visitors can only read published
-- restaurants' menus (existing RLS).

do $seed$
declare
  -- Generated from restaurants/grill-house/index.html; checked by the tests.
  c_menu constant jsonb := $json$
[
  {
    "slug": "appetizers",
    "name": "المقبلات",
    "icon": "bowl",
    "sort_order": 1,
    "items": [
      {
        "name": "حمص",
        "description": "حمص كريمي معد طازجاً، يقدم بزيت الزيتون وصنوبر محمص مع خبز التنور.",
        "price": 4000,
        "image_path": "/restaurants/grill-house/assets/appetizers/hummus.webp",
        "sort_order": 1
      },
      {
        "name": "بروشيتا",
        "description": "خبز محمص مقرمش مع طماطم طازجة وريحان وثوم وزيت الزيتون.",
        "price": 5000,
        "image_path": "/restaurants/grill-house/assets/appetizers/bruschetta.webp",
        "sort_order": 2
      },
      {
        "name": "ناتشوز",
        "description": "رقائق ناتشوز مقرمشة مغطاة بالجبن الذائب والصلصة الحارة والجواكامولي.",
        "price": 6500,
        "image_path": "/restaurants/grill-house/assets/appetizers/nachos.webp",
        "sort_order": 3
      },
      {
        "name": "سلطة سيزر",
        "description": "خس طازج مع صلصة السيزر وقطع الدجاج المشوي ورقائق الجبن والخبز المحمص.",
        "price": 6000,
        "image_path": "/restaurants/grill-house/assets/appetizers/caesar-salad.webp",
        "sort_order": 4
      }
    ]
  },
  {
    "slug": "main-dishes",
    "name": "المشويات",
    "icon": "skewer",
    "sort_order": 2,
    "items": [
      {
        "name": "مشاوي مشكلة",
        "description": "تشكيلة من ألذ المشاوي المشوية على الفحم، تقدم مع الأرز والخضار المشوية.",
        "price": 22000,
        "image_path": "/restaurants/grill-house/assets/grills/mixed-grill-platter.webp",
        "sort_order": 1
      },
      {
        "name": "فيليه لحم مشوي",
        "description": "قطعة فيليه طرية مشوية على الفحم مع صلصة الفلفل الأسود.",
        "price": 25000,
        "image_path": "/restaurants/grill-house/assets/grills/grilled-beef-fillet.webp",
        "sort_order": 2
      },
      {
        "name": "شيش طاووق",
        "description": "مكعبات دجاج متبلة بخلطة الشيش التقليدية ومشوية على الفحم.",
        "price": 15000,
        "image_path": "/restaurants/grill-house/assets/grills/shish-tawook.webp",
        "sort_order": 3
      },
      {
        "name": "دجاج مشوي",
        "description": "نصف دجاجة متبلة بالأعشاب والبهارات ومشوية حتى تصبح طرية ومليئة بالنكهة.",
        "price": 12000,
        "image_path": "/restaurants/grill-house/assets/grills/grilled-chicken.webp",
        "sort_order": 4
      }
    ]
  },
  {
    "slug": "burgers",
    "name": "البرغر",
    "icon": "burger",
    "sort_order": 3,
    "items": [
      {
        "name": "برغر اللحم الكلاسيكي",
        "description": "قرص لحم بقري مشوي طازج مع الخس والطماطم والمخلل وصلصتنا الخاصة.",
        "price": 8000,
        "image_path": "/restaurants/grill-house/assets/burgers/classic-burger.webp",
        "sort_order": 1
      },
      {
        "name": "برغر باربكيو",
        "description": "قرص لحم مشوي مغطى بصلصة الباربكيو المدخنة وحلقات البصل المقرمشة.",
        "price": 9500,
        "image_path": "/restaurants/grill-house/assets/burgers/bbq-burger.webp",
        "sort_order": 2
      },
      {
        "name": "برغر الدجاج المقرمش",
        "description": "صدر دجاج مقرمش مقلي مع صلصة خاصة وخس طازج داخل خبز طري.",
        "price": 8500,
        "image_path": "/restaurants/grill-house/assets/burgers/crispy-chicken-burger.webp",
        "sort_order": 3
      },
      {
        "name": "دبل تشيز برغر",
        "description": "طبقتان من اللحم البقري مع طبقتين من الجبن الذائب وصلصتنا المميزة.",
        "price": 12000,
        "image_path": "/restaurants/grill-house/assets/burgers/double-cheese-burger.webp",
        "sort_order": 4
      }
    ]
  },
  {
    "slug": "pizza",
    "name": "البيتزا",
    "icon": "pizza",
    "sort_order": 4,
    "items": [
      {
        "name": "بيتزا مارغريتا",
        "description": "عجينة رقيقة مقرمشة مع صلصة الطماطم الطازجة وجبن الموزاريلا والريحان.",
        "price": 8000,
        "image_path": "/restaurants/grill-house/assets/pizza/margherita-pizza.webp",
        "sort_order": 1
      },
      {
        "name": "بيتزا بيبروني",
        "description": "بيتزا كلاسيكية مغطاة بشرائح البيبروني وجبن الموزاريلا الذائب.",
        "price": 10000,
        "image_path": "/restaurants/grill-house/assets/pizza/pepperoni-pizza.webp",
        "sort_order": 2
      },
      {
        "name": "بيتزا دجاج باربكيو",
        "description": "قطع دجاج مشوي مع صلصة الباربكيو والبصل الأحمر وجبن الموزاريلا.",
        "price": 12000,
        "image_path": "/restaurants/grill-house/assets/pizza/chicken-pizza.webp",
        "sort_order": 3
      },
      {
        "name": "بيتزا أربع أجبان",
        "description": "مزيج غني من أربعة أنواع من الجبن الذائب فوق عجينة طازجة ومقرمشة.",
        "price": 14000,
        "image_path": "/restaurants/grill-house/assets/pizza/four-cheese-pizza.webp",
        "sort_order": 4
      }
    ]
  },
  {
    "slug": "drinks",
    "name": "المشروبات",
    "icon": "cup",
    "sort_order": 5,
    "items": [
      {
        "name": "موهيتو",
        "description": "مشروب منعش بالليمون والنعناع الطازج مع لمسة من الصودا.",
        "price": 2500,
        "image_path": "/restaurants/grill-house/assets/drinks/mojito.webp",
        "sort_order": 1
      },
      {
        "name": "شاي مثلج",
        "description": "شاي مثلج منعش بنكهة طبيعية يقدم بارداً.",
        "price": 2000,
        "image_path": "/restaurants/grill-house/assets/drinks/iced-tea.webp",
        "sort_order": 2
      },
      {
        "name": "مشروب غازي",
        "description": "مشروبات غازية متنوعة تقدم باردة مع الثلج.",
        "price": 1500,
        "image_path": "/restaurants/grill-house/assets/drinks/pepsi.webp",
        "sort_order": 3
      },
      {
        "name": "مياه غازية",
        "description": "مياه غازية منعشة تقدم باردة، بديل خفيف للمشروبات السكرية.",
        "price": 1000,
        "image_path": "/restaurants/grill-house/assets/drinks/water.webp",
        "sort_order": 4
      }
    ]
  },
  {
    "slug": "desserts",
    "name": "الحلويات",
    "icon": "cake",
    "sort_order": 6,
    "items": [
      {
        "name": "كيك الشوكولاتة",
        "description": "قطعة كيك غنية بالشوكولاتة الداكنة مع طبقة من الصوص الذائب.",
        "price": 5500,
        "image_path": "/restaurants/grill-house/assets/desserts/chocolate-cake.webp",
        "sort_order": 1
      },
      {
        "name": "تشيز كيك",
        "description": "تشيز كيك ناعم وكريمي فوق قاعدة البسكويت مع صوص التوت.",
        "price": 6000,
        "image_path": "/restaurants/grill-house/assets/desserts/cheesecake.webp",
        "sort_order": 2
      },
      {
        "name": "براوني",
        "description": "قطعة براوني دافئة وغنية بالشوكولاتة، تقدم مع كرة آيس كريم.",
        "price": 4500,
        "image_path": "/restaurants/grill-house/assets/desserts/brownie.webp",
        "sort_order": 3
      },
      {
        "name": "آيس كريم",
        "description": "كرتان من الآيس كريم بنكهات متعددة، خيار مثالي لإنهاء وجبتكم.",
        "price": 4000,
        "image_path": "/restaurants/grill-house/assets/desserts/ice-cream.webp",
        "sort_order": 4
      }
    ]
  }
]
$json$::jsonb;

  v_restaurant_id uuid;
  v_restaurant_name text;
  v_category jsonb;
  v_item jsonb;
  v_category_id uuid;
  v_new_restaurant boolean := false;
  v_new_categories integer := 0;
  v_new_items integer := 0;
begin
  perform pg_catalog.set_config('search_path', '', true);

  -- ---------------------------------------------------------------------
  -- Pre-checks
  -- ---------------------------------------------------------------------
  if pg_catalog.jsonb_array_length(c_menu) <> 6 then
    raise exception 'Seed data must contain 6 categories';
  end if;

  select r.id, r.name into v_restaurant_id, v_restaurant_name
    from public.restaurants r
   where r.slug = 'grill-house';

  if v_restaurant_id is not null
     and pg_catalog.lower(pg_catalog.btrim(v_restaurant_name)) <> 'grill house' then
    raise exception 'Slug grill-house already belongs to restaurant "%" (id %); refusing to attach the Grill House menu to it',
      v_restaurant_name, v_restaurant_id;
  end if;

  -- ---------------------------------------------------------------------
  -- Restaurant (created once; an existing row is never modified)
  -- ---------------------------------------------------------------------
  if v_restaurant_id is null then
    insert into public.restaurants
      (slug, name, phone, address, hours, socials, hero_image, is_published)
    values (
      'grill-house',
      'Grill House',
      '+964 750 123 4567',
      'المنصور، بغداد',
      '12:00 ظهرًا – 12:00 منتصف الليل',
      '{"instagram": "https://www.instagram.com/kizuna.moments/"}'::jsonb,
      '/restaurants/grill-house/assets/hero/hero.webp',
      true
    )
    returning id into v_restaurant_id;
    v_new_restaurant := true;
  end if;

  -- ---------------------------------------------------------------------
  -- Categories and items (only missing ones are inserted)
  -- ---------------------------------------------------------------------
  for v_category in select value from pg_catalog.jsonb_array_elements(c_menu) loop
    select c.id into v_category_id
      from public.categories c
     where c.restaurant_id = v_restaurant_id
       and c.slug = v_category->>'slug';

    if v_category_id is null then
      insert into public.categories (restaurant_id, slug, name, icon, sort_order, is_visible)
      values (
        v_restaurant_id,
        v_category->>'slug',
        v_category->>'name',
        v_category->>'icon',
        (v_category->>'sort_order')::integer,
        true
      )
      returning id into v_category_id;
      v_new_categories := v_new_categories + 1;
    end if;

    for v_item in select value from pg_catalog.jsonb_array_elements(v_category->'items') loop
      if not exists (
        select 1 from public.menu_items m
         where m.restaurant_id = v_restaurant_id
           and m.category_id = v_category_id
           and m.name = v_item->>'name'
      ) then
        insert into public.menu_items
          (restaurant_id, category_id, name, description, price, image_path, is_available, sort_order)
        values (
          v_restaurant_id,
          v_category_id,
          v_item->>'name',
          v_item->>'description',
          (v_item->>'price')::integer,
          v_item->>'image_path',
          true,
          (v_item->>'sort_order')::integer
        );
        v_new_items := v_new_items + 1;
      end if;
    end loop;
  end loop;

  -- ---------------------------------------------------------------------
  -- Post-checks
  -- ---------------------------------------------------------------------
  if (select count(*) from public.restaurants where slug = 'grill-house') <> 1 then
    raise exception 'Post-check failed: expected exactly one grill-house restaurant';
  end if;
  if (select count(*) from public.categories
       where restaurant_id = v_restaurant_id
         and slug in ('appetizers', 'main-dishes', 'burgers', 'pizza', 'drinks', 'desserts')) <> 6 then
    raise exception 'Post-check failed: Grill House does not have its 6 categories';
  end if;
  if (select count(*) from public.menu_items where restaurant_id = v_restaurant_id) < 24 then
    raise exception 'Post-check failed: Grill House has fewer than 24 menu items';
  end if;

  raise notice 'Grill House %: % new categories, % new menu items (restaurant id %)',
    case when v_new_restaurant then 'created' else 'already existed' end,
    v_new_categories, v_new_items, v_restaurant_id;
end
$seed$;
