drop function if exists public.safe_daily_customer_import_from_json(jsonb, boolean);

create or replace function public.safe_daily_customer_import_from_json(
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
  v_inserted_customers integer := 0;
begin
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  create temporary table tmp_daily_customer_import on commit drop as
  with input_rows as (
    select
      row_number() over ()::integer as row_no,
      nullif(trim(value ->> 'final_customer_key'), '') as final_customer_key,
      nullif(trim(value ->> 'customer_id'), '') as customer_id_text,
      nullif(trim(value ->> 'customer_code'), '') as customer_code,
      nullif(trim(value ->> 'customer_name'), '') as customer_name,
      nullif(trim(value ->> 'branch'), '') as branch,
      nullif(trim(value ->> 'address'), '') as address,
      nullif(trim(value ->> 'new_phone'), '') as new_phone_raw,
      nullif(trim(value ->> 'new_whatsapp_phone'), '') as new_whatsapp_phone_raw,
      nullif(trim(value ->> 'phone_alt'), '') as phone_alt_raw,
      nullif(trim(value ->> 'notes'), '') as notes
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) value
  ), normalized as (
    select
      *,
      case when customer_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then customer_id_text::uuid end as customer_id_uuid,
      case when final_customer_key ~ '^[0-9]+$' then final_customer_key end as final_customer_code,
      public.dawaa_normalize_egypt_mobile(new_phone_raw, coalesce(customer_code, final_customer_key)) as new_phone,
      public.dawaa_normalize_egypt_mobile(new_whatsapp_phone_raw, coalesce(customer_code, final_customer_key)) as new_whatsapp_phone,
      public.dawaa_normalize_egypt_mobile(phone_alt_raw, coalesce(customer_code, final_customer_key)) as phone_alt,
      count(*) over (partition by nullif(coalesce(customer_code, final_customer_key), '')) as duplicate_key_count
    from input_rows
  ), matched as (
    select
      n.*,
      coalesce(by_id.id, by_code.unique_id, by_final_code.unique_id, by_phone.unique_id, weak.unique_id) as matched_customer_id,
      case
        when by_id.id is not null then 'customer_id'
        when by_code.unique_id is not null then 'customer_code'
        when by_final_code.unique_id is not null then 'final_customer_key_code'
        when by_phone.unique_id is not null then 'phone_unique'
        when weak.unique_id is not null then 'customer_name_branch_unique'
        else null
      end as match_method,
      coalesce(by_code.matches_count, by_final_code.matches_count, by_phone.matches_count, weak_all.matches_count, 0) as match_count
    from normalized n
    left join public.customers by_id
      on n.customer_id_uuid is not null and by_id.id = n.customer_id_uuid
    left join lateral (
      select (array_agg(c.id order by c.id::text))[1] as unique_id, count(*) as matches_count
      from public.customers c
      where by_id.id is null
        and n.customer_code is not null
        and c.customer_code = n.customer_code
    ) by_code on true
    left join lateral (
      select (array_agg(c.id order by c.id::text))[1] as unique_id, count(*) as matches_count
      from public.customers c
      where by_id.id is null and by_code.unique_id is null
        and n.final_customer_code is not null
        and c.customer_code = n.final_customer_code
    ) by_final_code on true
    left join lateral (
      select (array_agg(c.id order by c.id::text))[1] as unique_id, count(*) as matches_count
      from public.customers c
      where by_id.id is null and by_code.unique_id is null and by_final_code.unique_id is null
        and n.customer_code is null
        and n.final_customer_code is null
        and coalesce(n.new_phone, n.new_whatsapp_phone, n.phone_alt) is not null
        and (
          public.dawaa_normalize_egypt_mobile(c.phone, c.customer_code) in (n.new_phone, n.new_whatsapp_phone, n.phone_alt)
          or public.dawaa_normalize_egypt_mobile(c.whatsapp_phone, c.customer_code) in (n.new_phone, n.new_whatsapp_phone, n.phone_alt)
          or public.dawaa_normalize_egypt_mobile(c.phone_alt, c.customer_code) in (n.new_phone, n.new_whatsapp_phone, n.phone_alt)
        )
    ) by_phone on true
    left join lateral (
      select (array_agg(c.id order by c.id::text))[1] as unique_id, count(*) as matches_count
      from public.customers c
      where by_id.id is null and by_code.unique_id is null and by_final_code.unique_id is null and by_phone.unique_id is null
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
      c.address as existing_address,
      c.phone as existing_phone_raw,
      c.whatsapp_phone as existing_whatsapp_phone_raw,
      c.phone_alt as existing_phone_alt_raw,
      public.dawaa_normalize_egypt_mobile(c.phone, c.customer_code) as existing_phone_valid,
      public.dawaa_normalize_egypt_mobile(c.whatsapp_phone, c.customer_code) as existing_whatsapp_valid,
      public.dawaa_normalize_egypt_mobile(c.phone_alt, c.customer_code) as existing_phone_alt_valid,
      (
        coalesce(trim(c.name), '') = ''
        or trim(c.name) in ('0', '.', '-', 'عميل', 'عميل غير مسجل', 'عميل الصيدلية')
        or length(trim(c.name)) < 3
      ) as existing_name_weak,
      case
        when c.id is not null
          and m.new_phone is not null
          and public.dawaa_normalize_egypt_mobile(c.phone, c.customer_code) is not null
          and public.dawaa_normalize_egypt_mobile(c.phone, c.customer_code) <> m.new_phone
        then true else false
      end as phone_conflict,
      case
        when c.id is not null
          and m.new_whatsapp_phone is not null
          and public.dawaa_normalize_egypt_mobile(c.whatsapp_phone, c.customer_code) is not null
          and public.dawaa_normalize_egypt_mobile(c.whatsapp_phone, c.customer_code) <> m.new_whatsapp_phone
        then true else false
      end as whatsapp_conflict,
      case
        when c.id is not null
          and nullif(trim(coalesce(c.address, '')), '') is not null
          and nullif(trim(coalesce(m.address, '')), '') is not null
          and trim(c.address) <> trim(m.address)
        then true else false
      end as address_conflict,
      exists (
        select 1
        from public.customers phone_owner
        where m.new_phone is not null
          and nullif(trim(coalesce(phone_owner.phone, '')), '') = m.new_phone
          and (c.id is null or phone_owner.id <> c.id)
      ) as phone_used_by_other
    from matched m
    left join public.customers c on c.id = m.matched_customer_id
  ), final_decision as (
    select
      *,
      case
        when duplicate_key_count > 1 and coalesce(customer_code, final_customer_key) is not null then 'duplicate_in_file'
        when match_count > 1 then 'needs_review_multiple_matches'
        when phone_used_by_other then 'needs_review_phone_used_by_other'
        when target_id is null and (customer_code is not null or final_customer_code is not null or customer_name is not null) then 'new_customer'
        when target_id is null then 'unmatched'
        when phone_conflict then 'needs_review_existing_phone'
        when whatsapp_conflict then 'needs_review_existing_whatsapp'
        when address_conflict then 'needs_review_existing_address'
        when target_id is not null then 'existing_customer'
        else 'invalid_row'
      end as row_status
    from decision
  )
  select
    *,
    (
      row_status = 'existing_customer'
      and new_phone is not null
      and existing_phone_valid is null
    ) as would_update_phone,
    (
      row_status = 'existing_customer'
      and new_whatsapp_phone is not null
      and existing_whatsapp_valid is null
    ) as would_update_whatsapp,
    (
      row_status = 'existing_customer'
      and phone_alt is not null
      and existing_phone_alt_valid is null
    ) as would_update_phone_alt,
    (
      row_status = 'existing_customer'
      and nullif(trim(coalesce(existing_address, '')), '') is null
      and nullif(trim(coalesce(address, '')), '') is not null
    ) as would_update_address,
    (
      row_status = 'existing_customer'
      and existing_name_weak
      and nullif(trim(coalesce(customer_name, '')), '') is not null
      and length(trim(customer_name)) >= 3
    ) as would_update_name,
    (
      row_status = 'existing_customer'
      and nullif(trim(coalesce(existing_branch, '')), '') is null
      and nullif(trim(coalesce(branch, '')), '') is not null
    ) as would_update_branch
  from final_decision;

  if p_apply then
    update public.customers c
    set
      phone = case when t.would_update_phone then t.new_phone else c.phone end,
      whatsapp_phone = case when t.would_update_whatsapp then t.new_whatsapp_phone else c.whatsapp_phone end,
      phone_alt = case when t.would_update_phone_alt then t.phone_alt else c.phone_alt end,
      address = case when t.would_update_address then t.address else c.address end,
      name = case when t.would_update_name then t.customer_name else c.name end,
      branch = case when t.would_update_branch then t.branch else c.branch end,
      updated_at = now()
    from tmp_daily_customer_import t
    where c.id = t.target_id
      and (
        t.would_update_phone
        or t.would_update_whatsapp
        or t.would_update_phone_alt
        or t.would_update_address
        or t.would_update_name
        or t.would_update_branch
      );
    get diagnostics v_updated_customers = row_count;

    insert into public.customers (customer_code, name, phone, whatsapp_phone, phone_alt, branch, address, notes, created_at, updated_at)
    select
      coalesce(customer_code, final_customer_code),
      customer_name,
      new_phone,
      new_whatsapp_phone,
      phone_alt,
      branch,
      address,
      notes,
      now(),
      now()
    from tmp_daily_customer_import
    where row_status = 'new_customer'
      and coalesce(customer_code, final_customer_code, customer_name) is not null;
    get diagnostics v_inserted_customers = row_count;
  end if;

  select jsonb_build_object(
    'apply', p_apply,
    'rowsInFile', count(*),
    'matchedCustomers', count(*) filter (where target_id is not null),
    'validPhones', count(*) filter (where new_phone is not null),
    'validWhatsappPhones', count(*) filter (where new_whatsapp_phone is not null),
    'invalidPhones', count(*) filter (where new_phone is null and new_whatsapp_phone is null and phone_alt is null),
    'wouldUpdatePhone', count(*) filter (where would_update_phone),
    'wouldUpdateWhatsapp', count(*) filter (where would_update_whatsapp),
    'repairedPhoneAlt', count(*) filter (where would_update_phone_alt),
    'repairedAddresses', count(*) filter (where would_update_address),
    'repairedNames', count(*) filter (where would_update_name),
    'repairedBranches', count(*) filter (where would_update_branch),
    'customersUpdated', v_updated_customers,
    'insertedCustomers', case when p_apply then v_inserted_customers else count(*) filter (where row_status = 'new_customer') end,
    'skippedExistingValid', count(*) filter (
      where row_status = 'existing_customer'
        and not would_update_phone
        and not would_update_whatsapp
        and not would_update_phone_alt
        and not would_update_address
        and not would_update_name
        and not would_update_branch
    ),
    'unmatchedRows', count(*) filter (where row_status = 'unmatched'),
    'needsReviewRows', count(*) filter (where row_status like 'needs_review%' or row_status = 'duplicate_in_file'),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'row_no', row_no,
      'customer_code', coalesce(existing_customer_code, customer_code, final_customer_code),
      'customer_name', coalesce(existing_customer_name, customer_name),
      'branch', coalesce(existing_branch, branch),
      'address', coalesce(existing_address, address),
      'match_method', match_method,
      'status', row_status,
      'new_phone', new_phone,
      'new_whatsapp_phone', new_whatsapp_phone,
      'phone_alt', phone_alt,
      'existing_phone', existing_phone_raw,
      'existing_whatsapp_phone', existing_whatsapp_phone_raw,
      'phone_used_by_other', phone_used_by_other,
      'would_update_phone', would_update_phone,
      'would_update_whatsapp', would_update_whatsapp,
      'would_update_phone_alt', would_update_phone_alt,
      'would_update_address', would_update_address,
      'would_update_name', would_update_name,
      'would_update_branch', would_update_branch
    ) order by row_no) filter (where row_no <= 500), '[]'::jsonb)
  )
  into v_result
  from tmp_daily_customer_import;

  return v_result;
end;
$$;
