-- تسوية رسمية لدورة 26 يوليو - 25 أغسطس 2026، باستخدام السقف والمعدل
-- التاريخي الفعلي وقت الدورة دي (قبل تعديل المعدلات الموحدة الجديد
-- في 2026-08-29):
-- دكاترة فئة أولى: تارجت 500 نقطة، 3 جنيه/نقطة، سقف 1500
--   (حسن، اسلام فاروق، بسنت، ندي، سارة، وليد، يوسف)
-- دكاترة فئة تانية: تارجت 500 نقطة، 1.5 جنيه/نقطة، سقف 750
--   (احمد حافظ، احمد وليد، رضا، محمد شبل، عمر، مي)
-- مساعدين فئة أولى: تارجت 100 نقطة، 10 جنيه/نقطة، سقف 1000
--   (محمد علي، شيماء، دنيا، هدي)
-- مساعدين فئة تانية: تارجت 100 نقطة، 7 جنيه/نقطة، سقف 700
--   (هبه حماده، هاجر، محمد خالد)
-- الحافز = min(النقاط الفعلية المسجلة في employee_transactions لنفس
-- الدورة (month_cycle = '2026-08'), التارجت) × السعر.
--
-- طُبّق هذا التسجيل مباشرة على قاعدة الإنتاج بتاريخ 2026-08-29. آمن
-- لإعادة التشغيل بفضل قيد UNIQUE(staff_id, cycle_start, cycle_end)
-- والـ ON CONFLICT DO NOTHING.

insert into public.employee_monthly_statements
  (staff_id, staff_name, branch, cycle_start, cycle_end, incentive_amount, net_salary, points_opening, points_rewards, points_deductions, points_closing, status, generated_at, generated_by)
select
  s.id::text,
  s.name,
  s.branch,
  '2026-07-26'::date,
  '2026-08-25'::date,
  least(coalesce(t.net_points,0), tier.target_points) * tier.rate,
  least(coalesce(t.net_points,0), tier.target_points) * tier.rate,
  0,
  greatest(coalesce(t.net_points,0),0),
  greatest(-coalesce(t.net_points,0),0),
  coalesce(t.net_points,0),
  'معتمد',
  now(),
  'general_manager'
from staff s
join (values
  ('د/ حسن', 500, 3.00),
  ('د اسلام فاروق', 500, 3.00),
  ('د/ بسنت', 500, 3.00),
  ('د/ ندي', 500, 3.00),
  ('د/ سارة', 500, 3.00),
  ('د/ وليد', 500, 3.00),
  ('د/ يوسف', 500, 3.00),
  ('د احمد حافظ', 500, 1.50),
  ('د احمد وليد', 500, 1.50),
  ('د رضا', 500, 1.50),
  ('د محمد شبل', 500, 1.50),
  ('د/ عمر', 500, 1.50),
  ('د/ مي', 500, 1.50),
  ('د/ محمد علي', 100, 10.00),
  ('د/ شيماء', 100, 10.00),
  ('د دنيا', 100, 10.00),
  ('د هدي ', 100, 10.00),
  ('هبه حماده', 100, 7.00),
  ('هاجر', 100, 7.00),
  ('د/ محمد خالد', 100, 7.00)
) as tier(staff_name, target_points, rate) on tier.staff_name = s.name
left join (
  select staff_id, sum(points_delta) as net_points
  from employee_transactions
  where month_cycle = '2026-08' and status = 'active'
  group by staff_id
) t on t.staff_id = s.id
where (s.name != 'د/ محمد خالد' or s.id::text = '3ef95119-6c28-442b-9a3d-c18a48cc4cbf')
on conflict (staff_id, cycle_start, cycle_end) do nothing;
