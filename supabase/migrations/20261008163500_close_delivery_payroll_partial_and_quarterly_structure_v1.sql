-- Close the remaining structural gaps in delivery payroll:
-- 1) explicit first/partial-cycle management decision using an existing rate band only
-- 2) explicit quarterly cycle + payout month + approved evaluation percentage
-- No automatic financial assumptions are introduced.

create table if not exists public.delivery_payroll_partial_cycle_decisions_v1 (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete restrict,
  month_cycle text not null check (month_cycle ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  discipline_band_override text not null check (discipline_band_override in ('committed','regular','low')),
  decision_status text not null default 'approved' check (decision_status in ('draft','approved','rejected')),
  reason text not null,
  approved_by uuid references public.staff_accounts(id) on delete restrict,
  approved_by_name text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(staff_id, month_cycle)
);

alter table public.delivery_payroll_partial_cycle_decisions_v1 enable row level security;
revoke all on public.delivery_payroll_partial_cycle_decisions_v1 from anon, authenticated;

create table if not exists public.delivery_payroll_quarter_cycles_v1 (
  id uuid primary key default gen_random_uuid(),
  quarter_code text not null unique,
  period_start date not null,
  period_end date not null,
  payout_month_cycle text not null check (payout_month_cycle ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start)
);
create unique index if not exists delivery_payroll_quarter_cycles_v1_one_active_payout_month
  on public.delivery_payroll_quarter_cycles_v1(payout_month_cycle) where active=true;
alter table public.delivery_payroll_quarter_cycles_v1 enable row level security;
revoke all on public.delivery_payroll_quarter_cycles_v1 from anon, authenticated;

create table if not exists public.delivery_payroll_quarterly_assessments_v1 (
  id uuid primary key default gen_random_uuid(),
  quarter_cycle_id uuid not null references public.delivery_payroll_quarter_cycles_v1(id) on delete restrict,
  staff_id uuid not null references public.staff(id) on delete restrict,
  score_pct numeric(5,2) not null check (score_pct between 0 and 100),
  assessment_status text not null default 'approved' check (assessment_status in ('draft','approved','rejected')),
  note text,
  approved_by uuid references public.staff_accounts(id) on delete restrict,
  approved_by_name text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(quarter_cycle_id, staff_id)
);
alter table public.delivery_payroll_quarterly_assessments_v1 enable row level security;
revoke all on public.delivery_payroll_quarterly_assessments_v1 from anon, authenticated;

create or replace function public.set_delivery_payroll_partial_cycle_decision_v1(
  p_staff_id uuid,
  p_month_cycle text,
  p_discipline_band text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_actor public.staff_accounts%rowtype;
  v_row public.delivery_payroll_partial_cycle_decisions_v1%rowtype;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$'
     or p_discipline_band not in ('committed','regular','low')
     or nullif(trim(coalesce(p_reason,'')),'') is null then
    raise exception 'invalid_partial_cycle_decision_input' using errcode='22023';
  end if;
  select * into v_actor from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict() and coalesce(active,false) and coalesce(can_login,false);
  if not found or coalesce(v_actor.role,'') not in ('general_manager','executive_manager')
     or not public.dawaa_current_actor_can(array['manage_payroll'])
     or not public.dawaa_can_manage_payroll_staff_id_v1(p_staff_id) then
    raise exception 'not_authorized_for_partial_cycle_decision' using errcode='42501';
  end if;
  insert into public.delivery_payroll_partial_cycle_decisions_v1(
    staff_id,month_cycle,discipline_band_override,decision_status,reason,approved_by,approved_by_name,approved_at,updated_at
  ) values(
    p_staff_id,p_month_cycle,p_discipline_band,'approved',trim(p_reason),v_actor.id,coalesce(v_actor.name,v_actor.username),now(),now()
  )
  on conflict(staff_id,month_cycle) do update set
    discipline_band_override=excluded.discipline_band_override,
    decision_status='approved',reason=excluded.reason,approved_by=excluded.approved_by,
    approved_by_name=excluded.approved_by_name,approved_at=excluded.approved_at,updated_at=now()
  returning * into v_row;
  return jsonb_build_object('success',true,'decision',to_jsonb(v_row),'financial_effect','none_until_cycle_finalization');
end;$$;
revoke all on function public.set_delivery_payroll_partial_cycle_decision_v1(uuid,text,text,text) from public, anon;
grant execute on function public.set_delivery_payroll_partial_cycle_decision_v1(uuid,text,text,text) to authenticated, service_role;

create or replace function public.set_delivery_payroll_quarterly_assessment_v1(
  p_staff_id uuid,
  p_quarter_code text,
  p_score_pct numeric,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_actor public.staff_accounts%rowtype;
  v_cycle public.delivery_payroll_quarter_cycles_v1%rowtype;
  v_row public.delivery_payroll_quarterly_assessments_v1%rowtype;
begin
  if p_staff_id is null or nullif(trim(coalesce(p_quarter_code,'')),'') is null or p_score_pct is null or p_score_pct<0 or p_score_pct>100 then
    raise exception 'invalid_delivery_quarterly_assessment_input' using errcode='22023';
  end if;
  select * into v_actor from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict() and coalesce(active,false) and coalesce(can_login,false);
  if not found or coalesce(v_actor.role,'') not in ('general_manager','executive_manager')
     or not public.dawaa_current_actor_can(array['manage_payroll'])
     or not public.dawaa_can_manage_payroll_staff_id_v1(p_staff_id) then
    raise exception 'not_authorized_for_delivery_quarterly_assessment' using errcode='42501';
  end if;
  select * into v_cycle from public.delivery_payroll_quarter_cycles_v1
  where quarter_code=trim(p_quarter_code) and active=true limit 1;
  if not found then raise exception 'delivery_quarter_cycle_not_found_or_inactive' using errcode='22023'; end if;
  insert into public.delivery_payroll_quarterly_assessments_v1(
    quarter_cycle_id,staff_id,score_pct,assessment_status,note,approved_by,approved_by_name,approved_at,updated_at
  ) values(
    v_cycle.id,p_staff_id,p_score_pct,'approved',nullif(trim(coalesce(p_note,'')),''),v_actor.id,coalesce(v_actor.name,v_actor.username),now(),now()
  )
  on conflict(quarter_cycle_id,staff_id) do update set
    score_pct=excluded.score_pct,assessment_status='approved',note=excluded.note,approved_by=excluded.approved_by,
    approved_by_name=excluded.approved_by_name,approved_at=excluded.approved_at,updated_at=now()
  returning * into v_row;
  return jsonb_build_object('success',true,'assessment',to_jsonb(v_row),'quarter_code',v_cycle.quarter_code,'payout_month_cycle',v_cycle.payout_month_cycle);
end;$$;
revoke all on function public.set_delivery_payroll_quarterly_assessment_v1(uuid,text,numeric,text) from public, anon;
grant execute on function public.set_delivery_payroll_quarterly_assessment_v1(uuid,text,numeric,text) to authenticated, service_role;

create or replace function public.delivery_payroll_quarterly_incentive_truth_v1(
  p_staff_id uuid,
  p_month_cycle text
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_cycle public.delivery_payroll_quarter_cycles_v1%rowtype;
  v_assessment public.delivery_payroll_quarterly_assessments_v1%rowtype;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_delivery_quarterly_truth_input' using errcode='22023';
  end if;
  select * into v_cycle from public.delivery_payroll_quarter_cycles_v1
  where active=true and payout_month_cycle=p_month_cycle
  order by period_end desc,created_at desc limit 1;
  if not found then
    return jsonb_build_object('schema','delivery_payroll_quarterly_incentive_truth_v1','due',false,'status','not_due','score_pct',null);
  end if;
  select * into v_assessment from public.delivery_payroll_quarterly_assessments_v1
  where quarter_cycle_id=v_cycle.id and staff_id=p_staff_id
  order by updated_at desc limit 1;
  if not found or v_assessment.assessment_status<>'approved' then
    return jsonb_build_object(
      'schema','delivery_payroll_quarterly_incentive_truth_v1','due',true,'status','assessment_required',
      'quarter_code',v_cycle.quarter_code,'period_start',v_cycle.period_start,'period_end',v_cycle.period_end,
      'payout_month_cycle',v_cycle.payout_month_cycle,'approved',false,'score_pct',null
    );
  end if;
  return jsonb_build_object(
    'schema','delivery_payroll_quarterly_incentive_truth_v1','due',true,'status','approved',
    'quarter_code',v_cycle.quarter_code,'period_start',v_cycle.period_start,'period_end',v_cycle.period_end,
    'payout_month_cycle',v_cycle.payout_month_cycle,'approved',true,'score_pct',v_assessment.score_pct,
    'assessment_id',v_assessment.id,'approved_at',v_assessment.approved_at,'approved_by_name',v_assessment.approved_by_name
  );
end;$$;
revoke all on function public.delivery_payroll_quarterly_incentive_truth_v1(uuid,text) from public, anon, authenticated;
grant execute on function public.delivery_payroll_quarterly_incentive_truth_v1(uuid,text) to service_role;

-- Extend classification to consume an explicitly approved partial-cycle band only.
create or replace function public.dawaa_delivery_payroll_classification_v1(p_staff_id uuid, p_month_cycle text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $$
declare
  v_start date; v_end date; v_as_of date;
  v_staff public.staff%rowtype;
  v_policy public.delivery_payroll_policy_versions%rowtype;
  v_override public.delivery_payroll_staff_overrides%rowtype;
  v_partial public.delivery_payroll_partial_cycle_decisions_v1%rowtype;
  v_rate public.delivery_payroll_rate_bands%rowtype;
  v_eligible boolean:=false; v_partial_override boolean:=false;
  v_tenure text; v_tenure_source text;
  v_attended integer:=0; v_pending integer:=0; v_approved_days integer:=0;
  v_late integer:=0; v_early integer:=0; v_discipline integer:=0; v_excused integer:=0;
  v_band_result jsonb;
  v_committed_credit integer:=0; v_regular_credit integer:=0;
  v_band text; v_band_ar text; v_status text;
  v_cycle_closed boolean:=false; v_provisional boolean:=true; v_finalizable boolean:=false;
  v_eval_multiplier numeric:=null;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid_delivery_payroll_classification_input' using errcode='22023'; end if;
  select * into v_staff from public.staff where id=p_staff_id;
  if not found then raise exception 'delivery_staff_not_found' using errcode='22023'; end if;
  select b.cycle_start,b.cycle_end into v_start,v_end from public.dawaa_pay_cycle_bounds_v1(to_date(p_month_cycle||'-25','YYYY-MM-DD')) b;
  v_as_of:=least(v_end,(now() at time zone 'Africa/Cairo')::date);
  v_cycle_closed:=((now() at time zone 'Africa/Cairo')::date>v_end);
  select * into v_policy from public.delivery_payroll_policy_versions p
   where p.active=true and p.effective_from<=v_start and (p.effective_to is null or p.effective_to>=v_start)
   order by p.effective_from desc,p.created_at desc limit 1;
  if not found then return jsonb_build_object('staff_id',p_staff_id,'month_cycle',p_month_cycle,'status','policy_not_configured'); end if;
  select * into v_override from public.delivery_payroll_staff_overrides o
   where o.staff_id=p_staff_id and o.effective_from<=v_end and (o.effective_to is null or o.effective_to>=v_start)
   order by o.effective_from desc,o.created_at desc limit 1;
  if found and v_override.payroll_eligible is not null then v_eligible:=v_override.payroll_eligible;
  else v_eligible:=(lower(trim(coalesce(v_staff.role,''))) in ('delivery','توصيل','مندوب','مندوب توصيل') or lower(trim(coalesce(v_staff.type,''))) in ('delivery','توصيل')); end if;
  if not v_eligible then return jsonb_build_object('schema','dawaa_delivery_payroll_classification_v1','staff_id',p_staff_id,'staff_name',v_staff.name,'branch',v_staff.branch,'month_cycle',p_month_cycle,'cycle_start',v_start,'cycle_end',v_end,'status','not_delivery_payroll','payroll_eligible',false); end if;
  if v_override.tenure_band in ('old','new') then v_tenure:=v_override.tenure_band; v_tenure_source:='management_override';
  elsif v_staff.join_date is not null then if (v_end-v_staff.join_date)>=v_policy.old_tenure_days then v_tenure:='old'; else v_tenure:='new'; end if; v_tenure_source:='staff_join_date';
  else v_tenure:='new'; v_tenure_source:='fallback_new_missing_join_date'; end if;
  select count(*) filter(where e.attended)::integer,
         count(*) filter(where e.attendance_status='approved')::integer,
         count(*) filter(where e.attendance_status='pending_review' or e.review_required)::integer,
         coalesce(sum(e.late_minutes) filter(where e.attended),0)::integer,
         coalesce(sum(e.early_leave_minutes) filter(where e.attended),0)::integer,
         coalesce(sum(e.discipline_minutes) filter(where e.attended),0)::integer,
         coalesce(sum((e.late_minutes+e.early_leave_minutes)-e.discipline_minutes) filter(where e.attended),0)::integer
    into v_attended,v_approved_days,v_pending,v_late,v_early,v_discipline,v_excused
  from public.dawaa_delivery_discipline_evidence_v1(p_staff_id,p_month_cycle) e;
  v_band_result:=public.dawaa_delivery_discipline_band_v1(v_attended,v_discipline,v_start);
  v_status:=v_band_result->>'status'; v_band:=nullif(v_band_result->>'discipline_band',''); v_band_ar:=v_band_result->>'discipline_band_ar';
  v_committed_credit:=coalesce((v_band_result->>'committed_credit_minutes')::integer,0); v_regular_credit:=coalesce((v_band_result->>'regular_credit_minutes')::integer,0);
  if v_status='insufficient_attendance_days' and v_staff.join_date is not null and v_staff.join_date>v_start and v_staff.join_date<=v_end then
    select * into v_partial from public.delivery_payroll_partial_cycle_decisions_v1 d
    where d.staff_id=p_staff_id and d.month_cycle=p_month_cycle and d.decision_status='approved'
    order by d.updated_at desc limit 1;
    if found then
      v_partial_override:=true; v_band:=v_partial.discipline_band_override;
      v_band_ar:=case v_band when 'committed' then 'ملتزم' when 'regular' then 'عادي' else 'منخفض' end;
      v_status:='partial_cycle_admin_override';
    end if;
  end if;
  if v_band is not null then
    select * into v_rate from public.delivery_payroll_rate_bands r where r.policy_version_id=v_policy.id and r.discipline_band=v_band and r.tenure_band=v_tenure limit 1;
    if not found or not coalesce(v_rate.configured,false) then v_status:='rate_unconfigured'; end if;
  end if;
  select m.multiplier_pct into v_eval_multiplier from public.staff_evaluation_incentive_multipliers m where m.staff_id=p_staff_id and m.month_cycle=p_month_cycle order by m.updated_at desc limit 1;
  v_provisional:=not v_cycle_closed or v_pending>0;
  v_finalizable:=v_cycle_closed and v_pending=0 and (v_attended>=v_policy.min_attended_days or v_partial_override) and v_band is not null and coalesce(v_rate.configured,false);
  return jsonb_build_object(
    'schema','dawaa_delivery_payroll_classification_v1','policy_code',v_policy.policy_code,
    'staff_id',p_staff_id,'staff_name',v_staff.name,'branch',v_staff.branch,'payroll_eligible',true,
    'month_cycle',p_month_cycle,'cycle_start',v_start,'cycle_end',v_end,'as_of_date',v_as_of,'cycle_closed',v_cycle_closed,'provisional',v_provisional,'finalizable',v_finalizable,
    'attendance',jsonb_build_object('minimum_attended_days',v_policy.min_attended_days,'attended_days',v_attended,'approved_days_seen',v_approved_days,'pending_review_days',v_pending),
    'discipline',jsonb_build_object('late_minutes',v_late,'early_leave_minutes',v_early,'raw_deviation_minutes',v_late+v_early,'excused_permission_minutes',v_excused,'classification_minutes',v_discipline,'committed_credit_minutes',v_committed_credit,'regular_credit_minutes',v_regular_credit,'committed_credit_per_attended_day',v_policy.committed_credit_minutes_per_day,'regular_credit_per_attended_day',v_policy.regular_credit_minutes_per_day,'rule','classification_minutes = late arrival + early departure after approved permission exemptions; penalty multipliers do not inflate discipline minutes'),
    'classification',jsonb_build_object('status',v_status,'discipline_band',v_band,'discipline_band_ar',v_band_ar,'tenure_band',v_tenure,'tenure_band_ar',case v_tenure when 'old' then 'قديم' else 'جديد' end,'tenure_source',v_tenure_source,'display_name',case when v_band is null then null else coalesce(v_rate.display_name,v_band_ar||' '||case v_tenure when 'old' then 'قديم' else 'جديد' end) end),
    'partial_cycle',jsonb_build_object('override_applied',v_partial_override,'decision_id',case when v_partial_override then v_partial.id else null end,'decision_band',case when v_partial_override then v_partial.discipline_band_override else null end,'decision_reason',case when v_partial_override then v_partial.reason else null end),
    'rates',jsonb_build_object('configured',coalesce(v_rate.configured,false),'hourly_rate',v_rate.hourly_rate,'order_rate',v_rate.order_rate,'trip_rate',v_rate.trip_rate,'monthly_incentive_cap',v_rate.monthly_incentive_cap,'quarterly_incentive_cap',v_rate.quarterly_incentive_cap,'monthly_evaluation_multiplier_pct',v_eval_multiplier,'trip_payment_ready',false,'trip_payment_blocker','canonical_trip_source_not_configured')
  );
end;$$;

-- Delivery preview now treats partial-cycle override as an explicit management exception and quarterly payout as due only when configured.
create or replace function public.dawaa_delivery_financial_preview_v2(p_staff_id uuid, p_month_cycle text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $$
declare
  j jsonb; v_snap public.delivery_payroll_activity_snapshots_v1%rowtype; v_hours jsonb;
  v_has_snapshot boolean:=false; v_bridge_ready boolean:=false; v_payroll_days int:=0;
  v_warnings jsonb:='[]'::jsonb; v_blockers jsonb:='[]'::jsonb;
  v_join date; v_start date; v_end date; v_min_days int:=26; v_max_possible int:=0; v_partial_override boolean:=false;
  v_quarter jsonb; v_quarter_due boolean:=false; v_quarter_approved boolean:=false; v_quarter_pct numeric:=null; v_quarter_cap numeric:=0; v_quarter_amount numeric:=0; v_gross numeric:=0;
begin
  j:=public.dawaa_delivery_financial_preview_v1(p_staff_id,p_month_cycle);
  select * into v_snap from public.delivery_payroll_activity_snapshots_v1 s where s.staff_id=p_staff_id and s.month_cycle=p_month_cycle limit 1;
  v_has_snapshot:=found; v_bridge_ready:=v_has_snapshot;
  v_hours:=public.dawaa_delivery_hours_truth_v1(p_staff_id,p_month_cycle);
  v_payroll_days:=coalesce((v_hours->>'actual_worked_days')::int,0);
  v_warnings:=coalesce(j->'warnings','[]'::jsonb); v_blockers:=coalesce(j->'blockers','[]'::jsonb);
  v_start:=nullif(j->>'cycle_start','')::date; v_end:=nullif(j->>'cycle_end','')::date;
  v_min_days:=coalesce((j->'classification'->'attendance'->>'minimum_attended_days')::int,26);
  v_partial_override:=coalesce((j->'classification'->'partial_cycle'->>'override_applied')::boolean,false);
  select s.join_date into v_join from public.staff s where s.id=p_staff_id;
  if v_has_snapshot then
    if v_snap.app_attendance_open_shifts>0 then v_warnings:=v_warnings||jsonb_build_array(jsonb_build_object('code','delivery_app_open_attendance','count',v_snap.app_attendance_open_shifts)); end if;
    if v_snap.app_attendance_review_shifts>0 then v_warnings:=v_warnings||jsonb_build_array(jsonb_build_object('code','delivery_app_attendance_review','count',v_snap.app_attendance_review_shifts)); end if;
    if v_snap.app_attendance_days>0 and v_payroll_days<>v_snap.app_attendance_days then v_warnings:=v_warnings||jsonb_build_array(jsonb_build_object('code','attendance_source_day_mismatch','payroll_days',v_payroll_days,'delivery_app_days',v_snap.app_attendance_days));
    elsif v_snap.app_attendance_days=0 and v_payroll_days>0 then v_warnings:=v_warnings||jsonb_build_array(jsonb_build_object('code','delivery_app_attendance_missing_but_payroll_present','payroll_days',v_payroll_days)); end if;
    if v_snap.app_attendance_days=0 and v_payroll_days=0 and (v_snap.orders_total>0 or v_snap.trips_total>0) then v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','delivery_activity_without_attendance_evidence','orders_total',v_snap.orders_total,'trips_total',v_snap.trips_total)); end if;
  end if;
  if v_join is not null and v_start is not null and v_end is not null and v_join>v_start and v_join<=v_end then
    select count(*)::int into v_max_possible from generate_series(v_join::timestamp,v_end::timestamp,interval '1 day') g
    left join lateral public.attendance_schedule_for_date_v1(p_staff_id,g::date) s on true
    where coalesce(s.is_off,false)=false and coalesce(s.is_day_off,false)=false and s.shift_start is not null and s.shift_end is not null;
    if v_max_possible<v_min_days and not v_partial_override then
      v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','delivery_partial_cycle_policy_required','label','الموظف بدأ أثناء الدورة ولا يمكنه الوصول للحد الأدنى 26 يوم؛ يلزم قرار إداري صريح لاختيار فئة من مصفوفة الدليفري لأول دورة فقط','join_date',v_join,'maximum_possible_attended_days',v_max_possible,'minimum_attended_days',v_min_days));
    end if;
  end if;
  v_quarter:=public.delivery_payroll_quarterly_incentive_truth_v1(p_staff_id,p_month_cycle);
  v_quarter_due:=coalesce((v_quarter->>'due')::boolean,false);
  v_quarter_approved:=coalesce((v_quarter->>'approved')::boolean,false);
  if v_quarter_due and not v_quarter_approved then
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','delivery_quarterly_evaluation_missing','label','هذا شهر صرف الحافز الربع سنوي ولا يوجد تقييم ربع سنوي معتمد','quarter_code',v_quarter->>'quarter_code'));
  elsif v_quarter_due and v_quarter_approved then
    v_quarter_pct:=coalesce((v_quarter->>'score_pct')::numeric,0);
    v_quarter_cap:=coalesce((j->'classification'->'rates'->>'quarterly_incentive_cap')::numeric,0);
    v_quarter_amount:=round(v_quarter_cap*least(100,greatest(0,v_quarter_pct))/100.0,2);
  end if;
  v_gross:=coalesce((j->'earnings_preview'->>'gross_before_manual_adjustments')::numeric,0)+v_quarter_amount;
  j:=jsonb_set(j,'{schema}',to_jsonb('dawaa_delivery_financial_preview_v2'::text),true);
  j:=jsonb_set(j,'{classification,rates,trip_payment_ready}',to_jsonb(v_bridge_ready),true);
  j:=jsonb_set(j,'{classification,rates,trip_payment_blocker}',case when v_bridge_ready then 'null'::jsonb else to_jsonb('delivery_activity_snapshot_missing'::text) end,true);
  j:=jsonb_set(j,'{earnings_preview,quarterly_incentive}',to_jsonb(v_quarter_amount),true);
  j:=jsonb_set(j,'{earnings_preview,gross_before_manual_adjustments}',to_jsonb(round(v_gross,2)),true);
  j:=jsonb_set(j,'{warnings}',v_warnings,true); j:=jsonb_set(j,'{blockers}',v_blockers,true);
  j:=jsonb_set(j,'{ready_for_final}',to_jsonb(coalesce((j->>'ready_for_final')::boolean,false) and jsonb_array_length(v_blockers)=0),true);
  j:=j||jsonb_build_object(
    'activity_bridge_ready',v_bridge_ready,'activity_bridge_source','delivery_payroll_activity_snapshots_v1',
    'partial_cycle_context',jsonb_build_object('join_date',v_join,'maximum_possible_attended_days',v_max_possible,'minimum_attended_days',v_min_days,'override_applied',v_partial_override),
    'quarterly_incentive_status',v_quarter->>'status','quarterly_incentive_truth',v_quarter,
    'delivery_attendance_evidence',case when not v_has_snapshot then null else jsonb_build_object('source','delivery_attendance','used_for_payroll',false,'payroll_is_canonical',true,'app_attendance_days',v_snap.app_attendance_days,'app_attendance_minutes',v_snap.app_attendance_minutes,'app_open_shifts',v_snap.app_attendance_open_shifts,'app_review_shifts',v_snap.app_attendance_review_shifts,'payroll_worked_days',v_payroll_days) end
  );
  return j;
end;$$;
