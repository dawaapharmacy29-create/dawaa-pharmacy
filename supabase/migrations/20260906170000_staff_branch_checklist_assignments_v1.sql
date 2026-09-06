-- Staff + branch checklist assignments v1
-- Purpose:
-- 1) separate checklist task definitions from employee/branch responsibility;
-- 2) preserve the existing checklist UI while making the database return only due assignments;
-- 3) make production staff/branch corrections reproducible from migrations.

begin;

-- ---------------------------------------------------------------------------
-- A. Reproduce the current canonical staff corrections made on 2026-09-06.
-- ---------------------------------------------------------------------------
update public.staff
set role = 'مسؤولة النظافة', branch = 'فرع شكري', active = true, updated_at = now()
where id = '1bd09898-eb99-4c25-b6b3-4c25f109abf9'::uuid;

update public.staff
set role = 'مسؤولة النظافة', branch = 'فرع الشامي', active = true, updated_at = now()
where id = 'c628ac45-f4f5-410f-a124-ebfa761356c4'::uuid;

update public.staff
set role = 'مساعد صيدلي', branch = 'فرع الشامي', active = true, updated_at = now()
where id = 'd40cb3d7-9548-46eb-b001-2754ab692e97'::uuid;

update public.staff
set role = 'مساعد صيدلي', branch = 'فرع شكري', active = true, updated_at = now()
where id = '8088db32-c552-4f5b-9737-984d0d594b0c'::uuid;

update public.staff
set role = 'مساعد صيدلي', branch = 'فرع شكري', active = true, updated_at = now()
where id = 'bc718b18-b361-43a4-90fb-f8d7f6884b9a'::uuid;

insert into public.staff (id, name, role, branch, active, created_at, updated_at)
values (
  'b2c95319-4e74-495c-aa3d-7aa487b5ef2f'::uuid,
  'د/ محمد العزب',
  'مساعد صيدلي',
  'فرع الشامي',
  true,
  now(),
  now()
)
on conflict (id) do update set
  name = excluded.name,
  role = excluded.role,
  branch = excluded.branch,
  active = true,
  updated_at = now();

-- Keep login/account scope aligned with the canonical staff record where an account exists.
update public.staff_accounts a
set branch = s.branch,
    role = case
      when s.role = 'مسؤولة النظافة' then 'cleaning_supervisor'
      when s.role = 'مساعد صيدلي' then 'assistant'
      else a.role
    end,
    staff_name = s.name,
    name = s.name,
    updated_at = now()
from public.staff s
where a.staff_id::text = s.id::text
  and s.id in (
    '1bd09898-eb99-4c25-b6b3-4c25f109abf9'::uuid,
    'c628ac45-f4f5-410f-a124-ebfa761356c4'::uuid,
    'd40cb3d7-9548-46eb-b001-2754ab692e97'::uuid,
    '8088db32-c552-4f5b-9737-984d0d594b0c'::uuid,
    'bc718b18-b361-43a4-90fb-f8d7f6884b9a'::uuid
  )
  and coalesce(a.active,false) = true;

-- ---------------------------------------------------------------------------
-- B. Task-definition metadata.
-- ---------------------------------------------------------------------------
alter table public.staff_daily_checklist_items
  add column if not exists operation_category text not null default 'operations';

update public.staff_daily_checklist_items
set operation_category = case
  when role = 'مسؤولة النظافة' then 'cleaning'
  when item_key in ('order_stacking','shelf_fefo_check') then 'shelf'
  when item_key in ('fast_movers_spotcheck','damage_report') then 'inventory'
  else 'operations'
end
where operation_category = 'operations';

-- Add the exact branch-operation definitions requested. Definitions are intentionally
-- separate from assignments so responsibility can move between employees without
-- rewriting history or duplicating task rows.
insert into public.staff_daily_checklist_items
  (role,item_key,title,description,requires_photo,time_slot,sort_order,rule_key_on_fail,active,operation_category)
