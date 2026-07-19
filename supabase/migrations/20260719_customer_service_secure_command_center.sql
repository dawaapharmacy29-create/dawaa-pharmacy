begin;

create extension if not exists pgcrypto;

alter table if exists public.daily_followups
  add column if not exists is_hidden boolean not null default false,
  add column if not exists hidden_at timestamptz,
  add column if not exists hidden_by text,
  add column if not exists hidden_reason text,
  add column if not exists postponed_until timestamptz,
  add column if not exists next_followup_date timestamptz,
  add column if not exists followup_datetime timestamptz,
  add column if not exists request_type text,
  add column if not exists request_details text,
  add column if not exists request_status text,
  add column if not exists assigned_doctor text,
  add column if not exists responsible_name text,
  add column if not exists created_by_name text,
  add column if not exists followup_notes text,
  add column if not exists updated_by text,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by text,
  add column if not exists archive_reason text,
  add column if not exists cancelled_reason text,
  add column if not exists completed_by text,
  add column if not exists evaluation_summary text,
  add column if not exists evaluation_score numeric,
  add column if not exists source_batch_id uuid,
  add column if not exists source_row_number integer;

update public.daily_followups set is_hidden=false where is_hidden is null;

create table if not exists public.customer_followup_events (
  id uuid primary key default gen_random_uuid(),
  followup_id text not null,
  customer_id text,
  customer_code text,
  event_type text not null,
  old_status text,
  new_status text,
  event_note text,
  event_payload jsonb not null default '{}'::jsonb,
  branch text,
  actor_id text,
  actor_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.customer_followup_import_batches (
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  branch text,
  scheduled_for timestamptz,
  status text not null default 'uploaded',
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  inserted_rows integer not null default 0,
  skipped_rows integer not null default 0,
  error_rows integer not null default 0,
  created_by text,
  created_by_name text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  notes text,
  constraint customer_followup_import_batches_status_chk check (status in ('uploaded','validated','processing','completed','completed_with_errors','failed','cancelled'))
);

create table if not exists public.customer_followup_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.customer_followup_import_batches(id) on delete cascade,
  row_number integer not null,
  customer_code text,
  customer_name text,
  phone text,
  branch text,
  followup_reason text,
  priority text,
  assigned_to text,
  scheduled_for timestamptz,
  raw_payload jsonb not null default '{}'::jsonb,
  validation_status text not null default 'pending',
  validation_error text,
  created_followup_id text,
  created_at timestamptz not null default now(),
  constraint customer_followup_import_rows_validation_chk check (validation_status in ('pending','valid','invalid','created','skipped','failed')),
  unique(batch_id,row_number)
);

create index if not exists daily_followups_visible_queue_idx on public.daily_followups (is_hidden,followup_date desc,created_at desc);
create index if not exists daily_followups_hidden_archive_idx on public.daily_followups (hidden_at desc) where is_hidden=true;
create index if not exists daily_followups_postponed_until_idx on public.daily_followups (postponed_until) where postponed_until is not null;
create index if not exists daily_followups_exceptional_idx on public.daily_followups (followup_type,request_type,created_at desc);
create index if not exists daily_followups_source_batch_idx on public.daily_followups (source_batch_id,source_row_number) where source_batch_id is not null;
create index if not exists customer_followup_events_followup_created_idx on public.customer_followup_events (followup_id,created_at desc);
create index if not exists customer_followup_events_customer_code_created_idx on public.customer_followup_events (customer_code,created_at desc) where customer_code is not null;
create index if not exists customer_followup_events_branch_created_idx on public.customer_followup_events (branch,created_at desc);
create index if not exists customer_followup_import_rows_batch_status_idx on public.customer_followup_import_rows (batch_id,validation_status,row_number);

alter table public.customer_followup_events enable row level security;
alter table public.customer_followup_import_batches enable row level security;
alter table public.customer_followup_import_rows enable row level security;

revoke all on public.customer_followup_events from anon,authenticated;
revoke all on public.customer_followup_import_batches from anon,authenticated;
revoke all on public.customer_followup_import_rows from anon,authenticated;
grant select on public.customer_followup_events to authenticated;
grant select,insert,update on public.customer_followup_import_batches to authenticated;
grant select,insert,update on public.customer_followup_import_rows to authenticated;

