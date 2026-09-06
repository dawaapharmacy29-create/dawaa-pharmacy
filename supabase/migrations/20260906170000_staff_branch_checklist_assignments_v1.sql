-- Staff + branch checklist assignments v1
-- Final unmerged foundation for explicit employee/branch responsibility.
-- Definition -> assignment -> due workday -> submission evidence -> review -> performance projection.

begin;

-- ---------------------------------------------------------------------------
-- A. Canonical staff corrections supplied by operations management.
-- ---------------------------------------------------------------------------
update public.staff
set role='مسؤولة النظافة',branch='فرع شكري',active=true,updated_at=now()
where id='1bd09898-eb99-4c25-b6b3-4c25f109abf9'::uuid;

update public.staff
set role='مسؤولة النظافة',branch='فرع الشامي',active=true,updated_at=now()
where id='c628ac45-f4f5-410f-a124-ebfa761356c4'::uuid;

update public.staff
set role='مساعد صيدلي',branch='فرع الشامي',active=true,updated_at=now()
where id='d40cb3d7-9548-46eb-b001-2754ab692e97'::uuid;

update public.staff
set role='مساعد صيدلي',branch='فرع شكري',active=true,updated_at=now()
where id='8088db32-c552-4f5b-9737-984d0d594b0c'::uuid;

update public.staff
set role='مساعد صيدلي',branch='فرع شكري',active=true,updated_at=now()
where id='bc718b18-b361-43a4-90fb-f8d7f6884b9a'::uuid;

insert into public.staff(id,name,role,branch,active,created_at,updated_at)
values(
  'b2c95319-4e74-495c-aa3d-7aa487b5ef2f'::uuid,
  'د/ محمد العزب','مساعد صيدلي','فرع الشامي',true,now(),now()
)
on conflict(id) do update set
  name=excluded.name,role=excluded.role,branch=excluded.branch,active=true,updated_at=now();

update public.staff_accounts a
set branch=s.branch,
    role=case
      when s.role='مسؤولة النظافة' then 'cleaning_supervisor'
      when s.role='مساعد صيدلي' then 'assistant'
      else a.role
    end,
    staff_name=s.name,
    name=s.name,
    updated_at=now()
from public.staff s
where a.staff_id::text=s.id::text
  and s.id in(
    '1bd09898-eb99-4c25-b6b3-4c25f109abf9'::uuid,
    'c628ac45-f4f5-410f-a124-ebfa761356c4'::uuid,
    'd40cb3d7-9548-46eb-b001-2754ab692e97'::uuid,
    '8088db32-c552-4f5b-9737-984d0d594b0c'::uuid,
    'bc718b18-b361-43a4-90fb-f8d7f6884b9a'::uuid
  )
  and coalesce(a.active,false)=true;

-- ---------------------------------------------------------------------------
-- B. Task-definition metadata and final 24-hour wording.
-- ---------------------------------------------------------------------------
alter table public.staff_daily_checklist_items
  add column if not exists operation_category text not null default 'operations';

update public.staff_daily_checklist_items
set operation_category=case
  when role='مسؤولة النظافة' then 'cleaning'
  else operation_category
end
where operation_category='operations';

update public.staff_daily_checklist_items
set title='نظافة الأرضيات — الفترة الصباحية',
    description='تنظيف ومسح أرضية الصالة والممرات خلال الفترة الصباحية مع الحفاظ على جاهزية المكان للعملاء طوال التشغيل.',
    requires_photo=true,
    operation_category='cleaning'
where item_key='clean_floor_open';

update public.staff_daily_checklist_items
set title='نظافة الأرضيات — الفترة الليلية',
    description='تنظيف ومسح أرضية الصالة والممرات خلال الفترة الليلية مع الحفاظ على جاهزية المكان للتشغيل المستمر.',
    requires_photo=true,
    operation_category='cleaning'
where item_key='clean_floor_close';

update public.staff_daily_checklist_items
set title='نظافة الأرفف والواجهة الزجاجية',
    description='تنظيف الأرفف والواجهة الزجاجية من الغبار والبقع وترتيب الجزء الظاهر بصورة مناسبة للعمل المستمر.',
    requires_photo=true,
    operation_category='cleaning'
