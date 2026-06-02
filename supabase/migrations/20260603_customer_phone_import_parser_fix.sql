create or replace function public.dawaa_normalize_egypt_mobile(
  p_phone text,
  p_customer_code text default null
)
returns text
language sql
immutable
as $$
  with translated as (
    select
      translate(
        coalesce(p_phone, ''),
        '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
        '01234567890123456789'
      ) as raw_phone,
      translate(
        coalesce(p_customer_code, ''),
        '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
        '01234567890123456789'
      ) as raw_code
  ), cleaned as (
    select
      regexp_replace(raw_phone, '\D', '', 'g') as digits,
      regexp_replace(raw_code, '\D', '', 'g') as code_digits,
      lower(trim(raw_phone)) as raw
    from translated
  ), normalized as (
    select case
      when raw = '' or raw like 'code:%' then null
      when digits like '0020%' then '0' || substring(digits from 5)
      when digits like '20%' and length(digits) = 12 then '0' || substring(digits from 3)
      when digits ~ '^1[0125][0-9]{8}$' and length(digits) = 10 then '0' || digits
      when digits like '0%' then digits
      else digits
    end as phone,
    code_digits
    from cleaned
  )
  select case
    when phone ~ '^01[0125][0-9]{8}$'
      and (code_digits = '' or regexp_replace(phone, '\D', '', 'g') <> code_digits)
    then phone
    else null
  end
  from normalized;
$$;
