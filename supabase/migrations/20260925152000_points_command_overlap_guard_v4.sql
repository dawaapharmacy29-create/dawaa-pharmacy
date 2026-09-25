-- Points command V4: move same-event overlap protection into the server command boundary.
-- V3 remains an internal implementation for compatibility; app-role EXECUTE is revoked.

create or replace function public.dawaa_points_same_event_conflicts_v1(
  p_incoming_rule text,
  p_existing_rules text[]
)
returns text[]
language plpgsql
immutable
set search_path to 'public','pg_catalog'
as $function$
declare
  v_group text[];
  v_conflicts text[];
  v_incoming text:=upper(trim(coalesce(p_incoming_rule,'')));
begin
  if v_incoming='' then return array[]::text[]; end if;

  if v_incoming=any(array['CHAT-009','CHAT-010']) then
    v_group:=array['CHAT-009','CHAT-010'];
  elsif v_incoming=any(array['CLASS-001','CLASS-002','CLASS-003']) then
    v_group:=array['CLASS-001','CLASS-002','CLASS-003'];
  elsif v_incoming=any(array['SALE-002A','SALE-002B','SALE-003','SALE-004']) then
    v_group:=array['SALE-002A','SALE-002B','SALE-003','SALE-004'];
  elsif v_incoming=any(array['APP-006','APP-007']) then
    v_group:=array['APP-006','APP-007'];
  else
    return array[]::text[];
  end if;

  select coalesce(array_agg(distinct upper(trim(x))),array[]::text[])
  into v_conflicts
  from unnest(coalesce(p_existing_rules,array[]::text[])) x
  where upper(trim(x))=any(v_group)
    and upper(trim(x))<>v_incoming;

  return v_conflicts;
end;
$function$;

create or replace function public.record_employee_points_transaction_v4(
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
  p_metadata jsonb default '{}'::jsonb,
  p_manager_override boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_cycle text:=coalesce(nullif(trim(coalesce(p_month_cycle,'')),''),public.dawaa_current_points_cycle_label_v1());
  v_rule text:=upper(coalesce(nullif(trim(coalesce(p_rule_code,'')),''),'__EVENT__'));
  v_existing_rules text[]:=array[]::text[];
  v_conflicts text[]:=array[]::text[];
  v_can_override boolean:=false;
begin
  if p_manager_override then
    v_can_override:=public.dawaa_current_actor_can(array['manage_points','manage_payroll']);
    if not v_can_override then
      raise exception 'not_authorized_for_points_overlap_override' using errcode='42501';
    end if;
  end if;

  if coalesce(p_signed_points,0)<0 and p_source_id is not null and v_rule<>'__EVENT__' then
    select coalesce(array_agg(distinct existing_code),array[]::text[])
    into v_existing_rules
    from (
      select coalesce(
        nullif(upper(trim(et.metadata->>'rule_code')),''),
        nullif(upper((regexp_match(coalesce(et.description,et.reason,''),'__RULE__:([A-Za-z0-9_-]+)','i'))[1]),'')
      ) existing_code
      from public.employee_transactions et
      where et.staff_id=p_staff_id
        and et.source_id=p_source_id
        and et.month_cycle=v_cycle
        and et.type='penalty'
        and coalesce(et.status,'active') in ('active','approved','pending')
    ) q
    where existing_code is not null;

    v_conflicts:=public.dawaa_points_same_event_conflicts_v1(v_rule,v_existing_rules);

    if coalesce(array_length(v_conflicts,1),0)>0 and not p_manager_override then
      raise exception 'overlapping_points_deduction:%',array_to_string(v_conflicts,',')
        using errcode='23514';
    end if;
  end if;

  return public.record_employee_points_transaction_v3(
    p_staff_id,
    p_signed_points,
    p_reason,
    p_description,
    p_source,
    p_source_id,
    v_rule,
    v_cycle,
    p_branch,
    p_status,
    p_category,
    coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object(
      'command_version',4,
      'same_event_overlap_checked',true,
      'manager_overlap_override',coalesce(p_manager_override,false),
      'overlap_conflicts',to_jsonb(v_conflicts)
    )
  );
end;
$function$;

revoke execute on function public.record_employee_points_transaction_v4(uuid,numeric,text,text,text,uuid,text,text,text,text,text,jsonb,boolean)
  from public,anon;
grant execute on function public.record_employee_points_transaction_v4(uuid,numeric,text,text,text,uuid,text,text,text,text,text,jsonb,boolean)
  to authenticated,service_role;

revoke execute on function public.record_employee_points_transaction_v3(uuid,numeric,text,text,text,uuid,text,text,text,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.record_employee_points_transaction_v3(uuid,numeric,text,text,text,uuid,text,text,text,text,text,jsonb)
  to service_role;

comment on function public.record_employee_points_transaction_v3(uuid,numeric,text,text,text,uuid,text,text,text,text,text,jsonb)
  is 'INTERNAL COMPATIBILITY IMPLEMENTATION: application writes must use record_employee_points_transaction_v4.';
