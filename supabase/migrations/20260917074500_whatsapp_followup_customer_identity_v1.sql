-- Carry canonical customer identity into the WhatsApp follow-up queue.
-- Resolution is intentionally conservative: only one unambiguous customer may be linked.
-- Branch-only until release approval.

alter table public.whatsapp_auto_followup_requests
  add column if not exists customer_id uuid,
  add column if not exists customer_code text;

create index if not exists whatsapp_auto_followup_requests_customer_id_idx
  on public.whatsapp_auto_followup_requests(customer_id)
  where customer_id is not null;

create index if not exists whatsapp_auto_followup_requests_customer_code_idx
  on public.whatsapp_auto_followup_requests(customer_code)
  where nullif(trim(customer_code), '') is not null;

create or replace function public.dawaa_whatsapp_followup_resolve_customer_identity_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_phone text;
  v_name text;
  v_count integer := 0;
  v_customer_id uuid;
  v_customer_code text;
begin
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
$$;

revoke all on function public.dawaa_whatsapp_followup_resolve_customer_identity_v1() from public, anon, authenticated;

drop trigger if exists whatsapp_auto_followup_resolve_customer_identity_v1 on public.whatsapp_auto_followup_requests;
create trigger whatsapp_auto_followup_resolve_customer_identity_v1
before insert or update of customer_phone, customer_name, customer_id
on public.whatsapp_auto_followup_requests
for each row
execute function public.dawaa_whatsapp_followup_resolve_customer_identity_v1();

-- Backfill existing unresolved rows through the same conservative resolver.
update public.whatsapp_auto_followup_requests
set customer_name = customer_name
where customer_id is null;

comment on column public.whatsapp_auto_followup_requests.customer_id is
  'Canonical customers.id resolved only when the WhatsApp follow-up identity is unambiguous.';
comment on column public.whatsapp_auto_followup_requests.customer_code is
  'Canonical customer code paired with customer_id after conservative WhatsApp follow-up identity resolution.';
