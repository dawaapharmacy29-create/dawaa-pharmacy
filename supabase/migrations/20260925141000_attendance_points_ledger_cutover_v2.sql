-- Attendance points deduction canonical ledger cutover V2.
-- Replaces hourly DELETE/INSERT rebuilds with a stable event identity, fingerprinted
-- recalculation and explicit invalidation. V1 APIs become compatibility wrappers.

create or replace function public.dawaa_upsert_attendance_deduction_event_v2(
  p_staff_id uuid,
  p_employee_name text,
  p_branch text,
  p_month_cycle text,
  p_transaction_date date,
  p_points numeric,
  p_amount numeric,
  p_description text,
  p_calculation_fingerprint text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_hash text;
  v_source_id uuid;
  v_existing public.employee_transactions%rowtype;
  v_saved public.employee_transactions%rowtype;
  v_finalized boolean:=false;
  v_points numeric:=round(greatest(coalesce(p_points,0),0),2);
  v_amount numeric:=round(greatest(coalesce(p_amount,0),0),2);
  v_old_fingerprint text;
  v_manager_adjusted boolean:=false;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_attendance_deduction_event_input' using errcode='22023';
  end if;

  v_hash:=md5(p_staff_id::text||'|'||p_month_cycle||'|attendance_deduction_v2');
  v_source_id:=(
    substr(v_hash,1,8)||'-'||substr(v_hash,9,4)||'-'||substr(v_hash,13,4)||'-'||
    substr(v_hash,17,4)||'-'||substr(v_hash,21,12)
  )::uuid;

  select exists(
    select 1 from public.payroll_finalized_snapshots_v2 f
    where f.staff_id=p_staff_id and f.month_cycle=p_month_cycle
  ) into v_finalized;

  select * into v_existing
  from public.employee_transactions et
  where et.staff_id=p_staff_id
    and et.month_cycle=p_month_cycle
    and et.source='attendance_deduction_v2'
    and et.source_id=v_source_id
    and et.status in ('pending','active','approved')
  order by
    case et.status when 'approved' then 1 when 'active' then 2 else 3 end,
    coalesce(et.updated_at,et.created_at) desc,
    et.id desc
  limit 1
  for update;

  if found then
    v_old_fingerprint:=nullif(v_existing.metadata->>'calculation_fingerprint','');
    v_manager_adjusted:=coalesce((v_existing.metadata->>'manager_adjusted')::boolean,false);

    if v_finalized then
      return jsonb_build_object(
        'action','frozen',
        'id',v_existing.id,
        'status',v_existing.status,
        'source_id',v_source_id
      );
    end if;

    if v_old_fingerprint is not distinct from p_calculation_fingerprint then
      if v_existing.status='pending' and not v_manager_adjusted then
        update public.employee_transactions
        set employee_name=p_employee_name,
            branch=p_branch,
            type='penalty',
            title='خصم حضور — بانتظار اعتماد المدير',
            reason='خصم تأخير/غياب من Attendance Truth المعتمد',
            description=p_description,
            amount=v_amount,
            points=v_points,
            points_delta=-v_points,
            base_points=v_points,
            final_points=-v_points,
            transaction_date=p_transaction_date,
            employee_visible=true,
            metadata=coalesce(metadata,'{}'::jsonb)||coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object(
              'engine_version',2,
              'rule_code','attendance_deduction_v2',
              'calculation_fingerprint',p_calculation_fingerprint,
              'manager_adjusted',false
            ),
            updated_at=now()
        where id=v_existing.id
        returning * into v_saved;

        return jsonb_build_object('action','updated_pending','id',v_saved.id,'status',v_saved.status,'source_id',v_source_id);
      end if;

      return jsonb_build_object(
        'action',case when v_manager_adjusted then 'kept_manager_adjustment' else 'unchanged' end,
        'id',v_existing.id,
        'status',v_existing.status,
        'source_id',v_source_id
      );
    end if;

    update public.employee_transactions
    set status='cancelled',
        description=coalesce(description,'')||' | أُلغي تلقائيًا لأن Attendance Truth/التعويضات تغيرت بعد الحساب السابق.',
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'invalidated_at',now(),
          'invalidated_by','attendance_deduction_v2',
          'replacement_fingerprint',p_calculation_fingerprint
        ),
        updated_at=now()
    where id=v_existing.id;

    insert into public.incentive_audit_log(
      staff_id,rule_code,source_module,cycle_start,cycle_end,points_delta,money_delta,status,note,created_by
    )
    select
      p_staff_id,'attendance_deduction_v2_recalculated','attendance',
      b.cycle_start,b.cycle_end,0,0,'cancelled',
      'تم إلغاء حركة الحضور السابقة لأن بصمة الحقيقة المالية تغيرت؛ سيُنشأ اقتراح جديد عند وجود خصم.',
      'system_attendance_sync'
    from public.dawaa_pay_cycle_bounds_v1(to_date(p_month_cycle||'-25','YYYY-MM-DD')) b;
  end if;

  if v_points<=0 or v_amount<=0 then
    return jsonb_build_object('action','no_deduction','source_id',v_source_id);
  end if;

  insert into public.employee_transactions(
    staff_id,employee_id,employee_name,branch,type,title,reason,description,
    amount,points,points_delta,base_points,final_points,source,source_id,
    transaction_date,month_cycle,status,employee_visible,created_by,metadata
  ) values(
    p_staff_id,p_staff_id,p_employee_name,p_branch,'penalty',
    'خصم حضور — بانتظار اعتماد المدير',
    'خصم تأخير/غياب من Attendance Truth المعتمد',
    p_description,
    v_amount,v_points,-v_points,v_points,-v_points,
    'attendance_deduction_v2',v_source_id,p_transaction_date,p_month_cycle,'pending',true,
    'system_attendance_sync',
    coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object(
      'engine_version',2,
      'rule_code','attendance_deduction_v2',
      'calculation_fingerprint',p_calculation_fingerprint,
      'manager_adjusted',false
    )
  )
  returning * into v_saved;

  return jsonb_build_object('action','created_pending','id',v_saved.id,'status',v_saved.status,'source_id',v_source_id);
