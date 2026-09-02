-- تصحيح خطأين حقيقيين اكتشفناهم بمراجعة دقيقة لمطابقة الأسماء:
-- 1. الدالة كانت بتتأكد إن الـ alias نفسه "active"، بس مش بتتأكد إن الموظف
--    اللي الـ alias بيشاور عليه لسه نشط هو كمان — نتيجته: 7 فواتير اتحطت
--    على سجل قديم غير نشط لـ"د/ علا" بدل سجلها الحالي النشط.
-- 2. لما أكتر من موظف نشط مختلف يكون عندهم alias نشط لنفس الاسم المطبّع
--    (زي "اسلام" اللي فعليًا بترجع لدكتور "اسلام فاروق" وموظف تاني منفصل
--    "اسلام السبع" في نفس الفرع)، الدالة كانت بتختار واحد منهم بشكل غير
--    محدد (LIMIT 1 من غير ORDER BY حاسم) بدل ما ترجّع "ambiguous" وتسيب
--    القرار لمراجعة بشرية — نتيجته: 25 فاتورة كانت هتتحط على شخص غلط
--    باحتمال 50%.
create or replace function public.match_base44_entered_by_v1(p_raw_name text)
returns table (staff_id uuid, match_status text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_normalized text;
  v_staff_id uuid;
  v_count integer;
begin
  if p_raw_name is null or trim(p_raw_name) = '' then
    return query select null::uuid, 'empty'::text;
    return;
  end if;

  v_normalized := public.dawaa_normalize_staff_name_v1(p_raw_name);
  if v_normalized = '' then
    return query select null::uuid, 'empty'::text;
    return;
  end if;

  select count(distinct a.staff_id) into v_count
  from public.staff_identity_aliases a
  join public.staff s on s.id = a.staff_id
  where a.normalized_alias = v_normalized and a.active = true and coalesce(s.active, true);

  if v_count = 1 then
    select distinct a.staff_id into v_staff_id
    from public.staff_identity_aliases a
    join public.staff s on s.id = a.staff_id
    where a.normalized_alias = v_normalized and a.active = true and coalesce(s.active, true);
    return query select v_staff_id, 'matched'::text;
    return;
  elsif v_count > 1 then
    return query select null::uuid, 'ambiguous'::text;
    return;
  end if;

  select count(*) into v_count
  from public.staff s
  where coalesce(s.active, true) and public.dawaa_normalize_staff_name_v1(s.name) = v_normalized;
  if v_count = 1 then
    select s.id into v_staff_id from public.staff s
    where coalesce(s.active, true) and public.dawaa_normalize_staff_name_v1(s.name) = v_normalized;
    return query select v_staff_id, 'matched'::text;
    return;
  elsif v_count > 1 then
    return query select null::uuid, 'ambiguous'::text;
    return;
  end if;

  if length(v_normalized) >= 3 then
    select count(*) into v_count
    from public.staff s
    where coalesce(s.active, true)
      and length(public.dawaa_normalize_staff_name_v1(s.name)) >= 3
      and (public.dawaa_normalize_staff_name_v1(s.name) like '%' || v_normalized || '%'
           or v_normalized like '%' || public.dawaa_normalize_staff_name_v1(s.name) || '%');
    if v_count = 1 then
      select s.id into v_staff_id from public.staff s
      where coalesce(s.active, true)
        and length(public.dawaa_normalize_staff_name_v1(s.name)) >= 3
        and (public.dawaa_normalize_staff_name_v1(s.name) like '%' || v_normalized || '%'
             or v_normalized like '%' || public.dawaa_normalize_staff_name_v1(s.name) || '%');
      return query select v_staff_id, 'matched'::text;
      return;
    elsif v_count > 1 then
      return query select null::uuid, 'ambiguous'::text;
      return;
    end if;
  end if;

  return query select null::uuid, 'unmatched'::text;
end;
$function$;

-- إعادة تطبيق المطابقة المصححة على كل الفواتير اللي لسه ما اتراجعتش، عشان
-- نصلّح أي إسناد غلط حصل بالخطأ القديم قبل التصحيح.
with fixed as (
  select b.id, m.staff_id, m.match_status
  from public.base44_purchase_invoice_sync b
  cross join lateral public.match_base44_entered_by_v1(b.entered_by_raw) as m
  where b.review_id is null
)
update public.base44_purchase_invoice_sync b
set entered_by_staff_id = f.staff_id, match_status = f.match_status
from fixed f
where b.id = f.id;

notify pgrst, 'reload schema';
