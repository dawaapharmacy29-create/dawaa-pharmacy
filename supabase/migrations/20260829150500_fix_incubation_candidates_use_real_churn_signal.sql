-- إصلاح: القائمة الأساسية للعملاء المرشحين للاسترجاع (dawaa_incubation_candidates_v1)
-- كانت بتحط recommended_for_incubation = true لأي عميل صرف 1500 جنيه فأكتر
-- في تاريخه، وترتيبها (branch_rank) كان بإجمالي المشتريات التاريخي بس — من
-- غير أي فحص هل العميل فعلاً توقف عن الشراء أو لأ. إشارة ذكية حقيقية لاكتشاف
-- التوقف/الانخفاض كانت موجودة أصلاً في dawaa_customer_purchase_frequency_v2
-- (حالات زي 'توقف عن الشراء'، 'انخفض الشراء المتوقع') لكن مستخدمة بس في
-- البحث اليدوي، مش في القائمة الأساسية اللي فريق الاسترجاع بيشتغل عليها يوميًا.
--
-- طُبّق هذا الإصلاح مباشرة على قاعدة الإنتاج بتاريخ 2026-08-29 (تحقق لاحق:
-- 424 عميل بقوا مؤهلين بسبب واضح وقابل للتنفيذ — 97 توقفوا فعليًا عن الشراء،
-- 81 يحتاجون متابعة، 115 انخفاض متوقع، 131 أقل من نفس الفترة السابقة — بدل
-- "كل عميل مؤهل" قبل الإصلاح). هذا الملف يوثّق نفس التغيير في المستودع حسب
-- docs/ARCHITECTURE_TARGET.md البند 11.

create or replace view public.dawaa_incubation_candidates_v1 as
select
  coalesce(c.customer_code, c.code, c.id::text) as customer_key,
  coalesce(c.customer_code, c.code) as customer_code,
  coalesce(c.customer_name, c.name, 'عميل بدون اسم') as customer_name,
  coalesce(c.customer_phone, c.phone) as customer_phone,
  c.branch,
  coalesce(c.total_spent, c.total_purchases, 0::numeric) as total_spent,
  coalesce(c.invoices_count, c.total_invoices, 0)::numeric as total_invoice_count,
  coalesce(c.avg_invoice, 0::numeric) as avg_invoice,
  coalesce(c.avg_monthly, 0::numeric) as avg_monthly,
  coalesce(c.first_purchase, null::date) as first_purchase,
  coalesce(freq.last_purchase, c.last_purchase, c.last_invoice_date, null::date) as last_purchase,
  coalesce(c.segment, c.type, c.retention_status, 'غير محدد') as segment,
  coalesce(c.status, c.customer_status, 'active') as customer_status,
  (
    coalesce(c.total_spent, c.total_purchases, 0::numeric) >= 1500::numeric
    and coalesce(freq.purchase_frequency_status, '') in ('توقف عن الشراء', 'يحتاج متابعة', 'انخفض الشراء المتوقع', 'أقل من نفس الفترة السابقة')
  ) as recommended_for_incubation,
  case coalesce(freq.purchase_frequency_status, '')
    when 'توقف عن الشراء' then 'توقف فعليًا عن الشراء رغم قيمته السابقة — أولوية عاجلة'
    when 'انخفض الشراء المتوقع' then 'معدل شرائه بينخفض بشكل ملحوظ عن المتوقع هذا الشهر'
    when 'يحتاج متابعة' then 'توقف مؤقتًا هذا الشهر، يستاهل تواصل استباقي'
    when 'أقل من نفس الفترة السابقة' then 'شراؤه أقل من نفس الفترة في الدورة السابقة'
    else 'ترشيح من قيمة العميل التاريخية بدون إشارة توقف واضحة حاليًا'
  end as incubation_recommendation,
  case when coalesce(c.total_spent, c.total_purchases, 0::numeric) >= 8000::numeric then 'vip' else 'normal' end as incubation_priority,
  row_number() over (
    partition by c.branch
    order by
      case coalesce(freq.purchase_frequency_status, '')
        when 'توقف عن الشراء' then 0
        when 'انخفض الشراء المتوقع' then 1
        when 'يحتاج متابعة' then 2
        when 'أقل من نفس الفترة السابقة' then 3
        else 4
      end,
      coalesce(c.total_spent, c.total_purchases, 0::numeric) desc
  ) as branch_rank,
  ic.id as case_id,
  ic.status as incubation_status,
  ic.assigned_doctor,
  ic.assigned_customer_service,
  ic.after_total_spent,
  ic.after_invoice_count,
  ic.after_purchase_count,
  coalesce(freq.purchase_frequency_status, 'غير معروف') as purchase_frequency_status
from customers c
left join customer_incubation_cases ic on ic.customer_code = coalesce(c.customer_code, c.code)
left join dawaa_customer_purchase_frequency_v2 freq on freq.customer_code = coalesce(c.customer_code, c.code)
where coalesce(c.total_spent, c.total_purchases, 0::numeric) >= 1500::numeric;
