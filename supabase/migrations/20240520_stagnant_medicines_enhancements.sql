-- Safe enhancement for stagnant medicines and dispense records.
-- Date: 2024-05-20

create extension if not exists pgcrypto;

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  created_at timestamptz default now()
);

create table if not exists public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid,
  name text not null,
  role text,
  branch_id uuid references public.branches(id),
  branch_name text,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.user_profiles
  add column if not exists staff_id uuid,
  add column if not exists role text,
  add column if not exists branch_id uuid,
  add column if not exists branch_name text,
  add column if not exists active boolean default true,
  add column if not exists updated_at timestamptz default now();

create unique index if not exists user_profiles_staff_id_unique_idx
  on public.user_profiles(staff_id)
  where staff_id is not null;

do $$
begin
  if to_regclass('public.staff_accounts') is not null then
    insert into public.branches(name)
    select distinct coalesce(nullif(branch, ''), 'الكل')
    from public.staff_accounts
    where coalesce(nullif(branch, ''), 'الكل') is not null
      and not exists (
        select 1
        from public.branches existing
        where existing.name = coalesce(nullif(public.staff_accounts.branch, ''), 'الكل')
      );

    insert into public.user_profiles(id, staff_id, name, role, branch_id, branch_name, active)
    select
      sa.id,
      case
        when sa.staff_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then sa.staff_id::text::uuid
        else null
      end,
      coalesce(sa.name, sa.staff_name, sa.username),
      coalesce(sa.role, sa.staff_role),
      b.id,
      coalesce(nullif(sa.branch, ''), 'الكل'),
      coalesce(sa.active, true)
    from public.staff_accounts sa
    left join lateral (
      select id
      from public.branches
      where name = coalesce(nullif(sa.branch, ''), 'الكل')
      order by created_at nulls last, id
      limit 1
    ) b on true
    where sa.id is not null
    on conflict (id) do update set
      staff_id = excluded.staff_id,
      name = excluded.name,
      role = excluded.role,
      branch_id = excluded.branch_id,
      branch_name = excluded.branch_name,
      active = excluded.active,
      updated_at = now();
  end if;
end $$;

do $$
begin
  if to_regclass('public.staff') is not null then
    insert into public.branches(name)
    select distinct coalesce(nullif(branch, ''), 'الكل')
    from public.staff
    where coalesce(nullif(branch, ''), 'الكل') is not null
      and not exists (
        select 1
        from public.branches existing
        where existing.name = coalesce(nullif(public.staff.branch, ''), 'الكل')
      );

    insert into public.user_profiles(id, staff_id, name, role, branch_id, branch_name, active)
    select
      s.id,
      s.id,
      s.name,
      s.role,
      b.id,
      coalesce(nullif(s.branch, ''), 'الكل'),
      coalesce(s.active, true)
    from public.staff s
    left join lateral (
      select id
      from public.branches
      where name = coalesce(nullif(s.branch, ''), 'الكل')
      order by created_at nulls last, id
      limit 1
    ) b on true
    where s.id is not null
    on conflict (id) do update set
      name = excluded.name,
      role = excluded.role,
      branch_id = excluded.branch_id,
      branch_name = excluded.branch_name,
      active = excluded.active,
      updated_at = now();
  end if;
end $$;