values
  ('مسؤولة النظافة','clean_door_entry','نظافة باب وواجهة الدخول','تنظيف الباب ومقبض الباب والزجاج المحيط بالمدخل والتأكد من خلوه من البقع.',true,'فتح',7,'cleaner_surfaces_miss',true,'cleaning'),
  ('مسؤولة النظافة','clean_signage','نظافة اليافطة','تنظيف اليافطة والجزء الظاهر من واجهة الصيدلية والتأكد من عدم وجود أتربة واضحة.',true,'فتح',8,'cleaner_surfaces_miss',true,'cleaning'),
  ('مساعد صيدلي','shelf_tablets','رص الأقراص والكبسولات','مراجعة رص الأقراص والكبسولات، إعادة الأصناف لمكانها، وتطبيق الأقرب انتهاءً أولًا.',true,'أثناء اليوم',20,'assistant_shelf_arrangement_miss',true,'shelf'),
  ('مساعد صيدلي','shelf_lab_supplies','رص المعمل والمستلزمات','ترتيب منطقة المعمل والمستلزمات والتأكد من سهولة الوصول وعدم وجود أصناف في غير مكانها.',true,'أثناء اليوم',21,'assistant_order_stacking_error',true,'shelf'),
  ('مساعد صيدلي','shelf_accessories','رص الإكسسوار','ترتيب الإكسسوار ومنتجات العرض بصورة منظمة وعدم وجود عبوات تالفة أو في غير مكانها.',true,'أثناء اليوم',22,'assistant_shelf_arrangement_miss',true,'shelf'),
  ('مساعد صيدلي','weekly_inventory_list','جرد قائمة الأصناف الأسبوعية','تنفيذ قائمة الجرد الأسبوعية المحددة للفرع وتسجيل أي فرق يحتاج مراجعة.',false,'أثناء اليوم',23,'assistant_inventory_discrepancy',true,'inventory')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- C. Canonical assignment layer: task definition -> staff -> branch -> cadence.
-- ---------------------------------------------------------------------------
create table if not exists public.staff_daily_checklist_assignments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.staff_daily_checklist_items(id) on delete restrict,
  staff_id uuid not null references public.staff(id) on delete restrict,
  branch text not null,
  cadence text not null default 'daily' check (cadence in ('daily','weekly')),
  weekday smallint null check (weekday between 1 and 7),
  active_from date not null default (timezone('Africa/Cairo',now()))::date,
  active_to date null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_daily_checklist_assignment_weekly_day_ck
    check ((cadence = 'daily' and weekday is null) or (cadence = 'weekly' and weekday is not null)),
  constraint staff_daily_checklist_assignment_date_ck
    check (active_to is null or active_to >= active_from)
);

create unique index if not exists uq_staff_daily_checklist_assignments_active
  on public.staff_daily_checklist_assignments(item_id,staff_id,branch)
  where active = true and active_to is null;

create index if not exists idx_staff_daily_checklist_assignments_staff_due
  on public.staff_daily_checklist_assignments(staff_id,branch,active,active_from,active_to,cadence,weekday);

create index if not exists idx_staff_daily_checklist_assignments_item
  on public.staff_daily_checklist_assignments(item_id,active);

alter table public.staff_daily_checklist_assignments enable row level security;

-- Assignment schedule helper. ISO weekday: Monday=1 ... Sunday=7.
create or replace function public.dawaa_checklist_assignment_due_v1(
  p_cadence text,
  p_weekday smallint,
  p_active_from date,
  p_active_to date,
  p_target_date date
)
returns boolean
language sql
immutable
security invoker
set search_path = public, pg_catalog
as $$
  select
    p_target_date >= p_active_from
    and (p_active_to is null or p_target_date <= p_active_to)
    and (
      p_cadence = 'daily'
      or (p_cadence = 'weekly' and extract(isodow from p_target_date)::smallint = p_weekday)
    );
$$;

revoke all on function public.dawaa_checklist_assignment_due_v1(text,smallint,date,date,date) from public;
grant execute on function public.dawaa_checklist_assignment_due_v1(text,smallint,date,date,date) to anon,authenticated;

-- Backfill existing role-based behavior into explicit assignments for every active
-- canonical employee. After this point the UI no longer needs to infer ownership from role.
insert into public.staff_daily_checklist_assignments(item_id,staff_id,branch,cadence,weekday,active_from,active)
select i.id,s.id,s.branch,'daily',null,(timezone('Africa/Cairo',now()))::date,true
from public.staff s
join public.staff_daily_checklist_items i on trim(i.role) = trim(s.role)
where coalesce(s.active,true) = true
  and i.active = true
  and i.item_key not in ('weekly_inventory_list')
on conflict do nothing;