drop policy if exists customer_followup_events_staff_select on public.customer_followup_events;
create policy customer_followup_events_staff_select on public.customer_followup_events for select to authenticated using (public.dawaa_current_staff_account_id_strict() is not null);
drop policy if exists customer_followup_import_batches_staff_select on public.customer_followup_import_batches;
create policy customer_followup_import_batches_staff_select on public.customer_followup_import_batches for select to authenticated using (public.dawaa_current_staff_account_id_strict() is not null);
drop policy if exists customer_followup_import_batches_staff_insert on public.customer_followup_import_batches;
create policy customer_followup_import_batches_staff_insert on public.customer_followup_import_batches for insert to authenticated with check (public.dawaa_current_staff_account_id_strict() is not null);
drop policy if exists customer_followup_import_batches_staff_update on public.customer_followup_import_batches;
create policy customer_followup_import_batches_staff_update on public.customer_followup_import_batches for update to authenticated using (public.dawaa_current_staff_account_id_strict() is not null) with check (public.dawaa_current_staff_account_id_strict() is not null);
drop policy if exists customer_followup_import_rows_staff_select on public.customer_followup_import_rows;
create policy customer_followup_import_rows_staff_select on public.customer_followup_import_rows for select to authenticated using (public.dawaa_current_staff_account_id_strict() is not null);
drop policy if exists customer_followup_import_rows_staff_insert on public.customer_followup_import_rows;
create policy customer_followup_import_rows_staff_insert on public.customer_followup_import_rows for insert to authenticated with check (public.dawaa_current_staff_account_id_strict() is not null);
drop policy if exists customer_followup_import_rows_staff_update on public.customer_followup_import_rows;
create policy customer_followup_import_rows_staff_update on public.customer_followup_import_rows for update to authenticated using (public.dawaa_current_staff_account_id_strict() is not null) with check (public.dawaa_current_staff_account_id_strict() is not null);

create or replace function public.dawaa_parse_followup_datetime_v1(p_value text)
returns timestamptz language plpgsql immutable set search_path=public,pg_catalog as $$
declare v text:=nullif(trim(coalesce(p_value,'')),''); r timestamptz;
begin
  if v is null then return null; end if;
  begin r:=v::timestamptz;
  exception when others then
    begin r:=replace(v,'T',' ')::timestamp at time zone 'Africa/Cairo';
    exception when others then raise exception 'موعد المتابعة غير صحيح. اختر التاريخ والوقت من الحقل المخصص.' using errcode='22007'; end;
  end;
  return r;
end $$;

create or replace function public.dawaa_require_customer_service_actor_v1(p_manager_only boolean default false)
returns public.staff_accounts language plpgsql stable security definer set search_path=public,auth,pg_catalog as $$
declare v_id uuid; a public.staff_accounts; r text; allowed boolean;
begin
  v_id:=public.dawaa_current_staff_account_id_strict();
  if v_id is null then raise exception 'يجب تسجيل الدخول بحساب موظف نشط'; end if;
  select * into a from public.staff_accounts where id=v_id and coalesce(active,false) and coalesce(can_login,false);
  if not found then raise exception 'حساب الموظف غير نشط أو غير مصرح له'; end if;
  r:=lower(trim(coalesce(a.role,a.staff_role,'')));
  allowed:=r in ('admin','manager','general_manager','executive_manager','branches_manager','branch_manager','customer_service_manager','owner') or r like '%مدير%' or coalesce((a.permissions->>'manage_customer_service')::boolean,false);
  if p_manager_only and not allowed then raise exception 'الأرشفة والاستعادة متاحة للمدير أو مسؤول خدمة العملاء المخول فقط'; end if;
  return a;
end $$;

