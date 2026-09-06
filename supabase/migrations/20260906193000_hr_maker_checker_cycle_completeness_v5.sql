-- HR maker-checker + cycle completeness v5
-- closes two manipulation gaps:
-- 1) the HR reviewer cannot be the same person who activates the financial effect.
-- 2) final incentive approval refreshes every day in the cycle before evaluating HR blockers.

create or replace function public.hr_guard_hr_transaction_v1()
returns trigger
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare
  c public.hr_compliance_cases%rowtype;
  a record;
  v_hash text;
begin
  if old.source <> 'hr_compliance_case' then
    return case when tg_op='DELETE' then old else new end;
  end if;

  if tg_op='DELETE' then
    raise exception using errcode='42501', message='لا يمكن حذف أثر موارد بشرية؛ استخدم الإلغاء مع سبب ليظل السجل قابلًا للتدقيق';
  end if;

  -- Financial identity/evidence fields are immutable once the HR transaction is created.
  if new.staff_id is distinct from old.staff_id
     or new.employee_id is distinct from old.employee_id
     or new.source is distinct from old.source
     or new.source_id is distinct from old.source_id
     or new.points_delta is distinct from old.points_delta
     or new.points is distinct from old.points
     or new.amount is distinct from old.amount
     or new.month_cycle is distinct from old.month_cycle
     or new.transaction_date is distinct from old.transaction_date
     or new.type is distinct from old.type
  then
    raise exception using errcode='42501', message='قيم أثر HR المالية والدليل غير قابلة للتعديل بعد الإنشاء؛ ألغِ الحالة وافتح تصحيحًا رسميًا';
  end if;

  -- Maker-checker: activating an HR effect requires a second authorized person.
  if lower(coalesce(new.status,'')) in ('active','approved')
     and lower(coalesce(old.status,'')) not in ('active','approved') then
    select * into c from public.hr_compliance_cases where id=old.source_id for update;
    if not found or c.status<>'approved' or c.data_confidence<>'verified' then
      raise exception using errcode='55000', message='لا يمكن تفعيل أثر HR قبل اعتماد الحالة واكتمال وثقة الدليل';
    end if;
    v_hash:=encode(digest(c.evidence::text,'sha256'),'hex');
    if v_hash<>c.evidence_hash then
      raise exception using errcode='55000', message='سلامة دليل HR غير صحيحة؛ تم منع تفعيل الأثر';
    end if;

    select * into a from public.hr_current_actor_v1();
    if not found then
      if current_user<>'service_role' then
        raise exception using errcode='42501', message='مستخدم إداري معرف مطلوب لتفعيل أثر HR';
      end if;
      -- service_role may execute system reconciliation, but never impersonates a human approver.
      new.approved_by:=coalesce(new.approved_by,'service_role');
      new.approved_by_name:=coalesce(new.approved_by_name,'النظام');
      new.approved_at:=coalesce(new.approved_at,now());
    else
      if a.role not in ('general_manager','executive_manager','branches_manager','admin') then
        raise exception using errcode='42501', message='تفعيل أثر HR المالي مقصور على الإدارة العليا';
      end if;
      if c.reviewed_by is not null and c.reviewed_by=a.account_id then
        raise exception using errcode='42501', message='فصل المهام مطلوب: مراجع حالة HR لا يمكنه اعتماد أثرها المالي بنفسه';
      end if;
      if coalesce(a.staff_id,'')=c.staff_id::text then
        raise exception using errcode='42501', message='لا يمكن للموظف اعتماد أثر مالي يخصه';
      end if;
      new.approved_by:=a.staff_id;
      new.approved_by_name:=a.staff_name;
      new.approved_at:=now();
      new.metadata:=coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
        'hr_financial_approver_account_id',a.account_id,
        'hr_financial_approver_staff_id',a.staff_id,
        'hr_financial_approver_name',a.staff_name,
        'maker_checker_verified',true
      );
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.hr_guard_hr_transaction_v1() from public,anon,authenticated;

drop trigger if exists trg_hr_transaction_value_guard on public.employee_transactions;
create trigger trg_hr_transaction_value_guard
before update or delete on public.employee_transactions
for each row when (old.source='hr_compliance_case')
execute function public.hr_guard_hr_transaction_v1();