-- Weekly inventory is defined but deliberately NOT assigned here. The requested model
-- is employee-specific; assigning it without the owner's explicit responsibility map
-- would create false accountability. It can be assigned safely once ownership is set.

-- Cleaning responsibility is unambiguous from the business mapping supplied: Heba owns
-- Shokry cleaning and Habiba owns El-Shamy cleaning. The role backfill above already
-- assigns all active cleaning definitions to each of those two employees in their branch.

-- ---------------------------------------------------------------------------
-- D. Authorization / visibility.
-- ---------------------------------------------------------------------------
drop policy if exists staff_daily_checklist_assignments_scoped_select_v1 on public.staff_daily_checklist_assignments;
create policy staff_daily_checklist_assignments_scoped_select_v1
on public.staff_daily_checklist_assignments
for select
to anon,authenticated
using (
  public.dawaa_current_staff_account_id_strict() is not null
  and (
    staff_id = public.dawaa_current_staff_subject_uuid_v1()
    or public.user_has_permission(public.dawaa_current_staff_account_id_strict(),'view_team')
  )
);

grant select on public.staff_daily_checklist_assignments to anon,authenticated;

-- Existing checklist page still queries the item table by role. This RLS policy makes
-- that existing query assignment-aware without creating a second UI data source.
drop policy if exists staff_daily_checklist_items_scoped_select_v1 on public.staff_daily_checklist_items;
create policy staff_daily_checklist_items_scoped_select_v2
on public.staff_daily_checklist_items
for select
to anon,authenticated
using (
  active
  and public.dawaa_current_staff_account_id_strict() is not null
  and (
    public.user_has_permission(public.dawaa_current_staff_account_id_strict(),'view_team')
    or exists (
      select 1
      from public.staff_daily_checklist_assignments a
      where a.item_id = staff_daily_checklist_items.id
        and a.staff_id = public.dawaa_current_staff_subject_uuid_v1()
        and a.active = true
        and public.dawaa_checklist_assignment_due_v1(
          a.cadence,a.weekday,a.active_from,a.active_to,(timezone('Africa/Cairo',now()))::date
        )
    )
  )
);

-- ---------------------------------------------------------------------------
-- E. Submission command: require an actual due assignment for this employee + branch.
-- ---------------------------------------------------------------------------
create or replace function public.submit_my_staff_daily_checklist_v1(
  p_item_id uuid,
  p_photo_url text default null::text,
  p_staff_note text default null::text
)
returns public.staff_daily_checklist_submissions
language plpgsql
security definer
set search_path to 'public','auth','pg_catalog'
as $$
declare
  v_account public.staff_accounts%rowtype;
  v_subject_id uuid;
  v_subject public.staff%rowtype;
  v_item public.staff_daily_checklist_items%rowtype;
  v_today date := (timezone('Africa/Cairo',now()))::date;
  v_row public.staff_daily_checklist_submissions%rowtype;
begin
  select * into v_account
  from public.staff_accounts
  where id = public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false) and coalesce(can_login,false);
  if not found then raise exception using errcode='42501',message='active staff actor required'; end if;

  v_subject_id := public.dawaa_current_staff_subject_uuid_v1();
  if v_subject_id is null then raise exception using errcode='42501',message='canonical staff identity required'; end if;

  select * into v_subject from public.staff where id=v_subject_id and coalesce(active,true)=true;
  if not found then raise exception using errcode='42501',message='canonical active staff record required'; end if;

  select * into v_item from public.staff_daily_checklist_items where id=p_item_id and active=true;
  if not found then raise exception using errcode='22023',message='active checklist item required'; end if;

  if not exists (
    select 1
    from public.staff_daily_checklist_assignments a
    where a.item_id = p_item_id
      and a.staff_id = v_subject_id
      and a.branch = v_subject.branch
      and a.active = true
      and public.dawaa_checklist_assignment_due_v1(a.cadence,a.weekday,a.active_from,a.active_to,v_today)
  ) then
    raise exception using errcode='42501',message='checklist task is not assigned to this employee for this branch/date';
  end if;

  if v_item.requires_photo and nullif(trim(coalesce(p_photo_url,'')),'') is null then
    raise exception using errcode='22023',message='checklist evidence photo required';
  end if;

  insert into public.staff_daily_checklist_submissions(
    staff_id,item_id,submission_date,branch,completed,photo_url,staff_note,
    submitted_at,review_status,reviewed_by,reviewed_by_name,reviewer_note,reviewed_at
  ) values (
    v_subject_id,p_item_id,v_today,v_subject.branch,true,
    nullif(trim(coalesce(p_photo_url,'')),''),nullif(trim(coalesce(p_staff_note,'')),''),
    now(),'pending',null,null,null,null
  )
  on conflict (staff_id,item_id,submission_date) do update set
    branch=excluded.branch,
    completed=true,
    photo_url=excluded.photo_url,
    staff_note=excluded.staff_note,
    submitted_at=excluded.submitted_at,
    review_status='pending',
    reviewed_by=null,
    reviewed_by_name=null,
    reviewer_note=null,
    reviewed_at=null,
    updated_at=now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.submit_my_staff_daily_checklist_v1(uuid,text,text) from public;