create or replace function public.dawaa_log_customer_followup_event_v1(p_followup_id text,p_event_type text,p_old_status text default null,p_new_status text default null,p_event_note text default null,p_event_payload jsonb default '{}'::jsonb,p_actor_id text default null,p_actor_name text default null)
returns uuid language plpgsql security definer set search_path=public,auth,pg_catalog as $$
declare a public.staff_accounts; f public.daily_followups%rowtype; eid uuid;
begin
  a:=public.dawaa_require_customer_service_actor_v1(false);
  select * into f from public.daily_followups where id=p_followup_id;
  if not found then raise exception 'المتابعة غير موجودة'; end if;
  insert into public.customer_followup_events(followup_id,customer_id,customer_code,event_type,old_status,new_status,event_note,event_payload,branch,actor_id,actor_name)
  values(f.id::text,f.customer_id::text,f.customer_code,trim(p_event_type),p_old_status,p_new_status,nullif(trim(coalesce(p_event_note,'')),''),coalesce(p_event_payload,'{}'::jsonb),f.branch,a.id::text,coalesce(a.name,a.username)) returning id into eid;
  return eid;
end $$;

create or replace function public.dawaa_archive_customer_followup_v1(p_followup_id text,p_reason text,p_actor text default null)
returns public.daily_followups language plpgsql security definer set search_path=public,auth,pg_catalog as $$
declare a public.staff_accounts; f public.daily_followups;
begin
  a:=public.dawaa_require_customer_service_actor_v1(true);
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'سبب الأرشفة مطلوب'; end if;
  update public.daily_followups set is_hidden=true,hidden_at=now(),hidden_by=coalesce(a.name,a.username),hidden_reason=trim(p_reason),updated_at=now(),updated_by=a.id::text where id=p_followup_id returning * into f;
  if not found then raise exception 'المتابعة غير موجودة أو لا يمكن أرشفتها'; end if;
  perform public.dawaa_log_customer_followup_event_v1(p_followup_id,'archived',coalesce(f.followup_status,f.status),'مؤرشف',trim(p_reason),'{}'::jsonb,a.id::text,coalesce(a.name,a.username));
  return f;
end $$;

create or replace function public.dawaa_restore_customer_followup_v1(p_followup_id text,p_actor text default null)
returns public.daily_followups language plpgsql security definer set search_path=public,auth,pg_catalog as $$
declare a public.staff_accounts; f public.daily_followups;
begin
  a:=public.dawaa_require_customer_service_actor_v1(true);
  update public.daily_followups set is_hidden=false,hidden_at=null,hidden_by=null,hidden_reason=null,updated_at=now(),updated_by=a.id::text where id=p_followup_id returning * into f;
  if not found then raise exception 'المتابعة غير موجودة أو لا يمكن استعادتها'; end if;
  perform public.dawaa_log_customer_followup_event_v1(p_followup_id,'restored','مؤرشف',coalesce(f.followup_status,f.status),'تمت استعادة المتابعة','{}'::jsonb,a.id::text,coalesce(a.name,a.username));
  return f;
end $$;

create or replace function public.dawaa_postpone_customer_followup_v1(p_followup_id text,p_postponed_until text,p_actor text default null)
returns public.daily_followups language plpgsql security definer set search_path=public,auth,pg_catalog as $$
declare a public.staff_accounts; before_row public.daily_followups%rowtype; f public.daily_followups; dt timestamptz;
begin
  a:=public.dawaa_require_customer_service_actor_v1(false);
  dt:=public.dawaa_parse_followup_datetime_v1(p_postponed_until);
  if dt is null then raise exception 'اختر موعد التأجيل'; end if;
  if dt<=now() then raise exception 'موعد التأجيل يجب أن يكون في المستقبل'; end if;
  select * into before_row from public.daily_followups where id=p_followup_id for update;
  if not found then raise exception 'المتابعة غير موجودة أو لا يمكن تأجيلها'; end if;
  update public.daily_followups set status='مؤجل',followup_status='مؤجل',contact_status='مؤجل',postponed_until=dt,next_followup_date=dt,completed_at=null,updated_at=now(),updated_by=a.id::text where id=p_followup_id returning * into f;
  perform public.dawaa_log_customer_followup_event_v1(p_followup_id,'postponed',coalesce(before_row.followup_status,before_row.status),'مؤجل','تم التأجيل إلى '||to_char(dt at time zone 'Africa/Cairo','YYYY-MM-DD HH24:MI'),jsonb_build_object('postponed_until',dt),a.id::text,coalesce(a.name,a.username));
  return f;
end $$;

