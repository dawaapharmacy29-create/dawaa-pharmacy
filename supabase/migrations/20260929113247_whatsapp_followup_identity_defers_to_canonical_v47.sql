-- V47: follow-up requests stop guessing customer identity when the Canonical Customer Identity
-- Resolver (src/lib/customers/canonicalCustomerIdentityResolver.ts) already decided.
--
-- dawaa_whatsapp_followup_resolve_customer_identity_v1 filled customer_id from a unique phone OR a
-- unique display NAME whenever customer_id was null. The canonical resolver never resolves by name
-- and deliberately leaves ambiguous/contradicted identities unresolved; the trigger silently
-- overrode that. Rows written by the canonical path now carry customer_identity_status and the
-- trigger leaves them untouched. Legacy writers (status null) keep the previous behaviour.
-- No existing row is modified.

alter table public.whatsapp_auto_followup_requests
  add column if not exists customer_identity_status text;

alter table public.whatsapp_auto_followup_requests
  drop constraint if exists whatsapp_auto_followup_requests_identity_status_ck;
alter table public.whatsapp_auto_followup_requests
  add constraint whatsapp_auto_followup_requests_identity_status_ck
  check (customer_identity_status is null
         or customer_identity_status in ('resolved', 'unresolved', 'ambiguous', 'contradicted'));

create or replace function public.dawaa_whatsapp_followup_resolve_customer_identity_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_phone text;
  v_name text;
  v_count integer := 0;
  v_customer_id uuid;
  v_customer_code text;
begin
  -- Canonical Customer Identity already decided (resolved or deliberately not): never guess.
  if new.customer_identity_status is not null then
    if new.customer_identity_status <> 'resolved' then
      new.customer_id := null;
    end if;
    return new;
  end if;

  if new.customer_id is not null then
    select c.customer_code into v_customer_code
    from public.customers c
    where c.id = new.customer_id
      and coalesce(c.is_duplicate, false) = false
    limit 1;
    if found then
      new.customer_code := coalesce(new.customer_code, v_customer_code);
      return new;
    end if;
    new.customer_id := null;
  end if;

  v_phone := regexp_replace(coalesce(new.customer_phone, ''), '[^0-9]', '', 'g');
  if v_phone like '0020%' then
    v_phone := '0' || substring(v_phone from 5);
  elsif v_phone ~ '^201[0-9]{9}$' then
    v_phone := '0' || substring(v_phone from 3);
  end if;

  if v_phone ~ '^01[0-9]{9}$' then
    select count(*), max(m.id::text)::uuid, max(m.customer_code)
      into v_count, v_customer_id, v_customer_code
    from (
      select c.id, c.customer_code
      from public.customers c
      where coalesce(c.is_duplicate, false) = false
        and (
          regexp_replace(coalesce(c.normalized_phone, ''), '[^0-9]', '', 'g') = v_phone
          or regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') = v_phone
          or regexp_replace(coalesce(c.customer_phone, ''), '[^0-9]', '', 'g') = v_phone
          or regexp_replace(coalesce(c.whatsapp_phone, ''), '[^0-9]', '', 'g') = v_phone
          or regexp_replace(coalesce(c.mobile, ''), '[^0-9]', '', 'g') = v_phone
          or regexp_replace(coalesce(c.whatsapp, ''), '[^0-9]', '', 'g') = v_phone
          or regexp_replace(coalesce(c.phone_alt, ''), '[^0-9]', '', 'g') = v_phone
        )
      limit 2
    ) m;

    if v_count = 1 then
      new.customer_id := v_customer_id;
      new.customer_code := v_customer_code;
      return new;
    end if;
  end if;

  v_name := lower(trim(regexp_replace(coalesce(new.customer_name, ''), '[[:space:]]+', ' ', 'g')));
  if length(v_name) >= 3 then
    select count(*), max(m.id::text)::uuid, max(m.customer_code)
      into v_count, v_customer_id, v_customer_code
    from (
      select c.id, c.customer_code
      from public.customers c
      where coalesce(c.is_duplicate, false) = false
        and (
          lower(trim(regexp_replace(coalesce(c.display_name, ''), '[[:space:]]+', ' ', 'g'))) = v_name
          or lower(trim(regexp_replace(coalesce(c.name, ''), '[[:space:]]+', ' ', 'g'))) = v_name
          or lower(trim(regexp_replace(coalesce(c.customer_name, ''), '[[:space:]]+', ' ', 'g'))) = v_name
        )
      limit 2
    ) m;

    if v_count = 1 then
      new.customer_id := v_customer_id;
      new.customer_code := v_customer_code;
    end if;
  end if;

  return new;
end;
$function$;