where item_key='clean_shelves_glass';

insert into public.staff_daily_checklist_items(
  role,item_key,title,description,requires_photo,time_slot,sort_order,rule_key_on_fail,active,operation_category
)
values
  ('مسؤولة النظافة','clean_door_entry','نظافة باب وواجهة الدخول',
   'تنظيف باب الدخول والمقبض والزجاج المحيط بالمدخل والتأكد من خلوه من الأتربة والبقع أثناء التشغيل.',
   true,'فتح',7,'cleaner_surfaces_miss',true,'cleaning'),
  ('مسؤولة النظافة','clean_signage','نظافة اليافطة',
   'تنظيف اليافطة والجزء الظاهر من واجهة الصيدلية والتأكد من عدم وجود أتربة واضحة أثناء التشغيل.',
   true,'فتح',8,'cleaner_surfaces_miss',true,'cleaning'),
  ('مساعد صيدلي','shelf_tablets','رص الأقراص والكبسولات',
   'مراجعة رص الأقراص والكبسولات، إعادة كل صنف لمكانه الصحيح، ترتيب الواجهة، وتطبيق الأقرب انتهاءً أولًا.',
   true,'أثناء اليوم',20,'assistant_shelf_arrangement_miss',true,'shelf'),
  ('مساعد صيدلي','shelf_lab_supplies','رص المعمل والمستلزمات',
   'ترتيب منطقة المعمل والمستلزمات الطبية، تثبيت أماكن الأصناف، ومنع التكدس أو وجود صنف في غير مكانه.',
   true,'أثناء اليوم',21,'assistant_order_stacking_error',true,'shelf'),
  ('مساعد صيدلي','shelf_accessories','رص الإكسسوار',
   'ترتيب الإكسسوار ومنتجات العرض حسب الفئة، مواجهة العبوات بصورة منظمة، واستبعاد أي عبوة تالفة أو في غير مكانها.',
   true,'أثناء اليوم',22,'assistant_shelf_arrangement_miss',true,'shelf'),
  ('مساعد صيدلي','shelf_creams','رص الكريمات والجل والدهانات',
   'مراجعة رص الكريمات والجل والدهانات، إعادة كل صنف لمكانه الصحيح، وترتيب الأقرب انتهاءً بصورة واضحة.',
   true,'أثناء اليوم',23,'assistant_shelf_arrangement_miss',true,'shelf'),
  ('مساعد صيدلي','weekly_inventory_tablets','الجرد الأسبوعي — الجزء اليومي من الأقراص والكبسولات',
   'نفّذ الجزء المخطط لليوم من قائمة الجرد الأسبوعية للأقراص والكبسولات. المطلوب تقدم يومي على أيام العمل حتى إكمال نطاق الأسبوع بالكامل، مع تسجيل أي فرق يحتاج مراجعة.',
   false,'أثناء اليوم',30,'assistant_inventory_discrepancy',true,'inventory'),
  ('مساعد صيدلي','weekly_inventory_supplies','الجرد الأسبوعي — الجزء اليومي من المعمل والمستلزمات',
   'نفّذ الجزء المخطط لليوم من قائمة الجرد الأسبوعية للمعمل والمستلزمات. يستمر الجرد على أيام العمل حتى إكمال نطاق الأسبوع بالكامل، مع تسجيل الفروق أولًا بأول.',
   false,'أثناء اليوم',31,'assistant_inventory_discrepancy',true,'inventory'),
  ('مساعد صيدلي','weekly_inventory_accessories','الجرد الأسبوعي — الجزء اليومي من الإكسسوار',
   'نفّذ الجزء المخطط لليوم من قائمة الجرد الأسبوعية للإكسسوار ومنتجات العرض، بحيث يكتمل نطاق الأسبوع تدريجيًا خلال أيام العمل الستة.',
   false,'أثناء اليوم',32,'assistant_inventory_discrepancy',true,'inventory'),
  ('مساعد صيدلي','weekly_inventory_creams','الجرد الأسبوعي — الجزء اليومي من الكريمات والجل والدهانات',
   'نفّذ الجزء المخطط لليوم من قائمة الجرد الأسبوعية للكريمات والجل والدهانات، وسجّل أي فرق يوميًا حتى إكمال نطاق الأسبوع.',
   false,'أثناء اليوم',33,'assistant_inventory_discrepancy',true,'inventory')