create or replace function public.dawaa_create_exceptional_followup_v2(p_customer_id text default null,p_customer_code text default null,p_customer_name text default null,p_customer_phone text default null,p_branch text default null,p_priority text default 'مهم',p_reason text default null,p_followup_datetime text default null,p_assigned_doctor text default null,p_request_details text default null,p_notes text default null,p_created_by text default null,p_created_by_name text default null)
returns public.daily_followups language plpgsql security definer set search_path=public,auth,pg_catalog as $$
declare a public.staff_accounts; dt timestamptz; n text; reason text; f public.daily_followups;
begin
  a:=public.dawaa_require_customer_service_actor_v1(false);
  dt:=coalesce(public.dawaa_parse_followup_datetime_v1(p_followup_datetime),now()); n:=nullif(trim(coalesce(p_customer_name,'')),''); reason:=nullif(trim(coalesce(p_reason,'')),'');
  if n is null then raise exception 'اسم العميل مطلوب'; end if;
  if reason is null then raise exception 'سبب المتابعة مطلوب'; end if;
  if nullif(trim(coalesce(p_branch,'')),'') is null then raise exception 'الفرع مطلوب'; end if;
  insert into public.daily_followups(date,followup_date,followup_datetime,customer_id,customer_code,customer_name,name,customer_phone,phone,branch,followup_type,category,priority,followup_reason,suggested_action,request_type,request_details,request_status,notes,followup_notes,status,followup_status,contact_status,assigned_to,responsible_name,assigned_doctor,created_by,created_by_name,created_at,updated_at)
  values((dt at time zone 'Africa/Cairo')::date,(dt at time zone 'Africa/Cairo')::date,dt,nullif(trim(coalesce(p_customer_id,'')),''),nullif(trim(coalesce(p_customer_code,'')),''),n,n,nullif(trim(coalesce(p_customer_phone,'')),''),nullif(trim(coalesce(p_customer_phone,'')),''),trim(p_branch),'exceptional','متابعة استثنائية',coalesce(nullif(trim(coalesce(p_priority,'')),''),'مهم'),reason,reason,'متابعة استثنائية',coalesce(nullif(trim(coalesce(p_request_details,'')),''),reason),'open',nullif(trim(coalesce(p_notes,'')),''),nullif(trim(coalesce(p_notes,'')),''),'معلق','معلق','معلق',nullif(trim(coalesce(p_assigned_doctor,'')),''),nullif(trim(coalesce(p_assigned_doctor,'')),''),nullif(trim(coalesce(p_assigned_doctor,'')),''),a.id::text,coalesce(a.name,a.username),now(),now()) returning * into f;
  perform public.dawaa_log_customer_followup_event_v1(f.id::text,'created',null,'معلق',reason,jsonb_build_object('source','exceptional'),a.id::text,coalesce(a.name,a.username));
  return f;
end $$;

create or replace function public.dawaa_complete_customer_followup_v1(p_followup_id text,p_result text,p_summary text,p_score numeric default null,p_notes text default null,p_actor_id text default null,p_actor_name text default null)
returns public.daily_followups language plpgsql security definer set search_path=public,auth,pg_catalog as $$
declare a public.staff_accounts; before_row public.daily_followups%rowtype; f public.daily_followups;
begin
  a:=public.dawaa_require_customer_service_actor_v1(false);
  if nullif(trim(coalesce(p_result,'')),'') is null then raise exception 'نتيجة المتابعة مطلوبة'; end if;
  if length(trim(coalesce(p_summary,'')))<10 then raise exception 'اكتب تقييمًا واضحًا وملخصًا كاملًا للمتابعة لا يقل عن 10 أحرف'; end if;
  if p_score is not null and (p_score<0 or p_score>100) then raise exception 'درجة التقييم يجب أن تكون من 0 إلى 100'; end if;
  select * into before_row from public.daily_followups where id=p_followup_id for update;
  if not found then raise exception 'المتابعة غير موجودة'; end if;
  update public.daily_followups set status='تم',followup_status='تم',contact_status='تم التواصل',followup_result=trim(p_result),contact_result=trim(p_result),evaluation_summary=trim(p_summary),evaluation_score=p_score,followup_notes=nullif(trim(coalesce(p_notes,'')),''),completed_at=now(),completed_by=a.id::text,updated_by=a.id::text,updated_at=now() where id=p_followup_id returning * into f;
  perform public.dawaa_log_customer_followup_event_v1(p_followup_id,'completed',coalesce(before_row.followup_status,before_row.status),'تم',trim(p_summary),jsonb_build_object('result',trim(p_result),'score',p_score,'notes',p_notes),a.id::text,coalesce(a.name,a.username));
  return f;
