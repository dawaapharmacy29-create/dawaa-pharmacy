-- المشكلة: employee_compensation_profiles مفتاحها الأساسي staff_id بس (صف
-- واحد لكل موظف)، فمش بتسمح بتخزين أكتر من معدل لنفس الموظف عبر الزمن.
-- دالة dawaa_staff_points_truth_v2 كانت بتاخد المعدل الحالي دايمًا (أو
-- current_date كمرجع) حتى لو الدورة المطلوبة قديمة وكان معدلها مختلف
-- فعليًا وقتها. هذا أدى لعرض أرقام حافز غلط تمامًا لأي دورة قديمة بعد أي
-- تعديل لاحق على معدل موظف (مثال واقعي تم اكتشافه واصلاحه في نفس الجلسة:
-- توحيد معدلات النقاط في 2026-08-29 خلّى أي عرض لدورة 26 يوليو-25 أغسطس
-- يستخدم غلط معدل اليوم بدل معدل وقتها).
--
-- الحل: جدول تاريخي منفصل (employee_compensation_rate_history) يسجل
-- المعدلات القديمة قبل ما تتغيّر، والدالة اتعدّلت عشان:
-- 1) تحسب v_as_of من تاريخ نهاية الدورة المطلوبة (يوم 25 من شهر تسمية
--    الدورة) بدل current_date دايمًا.
-- 2) لو معدل الملف الحالي (employee_compensation_profiles) لسه ماكانش
--    ساري وقت الدورة المطلوبة (effective_from بعد v_as_of)، ترجع لجدول
--    التاريخ وتجيب المعدل اللي كان ساري فعليًا وقتها.
--
-- طُبّق هذا الإصلاح مباشرة على قاعدة الإنتاج بتاريخ 2026-08-29، مع تصحيح
-- effective_from على الصفوف الحالية (كانت لسه بتحمل تاريخ الإنشاء الأصلي
-- 2026-08-07 بدل تاريخ التطبيق الفعلي)، وإضافة صفوف تاريخية بالمعدلات
-- القديمة المؤكدة من صاحب الصيدلية لدورة 26 يوليو-25 أغسطس 2026.

create table if not exists public.employee_compensation_rate_history (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id),
  point_value numeric not null,
  monthly_incentive_base numeric not null,
  effective_until date not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_comp_rate_history_staff on public.employee_compensation_rate_history(staff_id, effective_until);

update public.employee_compensation_profiles
set effective_from = '2026-08-29'
where staff_id in (
  '414272ca-cb99-4c0a-98b0-d29701d80734','3b2f682d-be41-4374-a0b8-25411ee6e8d3','3ee4c17e-8965-48c9-8267-2e68db449a31','ccfbb4af-f1f0-4f30-b240-f0300ab4dd6e',
  '86f04320-b9bb-42da-b39a-8fe72aa84598',
  '8601fb7f-c14c-43b8-b735-8761d8c12ace','51e1abe6-6aa7-4987-ab11-ac1141012cb5','12a8da5b-74cd-4a86-aaf9-1cfb636f0df8','30ed35e5-7481-4dc5-8d0b-6f209721df3c','0848f99f-5778-46b2-8053-40b73dc16488','db6394bc-30c2-4989-bf75-35e58deca8b0',
  '0afe27ce-bc26-4b14-9e1b-c37d9040631e',
  'dea91886-1ae8-4766-a166-9952866a5024','8088db32-c552-4f5b-9737-984d0d594b0c','e3640642-5c60-4815-8001-1bb93193668f','ba6c1157-e2f7-44e7-9ebd-6484582aa087','3ef95119-6c28-442b-9a3d-c18a48cc4cbf','8a926517-39ba-4162-8832-a877dfd44456',
  'd40cb3d7-9548-46eb-b001-2754ab692e97'
);

