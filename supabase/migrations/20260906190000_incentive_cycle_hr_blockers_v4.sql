-- Incentive cycle HR blockers v4
-- يمنع الاعتماد النهائي للدورة إذا كانت هناك حالات حضور/التزام غير محسومة أو آثار HR معلقة أو دليل متغير.

create or replace function public.hr_incentive_cycle_readiness_v1(p_cycle_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_catalog
as $$
declare c record; v_open int; v_blocked int; v_pending int; v_hash_bad int; v_ready boolean;
begin
  select id,cycle_start,cycle_end,status into c from public.incentive_cycles where id=p_cycle_id;
  if not found then raise exception 'cycle_not_found'; end if;
  if not public.dawaa_can_manage_incentives() and current_user<>'service_role' then
    raise exception using errcode='42501',message='not_authorized';
  end if;

  select count(*) into v_open
  from public.hr_compliance_cases h
  where h.work_date between c.cycle_start and c.cycle_end
    and h.status in ('open','reviewed');

  select count(*) into v_blocked
  from public.hr_compliance_cases h
  where h.work_date between c.cycle_start and c.cycle_end
    and h.data_confidence='blocked'
    and h.status not in ('rejected','closed');

  select count(*) into v_pending
  from public.hr_compliance_cases h
  where h.work_date between c.cycle_start and c.cycle_end
    and h.incentive_status='pending';

  select count(*) into v_hash_bad
  from public.hr_compliance_cases h
  where h.work_date between c.cycle_start and c.cycle_end
    and h.status='approved'
    and encode(digest(h.evidence::text,'sha256'),'hex')<>h.evidence_hash;

  v_ready := v_open=0 and v_blocked=0 and v_pending=0 and v_hash_bad=0;
  return jsonb_build_object(
    'cycle_id',p_cycle_id,'cycle_start',c.cycle_start,'cycle_end',c.cycle_end,'ready',v_ready,
    'open_hr_cases',v_open,'blocked_data_cases',v_blocked,'pending_hr_incentive_cases',v_pending,'evidence_integrity_failures',v_hash_bad
  );
end;
$$;

revoke all on function public.hr_incentive_cycle_readiness_v1(uuid) from public;
grant execute on function public.hr_incentive_cycle_readiness_v1(uuid) to authenticated,service_role;

create or replace function public.transition_incentive_cycle(p_cycle_id uuid,p_next_status text,p_actor_staff_id text,p_actor_name text,p_reason text default null)
returns void language plpgsql security definer set search_path=public,pg_catalog as $$
declare
  v_current text;
  v_end date;
  v_start date;
  v_summary jsonb;
  v_blockers text[]:=array[]::text[];
  v_hr jsonb;
begin
  if not public.dawaa_can_manage_incentives() and current_user<>'service_role' then raise exception 'not authorized to manage incentives'; end if;
  select status,cycle_start,cycle_end into v_current,v_start,v_end from public.incentive_cycles where id=p_cycle_id for update;
  if v_current is null then raise exception 'cycle not found'; end if;
  if not ((v_current='manager_review' and p_next_status='finance_review') or (v_current='finance_review' and p_next_status='approved') or
    (v_current='approved' and p_next_status='paid') or (v_current in ('approved','paid') and p_next_status='reopened') or
    (v_current='reopened' and p_next_status='manager_review')) then raise exception 'invalid incentive cycle transition: % -> %',v_current,p_next_status; end if;
  if p_next_status='reopened' and length(trim(coalesce(p_reason,'')))<10 then raise exception 'reopen requires a clear reason of at least 10 characters'; end if;

  if p_next_status='approved' then
    if v_end>=current_date then v_blockers:=array_append(v_blockers,'cycle_not_closed'); end if;
    if exists(select 1 from public.incentive_appeals where cycle_id=p_cycle_id and status in ('submitted','under_review')) then v_blockers:=array_append(v_blockers,'open_appeal'); end if;
    if exists(select 1 from public.incentive_cycle_staff_snapshots where cycle_id=p_cycle_id and (approved_weeks<3 or data_coverage_percent is null or data_coverage_percent<80)) then v_blockers:=array_append(v_blockers,'performance_data_incomplete'); end if;
    if exists(select 1 from public.incentive_cycle_staff_snapshots where cycle_id=p_cycle_id and lower(coalesce(role,'')) ~ '(manager|doctor|pharmac|مدير|دكتور|صيدل)' and target_amount<=0) then v_blockers:=array_append(v_blockers,'eligible_target_missing'); end if;
    if exists(select 1 from public.staff_payroll_incentive_truth_v1 t join public.incentive_cycle_staff_snapshots s on s.staff_id=t.staff_id and s.cycle_id=p_cycle_id where t.performance_records>1 or t.target_records>1) then v_blockers:=array_append(v_blockers,'duplicate_settlement'); end if;
    if exists(select 1 from public.staff_payroll_incentive_truth_v1 t join public.incentive_cycle_staff_snapshots s on s.staff_id=t.staff_id and s.cycle_id=p_cycle_id where abs(coalesce(t.performance_incentive,0)-s.performance_incentive)>0.01 or abs(coalesce(t.target_bonus,0)-s.target_bonus)>0.01) then v_blockers:=array_append(v_blockers,'payroll_truth_conflict'); end if;
    if exists(select 1 from public.incentive_cycle_staff_snapshots where cycle_id=p_cycle_id and abs(total_incentive-(performance_incentive+target_bonus+other_incentives-deductions))>0.01) then v_blockers:=array_append(v_blockers,'invalid_total'); end if;

    -- HR / attendance anti-tamper blockers
    select public.hr_incentive_cycle_readiness_v1(p_cycle_id) into v_hr;
    if coalesce((v_hr->>'open_hr_cases')::int,0)>0 then v_blockers:=array_append(v_blockers,'open_hr_compliance_cases'); end if;
    if coalesce((v_hr->>'blocked_data_cases')::int,0)>0 then v_blockers:=array_append(v_blockers,'hr_data_quality_blocked'); end if;
    if coalesce((v_hr->>'pending_hr_incentive_cases')::int,0)>0 then v_blockers:=array_append(v_blockers,'pending_hr_incentive_effects'); end if;
    if coalesce((v_hr->>'evidence_integrity_failures')::int,0)>0 then v_blockers:=array_append(v_blockers,'hr_evidence_integrity_failure'); end if;

    if cardinality(v_blockers)>0 then raise exception 'final approval blocked: %',array_to_string(v_blockers,','); end if;
  end if;

  select jsonb_build_object(
    'staff_count',count(*),
    'performance_total',coalesce(sum(performance_incentive),0),
    'target_total',coalesce(sum(target_bonus),0),
    'other_total',coalesce(sum(other_incentives),0),
    'deductions_total',coalesce(sum(deductions),0),
    'grand_total',coalesce(sum(total_incentive),0),
    'ineligible_count',count(*) filter(where not eligible)
  ) into v_summary
  from public.incentive_cycle_staff_snapshots where cycle_id=p_cycle_id;

  update public.incentive_cycles set status=p_next_status,updated_at=now(),summary_snapshot=v_summary,
    approved_at=case when p_next_status='approved' then now() else approved_at end,
    paid_at=case when p_next_status='paid' then now() else paid_at end,
    reopened_at=case when p_next_status='reopened' then now() else reopened_at end,
    reopen_reason=case when p_next_status='reopened' then p_reason else reopen_reason end
  where id=p_cycle_id;

  insert into public.incentive_governance_audit(cycle_id,action,from_status,to_status,actor_staff_id,actor_name,reason,details)
  values(
    p_cycle_id,'status_changed',v_current,p_next_status,p_actor_staff_id,p_actor_name,p_reason,
    jsonb_build_object('financial_summary',v_summary,'hr_readiness',case when p_next_status='approved' then v_hr else null end,
      'rules_version',(select rules_version from public.incentive_cycles where id=p_cycle_id))
  );
end $$;

revoke all on function public.transition_incentive_cycle(uuid,text,text,text,text) from public;
grant execute on function public.transition_incentive_cycle(uuid,text,text,text,text) to anon,authenticated,service_role;

notify pgrst,'reload schema';