create table if not exists public.stagnant_medicines (
  id uuid primary key default gen_random_uuid(),
  product_name text,
  medicine_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.stagnant_medicines
  add column if not exists product_name text,
  add column if not exists medicine_name text,
  add column if not exists product_code text,
  add column if not exists category text,
  add column if not exists usage text,
  add column if not exists product_type text,
  add column if not exists branch text,
  add column if not exists branch_id uuid references public.branches(id),
  add column if not exists branch_name text,
  add column if not exists responsible_doctor text,
  add column if not exists responsible_doctor_id uuid references public.user_profiles(id),
  add column if not exists responsible_doctor_name text,
  add column if not exists quantity_available integer default 0,
  add column if not exists total_quantity integer not null default 0,
  add column if not exists dispensed_quantity integer not null default 0,
  add column if not exists remaining_quantity integer not null default 0,
  add column if not exists expiry_date date,
  add column if not exists nearest_expiry_date date,
  add column if not exists source_file_date date,
  add column if not exists stagnant_file_date date,
  add column if not exists last_dispensed_at timestamptz,
  add column if not exists last_dispense_date date,
  add column if not exists target_min_percent numeric default 0,
  add column if not exists target_min_quantity integer default 0,
  add column if not exists minimum_remaining_percent numeric default 0,
  add column if not exists incentive_per_unit numeric default 0,
  add column if not exists status text default 'نشط',
  add column if not exists priority text default 'متوسطة',
  add column if not exists notes text,
  add column if not exists batch_details jsonb default '[]'::jsonb,
  add column if not exists uploaded_by uuid,
  add column if not exists upload_date date default current_date,
  add column if not exists created_by uuid references public.user_profiles(id),
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

update public.stagnant_medicines
set
  product_name = coalesce(nullif(product_name, ''), nullif(medicine_name, ''), 'صنف راكد'),
  medicine_name = coalesce(nullif(medicine_name, ''), nullif(product_name, ''), 'صنف راكد'),
  total_quantity = greatest(0, coalesce(nullif(total_quantity, 0), quantity_available, 0)),
  dispensed_quantity = greatest(0, coalesce(dispensed_quantity, 0)),
  remaining_quantity = greatest(0, greatest(0, coalesce(nullif(total_quantity, 0), quantity_available, 0)) - greatest(0, coalesce(dispensed_quantity, 0))),
  nearest_expiry_date = coalesce(nearest_expiry_date, expiry_date),
  stagnant_file_date = coalesce(stagnant_file_date, source_file_date, upload_date),
  branch_name = coalesce(branch_name, branch),
  responsible_doctor_name = coalesce(responsible_doctor_name, responsible_doctor),
  minimum_remaining_percent = coalesce(minimum_remaining_percent, target_min_percent, 0),
  status = coalesce(status, 'نشط'),
  priority = coalesce(priority, 'متوسطة'),
  updated_at = coalesce(updated_at, now());

alter table public.stagnant_medicines
  alter column product_name set not null,
  alter column total_quantity set not null,
  alter column dispensed_quantity set not null,
  alter column remaining_quantity set not null;

create table if not exists public.stagnant_medicine_dispenses (
  id uuid primary key default gen_random_uuid(),
  stagnant_medicine_id uuid references public.stagnant_medicines(id) on delete cascade,
  product_name text not null,
  product_code text,
  doctor_id uuid references public.user_profiles(id),
  doctor_name text not null,
  branch_id uuid references public.branches(id),
  branch_name text,
  quantity integer not null,
  incentive_per_unit numeric default 0,
  total_incentive numeric default 0,
  product_expiry_date date,
  dispensed_at timestamptz default now(),
  customer_name text,
  customer_code text,
  customer_phone text,
  invoice_no text,
  notes text,
  created_by uuid references public.user_profiles(id),
  created_at timestamptz default now()
);

alter table public.stagnant_medicine_dispenses
  add column if not exists stagnant_medicine_id uuid references public.stagnant_medicines(id) on delete cascade,
  add column if not exists product_name text,
  add column if not exists product_code text,
  add column if not exists doctor_id uuid references public.user_profiles(id),
  add column if not exists doctor_name text,
  add column if not exists branch_id uuid references public.branches(id),
  add column if not exists branch_name text,
  add column if not exists quantity integer,
  add column if not exists incentive_per_unit numeric default 0,
  add column if not exists total_incentive numeric default 0,
  add column if not exists product_expiry_date date,
  add column if not exists dispensed_at timestamptz default now(),
  add column if not exists customer_name text,
  add column if not exists customer_code text,
  add column if not exists customer_phone text,
  add column if not exists invoice_no text,
  add column if not exists notes text,
  add column if not exists created_by uuid references public.user_profiles(id),
  add column if not exists created_at timestamptz default now();

update public.stagnant_medicine_dispenses d
set
  product_name = coalesce(nullif(d.product_name, ''), m.product_name, 'صنف راكد'),
  product_code = coalesce(d.product_code, m.product_code),
  doctor_name = coalesce(nullif(d.doctor_name, ''), m.responsible_doctor_name, 'غير محدد'),
  branch_id = coalesce(d.branch_id, m.branch_id),
  branch_name = coalesce(d.branch_name, m.branch_name),
  quantity = coalesce(d.quantity, 0),
  incentive_per_unit = coalesce(d.incentive_per_unit, m.incentive_per_unit, 0),
  total_incentive = coalesce(d.total_incentive, coalesce(d.quantity, 0) * coalesce(d.incentive_per_unit, m.incentive_per_unit, 0), 0),
  product_expiry_date = coalesce(d.product_expiry_date, m.nearest_expiry_date, m.expiry_date),
  dispensed_at = coalesce(d.dispensed_at, d.created_at, now()),
  created_at = coalesce(d.created_at, now())
from public.stagnant_medicines m
where m.id = d.stagnant_medicine_id;

update public.stagnant_medicine_dispenses
set
  product_name = coalesce(nullif(product_name, ''), 'صنف راكد'),
  doctor_name = coalesce(nullif(doctor_name, ''), 'غير محدد'),
  quantity = coalesce(quantity, 0),
  incentive_per_unit = coalesce(incentive_per_unit, 0),
  total_incentive = coalesce(total_incentive, coalesce(quantity, 0) * coalesce(incentive_per_unit, 0), 0),
  dispensed_at = coalesce(dispensed_at, created_at, now()),
  created_at = coalesce(created_at, now());

alter table public.stagnant_medicine_dispenses
  alter column product_name set not null,
  alter column doctor_name set not null,
  alter column quantity set not null;

create index if not exists stagnant_medicines_branch_id_idx on public.stagnant_medicines(branch_id);
create index if not exists stagnant_medicines_responsible_doctor_id_idx on public.stagnant_medicines(responsible_doctor_id);
create index if not exists stagnant_medicines_status_idx on public.stagnant_medicines(status);
create index if not exists stagnant_medicines_priority_idx on public.stagnant_medicines(priority);
create index if not exists stagnant_medicines_nearest_expiry_date_idx on public.stagnant_medicines(nearest_expiry_date);
create index if not exists stagnant_medicine_dispenses_stagnant_medicine_id_idx on public.stagnant_medicine_dispenses(stagnant_medicine_id);
create index if not exists stagnant_medicine_dispenses_doctor_id_idx on public.stagnant_medicine_dispenses(doctor_id);
create index if not exists stagnant_medicine_dispenses_branch_id_idx on public.stagnant_medicine_dispenses(branch_id);
create index if not exists stagnant_medicine_dispenses_dispensed_at_idx on public.stagnant_medicine_dispenses(dispensed_at desc);

create or replace function public.set_stagnant_medicine_quantities()
returns trigger
language plpgsql
as $$
begin
  new.total_quantity := greatest(0, coalesce(new.total_quantity, new.quantity_available, 0));
  new.dispensed_quantity := greatest(0, coalesce(new.dispensed_quantity, 0));
  if new.total_quantity < new.dispensed_quantity then
    raise exception 'total_quantity cannot be less than dispensed_quantity';
  end if;
  new.remaining_quantity := greatest(0, new.total_quantity - new.dispensed_quantity);
  new.product_name := coalesce(nullif(new.product_name, ''), nullif(new.medicine_name, ''), 'صنف راكد');
  new.medicine_name := coalesce(nullif(new.medicine_name, ''), new.product_name);
  new.nearest_expiry_date := coalesce(new.nearest_expiry_date, new.expiry_date);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_stagnant_medicine_quantities on public.stagnant_medicines;
create trigger set_stagnant_medicine_quantities
before insert or update of product_name, medicine_name, total_quantity, quantity_available, dispensed_quantity, expiry_date, nearest_expiry_date
on public.stagnant_medicines
for each row execute function public.set_stagnant_medicine_quantities();

alter table public.stagnant_medicines enable row level security;
alter table public.stagnant_medicine_dispenses enable row level security;
alter table public.user_profiles enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stagnant_medicines' and policyname = 'Allow anon read stagnant medicines') then
    create policy "Allow anon read stagnant medicines" on public.stagnant_medicines for select to anon using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stagnant_medicines' and policyname = 'Allow anon write stagnant medicines') then
    create policy "Allow anon write stagnant medicines" on public.stagnant_medicines for all to anon using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stagnant_medicine_dispenses' and policyname = 'Allow anon read stagnant medicine dispenses') then
    create policy "Allow anon read stagnant medicine dispenses" on public.stagnant_medicine_dispenses for select to anon using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stagnant_medicine_dispenses' and policyname = 'Allow anon write stagnant medicine dispenses') then
    create policy "Allow anon write stagnant medicine dispenses" on public.stagnant_medicine_dispenses for all to anon using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_profiles' and policyname = 'Allow anon read user profiles') then
    create policy "Allow anon read user profiles" on public.user_profiles for select to anon using (true);
  end if;
end $$;
