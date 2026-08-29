-- الجزء الأول: نقاط بيع الرواكد — كل علبة (quantity) تتباع من صنف راكد
-- = +3 نقاط للدكتور، بالإضافة للحافز المالي المنفصل الموجود أصلاً
-- (incentive_per_unit/total_incentive في stagnant_medicine_dispenses)
-- وغير متأثر بهذا التعديل. الحماية من التكرار عبر (source, source_id).
-- تم اختبار المنطق داخل معاملة مع rollback قبل الاعتماد النهائي.

create or replace function public.settle_stagnant_dispense_doctor_points()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_doctor record;
  v_points numeric;
  v_month_cycle text;
begin
  if new.doctor_id is null or coalesce(new.quantity, 0) <= 0 then
    return new;
  end if;

  if exists (
    select 1 from public.employee_transactions
    where source = 'stagnant_medicine_dispense' and source_id = new.id
  ) then
    return new;
  end if;

  select id, name, branch into v_doctor
  from public.staff
  where id = new.doctor_id and coalesce(active, true);
  if not found then
    return new;
  end if;

  v_points := 3 * new.quantity;
  v_month_cycle := to_char(coalesce(new.dispensed_at, new.created_at, now()), 'YYYY-MM');

  insert into public.employee_transactions (
    staff_id, employee_id, employee_name, type, title, reason, amount, points, points_delta,
    source, source_id, transaction_date, created_at, description, month_cycle, branch,
    status, category, employee_visible, created_by
  ) values (
    v_doctor.id, v_doctor.id, v_doctor.name, 'reward', 'بيع صنف راكد', 'بيع صنف راكد',
    0, v_points, v_points, 'stagnant_medicine_dispense', new.id,
    coalesce(new.dispensed_at::date, current_date), now(),
    'بيع ' || new.quantity || ' علبة راكدة: ' || coalesce(new.product_name, 'صنف') || ' (نقاط منفصلة عن الحافز المالي)',
    v_month_cycle, coalesce(new.branch_name, v_doctor.branch), 'active', 'رواكد', true, 'system_automation'
  );

  return new;
end;
$function$;

drop trigger if exists trg_stagnant_medicine_dispense_points on public.stagnant_medicine_dispenses;
create trigger trg_stagnant_medicine_dispense_points
  after insert on public.stagnant_medicine_dispenses
  for each row
  execute function public.settle_stagnant_dispense_doctor_points();

-- الجزء الثاني: تجهيز أعمدة مراجعة فواتير الشراء (المدخّلة من تطبيق خارجي
-- منفصل من الدكتور) مقدمًا، قبل ما المزامنة تشتغل فعليًا. الصفحة نفسها
-- (لهبة/هاجر/نور) هتُبنى لاحقًا لما تكون البيانات الحقيقية متاحة للتأكد من
-- شكلها الفعلي على مستوى الأصناف. الأعمدة دي مش بتأثر على أي حاجة حاليًا
-- طالما الجدول فاضي.

alter table public.purchase_invoices_v13
  add column if not exists entered_by_staff_id uuid references public.staff(id),
  add column if not exists review_status text default 'pending' check (review_status in ('pending','correct','error')),
  add column if not exists reviewed_by_staff_id uuid references public.staff(id),
  add column if not exists reviewed_by_name text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text;