insert into public.employee_compensation_rate_history (staff_id, point_value, monthly_incentive_base, effective_until, note)
values
  ('414272ca-cb99-4c0a-98b0-d29701d80734', 3.00, 1500, '2026-08-29', 'معدل سنيور القديم قبل التوحيد'),
  ('3b2f682d-be41-4374-a0b8-25411ee6e8d3', 3.00, 1500, '2026-08-29', 'معدل سنيور القديم قبل التوحيد'),
  ('3ee4c17e-8965-48c9-8267-2e68db449a31', 3.00, 1500, '2026-08-29', 'معدل سنيور القديم قبل التوحيد'),
  ('ccfbb4af-f1f0-4f30-b240-f0300ab4dd6e', 3.00, 1500, '2026-08-29', 'معدل سنيور القديم قبل التوحيد'),
  ('86f04320-b9bb-42da-b39a-8fe72aa84598', 3.00, 1500, '2026-08-29', 'تقريب آمن بمعدل فئة السنيور — لم تكن ضحى صيدلانية وقتها'),
  ('8601fb7f-c14c-43b8-b735-8761d8c12ace', 1.50, 750, '2026-08-29', 'معدل متوسط القديم قبل التوحيد'),
  ('51e1abe6-6aa7-4987-ab11-ac1141012cb5', 1.50, 750, '2026-08-29', 'معدل متوسط القديم قبل التوحيد'),
  ('12a8da5b-74cd-4a86-aaf9-1cfb636f0df8', 1.50, 750, '2026-08-29', 'معدل متوسط القديم قبل التوحيد'),
  ('30ed35e5-7481-4dc5-8d0b-6f209721df3c', 1.50, 750, '2026-08-29', 'معدل متوسط القديم قبل التوحيد'),
  ('0848f99f-5778-46b2-8053-40b73dc16488', 1.50, 750, '2026-08-29', 'معدل متوسط القديم قبل التوحيد'),
  ('db6394bc-30c2-4989-bf75-35e58deca8b0', 1.50, 750, '2026-08-29', 'معدل متوسط القديم قبل التوحيد'),
  ('0afe27ce-bc26-4b14-9e1b-c37d9040631e', 1.50, 750, '2026-08-29', 'تقريب آمن بمعدل فئة المتوسط — لم تكن دنيا صيدلانية وقتها'),
  ('ba6c1157-e2f7-44e7-9ebd-6484582aa087', 10.00, 1000, '2026-08-29', 'معدل مساعدين فئة أولى القديم'),
  ('8088db32-c552-4f5b-9737-984d0d594b0c', 10.00, 1000, '2026-08-29', 'معدل مساعدين فئة أولى القديم'),
  ('d40cb3d7-9548-46eb-b001-2754ab692e97', 10.00, 1000, '2026-08-29', 'معدل مساعدين فئة أولى القديم'),
  ('dea91886-1ae8-4766-a166-9952866a5024', 7.00, 700, '2026-08-29', 'معدل مساعدين فئة تانية القديم'),
  ('e3640642-5c60-4815-8001-1bb93193668f', 7.00, 700, '2026-08-29', 'معدل مساعدين فئة تانية القديم'),
  ('3ef95119-6c28-442b-9a3d-c18a48cc4cbf', 7.00, 700, '2026-08-29', 'معدل مساعدين فئة تانية القديم'),
  ('8a926517-39ba-4162-8832-a877dfd44456', 10.00, 1000, '2026-08-29', 'افتراض آمن بقيمته الأصلية المسجلة قبل أي تعديل — غير مذكور صراحة في الفئتين');

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

  v_final := greatest(0, v_starting + v_rewards - v_deductions);

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
    round(least(v_final, v_starting) / nullif(v_starting, 0) * v_max_incentive, 2),
    v_competition,
    round(least(v_final, v_starting) / nullif(v_starting, 0) * v_max_incentive, 2) + v_competition,
    round(least(100, v_final / nullif(v_starting, 0) * 100), 1),
    v_pending_rewards,
    v_pending_deductions,
    v_profile_configured;
end;
$function$;