end $$;

create or replace function public.dawaa_cancel_customer_followup_v1(p_followup_id text,p_reason text,p_actor_id text default null,p_actor_name text default null)
returns public.daily_followups language plpgsql security definer set search_path=public,auth,pg_catalog as $$
declare a public.staff_accounts; before_row public.daily_followups%rowtype; f public.daily_followups;
begin
  a:=public.dawaa_require_customer_service_actor_v1(false);
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'سبب الإلغاء مطلوب'; end if;
  select * into before_row from public.daily_followups where id=p_followup_id for update;
  if not found then raise exception 'المتابعة غير موجودة'; end if;
  update public.daily_followups set status='ملغي',followup_status='ملغي',cancelled_at=now(),cancelled_by=a.id::text,cancelled_reason=trim(p_reason),updated_by=a.id::text,updated_at=now() where id=p_followup_id returning * into f;
  perform public.dawaa_log_customer_followup_event_v1(p_followup_id,'cancelled',coalesce(before_row.followup_status,before_row.status),'ملغي',trim(p_reason),'{}'::jsonb,a.id::text,coalesce(a.name,a.username));
  return f;
end $$;

revoke all on function public.dawaa_require_customer_service_actor_v1(boolean) from public,anon;
revoke all on function public.dawaa_log_customer_followup_event_v1(text,text,text,text,text,jsonb,text,text) from public,anon;
revoke all on function public.dawaa_archive_customer_followup_v1(text,text,text) from public,anon;
revoke all on function public.dawaa_restore_customer_followup_v1(text,text) from public,anon;
revoke all on function public.dawaa_postpone_customer_followup_v1(text,text,text) from public,anon;
revoke all on function public.dawaa_create_exceptional_followup_v2(text,text,text,text,text,text,text,text,text,text,text,text,text) from public,anon;
revoke all on function public.dawaa_complete_customer_followup_v1(text,text,text,numeric,text,text,text) from public,anon;
revoke all on function public.dawaa_cancel_customer_followup_v1(text,text,text,text) from public,anon;
grant execute on function public.dawaa_log_customer_followup_event_v1(text,text,text,text,text,jsonb,text,text) to authenticated;
grant execute on function public.dawaa_archive_customer_followup_v1(text,text,text) to authenticated;
grant execute on function public.dawaa_restore_customer_followup_v1(text,text) to authenticated;
grant execute on function public.dawaa_postpone_customer_followup_v1(text,text,text) to authenticated;
grant execute on function public.dawaa_create_exceptional_followup_v2(text,text,text,text,text,text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.dawaa_complete_customer_followup_v1(text,text,text,numeric,text,text,text) to authenticated;
grant execute on function public.dawaa_cancel_customer_followup_v1(text,text,text,text) to authenticated;

drop view if exists public.customer_followup_command_center_v1;
create view public.customer_followup_command_center_v1 with (security_invoker=true) as
select f.*,coalesce(f.archived_at,f.hidden_at) effective_archived_at,coalesce(f.archive_reason,f.hidden_reason) effective_archive_reason,
case when coalesce(f.is_hidden,false) or f.archived_at is not null then 'archived' when f.cancelled_at is not null then 'cancelled' when f.completed_at is not null then 'completed' when f.postponed_until is not null then 'postponed' when coalesce(f.needs_manager,false) then 'needs_manager' else 'open' end operational_status,
(select count(*) from public.customer_followup_events e where e.followup_id=f.id::text) events_count,
(select max(e.created_at) from public.customer_followup_events e where e.followup_id=f.id::text) last_event_at
from public.daily_followups f;
revoke all on public.customer_followup_command_center_v1 from anon;
grant select on public.customer_followup_command_center_v1 to authenticated;

commit;
