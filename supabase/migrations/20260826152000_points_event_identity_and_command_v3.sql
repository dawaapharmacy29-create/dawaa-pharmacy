-- Points Architecture V3 - semantic event identity and centralized write command.
-- Same source event + same rule is idempotent; distinct valid rules on the same event remain distinct.

create or replace view public.dawaa_employee_points_ledger_v2
with (security_invoker = true)
as
with normalized as (
  select
    et.*,
    coalesce(
      nullif(trim(et.metadata->>'rule_code'), ''),
      nullif(substring(coalesce(et.description,'') from '__RULE__:([A-Za-z0-9_-]+)'), ''),
      '__event__'
    ) as semantic_rule_code,
    case
      when coalesce(et.points_delta, 0) <> 0 then et.points_delta
      when coalesce(et.final_points, 0) <> 0 then
        case
          when lower(coalesce(et.type, '')) in ('penalty', 'deduction') then -abs(et.final_points)
          when lower(coalesce(et.type, '')) in ('reward', 'bonus') then abs(et.final_points)
          else et.final_points
        end
      when coalesce(et.points, 0) <> 0 then
        case
          when lower(coalesce(et.type, '')) in ('penalty', 'deduction') then -abs(et.points)
          when lower(coalesce(et.type, '')) in ('reward', 'bonus') then abs(et.points)
          else et.points
        end
      else 0::numeric
    end as signed_points,
    row_number() over (
      partition by
        et.staff_id,
        coalesce(et.month_cycle, ''),
        coalesce(et.source, ''),
        case when et.source_id is not null then et.source_id::text else et.id::text end,
        case
          when et.source_id is not null then coalesce(
            nullif(trim(et.metadata->>'rule_code'), ''),
            nullif(substring(coalesce(et.description,'') from '__RULE__:([A-Za-z0-9_-]+)'), ''),
            '__event__'
          )
          else et.id::text
        end
      order by
        case et.status when 'approved' then 1 when 'active' then 2 else 3 end,
        coalesce(et.updated_at, et.created_at) desc,
        et.id desc
    ) as event_rank
  from public.employee_transactions et
  where et.status in ('active', 'approved')
)
select
  id,
  staff_id,
  employee_id,
  employee_name,
  branch,
  month_cycle,
  type,
  title,
  reason,
  description,
  category,
  source,
  source_id,
  transaction_date,
  created_at,
  updated_at,
  signed_points,
  amount as money_amount,
  metadata
from normalized
where event_rank = 1;

comment on view public.dawaa_employee_points_ledger_v2 is
  'Canonical approved points ledger. Dedupe identity is staff+cycle+source+source_id+semantic rule code, preserving distinct valid rules on one event.';

create unique index if not exists employee_transactions_semantic_event_once_v3
  on public.employee_transactions (
    staff_id,
    month_cycle,
    coalesce(source,''),
    source_id,
    coalesce(nullif(trim(metadata->>'rule_code'),''),'__event__')
  )
  where source_id is not null and coalesce(status,'active') in ('active','approved','pending');

create or replace function public.record_employee_points_transaction_v3(
  p_staff_id uuid,
  p_signed_points numeric,
  p_reason text,
  p_description text default null,
  p_source text default 'manual_admin',
  p_source_id uuid default null,
  p_rule_code text default null,
  p_month_cycle text default null,
  p_branch text default null,
  p_status text default 'active',
  p_category text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
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
  v_global boolean := v_actor_role in ('general_manager','admin','executive_manager','branches_manager','manager','مدير عام','مدير تنفيذي','مديرة الفروع','مدير الفروع');
  v_branch_manager boolean := v_actor_role in ('branch_manager','customer_service_manager','مدير فرع','مديرة فرع','مسؤولة خدمة العملاء','مسؤول خدمة العملاء');
begin
  if v_actor_id is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_staff from public.staff where id = p_staff_id;
  if not found then raise exception 'staff_not_found'; end if;

  if not v_global then
    if not v_branch_manager then raise exception 'not_authorized'; end if;
    if coalesce(v_staff.branch,'') is distinct from coalesce(v_actor_branch,'') then
      raise exception 'not_authorized_for_branch';
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
    insert into public.employee_transactions (
      staff_id, employee_id, employee_name, type, title, reason, description,
      amount, points, points_delta, final_points, source, source_id,
      transaction_date, month_cycle, branch, status, category,
      created_by, created_by_name, approved_by, approved_by_name, approved_at,
      employee_visible, metadata
    ) values (
      p_staff_id, p_staff_id, v_staff.name, v_type, p_reason, p_reason, nullif(trim(coalesce(p_description,'')),''),
      0, abs(coalesce(p_signed_points,0)), coalesce(p_signed_points,0), coalesce(p_signed_points,0),
      v_source, p_source_id, current_date, v_cycle, coalesce(nullif(trim(coalesce(p_branch,'')),''),v_staff.branch),
      v_status, p_category, v_actor_id, null, case when v_status in ('active','approved') then v_actor_id else null end,
      null, case when v_status in ('active','approved') then now() else null end, true,
      coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object('engine_version',3,'rule_code',v_rule)
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
        metadata = coalesce(metadata,'{}'::jsonb) || coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object('engine_version',3,'rule_code',v_rule)
    where id = v_existing
    returning * into v_saved;
  end if;

  return jsonb_build_object(
    'id', v_saved.id,
    'staff_id', v_saved.staff_id,
    'source', v_saved.source,
    'source_id', v_saved.source_id,
    'rule_code', v_rule,
    'points_delta', v_saved.points_delta,
    'status', v_saved.status,
    'month_cycle', v_saved.month_cycle
  );
end;
$$;

revoke all on function public.record_employee_points_transaction_v3(uuid,numeric,text,text,text,uuid,text,text,text,text,text,jsonb) from public;
grant execute on function public.record_employee_points_transaction_v3(uuid,numeric,text,text,text,uuid,text,text,text,text,text,jsonb) to anon, authenticated;

comment on function public.record_employee_points_transaction_v3(uuid,numeric,text,text,text,uuid,text,text,text,text,text,jsonb) is
  'Central idempotent points write command. Same staff/cycle/source/source_id/rule updates one transaction instead of duplicating it.';
