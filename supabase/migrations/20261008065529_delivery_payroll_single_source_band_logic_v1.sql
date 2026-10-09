create or replace function public.dawaa_delivery_payroll_classification_v1(
  p_staff_id uuid,
  p_month_cycle text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_start date; v_end date; v_as_of date;
  v_staff public.staff%rowtype;
  v_policy public.delivery_payroll_policy_versions%rowtype;
  v_override public.delivery_payroll_staff_overrides%rowtype;
  v_rate public.delivery_payroll_rate_bands%rowtype;
  v_eligible boolean:=false;
  v_tenure text; v_tenure_source text;
  v_attended integer:=0; v_pending integer:=0; v_approved_days integer:=0;
  v_late integer:=0; v_early integer:=0; v_discipline integer:=0; v_excused integer:=0;
  v_band_result jsonb;
  v_committed_credit integer:=0; v_regular_credit integer:=0;
  v_band text; v_band_ar text; v_status text;
  v_cycle_closed boolean:=false; v_provisional boolean:=true; v_finalizable boolean:=false;
  v_eval_multiplier numeric:=null;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_delivery_payroll_classification_input' using errcode='22023';
  end if;

  select * into v_staff from public.staff where id=p_staff_id;
  if not found then raise exception 'delivery_staff_not_found' using errcode='22023'; end if;

  select b.cycle_start,b.cycle_end into v_start,v_end
  from public.dawaa_pay_cycle_bounds_v1(to_date(p_month_cycle||'-25','YYYY-MM-DD')) b;
  v_as_of:=least(v_end,(now() at time zone 'Africa/Cairo')::date);
  v_cycle_closed:=((now() at time zone 'Africa/Cairo')::date>v_end);

  select * into v_policy
  from public.delivery_payroll_policy_versions p
  where p.active=true and p.effective_from<=v_start and (p.effective_to is null or p.effective_to>=v_start)
  order by p.effective_from desc,p.created_at desc
  limit 1;
  if not found then
    return jsonb_build_object('staff_id',p_staff_id,'month_cycle',p_month_cycle,'status','policy_not_configured');
  end if;

  select * into v_override
  from public.delivery_payroll_staff_overrides o
  where o.staff_id=p_staff_id and o.effective_from<=v_end and (o.effective_to is null or o.effective_to>=v_start)
  order by o.effective_from desc,o.created_at desc
  limit 1;

  if found and v_override.payroll_eligible is not null then
    v_eligible:=v_override.payroll_eligible;
  else
    v_eligible:=(
      lower(trim(coalesce(v_staff.role,''))) in ('delivery','توصيل','مندوب','مندوب توصيل')
      or lower(trim(coalesce(v_staff.type,''))) in ('delivery','توصيل')
    );
  end if;

  if not v_eligible then
    return jsonb_build_object(
      'schema','dawaa_delivery_payroll_classification_v1',
      'staff_id',p_staff_id,'staff_name',v_staff.name,'branch',v_staff.branch,
      'month_cycle',p_month_cycle,'cycle_start',v_start,'cycle_end',v_end,
      'status','not_delivery_payroll','payroll_eligible',false
    );
  end if;

  if v_override.tenure_band in ('old','new') then
    v_tenure:=v_override.tenure_band;
    v_tenure_source:='management_override';
  elsif v_staff.join_date is not null then
    if (v_end-v_staff.join_date)>=v_policy.old_tenure_days then v_tenure:='old'; else v_tenure:='new'; end if;
    v_tenure_source:='staff_join_date';
  else
    v_tenure:='new';
    v_tenure_source:='fallback_new_missing_join_date';
  end if;

  select
    count(*) filter(where e.attended)::integer,
    count(*) filter(where e.attendance_status='approved')::integer,
    count(*) filter(where e.attendance_status='pending_review' or e.review_required)::integer,
    coalesce(sum(e.late_minutes) filter(where e.attended),0)::integer,
    coalesce(sum(e.early_leave_minutes) filter(where e.attended),0)::integer,
    coalesce(sum(e.discipline_minutes) filter(where e.attended),0)::integer,
    coalesce(sum((e.late_minutes+e.early_leave_minutes)-e.discipline_minutes) filter(where e.attended),0)::integer
  into v_attended,v_approved_days,v_pending,v_late,v_early,v_discipline,v_excused
  from public.dawaa_delivery_discipline_evidence_v1(p_staff_id,p_month_cycle) e;

  -- Single source of truth for band boundaries.
  v_band_result:=public.dawaa_delivery_discipline_band_v1(v_attended,v_discipline,v_start);
  v_status:=v_band_result->>'status';
  v_band:=nullif(v_band_result->>'discipline_band','');
  v_band_ar:=v_band_result->>'discipline_band_ar';
  v_committed_credit:=coalesce((v_band_result->>'committed_credit_minutes')::integer,0);
  v_regular_credit:=coalesce((v_band_result->>'regular_credit_minutes')::integer,0);

  if v_band is not null then
    select * into v_rate
    from public.delivery_payroll_rate_bands r
    where r.policy_version_id=v_policy.id and r.discipline_band=v_band and r.tenure_band=v_tenure
    limit 1;
    if not found or not coalesce(v_rate.configured,false) then
      v_status:='rate_unconfigured';
    end if;
  end if;

  select m.multiplier_pct into v_eval_multiplier
  from public.staff_evaluation_incentive_multipliers m
  where m.staff_id=p_staff_id and m.month_cycle=p_month_cycle
  order by m.updated_at desc
  limit 1;

  v_provisional:=not v_cycle_closed or v_pending>0;
  v_finalizable:=v_cycle_closed and v_pending=0 and v_attended>=v_policy.min_attended_days
    and v_band is not null and coalesce(v_rate.configured,false);

  return jsonb_build_object(
    'schema','dawaa_delivery_payroll_classification_v1',
    'policy_code',v_policy.policy_code,
    'staff_id',p_staff_id,'staff_name',v_staff.name,'branch',v_staff.branch,
    'payroll_eligible',true,
    'month_cycle',p_month_cycle,'cycle_start',v_start,'cycle_end',v_end,'as_of_date',v_as_of,
    'cycle_closed',v_cycle_closed,'provisional',v_provisional,'finalizable',v_finalizable,
    'attendance',jsonb_build_object(
      'minimum_attended_days',v_policy.min_attended_days,
      'attended_days',v_attended,
      'approved_days_seen',v_approved_days,
      'pending_review_days',v_pending
    ),
    'discipline',jsonb_build_object(
      'late_minutes',v_late,
      'early_leave_minutes',v_early,
      'raw_deviation_minutes',v_late+v_early,
      'excused_permission_minutes',v_excused,
      'classification_minutes',v_discipline,
      'committed_credit_minutes',v_committed_credit,
      'regular_credit_minutes',v_regular_credit,
      'committed_credit_per_attended_day',v_policy.committed_credit_minutes_per_day,
      'regular_credit_per_attended_day',v_policy.regular_credit_minutes_per_day,
      'rule','classification_minutes = late arrival + early departure after approved permission exemptions; penalty multipliers do not inflate discipline minutes'
    ),
    'classification',jsonb_build_object(
      'status',v_status,
      'discipline_band',v_band,
      'discipline_band_ar',v_band_ar,
      'tenure_band',v_tenure,
      'tenure_band_ar',case v_tenure when 'old' then 'قديم' else 'جديد' end,
      'tenure_source',v_tenure_source,
      'display_name',case when v_band is null then null else coalesce(v_rate.display_name,v_band_ar||' '||case v_tenure when 'old' then 'قديم' else 'جديد' end) end
    ),
    'rates',jsonb_build_object(
      'configured',coalesce(v_rate.configured,false),
      'hourly_rate',v_rate.hourly_rate,
      'order_rate',v_rate.order_rate,
      'trip_rate',v_rate.trip_rate,
      'monthly_incentive_cap',v_rate.monthly_incentive_cap,
      'quarterly_incentive_cap',v_rate.quarterly_incentive_cap,
      'monthly_evaluation_multiplier_pct',v_eval_multiplier,
      'trip_payment_ready',false,
      'trip_payment_blocker','canonical_trip_source_not_configured'
    )
  );
end;
$function$;

revoke all on function public.dawaa_delivery_payroll_classification_v1(uuid,text) from public;
revoke all on function public.dawaa_delivery_payroll_classification_v1(uuid,text) from anon,authenticated;