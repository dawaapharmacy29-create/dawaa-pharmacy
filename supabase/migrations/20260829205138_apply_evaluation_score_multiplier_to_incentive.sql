-- الحافز النهائي دلوقتي = حافز النقاط المحسوب × نسبة التقييم الشهري
-- (لو موجودة لنفس الموظف ونفس الدورة، وإلا 100% افتراضيًا). هذا يستبدل
-- نظام "نقاط صغيرة لكل محور" (±15/-30 لكل نجمة) اللي كان مضاف على رصيد
-- النقاط نفسه — بناءً على طلب صريح من صاحب الصيدلية بعد ملاحظة إن دكتور
-- بنتيجة تقييم 81% كان لسه بياخد الحافز الكامل 750 جنيه لأن نقاطه
-- التشغيلية وصلت للسقف بمفردها، رغم إن نتيجة التقييم الإداري أقل من 100%.
--
-- الجدول الجديد staff_evaluation_incentive_multipliers يُحدَّث فقط لحظة
-- اعتماد/إرسال التقييم الشهري الفعلي (مش أي حفظ مسودة)، ومرة واحدة بس لكل
-- تقييم (تعديل تقييم مُرسَل بالفعل لا يُحدّث النسبة تلقائيًا).
-- dawaa_staff_points_truth_v2 اتعدّلت عشان تستخدم هذه النسبة تلقائيًا في
-- كل مكان يعرض الحافز المركزي (لوحة الموظف، صفحات التقييم، أي تقرير)،
-- مش بس في هذه الصفحة، حفاظًا على مصدر حقيقة واحد.

create table if not exists public.staff_evaluation_incentive_multipliers (
  staff_id uuid not null references public.staff(id),
  month_cycle text not null,
  multiplier_pct numeric not null check (multiplier_pct >= 0 and multiplier_pct <= 100),
  source_evaluation_id uuid,
  updated_at timestamptz not null default now(),
  primary key (staff_id, month_cycle)
);

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
  v_starting numeric := 500;
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
      v_starting := greatest(1, round(v_max_incentive / v_point_rate));
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
      v_starting := greatest(1, round(v_max_incentive / v_point_rate));
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

  v_final := greatest(0, v_starting + v_rewards - v_deductions);
  v_base_incentive := round(least(v_final, v_starting) / nullif(v_starting, 0) * v_max_incentive, 2);
  v_final_incentive := round(coalesce(v_base_incentive, 0) * v_eval_multiplier / 100, 2);

  return query
  select
    p_staff_id,
    v_staff.name,
    v_staff.role,
    v_staff.branch,
    v_tier,
    v_cycle,
    v_starting,
    v_rewards,
    v_deductions,
    v_rewards - v_deductions,
    v_final,
    greatest(0, v_final - v_starting),
    v_starting::integer,
    v_point_rate,
    v_max_incentive,
    v_base_incentive,
    v_competition,
    v_final_incentive + v_competition,
    round(least(100, v_final / nullif(v_starting, 0) * 100), 1),
    v_pending_rewards,
    v_pending_deductions,
    v_profile_configured;
end;
$function$;