end;
$function$;

revoke execute on function public.dawaa_upsert_attendance_deduction_event_v2(uuid,text,text,text,date,numeric,numeric,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.dawaa_upsert_attendance_deduction_event_v2(uuid,text,text,text,date,numeric,numeric,text,text,jsonb)
  to service_role;

create or replace function public.dawaa_sync_attendance_points_deduction_v2(
  p_month_cycle text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_month text;
  v_start date;
  v_end date;
  v_s record;
  v_comp record;
  v_point_rate numeric;
  v_egp numeric;
  v_points numeric;
  v_true_hourly_rate numeric;
  v_late_penalty_total int;
  v_early_total int;
  v_absence_days int;
  v_absence_hours numeric;
  v_late_total int;
  v_cap_points numeric;
  v_deviation jsonb;
  v_updated int:=0;
  v_skipped_no_comp int:=0;
  v_skipped_capped int:=0;
  v_skipped_hours_mode int:=0;
  v_day record;
  v_fingerprint text;
  v_result jsonb;
begin
  if p_month_cycle is not null then
    select cycle_start,cycle_end into v_start,v_end
    from public.dawaa_pay_cycle_bounds_v1(to_date(p_month_cycle||'-25','YYYY-MM-DD'));
    v_month:=p_month_cycle;
  else
    select cycle_start,cycle_end,month_cycle into v_start,v_end,v_month
    from public.dawaa_pay_cycle_bounds_v1(null);
  end if;
  v_end:=least(v_end,(now() at time zone 'Africa/Cairo')::date);

  for v_s in
    select id,name,branch,role from public.staff where coalesce(active,false)=true
  loop
    select * into v_comp
    from public.employee_compensation_profiles
    where staff_id=v_s.id::text and active=true
    order by effective_from desc nulls last
    limit 1;

    if v_comp.hourly_rate is null or v_comp.hourly_rate<=0
       or coalesce(v_comp.monthly_incentive_base,0)<=0 then
      v_skipped_no_comp:=v_skipped_no_comp+1;
      continue;
    end if;

    if coalesce(v_comp.salary_calculation_mode,'legacy_fixed')='attendance_hours_v1' then
      v_skipped_hours_mode:=v_skipped_hours_mode+1;
      continue;
    end if;

    v_true_hourly_rate:=round(v_comp.hourly_rate/26.0,4);
    v_late_penalty_total:=0;
    v_early_total:=0;
    v_absence_days:=0;
    v_absence_hours:=0;
    v_late_total:=0;

    for v_day in
      select ads.id,ads.attendance_date,ads.resolution_status,ads.late_minutes,ads.early_leave_minutes,
             ads.candidate_hours,ads.scheduled_start_at,ads.scheduled_end_at
      from public.attendance_daily_summary ads
      where ads.staff_id=v_s.id
        and ads.attendance_date between v_start and v_end
        and ads.status='approved'
      order by ads.attendance_date
    loop
      declare
        v_scheduled_hours numeric:=case
          when v_day.scheduled_start_at is not null and v_day.scheduled_end_at is not null
          then extract(epoch from (v_day.scheduled_end_at-v_day.scheduled_start_at))/3600.0
          else null
        end;
        v_extra_minutes int:=round(greatest(coalesce(v_day.candidate_hours,0)-coalesce(v_scheduled_hours,0),0)*60)::int;
      begin
        v_deviation:=public.dawaa_net_attendance_deviation_v1(
          coalesce(v_day.late_minutes,0),v_extra_minutes,v_s.role,false
        );
        v_late_penalty_total:=v_late_penalty_total+coalesce((v_deviation->>'deduction_minutes')::int,0);
        v_late_total:=v_late_total+coalesce(v_day.late_minutes,0);
        v_early_total:=v_early_total+coalesce(v_day.early_leave_minutes,0);
        if v_day.resolution_status='absence_review' then
          v_absence_days:=v_absence_days+1;
          v_absence_hours:=v_absence_hours+coalesce(v_scheduled_hours,0);
        end if;
      end;
    end loop;

    select md5(
      coalesce(jsonb_agg(
        jsonb_build_object(
          'date',ads.attendance_date,
          'resolution_id',ads.id,
          'resolution_fingerprint',public.attendance_resolution_fingerprint_v2(ads.id)
        ) order by ads.attendance_date
      )::text,'[]')
      ||'|'||coalesce(v_comp.hourly_rate,0)::text
      ||'|'||coalesce(v_comp.monthly_incentive_base,0)::text
      ||'|'||coalesce(v_comp.point_value,0)::text
      ||'|'||coalesce(v_comp.salary_calculation_mode,'')
    )
    into v_fingerprint
    from public.attendance_daily_summary ads
    where ads.staff_id=v_s.id
      and ads.attendance_date between v_start and v_end
      and ads.status='approved';

    v_egp:=round(
      (v_late_penalty_total/60.0)*v_true_hourly_rate
      +(v_early_total/60.0)*v_true_hourly_rate
      +(v_absence_hours*v_true_hourly_rate)
    ,2);

    v_point_rate:=case when coalesce(v_comp.point_value,0)>0 then v_comp.point_value else 3 end;
    v_points:=case when v_egp>0 then round(v_egp/v_point_rate,2) else 0 end;
    v_cap_points:=round(v_comp.monthly_incentive_base/v_point_rate,2);

    if v_points>v_cap_points then
      v_points:=v_cap_points;
      v_skipped_capped:=v_skipped_capped+1;
    end if;
    v_egp:=round(v_points*v_point_rate,2);

    v_result:=public.dawaa_upsert_attendance_deduction_event_v2(
      v_s.id,v_s.name,v_s.branch,v_month,v_end,v_points,v_egp,
      format(
        'تأخير فعلي %s دقيقة (محتسب %s بعد المقاصة) + خروج مبكر %s دقيقة + %s يوم غياب (%s ساعة) بسعر ساعة %s ج.م — دورة %s إلى %s.',
        v_late_total,v_late_penalty_total,v_early_total,v_absence_days,round(v_absence_hours,1),
        v_true_hourly_rate,v_start,v_end
      ),
      v_fingerprint,
      jsonb_build_object(
        'cycle_start',v_start,
        'cycle_end',v_end,
        'late_minutes_raw',v_late_total,
        'late_minutes_deducted',v_late_penalty_total,
        'early_leave_minutes',v_early_total,
        'absence_days',v_absence_days,
        'absence_hours',round(v_absence_hours,2),
        'true_hourly_rate',v_true_hourly_rate,
        'point_rate',v_point_rate
      )
    );

    if coalesce(v_result->>'action','') in ('created_pending','updated_pending') then
      v_updated:=v_updated+1;
    end if;
  end loop;

  return jsonb_build_object(
    'engine_version',2,
    'month_cycle',v_month,
    'cycle_start',v_start,
    'cycle_end',v_end,
    'staff_pending_created_or_updated',v_updated,
    'capped_at_incentive_limit',v_skipped_capped,
    'skipped_no_compensation_profile',v_skipped_no_comp,
    'skipped_hours_based_mode',v_skipped_hours_mode
  );
end;
$function$;

revoke execute on function public.dawaa_sync_attendance_points_deduction_v2(text)
  from public,anon,authenticated;
grant execute on function public.dawaa_sync_attendance_points_deduction_v2(text)
  to service_role;

create or replace function public.attendance_deduction_pending_review_v2()
returns table(
  id uuid,
  staff_id uuid,
  employee_name text,
  branch text,
  month_cycle text,
  points numeric,
  amount numeric,
  description text,
  transaction_date date
)
language sql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
  select et.id,et.staff_id,et.employee_name,et.branch,et.month_cycle,
         abs(coalesce(et.points_delta,et.points,0))::numeric,
         et.amount,et.description,et.transaction_date
  from public.employee_transactions et
  where et.source='attendance_deduction_v2' and et.status='pending'
  order by abs(coalesce(et.points_delta,et.points,0)) desc;
$function$;

create or replace function public.attendance_deduction_review_decide_v2(
  p_transaction_id uuid,
  p_decision text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_row public.employee_transactions%rowtype;
  v_actor public.staff_accounts%rowtype;
  v_new_status text;
  v_bounds record;
begin
  if p_decision not in ('approve','reject') then
    raise exception 'invalid_attendance_deduction_decision' using errcode='22023';
  end if;
  if not public.dawaa_can_manage_biometric_mapping_v1() then
    raise exception 'not_authorized_for_attendance_deduction_review' using errcode='42501';
  end if;

  select * into v_row
  from public.employee_transactions
  where id=p_transaction_id and source='attendance_deduction_v2' and status='pending'
  for update;
  if not found then
    raise exception 'attendance_deduction_not_pending' using errcode='22023';
  end if;

  select * into v_actor
  from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict();

  if exists(
    select 1 from public.payroll_finalized_snapshots_v2 f
    where f.staff_id=v_row.staff_id and f.month_cycle=v_row.month_cycle
  ) then
    raise exception 'finalized_payroll_cycle_is_immutable' using errcode='55000';
  end if;

  v_new_status:=case when p_decision='approve' then 'approved' else 'cancelled' end;

  update public.employee_transactions
  set status=v_new_status,
      approved_by=case when v_new_status='approved' then v_actor.id::text else null end,
      approved_by_name=case when v_new_status='approved' then coalesce(v_actor.name,v_actor.staff_name,v_actor.username) else null end,
      approved_at=case when v_new_status='approved' then now() else null end,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'review_decision',p_decision,
        'review_note',nullif(trim(coalesce(p_note,'')),''),
        'reviewed_at',now(),
        'reviewed_by',v_actor.id
      ),
      updated_at=now()
  where id=v_row.id;

  select * into v_bounds
  from public.dawaa_pay_cycle_bounds_v1(to_date(v_row.month_cycle||'-25','YYYY-MM-DD'));

  insert into public.incentive_audit_log(
    staff_id,rule_code,source_module,cycle_start,cycle_end,points_delta,money_delta,status,note,created_by
  ) values(
    v_row.staff_id,'attendance_deduction_v2_manual_review','attendance',
    v_bounds.cycle_start,v_bounds.cycle_end,
    case when v_new_status='approved' then v_row.points_delta else 0 end,
    case when v_new_status='approved' then -abs(v_row.amount) else 0 end,
    v_new_status,
    coalesce(nullif(trim(coalesce(p_note,'')),''),
      case when v_new_status='approved' then 'اعتماد إداري لخصم حضور' else 'رفض خصم حضور' end),
    coalesce(v_actor.name,v_actor.staff_name,v_actor.username,'unknown')
  );

  return jsonb_build_object('id',v_row.id,'new_status',v_new_status,'engine_version',2);
end;
$function$;

create or replace function public.attendance_deduction_adjust_v2(
  p_transaction_id uuid,
  p_new_points numeric default null,
  p_multiplier numeric default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_row public.employee_transactions%rowtype;
  v_actor public.staff_accounts%rowtype;
  v_old_points numeric;
  v_new_points numeric;
  v_point_rate numeric;
  v_new_amount numeric;
begin
  if not public.dawaa_can_manage_biometric_mapping_v1() then
    raise exception 'not_authorized_for_attendance_deduction_adjustment' using errcode='42501';
  end if;
  if length(trim(coalesce(p_reason,'')))<3 then
    raise exception 'attendance_deduction_adjustment_reason_required' using errcode='22023';
  end if;
  if p_new_points is null and p_multiplier is null then
    raise exception 'attendance_deduction_adjustment_value_required' using errcode='22023';
  end if;

  select * into v_row
  from public.employee_transactions
  where id=p_transaction_id and source='attendance_deduction_v2' and status='pending'
  for update;
  if not found then raise exception 'attendance_deduction_not_pending' using errcode='22023'; end if;

  select * into v_actor
  from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict();

  v_old_points:=abs(coalesce(v_row.points_delta,v_row.points,0));
  v_point_rate:=case when v_old_points<>0 then round(v_row.amount/v_old_points,4) else 1 end;
  v_new_points:=round(coalesce(p_new_points,v_old_points*coalesce(p_multiplier,1)),2);
  if v_new_points<0 then raise exception 'attendance_deduction_points_cannot_be_negative' using errcode='22023'; end if;
  v_new_amount:=round(v_new_points*v_point_rate,2);

  update public.employee_transactions
  set points=v_new_points,
      points_delta=-v_new_points,
      base_points=v_new_points,
      final_points=-v_new_points,
      amount=v_new_amount,
      description=coalesce(v_row.description,'')||format(' | تعديل إداري من %s إلى %s نقطة — %s',v_old_points,v_new_points,p_reason),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'manager_adjusted',true,
        'manager_adjustment_reason',trim(p_reason),
        'manager_adjusted_at',now(),
        'manager_adjusted_by',v_actor.id
      ),
      updated_at=now()
  where id=p_transaction_id;

  insert into public.attendance_manual_actions_audit(
    action_type,staff_id,target_id,old_value,new_value,reason,actor_account_id,actor_name,actor_role
  ) values(
    'deduction_adjustment_v2',v_row.staff_id,p_transaction_id,
    jsonb_build_object('points',v_old_points,'amount',v_row.amount),
    jsonb_build_object('points',v_new_points,'amount',v_new_amount,'multiplier',p_multiplier),
    trim(p_reason),v_actor.id,coalesce(v_actor.name,v_actor.staff_name,v_actor.username),v_actor.role
  );

  return jsonb_build_object('id',p_transaction_id,'old_points',v_old_points,'new_points',v_new_points,'new_amount',v_new_amount,'engine_version',2);
end;
$function$;

grant execute on function public.attendance_deduction_pending_review_v2() to authenticated,service_role;
grant execute on function public.attendance_deduction_review_decide_v2(uuid,text,text) to authenticated,service_role;
grant execute on function public.attendance_deduction_adjust_v2(uuid,numeric,numeric,text) to authenticated,service_role;

-- Compatibility names now delegate to the canonical V2 behavior.
create or replace function public.dawaa_sync_attendance_points_deduction_v1(p_month_cycle text default null)
returns jsonb
language sql
security definer
set search_path to 'public','pg_catalog'
as $function$
  select public.dawaa_sync_attendance_points_deduction_v2(p_month_cycle);
$function$;

create or replace function public.attendance_deduction_pending_review_v1()
returns table(
  id uuid,staff_id uuid,employee_name text,branch text,month_cycle text,
  points numeric,amount numeric,description text,transaction_date date
)
language sql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
  select * from public.attendance_deduction_pending_review_v2();
$function$;

create or replace function public.attendance_deduction_review_decide_v1(
  p_transaction_id uuid,p_decision text,p_note text default null
)
returns jsonb
language sql
security definer
set search_path to 'public','pg_catalog'
as $function$
  select public.attendance_deduction_review_decide_v2(p_transaction_id,p_decision,p_note);
$function$;

create or replace function public.attendance_deduction_adjust_v1(
  p_transaction_id uuid,p_new_points numeric default null,p_multiplier numeric default null,p_reason text default null
)
returns jsonb
language sql
security definer
set search_path to 'public','pg_catalog'
as $function$
  select public.attendance_deduction_adjust_v2(p_transaction_id,p_new_points,p_multiplier,p_reason);
$function$;

revoke execute on function public.dawaa_sync_attendance_points_deduction_v1(text) from public,anon,authenticated;
revoke execute on function public.dawaa_sync_attendance_points_deduction_v2(text) from public,anon,authenticated;

do $block$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid
  from cron.job
  where jobname='attendance-points-deduction-sync'
  limit 1;

  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;

  perform cron.schedule(
    'attendance-points-deduction-sync',
    '0 * * * *',
    'select public.dawaa_sync_attendance_points_deduction_v2();'
  );
end
$block$;

comment on function public.dawaa_sync_attendance_points_deduction_v1(text)
  is 'COMPATIBILITY WRAPPER: canonical attendance deduction sync is V2.';
