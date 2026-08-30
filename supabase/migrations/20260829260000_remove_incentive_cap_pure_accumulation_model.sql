-- تغيير جذري بتأكيد صريح من صاحب الصيدلية (2026-08-29): الحافز مالوش سقف
-- أعلى خالص. الفورمولا القديمة كانت بتدّي كل موظف "رصيد ابتدائي" = التارجت
-- الكامل، وتحسب الحافز كنسبة من الرصيد النهائي للتارجت (بحد أقصى 100%
-- منه) — يعني في بداية أي دورة بدون نشاط حقيقي، كان الحافز يظهر كامل
-- (100%) تلقائيًا، وهو رقم افتراضي مش تقدير حقيقي.
--
-- الفورمولا الجديدة: الحافز = صافي النقاط الحقيقية المكتسبة هذه الدورة
-- (من المحادثات، طلبات العملاء، المتابعات، الرواكد...) × سعر النقطة، من
-- غير أي سقف أعلى. لو صافي النقاط سالب، الحافز يبقى صفر (مش سالب)، لكن
-- مفيش حد أقصى فوق — لو الأداء الحقيقي يستاهل أكتر من السقف القديم،
-- الحافز يزيد فعليًا.
--
-- target_points/max_incentive_egp لسه بيترجعوا كمرجع تقريبي بس (من نفس
-- قيم ملف التعويض)، مش كسقف فعلي بيوقف الحافز عنده. تم التحقق من عدم
-- وجود أي تعارض مع المستهلكين الحاليين للدالة (DoctorIncentiveSummaryCard،
-- staffDetailLoader، monthlyPerformance360Service) — كلهم بيتعاملوا مع
-- النسب المئوية بأمان (بيقصّوها بأنفسهم لعرضهم الخاص لو احتاجوا).

