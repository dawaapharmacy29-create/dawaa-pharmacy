-- Normalize Heba's display name everywhere operational and allow a review author
-- to link only the points transaction that belongs to the review they created.
-- The review-author exception is intentionally source-record bound, staff bound,
-- and branch bound so it does not grant generic points-write permission.

do $$
declare
  r record;
begin
  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema
     and t.table_name = c.table_name
    where c.table_schema = 'public'
      and t.table_type = 'BASE TABLE'
      and c.data_type in ('text','character varying','character')
      and c.column_name in (
        'name','full_name','staff_name','employee_name','assigned_name','doctor_name',
        'pharmacist_name','user_name','created_by_name','reviewer_name','evaluator_name',
        'approved_by_name','completed_by_name'
      )
      and c.table_name not like '%backup%'
      and c.table_name not like 'archive_%'
      and c.table_name not like 'orphan_%'
  loop
    begin
      execute format(
        'update public.%I set %I = %L where trim(%I) in (%L,%L)',
        r.table_name,
        r.column_name,
        'هبه محمد',
        r.column_name,
        'هبه حماده',
        'هبة حماده'
      );
    exception when others then
      null;
    end;
  end loop;
end $$;

update public.staff
set name = replace(replace(name, 'هبه حماده', 'هبه محمد'), 'هبة حماده', 'هبه محمد')
where name ilike '%هبه حماده%' or name ilike '%هبة حماده%';

create or replace function public.record_employee_points_transaction_v3(
  p_staff_id uuid,
  p_signed_points numeric,
  p_reason text,
  p_description text default null::text,
  p_source text default 'manual_admin'::text,
  p_source_id uuid default null::uuid,
  p_rule_code text default null::text,
  p_month_cycle text default null::text,
  p_branch text default null::text,
  p_status text default 'active'::text,
  p_category text default null::text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor_id text := public.employee_operating_actor_id();
  v_actor_role text := lower(trim(coalesce(public.employee_operating_actor_role(),'')));
  v_actor_branch text := nullif(trim(coalesce(public.employee_operating_actor_branch(),'')), '');
  v_staff public.staff%rowtype;
  v_cycle text := coalesce(nullif(trim(coalesce(p_month_cycle,'')),''), public.dawaa_current_points_cycle_label_v1());
  v_source text := coalesce(nullif(trim(coalesce(p_source,'')),''),'manual_admin');
  v_rule text := coalesce(nullif(trim(coalesce(p_rule_code,'')),''),'__event__');
  v_status text := lower(trim(coalesce(p_status,'active')));
  v_type text;
  v_existing uuid;
  v_saved public.employee_transactions%rowtype;
  v_global boolean := v_actor_role in (
    'general_manager','admin','executive_manager','branches_manager','manager',
    'مدير عام','مدير تنفيذي','مديرة الفروع','مدير الفروع'
  );
  v_branch_manager boolean := v_actor_role in (
    'branch_manager','customer_service_manager','مدير فرع','مديرة فرع',
    'مسؤولة خدمة العملاء','مسؤول خدمة العملاء'
  );
  v_review_authorized boolean := false;
begin
  if v_actor_id is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_staff from public.staff where id = p_staff_id;
  if not found then
    raise exception 'staff_not_found';
  end if;

  if v_source in ('conversation_review','conversation_evaluation','conversation_sales_reviews')
     and p_source_id is not null then
    select exists(
      select 1
      from public.conversation_sales_reviews r
      where r.id = p_source_id
        and r.reviewer_id::text = v_actor_id
        and r.staff_id = p_staff_id
        and coalesce(trim(r.branch),'') = coalesce(trim(coalesce(p_branch,v_staff.branch)), '')
    ) into v_review_authorized;
  end if;

  if not v_global then
    if v_review_authorized then
      null;
    elsif v_branch_manager then
      if coalesce(v_staff.branch,'') is distinct from coalesce(v_actor_branch,'') then
        raise exception 'not_authorized_for_branch';
      end if;
    else
      raise exception 'not_authorized';
    end if;
  end if;

  if v_status not in ('active','approved','pending','cancelled') then
    raise exception 'invalid_status';
  end if;

  v_type := case when coalesce(p_signed_points,0) < 0 then 'penalty' else 'reward' end;

  if p_source_id is not null then
    select et.id into v_existing
    from public.employee_transactions et
    where et.staff_id = p_staff_id
      and et.month_cycle = v_cycle
      and coalesce(et.source,'') = v_source
      and et.source_id = p_source_id
      and coalesce(nullif(trim(et.metadata->>'rule_code'),''),'__event__') = v_rule
      and coalesce(et.status,'active') in ('active','approved','pending')
    order by coalesce(et.updated_at,et.created_at) desc, et.id desc
    limit 1;
  end if;

  if v_existing is null then
    insert into public.employee_transactions(
      staff_id,employee_id,employee_name,type,title,reason,description,amount,points,
      points_delta,final_points,source,source_id,transaction_date,month_cycle,branch,
      status,category,created_by,created_by_name,approved_by,approved_by_name,
      approved_at,employee_visible,metadata
    ) values (
      p_staff_id,p_staff_id,v_staff.name,v_type,p_reason,p_reason,
      nullif(trim(coalesce(p_description,'')),''),0,abs(coalesce(p_signed_points,0)),
      coalesce(p_signed_points,0),coalesce(p_signed_points,0),v_source,p_source_id,
      current_date,v_cycle,coalesce(nullif(trim(coalesce(p_branch,'')),''),v_staff.branch),
      v_status,p_category,v_actor_id,null,
      case when v_status in ('active','approved') then v_actor_id else null end,
      null,case when v_status in ('active','approved') then now() else null end,
      true,coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object('engine_version',3,'rule_code',v_rule)
    ) returning * into v_saved;
  else
    update public.employee_transactions
    set type = v_type,
        reason = p_reason,
        title = p_reason,
        description = nullif(trim(coalesce(p_description,'')),''),
        points = abs(coalesce(p_signed_points,0)),
        points_delta = coalesce(p_signed_points,0),
        final_points = coalesce(p_signed_points,0),
        branch = coalesce(nullif(trim(coalesce(p_branch,'')),''),v_staff.branch),
        status = v_status,
        category = p_category,
        approved_by = case when v_status in ('active','approved') then v_actor_id else null end,
        approved_at = case when v_status in ('active','approved') then now() else null end,
        updated_at = now(),
        metadata = coalesce(metadata,'{}'::jsonb) || coalesce(p_metadata,'{}'::jsonb)
          || jsonb_build_object('engine_version',3,'rule_code',v_rule)
    where id = v_existing
    returning * into v_saved;
  end if;

  return jsonb_build_object(
    'id',v_saved.id,
    'staff_id',v_saved.staff_id,
    'source',v_saved.source,
    'source_id',v_saved.source_id,
    'rule_code',v_rule,
    'points_delta',v_saved.points_delta,
    'status',v_saved.status,
    'month_cycle',v_saved.month_cycle
  );
end;
$function$;
