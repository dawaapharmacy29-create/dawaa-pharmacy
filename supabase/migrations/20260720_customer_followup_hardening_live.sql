begin;

-- Schema-compatible additive columns only. The production table uses text identifiers.
alter table if exists public.daily_followups
  add column if not exists identity_key text,
  add column if not exists canonical_followup_id text,
  add column if not exists duplicate_of text,
  add column if not exists data_quality_status text,
  add column if not exists data_issues text[] default '{}'::text[],
  add column if not exists requested_by_staff_id text,
  add column if not exists request_source text,
  add column if not exists open_case boolean default true;

create or replace function public.normalize_egyptian_mobile(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  with source as (
    select regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g') as digits
  )
  select case
    when digits ~ '^00201[0125][0-9]{8}$' then '0' || substr(digits, 5)
    when digits ~ '^201[0125][0-9]{8}$' then '0' || substr(digits, 3)
    when digits ~ '^1[0125][0-9]{8}$' then '0' || digits
    else digits
  end
  from source;
$$;

create or replace function public.customer_followup_identity(
  p_customer_id text,
  p_customer_code text,
  p_phone text,
  p_name text
)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_phone text := public.normalize_egyptian_mobile(p_phone);
  v_name text;
begin
  if nullif(btrim(p_customer_id), '') is not null then
    return 'id:' || btrim(p_customer_id);
  end if;

  if nullif(btrim(p_customer_code), '') is not null
     and lower(btrim(p_customer_code)) not in ('0', 'null', 'undefined', 'غير محدد', 'غير معروف') then
    return 'code:' || btrim(p_customer_code);
  end if;

  if v_phone ~ '^01[0125][0-9]{8}$' then
    return 'phone:' || v_phone;
  end if;

  v_name := lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'));
  if v_name <> '' and v_name not in ('0', 'غير محدد', 'غير معروف', 'عميل غير مسجل', 'عميل الصيدلية') then
    return 'name:' || v_name;
  end if;

  return null;
end;
$$;

-- Compatibility entry point for older application code. Existing database triggers
-- normalize identity, enforce valid lifecycle state and mark duplicate inserts safely.
create or replace function public.create_or_link_customer_followup(p_payload jsonb)
returns public.daily_followups
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_row public.daily_followups;
begin
  insert into public.daily_followups
  select * from jsonb_populate_record(null::public.daily_followups, p_payload)
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.create_or_link_customer_followup(jsonb) from public;
grant execute on function public.create_or_link_customer_followup(jsonb) to anon, authenticated;

-- Intentionally no historical mass update, duplicate hiding or unique open-case index here.
-- Legacy duplicates are reviewed through diagnostics. New writes use the transaction-safe
-- find_or_create_open_customer_followup RPC and the existing database guards.

commit;