on conflict(item_key) do update set
  title=excluded.title,
  description=excluded.description,
  requires_photo=excluded.requires_photo,
  time_slot=excluded.time_slot,
  sort_order=excluded.sort_order,
  rule_key_on_fail=excluded.rule_key_on_fail,
  active=true,
  operation_category=excluded.operation_category;

-- All active cleaning and shelf items require item-specific photo evidence.
update public.staff_daily_checklist_items
set requires_photo=true
where active=true and operation_category in('cleaning','shelf');

-- ---------------------------------------------------------------------------
-- C. Explicit assignment layer.
-- ---------------------------------------------------------------------------
create table if not exists public.staff_daily_checklist_assignments(
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.staff_daily_checklist_items(id) on delete restrict,
  staff_id uuid not null references public.staff(id) on delete restrict,
  branch text not null,
  cadence text not null default 'daily' check(cadence in('daily','weekly')),
  weekday smallint null check(weekday between 1 and 7),
  workdays_only boolean not null default false,
  active_from date not null default(timezone('Africa/Cairo',now()))::date,
  active_to date null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_daily_checklist_assignment_weekly_day_ck
    check((cadence='daily' and weekday is null) or(cadence='weekly' and weekday is not null)),
  constraint staff_daily_checklist_assignment_date_ck
    check(active_to is null or active_to>=active_from)
);

create unique index if not exists uq_staff_daily_checklist_assignments_active
  on public.staff_daily_checklist_assignments(item_id,staff_id,branch)
  where active=true and active_to is null;

create index if not exists idx_staff_daily_checklist_assignments_staff_due
  on public.staff_daily_checklist_assignments(staff_id,branch,active,active_from,active_to,cadence,weekday,workdays_only);
create index if not exists idx_staff_daily_checklist_assignments_item
  on public.staff_daily_checklist_assignments(item_id,active);

alter table public.staff_daily_checklist_assignments enable row level security;

create or replace function public.dawaa_checklist_assignment_due_v1(
  p_cadence text,p_weekday smallint,p_active_from date,p_active_to date,p_target_date date
)
returns boolean
language sql immutable security invoker
set search_path=public,pg_catalog
as $$
  select p_target_date>=p_active_from
    and(p_active_to is null or p_target_date<=p_active_to)
    and(p_cadence='daily' or(p_cadence='weekly' and extract(isodow from p_target_date)::smallint=p_weekday));
$$;

revoke all on function public.dawaa_checklist_assignment_due_v1(text,smallint,date,date,date) from public;
grant execute on function public.dawaa_checklist_assignment_due_v1(text,smallint,date,date,date) to anon,authenticated;

-- Workday source: weekly shift schedule first, staff.day_off only as fallback.
create or replace function public.dawaa_staff_scheduled_workday_v1(p_staff_id uuid,p_target_date date)
returns boolean
language plpgsql stable security invoker
set search_path=public,pg_catalog
as $$
declare
  v_day_ar text;
  v_sched public.shift_schedules%rowtype;
  v_day_off text;
begin
  if p_staff_id is null or p_target_date is null then return false; end if;
  v_day_ar:=case extract(dow from p_target_date)::int
    when 0 then 'الأحد' when 1 then 'الاثنين' when 2 then 'الثلاثاء'
    when 3 then 'الأربعاء' when 4 then 'الخميس' when 5 then 'الجمعة' else 'السبت' end;

  select ss.* into v_sched
  from public.shift_schedules ss
  where ss.staff_id=p_staff_id and trim(coalesce(ss.day_name,''))=v_day_ar
  order by ss.updated_at desc nulls last,ss.created_at desc nulls last,ss.id desc
  limit 1;
  if found then return not(coalesce(v_sched.is_off,false) or coalesce(v_sched.is_day_off,false)); end if;

  select nullif(trim(coalesce(s.day_off,'')),'') into v_day_off from public.staff s where s.id=p_staff_id;
  if v_day_off is not null and v_day_off=v_day_ar then return false; end if;
  return true;
