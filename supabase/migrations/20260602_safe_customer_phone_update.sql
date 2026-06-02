create or replace function public.dawaa_normalize_egypt_mobile(
  p_phone text,
  p_customer_code text default null
)
returns text
language sql
immutable
as $$
  with cleaned as (
    select
      regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as digits,
      regexp_replace(coalesce(p_customer_code, ''), '\D', '', 'g') as code_digits,
      lower(trim(coalesce(p_phone, ''))) as raw
  ), normalized as (
    select case
      when raw = '' or raw like 'code:%' then null
      when digits like '0020%' then '0' || substring(digits from 5)
      when digits like '20%' and length(digits) = 12 then '0' || substring(digits from 3)
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

drop function if exists public.safe_customer_phone_update_from_json(jsonb, boolean);

create or replace function public.safe_customer_phone_update_from_json(
  p_rows jsonb,
  p_apply boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_updated_customers integer := 0;
begin
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  create temporary table tmp_customer_phone_update on commit drop as
  with input_rows as (
    select
      row_number() over ()::integer as row_no,
      nullif(trim(value ->> 'final_customer_key'), '') as final_customer_key,
      nullif(trim(value ->> 'customer_id'), '') as customer_id_text,
      nullif(trim(value ->> 'customer_code'), '') as customer_code,
      nullif(trim(value ->> 'customer_name'), '') as customer_name,
      nullif(trim(value ->> 'branch'), '') as branch,
      nullif(trim(value ->> 'current_phone'), '') as current_phone,
      nullif(trim(value ->> 'new_phone'), '') as new_phone_raw,
      nullif(trim(value ->> 'new_whatsapp_phone'), '') as new_whatsapp_phone_raw,
      nullif(trim(value ->> 'notes'), '') as notes
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) value
  ), normalized as (
    select
      *,
      case when customer_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then customer_id_text::uuid end as customer_id_uuid,
      case when final_customer_key ~ '^[0-9]+$' then final_customer_key end as final_customer_code,
      public.dawaa_normalize_egypt_mobile(new_phone_raw, coalesce(customer_code, final_customer_key)) as new_phone,
      public.dawaa_normalize_egypt_mobile(new_whatsapp_phone_raw, coalesce(customer_code, final_customer_key)) as new_whatsapp_phone
    from input_rows
  ), matched as (
    select
      n.*,
      coalesce(by_id.id, by_code.id, by_final_code.id, weak.unique_id) as matched_customer_id,
      case
        when by_id.id is not null then 'customer_id'
        when by_code.id is not null then 'customer_code'
        when by_final_code.id is not null then 'final_customer_key_code'
        when weak.unique_id is not null then 'customer_name_branch_unique'
        else null
      end as match_method,
      case
        when by_id.id is not null or by_code.id is not null or by_final_code.id is not null or weak.unique_id is not null then true
        else false
      end as match_confident
    from normalized n
    left join public.customers by_id
      on n.customer_id_uuid is not null and by_id.id = n.customer_id_uuid
    left join public.customers by_code
      on by_id.id is null
     and n.customer_code is not null
     and by_code.customer_code = n.customer_code
    left join public.customers by_final_code
      on by_id.id is null and by_code.id is null
     and n.final_customer_code is not null
     and by_final_code.customer_code = n.final_customer_code
    left join lateral (
      select (array_agg(c.id order by c.id::text))[1] as unique_id, count(*) as matches_count
      from public.customers c
      where by_id.id is null and by_code.id is null and by_final_code.id is null
        and n.customer_name is not null
        and n.branch is not null
        and trim(coalesce(c.name, '')) = n.customer_name
        and trim(coalesce(c.branch, '')) = n.branch
    ) weak_all on true
    left join lateral (
      select weak_all.unique_id
      where weak_all.matches_count = 1
    ) weak on true
  ), decision as (
    select
      m.*,
      c.id as target_id,
      c.customer_code as existing_customer_code,
      c.name as existing_customer_name,
      c.branch as existing_branch,
      c.phone as existing_phone_raw,
      c.whatsapp_phone as existing_whatsapp_phone_raw,
      public.dawaa_normalize_egypt_mobile(c.phone, c.customer_code) as existing_phone_valid,
      public.dawaa_normalize_egypt_mobile(c.whatsapp_phone, c.customer_code) as existing_whatsapp_valid,
      case
        when m.new_phone is null then false
        when c.id is null then false
        when public.dawaa_normalize_egypt_mobile(c.phone, c.customer_code) is null then true
        when public.dawaa_normalize_egypt_mobile(c.phone, c.customer_code) = m.new_phone then false
        else false
      end as would_update_phone,
      case
        when m.new_whatsapp_phone is null then false
        when c.id is null then false
        when public.dawaa_normalize_egypt_mobile(c.whatsapp_phone, c.customer_code) is null then true
        when public.dawaa_normalize_egypt_mobile(c.whatsapp_phone, c.customer_code) = m.new_whatsapp_phone then false
        else false
      end as would_update_whatsapp,
      case
        when c.id is null then 'unmatched'
        when m.new_phone is null and m.new_whatsapp_phone is null then 'invalid_phone'
        when public.dawaa_normalize_egypt_mobile(c.phone, c.customer_code) is not null
          and m.new_phone is not null
          and public.dawaa_normalize_egypt_mobile(c.phone, c.customer_code) <> m.new_phone then 'needs_review_existing_phone'
        when public.dawaa_normalize_egypt_mobile(c.whatsapp_phone, c.customer_code) is not null
          and m.new_whatsapp_phone is not null
          and public.dawaa_normalize_egypt_mobile(c.whatsapp_phone, c.customer_code) <> m.new_whatsapp_phone then 'needs_review_existing_whatsapp'
        when public.dawaa_normalize_egypt_mobile(c.phone, c.customer_code) = m.new_phone
          or public.dawaa_normalize_egypt_mobile(c.whatsapp_phone, c.customer_code) = m.new_whatsapp_phone then 'already_valid'
        when (m.new_phone is not null or m.new_whatsapp_phone is not null) then 'ready_to_update'
        else 'skipped'
      end as row_status
    from matched m
    left join public.customers c on c.id = m.matched_customer_id
  )
  select * from decision;

  if p_apply then
    update public.customers c
    set
      phone = case when t.would_update_phone then t.new_phone else c.phone end,
      whatsapp_phone = case when t.would_update_whatsapp then t.new_whatsapp_phone else c.whatsapp_phone end,
      updated_at = now()
    from tmp_customer_phone_update t
    where c.id = t.target_id
      and (t.would_update_phone or t.would_update_whatsapp);
    get diagnostics v_updated_customers = row_count;
  end if;

  select jsonb_build_object(
    'apply', p_apply,
    'rowsInFile', count(*),
    'matchedCustomers', count(*) filter (where target_id is not null),
    'validPhones', count(*) filter (where new_phone is not null),
    'validWhatsappPhones', count(*) filter (where new_whatsapp_phone is not null),
    'invalidPhones', count(*) filter (where new_phone is null and new_whatsapp_phone is null),
    'wouldUpdatePhone', count(*) filter (where would_update_phone),
    'wouldUpdateWhatsapp', count(*) filter (where would_update_whatsapp),
    'customersUpdated', v_updated_customers,
    'skippedExistingValid', count(*) filter (where row_status = 'already_valid'),
    'unmatchedRows', count(*) filter (where row_status = 'unmatched'),
    'needsReviewRows', count(*) filter (where row_status like 'needs_review%'),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'row_no', row_no,
      'customer_code', coalesce(existing_customer_code, customer_code, final_customer_code),
      'customer_name', coalesce(existing_customer_name, customer_name),
      'branch', coalesce(existing_branch, branch),
      'match_method', match_method,
      'status', row_status,
      'new_phone', new_phone,
      'new_whatsapp_phone', new_whatsapp_phone,
      'existing_phone', existing_phone_raw,
      'existing_whatsapp_phone', existing_whatsapp_phone_raw,
      'would_update_phone', would_update_phone,
      'would_update_whatsapp', would_update_whatsapp
    ) order by row_no) filter (where row_no <= 200), '[]'::jsonb)
  )
  into v_result
  from tmp_customer_phone_update;

  if p_apply then
    perform public.rebuild_customer_metrics_summary();
  end if;

  return v_result;
end;
$$;
