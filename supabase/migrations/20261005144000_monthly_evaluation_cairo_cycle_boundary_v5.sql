-- Monthly Evaluation V5 cycle boundary must use Cairo calendar semantics consistently.
-- The approval command already uses Africa/Cairo; list/read status must not rely on DB session timezone.

create or replace function public.list_staff_for_monthly_evaluation_v5(
  p_actor_id uuid,
  p_branch text default null,
  p_month date default null
)
returns table(
  id uuid,name text,role text,branch text,staff_status text,evaluation_status text,
  evaluation_score numeric,sent_at timestamptz,evidence_ready boolean
)
language plpgsql
security definer
set search_path='public','pg_catalog'
as $function$
declare
  v_actor record;
  v_month date:=date_trunc('month',coalesce(p_month,current_date))::date;
  v_cycle_end date:=(date_trunc('month',coalesce(p_month,current_date))::date+interval '24 days')::date;
begin
  select * into v_actor from public.monthly_eval_actor(p_actor_id);
  if not found then return; end if;
  if p_actor_id is not null and v_actor.account_id is distinct from p_actor_id then return; end if;

  return query
  select s.id,s.name,coalesce(s.role,s.type),coalesce(s.branch,''),
    coalesce(s.status,case when coalesce(s.active,s.is_active,true) then 'active' else 'inactive' end),
    case
      when e.id is null then 'not_started'
      when e.status in ('sent','approved')
        and (e.sent_at is null or (e.sent_at at time zone 'Africa/Cairo')::date<=v_cycle_end)
        then 'needs_reapproval'
      else e.status
    end,
    case when e.id is null then null else e.overall_score end,
    e.sent_at,
    coalesce(lower(e.metrics_snapshot->>'evidence_ready') in ('true','t','1'),false)
  from public.staff s
  left join public.staff_monthly_manager_evaluations e
    on e.staff_id=s.id and e.evaluation_month=v_month
  where coalesce(s.active,s.is_active,true)=true
    and not(coalesce(s.status,'')~*'inactive|disabled|موقوف|غير نشط|archived')
    and public.dawaa_monthly_evaluation_canonical_role_v5(coalesce(s.role,s.type,''))<>'other'
    and (
      v_actor.role in ('general_manager','branches_manager','executive_manager','executive','admin')
      or (
        v_actor.role in ('branch_manager','branch_manager_shamy','branch_manager_shokry')
        and coalesce(s.branch,'')=v_actor.branch
        and public.dawaa_monthly_evaluation_branch_manager_subject_allowed_v5(coalesce(s.role,s.type,''))
      )
      or(v_actor.staff_id is not null and s.id=v_actor.staff_id)
    )
    and (
      p_branch is null or p_branch='' or coalesce(s.branch,'')=p_branch
      or v_actor.role not in ('general_manager','branches_manager','executive_manager','executive','admin')
    )
  order by
    case
      when e.id is null then 0
      when e.status='draft' then 1
      when e.status in ('sent','approved')
        and (e.sent_at is null or (e.sent_at at time zone 'Africa/Cairo')::date<=v_cycle_end)
        then 2
      else 3
    end,
    s.name;
end;
$function$;

revoke all on function public.list_staff_for_monthly_evaluation_v5(uuid,text,date) from public;
grant execute on function public.list_staff_for_monthly_evaluation_v5(uuid,text,date) to anon,authenticated;

notify pgrst,'reload schema';
