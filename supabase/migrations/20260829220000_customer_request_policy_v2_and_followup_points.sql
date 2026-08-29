-- الجزء الأول: نظام نقاط طلبات العملاء كان موجودًا بالفعل (سياسة مرنة
-- effective-dated + جدول أحداث لمنع التكرار)، لكن معدلاته كانت متفاوتة
-- حسب الفئة. حدّثناه لمعدل موحّد للجميع (تسجيل=1، تحقيق=3 إضافية) حسب طلب
-- صاحب الصيدلية، وأضفنا الأسماء الجديدة/الناقصة لجدول staff_incentive_tiers
-- (ضحى، محمد أبو الحسن، هبة، هاجر، نور، عبد الحميد) بنفس معدلات نقاطهم
-- المعتمدة (1.00/0.70/0.50).
--
-- الجزء الثاني: نظام نقاط المتابعات لم يكن موجودًا فعليًا (الآليتان
-- الموجودتان مسبقًا إما ضيقتان جدًا أو لا تكتبان في سجل النقاط الحقيقي
-- إطلاقًا). نظام جديد: تسجيل طلب المتابعة = +1، إتمامها فعليًا من خدمة
-- العملاء = +2 إضافية، شراء العميل بعدها = +4 إضافية — كلها للدكتور صاحب
-- الطلب الأصلي (requested_by_staff_id) بتأكيد صريح من صاحب الصيدلية.
-- الحماية من التكرار عبر فحص مباشر على (source, source_id) في
-- employee_transactions. تم اختبار المنطق داخل معاملة مع rollback قبل
-- الاعتماد النهائي.

insert into public.staff_incentive_tiers (staff_id, tier_key, point_rate_egp, target_points, stretch_cap_egp)
select s.id, t.tier_key, t.rate, 1500, t.rate * 1500
from public.staff s
join (values
  ('د/ حسن', 'senior_doctor', 1.00), ('د اسلام فاروق', 'senior_doctor', 1.00), ('د/ ندي', 'senior_doctor', 1.00), ('د/ بسنت', 'senior_doctor', 1.00), ('د/ ضحى', 'senior_doctor', 1.00),
  ('د/ مي', 'mid_doctor', 0.70), ('د/ عمر', 'mid_doctor', 0.70), ('د رضا', 'mid_doctor', 0.70), ('د احمد وليد', 'mid_doctor', 0.70), ('د احمد حافظ', 'mid_doctor', 0.70), ('د محمد شبل', 'mid_doctor', 0.70), ('د دنيا', 'mid_doctor', 0.70), ('د/ محمد أبو الحسن', 'mid_doctor', 0.70),
  ('د هدي ', 'assistant', 0.50), ('د/ شيماء', 'assistant', 0.50), ('د/ محمد علي', 'assistant', 0.50), ('د/ محمد خالد', 'assistant', 0.50), ('ا عبد الحميد', 'assistant', 0.50),
  ('هبه حماده', 'assistant', 0.50), ('هاجر', 'assistant', 0.50), ('نور', 'assistant', 0.50)
) as t(name, tier_key, rate) on t.name = s.name
on conflict (staff_id) do update set tier_key = excluded.tier_key, point_rate_egp = excluded.point_rate_egp, target_points = excluded.target_points, stretch_cap_egp = excluded.stretch_cap_egp, updated_at = now();

insert into public.customer_request_incentive_policy (policy_version, tier_key, registration_points, achievement_points, effective_from, active)
values
  ('2026-08-29-v2', 'senior_doctor', 1.00, 3.00, now(), true),
  ('2026-08-29-v2', 'mid_doctor', 1.00, 3.00, now(), true),
  ('2026-08-29-v2', 'assistant', 1.00, 3.00, now(), true);

create or replace function public.settle_followup_doctor_points(p_followup_id text, p_event_key text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_row public.daily_followups%rowtype;
  v_doctor_id uuid;
  v_doctor record;
  v_points numeric;
  v_source text;
  v_source_id uuid;
  v_reason text;
  v_month_cycle text;
begin
  if p_event_key not in ('logged','completed','purchase') then
    return;
  end if;

  select * into v_row from public.daily_followups where id = p_followup_id;
  if not found or v_row.requested_by_staff_id is null then
    return;
  end if;

  begin
    v_doctor_id := v_row.requested_by_staff_id::uuid;
  exception when others then
    return;
  end;

  select id, name, branch into v_doctor
  from public.staff
  where id = v_doctor_id and coalesce(active, true);
  if not found then
    return;
  end if;

  begin
    v_source_id := p_followup_id::uuid;
  exception when others then
    return;
  end;

  v_source := 'followup_' || p_event_key;

  if exists (
    select 1 from public.employee_transactions
    where source = v_source and source_id = v_source_id
  ) then
    return;
  end if;

  v_points := case p_event_key
    when 'logged' then 1
    when 'completed' then 2
    when 'purchase' then 4
  end;

  v_reason := case p_event_key
    when 'logged' then 'تسجيل طلب متابعة عميل'
    when 'completed' then 'إتمام متابعة العميل من خدمة العملاء'
    when 'purchase' then 'شراء العميل بعد المتابعة'
  end;

  v_month_cycle := public.dawaa_current_points_cycle_label_v1();

  insert into public.employee_transactions (
    staff_id, employee_id, employee_name, type, title, reason, amount, points, points_delta,
    source, source_id, transaction_date, created_at, description, month_cycle, branch,
    status, category, employee_visible, created_by
  ) values (
    v_doctor.id, v_doctor.id, v_doctor.name, 'reward', v_reason, v_reason, 0, v_points, v_points,
    v_source, v_source_id, current_date, now(), v_reason || ' — ' || coalesce(v_row.customer_name, 'عميل'),
    v_month_cycle, coalesce(v_row.branch, v_doctor.branch), 'active', 'متابعات العملاء', true, 'system_automation'
  );
end;
$function$;

create or replace function public.trg_followup_doctor_points()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_was_completed boolean;
  v_is_completed boolean;
  v_noise_statuses text[] := array['merged_duplicate','archived_system_noise','duplicate_archived','ملغي'];
begin
  if tg_op = 'INSERT' then
    perform public.settle_followup_doctor_points(new.id, 'logged');
  end if;

  v_is_completed := new.completed_at is not null and not (coalesce(new.status,'') = any(v_noise_statuses));
  v_was_completed := tg_op = 'UPDATE' and old.completed_at is not null and not (coalesce(old.status,'') = any(v_noise_statuses));

  if v_is_completed and not v_was_completed then
    perform public.settle_followup_doctor_points(new.id, 'completed');
  end if;

  if coalesce(new.purchase_after_followup, false) and not (tg_op = 'UPDATE' and coalesce(old.purchase_after_followup, false)) then
    perform public.settle_followup_doctor_points(new.id, 'purchase');
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_daily_followups_doctor_points on public.daily_followups;
create trigger trg_daily_followups_doctor_points
  after insert or update of completed_at, status, purchase_after_followup
  on public.daily_followups
  for each row
  when (current_setting('dawaa.historical_import', true) is distinct from 'on')
  execute function public.trg_followup_doctor_points();