end;
$$;

revoke all on function public.dawaa_staff_scheduled_workday_v1(uuid,date) from public;
grant execute on function public.dawaa_staff_scheduled_workday_v1(uuid,date) to anon,authenticated;

-- Preserve existing role-based checklist behavior for non-assistant roles only.
-- Assistants are intentionally excluded: their accountability is explicit per employee.
insert into public.staff_daily_checklist_assignments(
  item_id,staff_id,branch,cadence,weekday,workdays_only,active_from,active
)
select i.id,s.id,s.branch,'daily',null,false,(timezone('Africa/Cairo',now()))::date,true
from public.staff s
join public.staff_daily_checklist_items i on trim(i.role)=trim(s.role)
where coalesce(s.active,true)=true
  and i.active=true
  and trim(coalesce(s.role,''))<>'مساعد صيدلي'
on conflict do nothing;

-- Explicit assistant shelf + inventory responsibility map.
insert into public.staff_daily_checklist_assignments(
  item_id,staff_id,branch,cadence,weekday,workdays_only,active_from,active
)
select i.id,x.staff_id,x.branch,'daily',null,true,(timezone('Africa/Cairo',now()))::date,true
from public.staff_daily_checklist_items i
join(values
  ('shelf_accessories'::text,'8088db32-c552-4f5b-9737-984d0d594b0c'::uuid,'فرع شكري'::text),
  ('weekly_inventory_accessories','8088db32-c552-4f5b-9737-984d0d594b0c'::uuid,'فرع شكري'),
  ('shelf_tablets','bc718b18-b361-43a4-90fb-f8d7f6884b9a'::uuid,'فرع شكري'),
  ('weekly_inventory_tablets','bc718b18-b361-43a4-90fb-f8d7f6884b9a'::uuid,'فرع شكري'),
  ('shelf_lab_supplies','d40cb3d7-9548-46eb-b001-2754ab692e97'::uuid,'فرع الشامي'),
  ('weekly_inventory_supplies','d40cb3d7-9548-46eb-b001-2754ab692e97'::uuid,'فرع الشامي'),
  ('shelf_accessories','d40cb3d7-9548-46eb-b001-2754ab692e97'::uuid,'فرع الشامي'),
  ('weekly_inventory_accessories','d40cb3d7-9548-46eb-b001-2754ab692e97'::uuid,'فرع الشامي'),
  ('shelf_tablets','b2c95319-4e74-495c-aa3d-7aa487b5ef2f'::uuid,'فرع الشامي'),
  ('weekly_inventory_tablets','b2c95319-4e74-495c-aa3d-7aa487b5ef2f'::uuid,'فرع الشامي'),
  ('shelf_creams','b2c95319-4e74-495c-aa3d-7aa487b5ef2f'::uuid,'فرع الشامي'),
  ('weekly_inventory_creams','b2c95319-4e74-495c-aa3d-7aa487b5ef2f'::uuid,'فرع الشامي')
) as x(item_key,staff_id,branch) on x.item_key=i.item_key
on conflict do nothing;

-- Initial scoped read policy; the convergence migration hardens all downstream paths.
drop policy if exists staff_daily_checklist_assignments_scoped_select_v1 on public.staff_daily_checklist_assignments;
create policy staff_daily_checklist_assignments_scoped_select_v1
on public.staff_daily_checklist_assignments
for select to anon,authenticated
using(
  public.dawaa_current_staff_account_id_strict() is not null
  and(
    staff_id=public.dawaa_current_staff_subject_uuid_v1()
    or(
      public.user_has_permission(public.dawaa_current_staff_account_id_strict(),'view_team')
      and(
        lower(trim(coalesce(public.employee_operating_actor_role(),''))) in('general_manager','executive_manager','branches_manager','admin')
        or public.dawaa_review_coverage_branch_key_v1(branch)=public.dawaa_review_coverage_branch_key_v1(public.employee_operating_actor_branch())
      )
    )
  )
);

grant select on public.staff_daily_checklist_assignments to anon,authenticated;

commit;
