-- One-click import of the customer-requests WhatsApp groups (owner decision 2026-11-18).
-- The manager drops the export; the app finds the branch, the period, the doctor, the customer's
-- name and what they asked for, and saves everything at once. Each request now also keeps the
-- customer it belongs to (by code, else by phone) and the items, so the log is a usable record and
-- not only a count. A request from the pharmacy's shared account that names no doctor is saved for
-- the branch with no doctor: it is credited to nobody.
--
-- v1 stays as is (same table, same counting function); v2 adds columns and a richer import.

alter table public.customer_request_group_log_v1
  add column if not exists customer_id uuid references public.customers(id) on delete set null,
  add column if not exists customer_name text,
  add column if not exists details text;

create or replace function public.import_customer_request_group_v2(p_file_name text, p_branch text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $function$
declare
  v_branch text := nullif(btrim(p_branch), '');
  v_total integer;
  v_new integer := 0;
  v_updated integer := 0;
  v_credited integer := 0;
  v_customers integer := 0;
begin
  if not coalesce(public.dawaa_current_actor_can(array['manage_staff_accounts']), false) then
    raise exception 'group_requests_not_authorized' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'group_requests_invalid_rows' using errcode = '22023';
  end if;
  if v_branch is null or not exists (select 1 from public.staff s where btrim(s.branch) = v_branch) then
    raise exception 'group_requests_invalid_branch' using errcode = '22023';
  end if;
  v_total := jsonb_array_length(p_rows);

  with rows_in as (
    select nullif(btrim(r.fingerprint), '') as fingerprint, r.sent_at_local::timestamp as sent_local, r.sender,
           nullif(btrim(r.customer_code), '') as customer_code, nullif(btrim(r.customer_phone), '') as customer_phone,
           left(coalesce(r.body, ''), 2000) as body, left(r.attribution, 40) as attribution,
           left(nullif(btrim(r.customer_name), ''), 120) as customer_name, left(nullif(btrim(r.details), ''), 400) as details,
           (select s.id from public.staff s where s.id::text = nullif(btrim(r.staff_id), '')) as staff_id
    from jsonb_to_recordset(p_rows) as r(fingerprint text, sent_at_local text, sender text, customer_code text,
                                         customer_phone text, body text, attribution text, staff_id text,
                                         customer_name text, details text)
  ), matched as (
    -- One customer per request: the card with that code, else the one card with that phone.
    select i.*,
           coalesce(
             (select c.id from public.customers c
               where i.customer_code is not null and nullif(btrim(c.customer_code), '') = i.customer_code
               limit 1),
             (select min(c.id::text)::uuid from public.customers c
               where i.customer_phone is not null
                 and public.dawaa_sync_norm_phone(coalesce(c.customer_phone, c.phone, c.mobile, c.whatsapp_phone, c.whatsapp))
                     = public.dawaa_sync_norm_phone(i.customer_phone)
               having count(*) = 1)
           ) as customer_id
    from rows_in i
    where i.fingerprint is not null and (i.customer_code is not null or i.customer_phone is not null)
  ), upserted as (
    insert into public.customer_request_group_log_v1
      (fingerprint, staff_id, branch, sent_at, request_day, sender_name, customer_code, customer_phone, body,
       attribution, file_name, imported_by, customer_id, customer_name, details)
    select m.fingerprint, m.staff_id, v_branch, m.sent_local at time zone 'Africa/Cairo', m.sent_local::date, m.sender,
           m.customer_code, m.customer_phone, m.body, m.attribution, left(p_file_name, 200),
           public.dawaa_current_staff_account_id_strict()::text, m.customer_id, m.customer_name, m.details
    from matched m
    -- A re-upload fills what an older import left empty; it never moves a request already credited.
    on conflict (fingerprint) do update set
      staff_id = coalesce(customer_request_group_log_v1.staff_id, excluded.staff_id),
      attribution = case when customer_request_group_log_v1.staff_id is null and excluded.staff_id is not null
                         then excluded.attribution else customer_request_group_log_v1.attribution end,
      customer_id = coalesce(customer_request_group_log_v1.customer_id, excluded.customer_id),
      customer_name = coalesce(customer_request_group_log_v1.customer_name, excluded.customer_name),
      details = coalesce(customer_request_group_log_v1.details, excluded.details)
    returning (xmax = 0) as inserted, staff_id, customer_id
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted),
         count(*) filter (where inserted and staff_id is not null), count(*) filter (where inserted and customer_id is not null)
    into v_new, v_updated, v_credited, v_customers
  from upserted;

  return jsonb_build_object('total', v_total, 'new', v_new, 'already', v_updated,
                            'credited', v_credited, 'customers', v_customers);
end;
$function$;

revoke all on function public.import_customer_request_group_v2(text, text, jsonb) from public;
grant execute on function public.import_customer_request_group_v2(text, text, jsonb) to authenticated, service_role;