grant execute on function public.submit_my_staff_daily_checklist_v1(uuid,text,text) to anon,authenticated;

-- Cleaning daily rating readiness must count this employee's due assignments, not every
-- currently-active item for the whole cleaning role.
create or replace function public.get_cleaning_day_checklist_summary_v2(
  p_staff_id uuid,
  p_rating_date date default current_date
)
returns table(
  staff_id uuid,
  rating_date date,
  required_items integer,
  submitted_items integer,
  reviewed_items integer,
  approved_items integer,
  rejected_items integer,
  pending_items integer,
  max_stars integer,
  rating_ready boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_role text := lower(trim(coalesce(public.employee_operating_actor_role(),'')));
  v_self text := public.dawaa_current_staff_id_v1();
  v_actor_branch text := nullif(trim(coalesce(public.employee_operating_actor_branch(),'')), '');
  v_staff public.staff%rowtype;
  v_global boolean := v_role in ('general_manager','admin','executive_manager','branches_manager');
  v_date date := coalesce(p_rating_date,(timezone('Africa/Cairo',now()))::date);
begin
  select * into v_staff from public.staff where id=p_staff_id;
  if not found or not public.dawaa_is_cleaning_role_v1(v_staff.role) then
    raise exception 'cleaning_staff_not_found';
  end if;

  if not (p_staff_id::text=coalesce(v_self,'') or v_global or (v_role='branch_manager' and coalesce(v_staff.branch,'')=coalesce(v_actor_branch,''))) then
    raise exception 'not_authorized';
  end if;

  return query
  with due as (
    select a.item_id
    from public.staff_daily_checklist_assignments a
    join public.staff_daily_checklist_items i on i.id=a.item_id and i.active=true
    where a.staff_id=p_staff_id
      and a.branch=v_staff.branch
      and a.active=true
      and public.dawaa_checklist_assignment_due_v1(a.cadence,a.weekday,a.active_from,a.active_to,v_date)
  ), required as (
    select count(*)::integer cnt from due
  ), stats as (
    select
      count(s.id)::integer submitted,
      count(s.id) filter(where s.review_status <> 'pending')::integer reviewed,
      count(s.id) filter(where s.review_status = 'approved')::integer approved,
      count(s.id) filter(where s.review_status = 'rejected')::integer rejected,
      count(s.id) filter(where s.review_status = 'pending')::integer pending
    from due d
    left join public.staff_daily_checklist_submissions s
      on s.item_id=d.item_id and s.staff_id=p_staff_id and s.submission_date=v_date and s.completed=true
  )
  select
    p_staff_id,v_date,r.cnt,st.submitted,st.reviewed,st.approved,st.rejected,st.pending,
    case
      when r.cnt <= 0 then 1
      when st.reviewed < r.cnt then 0
      when st.approved >= r.cnt then 5
      when st.approved::numeric/r.cnt >= 0.83 then 4
      when st.approved::numeric/r.cnt >= 0.67 then 3
      when st.approved::numeric/r.cnt >= 0.50 then 2
      else 1
    end::integer,
    (r.cnt > 0 and st.submitted >= r.cnt and st.reviewed >= r.cnt and st.pending=0)
  from required r cross join stats st;
end;
$$;

revoke all on function public.get_cleaning_day_checklist_summary_v2(uuid,date) from public;
grant execute on function public.get_cleaning_day_checklist_summary_v2(uuid,date) to anon,authenticated;

commit;
