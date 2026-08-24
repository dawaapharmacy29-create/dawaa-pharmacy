-- Canonical source identity boundary for Base44/DawaaWael CustomerOrder rows.
-- Stable identities only:
--   customer code -> customer resolver
--   product code  -> products.id
--   recorded staff UUID -> doctor_id / source_recorded_staff_id
-- Never infer incentive ownership from a display name or assigned sourcing employee.

create or replace function public.customer_request_canonical_source_identity_v2()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_customer_code text;
  v_product_code text;
  v_product_id uuid;
  v_canonical_product_code text;
  v_staff_raw text;
  v_staff_id uuid;
  v_staff_name text;
  v_staff_branch text;
  v_request_branch_key text;
  v_staff_branch_key text;
begin
  if coalesce(new.source_system,'') <> 'dawaawael'
     or coalesce(new.source_entity,'') <> 'CustomerOrder'
     or new.source_payload is null then
    return new;
  end if;

  -- Preserve source customer code when present so the existing customer resolver
  -- can link by code before falling back to phone.
  v_customer_code := nullif(trim(coalesce(
    new.source_payload->>'customer_code',
    new.source_payload->>'customerCode',
    ''
  )), '');
  if nullif(trim(coalesce(new.customer_code,'')),'') is null
     and v_customer_code is not null
     and v_customer_code not in ('0','00') then
    new.customer_code := v_customer_code;
  end if;

  -- Product identity is code-first and exact. Name-only matching remains in the
  -- Data Quality workspace and never runs silently in this ingestion trigger.
  v_product_code := nullif(trim(coalesce(
    new.source_payload->>'product_code',
    new.source_payload->>'productCode',
    new.source_payload->>'item_code',
    new.source_payload->>'itemCode',
    ''
  )), '');

  if new.product_id is null and v_product_code is not null then
    select
      min(p.id::text)::uuid,
      min(p.product_code)
    into v_product_id,v_canonical_product_code
    from public.products p
    where upper(replace(trim(coalesce(p.product_code,'')),' ','')) =
          upper(replace(v_product_code,' ',''))
    having count(*) = 1;

    if v_product_id is not null then
      new.product_id := v_product_id;
      new.product_code := v_canonical_product_code;
    end if;
  end if;

  -- Incentive ownership accepts only a canonical staff UUID supplied explicitly
  -- by the source contract. assigned_employee is operational sourcing metadata.
  v_staff_raw := nullif(trim(coalesce(
    new.source_payload->>'recorded_staff_id',
    new.source_payload->>'recordedStaffId',
    new.source_payload->>'doctor_id',
    new.source_payload->>'doctorId',
    ''
  )), '');

  if v_staff_raw is not null
     and v_staff_raw ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_staff_id := v_staff_raw::uuid;

    select s.name,s.branch
      into v_staff_name,v_staff_branch
    from public.staff s
    where s.id=v_staff_id
      and coalesce(s.active,true)
      and coalesce(s.is_active,true)
    limit 1;

    if v_staff_name is not null then
      v_request_branch_key := public.dawaa_customer_request_branch_key(
        coalesce(nullif(trim(new.branch),''),nullif(trim(new.source_payload->>'branch'),''))
      );
      v_staff_branch_key := public.dawaa_customer_request_branch_key(v_staff_branch);

      if lower(trim(coalesce(v_staff_branch,'')))='كل الفروع'
         or (
           v_request_branch_key is not null
           and v_staff_branch_key = v_request_branch_key
         ) then
        new.source_recorded_staff_id := v_staff_id;
        if new.doctor_id is null then
          new.doctor_id := v_staff_id;
          new.doctor_name := v_staff_name;
        end if;
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.customer_request_canonical_source_identity_v2() from public;

drop trigger if exists aaa_customer_request_canonical_source_identity_v2 on public.customer_requests;
create trigger aaa_customer_request_canonical_source_identity_v2
before insert or update of source_system,source_entity,source_payload
on public.customer_requests
for each row execute function public.customer_request_canonical_source_identity_v2();

-- Re-run only rows that already contain stable identifiers in the source payload.
-- Existing name-only rows remain untouched and stay in the human Data Quality queue.
update public.customer_requests
set source_payload=source_payload
where source_system='dawaawael'
  and source_entity='CustomerOrder'
  and (
    nullif(trim(coalesce(
      source_payload->>'product_code',
      source_payload->>'productCode',
      source_payload->>'item_code',
      source_payload->>'itemCode',
      ''
    )), '') is not null
    or nullif(trim(coalesce(
      source_payload->>'recorded_staff_id',
      source_payload->>'recordedStaffId',
      source_payload->>'doctor_id',
      source_payload->>'doctorId',
      ''
    )), '') is not null
  );

comment on function public.customer_request_canonical_source_identity_v2() is
  'Code/UUID-only normalization boundary for Base44 CustomerOrder identity. Never attributes doctor points from names or assigned_employee.';