create or replace function public.hr_prepare_incentive_cycle_compliance_v1(p_cycle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare
  c record;
  a record;
  d date;
  v_days int:=0;
  v_cases int:=0;
  v_result jsonb;
begin
  select * into a from public.hr_current_actor_v1();
  if not found or a.role not in ('general_manager','executive_manager','branches_manager','admin') then
    raise exception using errcode='42501', message='إدارة عليا معرفة مطلوبة لتجهيز دورة الحوافز للمراجعة';
  end if;
  select id,cycle_start,cycle_end,status into c from public.incentive_cycles where id=p_cycle_id;
  if not found then raise exception 'cycle_not_found'; end if;

  d:=c.cycle_start;
  while d<=c.cycle_end loop
    select public.hr_refresh_compliance_cases_v1(d,null) into v_result;
    v_days:=v_days+1;
    v_cases:=v_cases+coalesce((v_result->>'cases_refreshed')::int,0);
    d:=d+1;
  end loop;

  return jsonb_build_object('cycle_id',p_cycle_id,'days_refreshed',v_days,'cases_refreshed',v_cases,'prepared_by',a.staff_name,'prepared_at',now());
end;
$$;

revoke all on function public.hr_prepare_incentive_cycle_compliance_v1(uuid) from public,anon;
grant execute on function public.hr_prepare_incentive_cycle_compliance_v1(uuid) to authenticated;

create or replace function public.transition_incentive_cycle(p_cycle_id uuid,p_next_status text,p_actor_staff_id text,p_actor_name text,p_reason text default null)
returns void
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare
  v_current text;
  v_end date;
  v_start date;
  v_summary jsonb;
  v_blockers text[]:=array[]::text[];
  v_hr jsonb;
  v_hr_prepare jsonb;
  a record;
  v_audit_actor_id text;
  v_audit_actor_name text;
begin
  if not public.dawaa_can_manage_incentives() and current_user<>'service_role' then raise exception 'not authorized to manage incentives'; end if;

  select * into a from public.hr_current_actor_v1();
  if found then
    -- Never trust caller-supplied identity for human transitions.
    v_audit_actor_id:=a.staff_id;
    v_audit_actor_name:=a.staff_name;
    if nullif(btrim(coalesce(p_actor_staff_id,'')),'') is not null and p_actor_staff_id<>a.staff_id then
      raise exception using errcode='42501', message='actor_identity_mismatch';
    end if;
  else
    if current_user<>'service_role' then raise exception using errcode='42501', message='identified_actor_required'; end if;
    v_audit_actor_id:=coalesce(nullif(btrim(p_actor_staff_id),''),'service_role');
    v_audit_actor_name:=coalesce(nullif(btrim(p_actor_name),''),'النظام');
  end if;

  select status,cycle_start,cycle_end into v_current,v_start,v_end from public.incentive_cycles where id=p_cycle_id for update;
  if v_current is null then raise exception 'cycle not found'; end if;
  if not ((v_current='manager_review' and p_next_status='finance_review')
      or (v_current='finance_review' and p_next_status='approved')
      or (v_current='approved' and p_next_status='paid')
      or (v_current in ('approved','paid') and p_next_status='reopened')
      or (v_current='reopened' and p_next_status='manager_review'))
  then raise exception 'invalid incentive cycle transition: % -> %',v_current,p_next_status; end if;
  if p_next_status='reopened' and length(trim(coalesce(p_reason,'')))<10 then raise exception 'reopen requires a clear reason of at least 10 characters'; end if;

  if p_next_status='approved' then
    -- Final approval must be a named human action, not an anonymous/background service transition.
    if not found or a.role not in ('general_manager','executive_manager','branches_manager','admin') then
      raise exception using errcode='42501', message='الاعتماد النهائي للحوافز يحتاج مديرًا معرفًا داخل التطبيق';
    end if;

    -- Generate/reconcile HR cases for every day first, so "missing cases" cannot bypass approval blockers.
    select public.hr_prepare_incentive_cycle_compliance_v1(p_cycle_id) into v_hr_prepare;

    if v_end>=current_date then v_blockers:=array_append(v_blockers,'cycle_not_closed'); end if;
    if exists(select 1 from public.incentive_appeals where cycle_id=p_cycle_id and status in ('submitted','under_review')) then v_blockers:=array_append(v_blockers,'open_appeal'); end if;
    if exists(select 1 from public.incentive_cycle_staff_snapshots where cycle_id=p_cycle_id and (approved_weeks<3 or data_coverage_percent is null or data_coverage_percent<80)) then v_blockers:=array_append(v_blockers,'performance_data_incomplete'); end if;
    if exists(select 1 from public.incentive_cycle_staff_snapshots where cycle_id=p_cycle_id and lower(coalesce(role,'')) ~ '(manager|doctor|pharmac|مدير|دكتور|صيدل)' and target_amount<=0) then v_blockers:=array_append(v_blockers,'eligible_target_missing'); end if;
    if exists(select 1 from public.staff_payroll_incentive_truth_v1 t join public.incentive_cycle_staff_snapshots s on s.staff_id=t.staff_id and s.cycle_id=p_cycle_id where t.performance_records>1 or t.target_records>1) then v_blockers:=array_append(v_blockers,'duplicate_settlement'); end if;
    if exists(select 1 from public.staff_payroll_incentive_truth_v1 t join public.incentive_cycle_staff_snapshots s on s.staff_id=t.staff_id and s.cycle_id=p_cycle_id where abs(coalesce(t.performance_incentive,0)-s.performance_incentive)>0.01 or abs(coalesce(t.target_bonus,0)-s.target_bonus)>0.01) then v_blockers:=array_append(v_blockers,'payroll_truth_conflict'); end if;
    if exists(select 1 from public.incentive_cycle_staff_snapshots where cycle_id=p_cycle_id and abs(total_incentive-(performance_incentive+target_bonus+other_incentives-deductions))>0.01) then v_blockers:=array_append(v_blockers,'invalid_total'); end if;

    select public.hr_incentive_cycle_readiness_v1(p_cycle_id) into v_hr;
    if coalesce((v_hr->>'open_hr_cases')::int,0)>0 then v_blockers:=array_append(v_blockers,'open_hr_compliance_cases'); end if;
    if coalesce((v_hr->>'blocked_data_cases')::int,0)>0 then v_blockers:=array_append(v_blockers,'hr_data_quality_blocked'); end if;
    if coalesce((v_hr->>'pending_hr_incentive_cases')::int,0)>0 then v_blockers:=array_append(v_blockers,'pending_hr_incentive_effects'); end if;
    if coalesce((v_hr->>'evidence_integrity_failures')::int,0)>0 then v_blockers:=array_append(v_blockers,'hr_evidence_integrity_failure'); end if;

    if cardinality(v_blockers)>0 then raise exception 'final approval blocked: %',array_to_string(v_blockers,','); end if;
  end if;

  select jsonb_build_object(
    'staff_count',count(*),'performance_total',coalesce(sum(performance_incentive),0),
    'target_total',coalesce(sum(target_bonus),0),'other_total',coalesce(sum(other_incentives),0),
    'deductions_total',coalesce(sum(deductions),0),'grand_total',coalesce(sum(total_incentive),0),
    'ineligible_count',count(*) filter(where not eligible)
  ) into v_summary
  from public.incentive_cycle_staff_snapshots where cycle_id=p_cycle_id;

  update public.incentive_cycles
  set status=p_next_status,updated_at=now(),summary_snapshot=v_summary,
      approved_at=case when p_next_status='approved' then now() else approved_at end,
      paid_at=case when p_next_status='paid' then now() else paid_at end,
      reopened_at=case when p_next_status='reopened' then now() else reopened_at end,
      reopen_reason=case when p_next_status='reopened' then p_reason else reopen_reason end
  where id=p_cycle_id;

  insert into public.incentive_governance_audit(cycle_id,action,from_status,to_status,actor_staff_id,actor_name,reason,details)
  values(
    p_cycle_id,'status_changed',v_current,p_next_status,v_audit_actor_id,v_audit_actor_name,p_reason,
    jsonb_build_object(
      'financial_summary',v_summary,
      'hr_prepare',case when p_next_status='approved' then v_hr_prepare else null end,
      'hr_readiness',case when p_next_status='approved' then v_hr else null end,
      'rules_version',(select rules_version from public.incentive_cycles where id=p_cycle_id)
    )
  );
end;
$$;

revoke all on function public.transition_incentive_cycle(uuid,text,text,text,text) from public;
grant execute on function public.transition_incentive_cycle(uuid,text,text,text,text) to anon,authenticated,service_role;

notify pgrst,'reload schema';
