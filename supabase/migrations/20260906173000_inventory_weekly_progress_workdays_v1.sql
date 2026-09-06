-- Spread weekly inventory across each employee's six scheduled workdays.
-- Inventory is a weekly responsibility with daily progress, not a one-day weekly event.

begin;

-- Mark assignments that should only be due on a scheduled workday.
alter table public.staff_daily_checklist_assignments
  add column if not exists workdays_only boolean not null default false;

-- Canonical schedule-aware workday helper.
-- Primary source: shift_schedules. Fallback: staff.day_off when no weekly schedule row exists.
create or replace function public.dawaa_staff_scheduled_workday_v1(
  p_staff_id uuid,
  p_target_date date
)
returns boolean
language plpgsql
stable
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_day_ar text;
  v_sched public.shift_schedules%rowtype;
  v_day_off text;
begin
  if p_staff_id is null or p_target_date is null then return false; end if;

  v_day_ar := case extract(dow from p_target_date)::int
    when 0 then 'الأحد'
    when 1 then 'الاثنين'
    when 2 then 'الثلاثاء'
    when 3 then 'الأربعاء'
    when 4 then 'الخميس'
    when 5 then 'الجمعة'
    else 'السبت'
  end;

  select ss.* into v_sched
  from public.shift_schedules ss
  where ss.staff_id = p_staff_id
    and trim(coalesce(ss.day_name,'')) = v_day_ar
  order by ss.updated_at desc nulls last, ss.created_at desc nulls last, ss.id desc
  limit 1;

  if found then
    return not (coalesce(v_sched.is_off,false) or coalesce(v_sched.is_day_off,false));
  end if;

  select nullif(trim(coalesce(s.day_off,'')),'') into v_day_off
  from public.staff s
  where s.id = p_staff_id;

  if v_day_off is not null and v_day_off = v_day_ar then return false; end if;
  return true;
end;
$$;

revoke all on function public.dawaa_staff_scheduled_workday_v1(uuid,date) from public;
grant execute on function public.dawaa_staff_scheduled_workday_v1(uuid,date) to anon,authenticated;

-- Rename weekly inventory definitions to make the operating model explicit:
-- each workday completes today's part of the weekly list.
update public.staff_daily_checklist_items
set title='الجرد الأسبوعي — الجزء اليومي من الأقراص والكبسولات',
    description='نفّذ الجزء المخطط لليوم من قائمة الجرد الأسبوعية للأقراص والكبسولات. المطلوب تقدم يومي على أيام العمل حتى إكمال نطاق الأسبوع بالكامل، مع تسجيل أي فرق يحتاج مراجعة.'
where item_key='weekly_inventory_tablets';

update public.staff_daily_checklist_items
set title='الجرد الأسبوعي — الجزء اليومي من المعمل والمستلزمات',
    description='نفّذ الجزء المخطط لليوم من قائمة الجرد الأسبوعية للمعمل والمستلزمات. يستمر الجرد على أيام العمل حتى إكمال نطاق الأسبوع بالكامل، مع تسجيل الفروق أولًا بأول.'
where item_key='weekly_inventory_supplies';

update public.staff_daily_checklist_items
set title='الجرد الأسبوعي — الجزء اليومي من الإكسسوار',
    description='نفّذ الجزء المخطط لليوم من قائمة الجرد الأسبوعية للإكسسوار ومنتجات العرض، بحيث يكتمل نطاق الأسبوع تدريجيًا خلال أيام العمل الستة.'
where item_key='weekly_inventory_accessories';

update public.staff_daily_checklist_items
set title='الجرد الأسبوعي — الجزء اليومي من الكريمات والجل والدهانات',
    description='نفّذ الجزء المخطط لليوم من قائمة الجرد الأسبوعية للكريمات والجل والدهانات، وسجّل أي فرق يوميًا حتى إكمال نطاق الأسبوع.'
where item_key='weekly_inventory_creams';

-- Remove the old inactive placeholder weekly assignments and recreate the inventory
-- responsibilities as daily-on-workday assignments. No fixed weekday is used.
delete from public.staff_daily_checklist_assignments a
using public.staff_daily_checklist_items i
where a.item_id=i.id
  and i.item_key in (
    'weekly_inventory_tablets',
    'weekly_inventory_supplies',
    'weekly_inventory_accessories',
    'weekly_inventory_creams'
  );

insert into public.staff_daily_checklist_assignments(
  item_id,staff_id,branch,cadence,weekday,active_from,active,workdays_only
)
select i.id,x.staff_id,x.branch,'daily',null,(timezone('Africa/Cairo',now()))::date,true,true
from public.staff_daily_checklist_items i
join (values
  ('weekly_inventory_accessories'::text,'8088db32-c552-4f5b-9737-984d0d594b0c'::uuid,'فرع شكري'::text),
  ('weekly_inventory_tablets','bc718b18-b361-43a4-90fb-f8d7f6884b9a'::uuid,'فرع شكري'),
  ('weekly_inventory_supplies','d40cb3d7-9548-46eb-b001-2754ab692e97'::uuid,'فرع الشامي'),
  ('weekly_inventory_accessories','d40cb3d7-9548-46eb-b001-2754ab692e97'::uuid,'فرع الشامي'),
  ('weekly_inventory_tablets','b2c95319-4e74-495c-aa3d-7aa487b5ef2f'::uuid,'فرع الشامي'),
  ('weekly_inventory_creams','b2c95319-4e74-495c-aa3d-7aa487b5ef2f'::uuid,'فرع الشامي')
) as x(item_key,staff_id,branch) on x.item_key=i.item_key
on conflict do nothing;

-- Shelf responsibilities are also employee-owned work tasks, so they should not
-- become overdue on the assistant's weekly day off.
update public.staff_daily_checklist_assignments a
set workdays_only=true,
    updated_at=now()
from public.staff_daily_checklist_items i
where i.id=a.item_id
  and i.item_key in ('shelf_tablets','shelf_lab_supplies','shelf_accessories','shelf_creams')
  and a.staff_id in (
    '8088db32-c552-4f5b-9737-984d0d594b0c'::uuid,
    'bc718b18-b361-43a4-90fb-f8d7f6884b9a'::uuid,
    'd40cb3d7-9548-46eb-b001-2754ab692e97'::uuid,
    'b2c95319-4e74-495c-aa3d-7aa487b5ef2f'::uuid
  );

-- Make checklist visibility workday-aware while preserving manager visibility.
drop policy if exists staff_daily_checklist_items_scoped_select_v2 on public.staff_daily_checklist_items;
drop policy if exists staff_daily_checklist_items_scoped_select_v3 on public.staff_daily_checklist_items;
create policy staff_daily_checklist_items_scoped_select_v3
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
        and (
          not a.workdays_only
          or public.dawaa_staff_scheduled_workday_v1(
            a.staff_id,(timezone('Africa/Cairo',now()))::date
          )
        )
    )
  )
);

-- Harden submission too: a task hidden on the employee's off day cannot be submitted
-- directly by calling the RPC.
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
      and (not a.workdays_only or public.dawaa_staff_scheduled_workday_v1(a.staff_id,v_today))
  ) then
    raise exception using errcode='42501',message='checklist task is not assigned/due for this employee on this workday';
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

commit;