create or replace function public.dawaa_staff_points_truth_v2(p_staff_id uuid, p_month_cycle text DEFAULT NULL::text)
 RETURNS TABLE(staff_id uuid, staff_name text, staff_role text, branch text, tier_key text, month_cycle text, starting_points numeric, reward_points numeric, deduction_points numeric, net_points_delta numeric, final_points numeric, distinction_points numeric, target_points integer, point_rate_egp numeric, max_incentive_egp numeric, points_incentive_egp numeric, competition_bonus_egp numeric, final_incentive_egp numeric, progress_pct numeric, pending_reward_points numeric, pending_deduction_points numeric, profile_configured boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_staff public.staff%rowtype;
  v_cycle text;
  v_as_of date;
  v_profile record;
  v_history record;
  v_tier text;
  v_reference_target numeric := 500;
  v_point_rate numeric := 3;
  v_max_incentive numeric := 1500;
  v_rewards numeric := 0;
  v_deductions numeric := 0;
  v_pending_rewards numeric := 0;
  v_pending_deductions numeric := 0;
  v_competition numeric := 0;
  v_final numeric := 0;
  v_profile_configured boolean := false;
  v_eval_multiplier numeric := 100;
  v_base_incentive numeric;
  v_final_incentive numeric;
begin
  select * into v_staff from public.staff s where s.id = p_staff_id;
  if not found then
    return;
  end if;

  if not public.dawaa_can_read_employee_transaction(p_staff_id, v_staff.branch) then
    raise exception 'not_authorized';
  end if;

  v_cycle := coalesce(nullif(btrim(p_month_cycle), ''), public.dawaa_current_points_cycle_label_v1());

  begin
    v_as_of := to_date(v_cycle || '-25', 'YYYY-MM-DD');
  exception when others then
    v_as_of := current_date;
  end;

  select
    ecp.monthly_incentive_base,
    ecp.point_value,
    ecp.effective_from
  into v_profile
  from public.employee_compensation_profiles ecp
  where ecp.staff_id = p_staff_id::text
    and coalesce(ecp.active, true)
    and coalesce(ecp.effective_from, v_as_of) <= v_as_of
  order by ecp.effective_from desc nulls last, ecp.updated_at desc nulls last
  limit 1;

  if found and coalesce(v_profile.monthly_incentive_base, 0) > 0 then
    v_profile_configured := true;
    v_max_incentive := v_profile.monthly_incentive_base;
    if coalesce(v_profile.point_value, 0) > 0 then
      v_point_rate := v_profile.point_value;
      v_reference_target := greatest(1, round(v_max_incentive / v_point_rate));
    end if;
  end if;

  select ech.point_value, ech.monthly_incentive_base
  into v_history
  from public.employee_compensation_rate_history ech
  where ech.staff_id = p_staff_id
    and v_as_of < ech.effective_until
  order by ech.effective_until asc
  limit 1;

  if found and coalesce(v_history.monthly_incentive_base, 0) > 0 then
    v_profile_configured := true;
    v_max_incentive := v_history.monthly_incentive_base;
    if coalesce(v_history.point_value, 0) > 0 then
      v_point_rate := v_history.point_value;
      v_reference_target := greatest(1, round(v_max_incentive / v_point_rate));
    end if;
  end if;

  select sit.tier_key into v_tier
  from public.staff_incentive_tiers sit
  where sit.staff_id = p_staff_id
  order by sit.updated_at desc nulls last, sit.created_at desc nulls last
  limit 1;

  select
    coalesce(sum(l.signed_points) filter (where l.signed_points > 0), 0),
    abs(coalesce(sum(l.signed_points) filter (where l.signed_points < 0), 0))
  into v_rewards, v_deductions
  from public.dawaa_employee_points_ledger_v2 l
  where l.staff_id = p_staff_id
    and l.month_cycle = v_cycle;

  select
    coalesce(sum(
      case
        when coalesce(et.points_delta, 0) > 0 then et.points_delta
        when coalesce(et.points_delta, 0) = 0 and lower(coalesce(et.type, '')) in ('reward', 'bonus') then abs(coalesce(et.points, 0))
        else 0
      end
    ), 0),
    coalesce(sum(
      case
        when coalesce(et.points_delta, 0) < 0 then abs(et.points_delta)
        when coalesce(et.points_delta, 0) = 0 and lower(coalesce(et.type, '')) in ('penalty', 'deduction') then abs(coalesce(et.points, 0))
        else 0
      end
    ), 0)
  into v_pending_rewards, v_pending_deductions
  from public.employee_transactions et
  where et.staff_id = p_staff_id
    and et.month_cycle = v_cycle
    and et.status = 'pending';

  select coalesce(sum(pcb.prize_egp), 0)
  into v_competition
  from public.pillar_competition_bonuses pcb
  where pcb.winner_staff_id = p_staff_id
    and pcb.month_cycle = v_cycle;

  select seim.multiplier_pct into v_eval_multiplier
  from public.staff_evaluation_incentive_multipliers seim
  where seim.staff_id = p_staff_id and seim.month_cycle = v_cycle;
  v_eval_multiplier := coalesce(v_eval_multiplier, 100);

  v_final := v_rewards - v_deductions;
  v_base_incentive := round(greatest(0, v_final) * v_point_rate, 2);
  v_final_incentive := round(v_base_incentive * v_eval_multiplier / 100, 2);

  return query
  select
    p_staff_id,
    v_staff.name,
    v_staff.role,
    v_staff.branch,
    v_tier,
    v_cycle,
    0::numeric,
    v_rewards,
    v_deductions,
    v_rewards - v_deductions,
    v_final,
    greatest(0, v_final - v_reference_target),
    v_reference_target::integer,
    v_point_rate,
    v_max_incentive,
    v_base_incentive,
    v_competition,
    v_final_incentive + v_competition,
    round(greatest(0, v_final) / nullif(v_reference_target, 0) * 100, 1),
    v_pending_rewards,
    v_pending_deductions,
    v_profile_configured;
end;
$function$;
