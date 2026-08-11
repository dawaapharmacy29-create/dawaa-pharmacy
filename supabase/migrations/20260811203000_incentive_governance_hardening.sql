-- Repository sync + hardening for the production migration 20260811001348_incentive_governance.
-- Safe to run when the governance objects already exist.

alter table if exists public.incentive_cycles enable row level security;
alter table if exists public.incentive_cycle_staff_snapshots enable row level security;
alter table if exists public.incentive_appeals enable row level security;
alter table if exists public.incentive_governance_audit enable row level security;

create or replace function public.guard_incentive_snapshot_immutability()
returns trigger language plpgsql security definer
set search_path = public, pg_catalog as $$
declare v_status text;
begin
  select status into v_status from public.incentive_cycles where id=coalesce(new.cycle_id,old.cycle_id);
  if v_status in ('approved','paid') then raise exception 'approved or paid incentive snapshots are immutable'; end if;
  return coalesce(new,old);
end $$;
revoke all on function public.guard_incentive_snapshot_immutability() from public, anon, authenticated;

drop trigger if exists incentive_snapshot_immutable_guard on public.incentive_cycle_staff_snapshots;
create trigger incentive_snapshot_immutable_guard before update or delete on public.incentive_cycle_staff_snapshots
for each row execute function public.guard_incentive_snapshot_immutability();

create or replace function public.block_incentive_audit_mutation()
returns trigger language plpgsql security definer
set search_path = public, pg_catalog as $$ begin raise exception 'incentive governance audit is append-only'; end $$;
revoke all on function public.block_incentive_audit_mutation() from public, anon, authenticated;
drop trigger if exists incentive_audit_append_only on public.incentive_governance_audit;
create trigger incentive_audit_append_only before update or delete on public.incentive_governance_audit
for each row execute function public.block_incentive_audit_mutation();

create or replace function public.submit_incentive_appeal(
  p_cycle_id uuid,p_staff_id text,p_staff_name text,p_criterion_key text,p_reason text,p_evidence_url text default null)
returns uuid language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_id uuid; v_actor text;
begin
  v_actor:=public.dawaa_current_staff_account_id_strict();
  if v_actor is null then raise exception 'identified application user required'; end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'appeal reason is required'; end if;
  if not exists(select 1 from public.incentive_cycles where id=p_cycle_id) then raise exception 'cycle not found'; end if;
  insert into public.incentive_appeals(cycle_id,staff_id,staff_name,criterion_key,reason,evidence_url)
  values(p_cycle_id,p_staff_id,p_staff_name,p_criterion_key,p_reason,nullif(trim(p_evidence_url),'')) returning id into v_id;
  insert into public.incentive_governance_audit(cycle_id,action,actor_staff_id,details)
  values(p_cycle_id,'appeal_submitted',v_actor,jsonb_build_object('appeal_id',v_id,'staff_id',p_staff_id,'criterion_key',p_criterion_key));
  return v_id;
end $$;
revoke all on function public.submit_incentive_appeal(uuid,text,text,text,text,text) from public;
grant execute on function public.submit_incentive_appeal(uuid,text,text,text,text,text) to anon,authenticated,service_role;

create or replace function public.transition_incentive_cycle(p_cycle_id uuid,p_next_status text,p_actor_staff_id text,p_actor_name text,p_reason text default null)
returns void language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_current text; v_end date; v_summary jsonb; v_blockers text[]:=array[]::text[];
begin
  if not public.dawaa_can_manage_incentives() and current_user<>'service_role' then raise exception 'not authorized to manage incentives'; end if;
  select status,cycle_end into v_current,v_end from public.incentive_cycles where id=p_cycle_id for update;
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
    if cardinality(v_blockers)>0 then raise exception 'final approval blocked: %',array_to_string(v_blockers,','); end if;
  end if;
  select jsonb_build_object('staff_count',count(*),'performance_total',coalesce(sum(performance_incentive),0),'target_total',coalesce(sum(target_bonus),0),'other_total',coalesce(sum(other_incentives),0),'deductions_total',coalesce(sum(deductions),0),'grand_total',coalesce(sum(total_incentive),0),'ineligible_count',count(*) filter(where not eligible)) into v_summary from public.incentive_cycle_staff_snapshots where cycle_id=p_cycle_id;
  update public.incentive_cycles set status=p_next_status,updated_at=now(),summary_snapshot=v_summary,
    approved_at=case when p_next_status='approved' then now() else approved_at end,paid_at=case when p_next_status='paid' then now() else paid_at end,
    reopened_at=case when p_next_status='reopened' then now() else reopened_at end,reopen_reason=case when p_next_status='reopened' then p_reason else reopen_reason end where id=p_cycle_id;
  insert into public.incentive_governance_audit(cycle_id,action,from_status,to_status,actor_staff_id,actor_name,reason,details)
  values(p_cycle_id,'status_changed',v_current,p_next_status,p_actor_staff_id,p_actor_name,p_reason,jsonb_build_object('financial_summary',v_summary,'rules_version',(select rules_version from public.incentive_cycles where id=p_cycle_id)));
end $$;
revoke all on function public.transition_incentive_cycle(uuid,text,text,text,text) from public;
grant execute on function public.transition_incentive_cycle(uuid,text,text,text,text) to anon,authenticated,service_role;

alter view if exists public.incentive_cycle_risks_v1 set (security_invoker=true);
