begin;

create table if not exists public.customer_followup_audit_log (
  id bigserial primary key,
  followup_id text,
  customer_id text,
  action text not null,
  actor_staff_id text,
  actor_name text,
  branch text,
  old_values jsonb,
  new_values jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists customer_followup_audit_log_followup_idx
  on public.customer_followup_audit_log(followup_id, created_at desc);
create index if not exists customer_followup_audit_log_branch_idx
  on public.customer_followup_audit_log(branch, created_at desc);

revoke all on public.customer_followup_audit_log from public;
grant select on public.customer_followup_audit_log to anon, authenticated;

create or replace function public.audit_daily_followup_change_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id text := coalesce(new.updated_by::text, new.created_by::text, old.updated_by::text, old.created_by::text);
  v_actor_name text := coalesce(new.created_by_name, new.responsible_name, old.created_by_name, old.responsible_name);
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'created';
  elsif new.completed_at is distinct from old.completed_at and new.completed_at is not null then
    v_action := 'completed';
  elsif new.cancelled_at is distinct from old.cancelled_at and new.cancelled_at is not null then
    v_action := 'cancelled';
  elsif new.archived_at is distinct from old.archived_at and new.archived_at is not null then
    v_action := 'archived';
  elsif new.branch is distinct from old.branch
     or new.customer_name is distinct from old.customer_name
     or new.customer_code is distinct from old.customer_code
     or new.customer_phone is distinct from old.customer_phone then
    v_action := 'customer_data_corrected';
  else
    v_action := 'updated';
  end if;

  insert into public.customer_followup_audit_log(
    followup_id, customer_id, action, actor_staff_id, actor_name, branch, old_values, new_values
  ) values (
    new.id::text,
    coalesce(new.customer_id::text, old.customer_id::text),
    v_action,
    v_actor_id,
    v_actor_name,
    coalesce(new.branch, old.branch),
    case when tg_op = 'INSERT' then null else to_jsonb(old) - array['customer_metrics'] end,
    to_jsonb(new) - array['customer_metrics']
  );
  return new;
end;
$$;

drop trigger if exists trg_audit_daily_followup_change_v1 on public.daily_followups;
create trigger trg_audit_daily_followup_change_v1
after insert or update on public.daily_followups
for each row execute function public.audit_daily_followup_change_v1();

create or replace function public.customer_followup_daily_performance_v1(
  p_branch text default null,
  p_day date default timezone('Africa/Cairo', now())::date
)
returns table(
  responsible_name text,
  branch text,
  total_count bigint,
  completed_count bigint,
  open_count bigint,
  no_answer_count bigint,
  postponed_count bigint,
  manager_count bigint,
  invalid_phone_count bigint,
  avg_close_hours numeric
)
language sql
security invoker
set search_path = public
as $$
  select
    coalesce(nullif(trim(d.responsible_name), ''), nullif(trim(d.assigned_to), ''), nullif(trim(d.created_by_name), ''), 'غير مسند') as responsible_name,
    coalesce(nullif(trim(d.branch), ''), 'غير محدد') as branch,
    count(*)::bigint as total_count,
    count(*) filter (where d.completed_at is not null or lower(coalesce(d.status,'')) in ('completed','closed','تم'))::bigint as completed_count,
    count(*) filter (where d.completed_at is null and d.cancelled_at is null and d.archived_at is null and coalesce(d.is_hidden,false)=false)::bigint as open_count,
    count(*) filter (where coalesce(d.followup_result,d.contact_result,d.followup_status,d.status) = 'لم يرد')::bigint as no_answer_count,
    count(*) filter (where d.postponed_until is not null or coalesce(d.followup_status,d.status) in ('مؤجل','scheduled'))::bigint as postponed_count,
    count(*) filter (where coalesce(d.needs_manager,false) or coalesce(d.followup_status,d.status) in ('يحتاج متابعة مدير','needs_manager'))::bigint as manager_count,
    count(*) filter (where coalesce(d.contact_status,'') in ('invalid_phone','الرقم غير صحيح') or coalesce(d.followup_result,d.contact_result) = 'الرقم غير صحيح')::bigint as invalid_phone_count,
    round(avg(extract(epoch from (d.completed_at - d.created_at))/3600.0) filter (where d.completed_at is not null and d.created_at is not null)::numeric, 2) as avg_close_hours
  from public.daily_followups d
  where coalesce(d.date::date, d.created_at::date) = p_day
    and (p_branch is null or trim(p_branch) = '' or p_branch = 'كل الفروع' or d.branch = p_branch)
  group by 1,2
  order by completed_count desc, total_count desc;
$$;

grant execute on function public.customer_followup_daily_performance_v1(text,date) to anon, authenticated;

create or replace function public.list_open_followup_duplicate_groups_v1(p_branch text default null)
returns table(
  identity_key text,
  branch text,
  request_type text,
  open_count bigint,
  canonical_id text,
  duplicate_ids text[],
  customer_name text,
  customer_code text,
  customer_phone text,
  newest_at timestamptz
)
language sql
security invoker
set search_path = public
as $$
  with open_rows as (
    select d.*,
      row_number() over (
        partition by d.identity_key, coalesce(d.branch,''), coalesce(nullif(trim(d.request_type),''),'general')
        order by d.created_at asc nulls last, d.id
      ) as rn
    from public.daily_followups d
    where d.identity_key is not null
      and d.completed_at is null
      and d.cancelled_at is null
      and d.archived_at is null
      and coalesce(d.is_hidden,false)=false
      and d.duplicate_of is null
      and (p_branch is null or trim(p_branch) = '' or p_branch = 'كل الفروع' or d.branch = p_branch)
  )
  select
    identity_key,
    coalesce(branch,'غير محدد'),
    coalesce(nullif(trim(request_type),''),'general'),
    count(*)::bigint,
    min(id::text) filter (where rn = 1),
    array_agg(id::text order by created_at) filter (where rn > 1),
    max(coalesce(customer_name,name)),
    max(customer_code),
    max(coalesce(customer_phone,phone)),
    max(created_at)
  from open_rows
  group by identity_key, branch, coalesce(nullif(trim(request_type),''),'general')
  having count(*) > 1
  order by count(*) desc, max(created_at) desc;
$$;

grant execute on function public.list_open_followup_duplicate_groups_v1(text) to anon, authenticated;

create or replace function public.merge_open_followup_duplicates_v1(
  p_canonical_id text,
  p_duplicate_ids text[],
  p_actor_staff_id text,
  p_actor_name text,
  p_reason text default 'دمج يدوي بعد المراجعة'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_staff record;
  v_count integer := 0;
begin
  select * into v_staff from public.resolve_staff_account_safe(p_actor_staff_id) limit 1;
  if v_staff.id is null or v_staff.active is not true or v_staff.can_login is not true then
    raise exception 'active_staff_account_required';
  end if;
  if coalesce(v_staff.role,'') not in ('customer_service_manager','general_manager','branch_manager','branches_manager','admin') then
    raise exception 'duplicate_merge_permission_denied';
  end if;
  if nullif(trim(p_canonical_id),'') is null or coalesce(array_length(p_duplicate_ids,1),0)=0 then
    raise exception 'canonical_and_duplicates_required';
  end if;

  update public.daily_followups
  set duplicate_of = p_canonical_id,
      canonical_followup_id = p_canonical_id,
      is_duplicate = true,
      is_hidden = true,
      hidden_at = coalesce(hidden_at, now()),
      hidden_by = p_actor_staff_id,
      hidden_reason = coalesce(nullif(trim(p_reason),''),'دمج يدوي بعد المراجعة'),
      archived_at = coalesce(archived_at, now()),
      archive_reason = coalesce(nullif(trim(p_reason),''),'دمج يدوي بعد المراجعة'),
      status = 'merged_duplicate',
      followup_status = 'merged_duplicate',
      updated_by = p_actor_staff_id,
      updated_at = now()
  where id::text = any(p_duplicate_ids)
    and id::text <> p_canonical_id;
  get diagnostics v_count = row_count;

  insert into public.customer_service_followup_events(
    followup_id,event_type,event_status,actor_staff_id,actor_name,notes,metadata
  ) values (
    p_canonical_id,'duplicates_merged','open',p_actor_staff_id,p_actor_name,p_reason,
    jsonb_build_object('duplicate_ids',p_duplicate_ids,'merged_count',v_count)
  );

  return jsonb_build_object('canonical_id',p_canonical_id,'merged_count',v_count);
end;
$$;

revoke all on function public.merge_open_followup_duplicates_v1(text,text[],text,text,text) from public;
grant execute on function public.merge_open_followup_duplicates_v1(text,text[],text,text,text) to anon, authenticated;

create or replace function public.correct_customer_followup_data_v1(
  p_followup_id text,
  p_customer_name text,
  p_customer_code text,
  p_customer_phone text,
  p_branch text,
  p_actor_staff_id text,
  p_actor_name text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_staff record;
  v_row public.daily_followups%rowtype;
  v_phone text;
  v_updated_followups integer := 0;
  v_updated_customers integer := 0;
begin
  select * into v_staff from public.resolve_staff_account_safe(p_actor_staff_id) limit 1;
  if v_staff.id is null or v_staff.active is not true or v_staff.can_login is not true then
    raise exception 'active_staff_account_required';
  end if;
  if coalesce(v_staff.role,'') not in ('customer_service','customer_service_manager','general_manager','branch_manager','branches_manager','admin') then
    raise exception 'customer_correction_permission_denied';
  end if;

  select * into v_row from public.daily_followups where id::text = p_followup_id limit 1 for update;
  if v_row.id is null then raise exception 'followup_not_found'; end if;
  v_phone := public.dawaa_normalize_egyptian_mobile_v1(coalesce(p_customer_phone,v_row.customer_phone,v_row.phone));

  update public.daily_followups
  set customer_name = coalesce(nullif(trim(p_customer_name),''),customer_name),
      name = coalesce(nullif(trim(p_customer_name),''),name),
      customer_code = coalesce(nullif(trim(p_customer_code),''),customer_code),
      customer_phone = coalesce(nullif(trim(v_phone),''),customer_phone),
      phone = coalesce(nullif(trim(v_phone),''),phone),
      branch = coalesce(nullif(trim(p_branch),''),branch),
      data_quality_status = 'reviewed',
      data_issues = '{}'::text[],
      updated_by = p_actor_staff_id,
      updated_at = now()
  where id = v_row.id
     or (v_row.customer_id is not null and customer_id = v_row.customer_id and completed_at is null);
  get diagnostics v_updated_followups = row_count;

  if v_row.customer_id is not null then
    update public.customers
    set name = coalesce(nullif(trim(p_customer_name),''),name),
        customer_code = coalesce(nullif(trim(p_customer_code),''),customer_code),
        phone = coalesce(nullif(trim(v_phone),''),phone),
        mobile = coalesce(nullif(trim(v_phone),''),mobile),
        branch = coalesce(nullif(trim(p_branch),''),branch)
    where id::text = v_row.customer_id::text;
    get diagnostics v_updated_customers = row_count;
  end if;

  insert into public.customer_service_followup_events(
    followup_id,event_type,event_status,actor_staff_id,actor_name,notes,metadata
  ) values (
    v_row.id::text,'customer_data_corrected','open',p_actor_staff_id,p_actor_name,p_note,
    jsonb_build_object('name',p_customer_name,'code',p_customer_code,'phone',v_phone,'branch',p_branch)
  );

  return jsonb_build_object('followups_updated',v_updated_followups,'customers_updated',v_updated_customers);
end;
$$;

revoke all on function public.correct_customer_followup_data_v1(text,text,text,text,text,text,text,text) from public;
grant execute on function public.correct_customer_followup_data_v1(text,text,text,text,text,text,text,text) to anon, authenticated;

commit;
