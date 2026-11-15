-- Customer requests posted in the branches' WhatsApp groups (owner decision 2026-11-15): requests
-- now go through the group as well as the app, and both count in the doctors' evaluation. The
-- manager uploads the group's export; every message with a customer code or phone is logged once
-- (by its fingerprint) with the doctor it is credited to (by phone, name in the message, or the
-- only doctor punched in at that time). The evaluation counts a group request for a customer only
-- when the app has no request for the same customer that day.

create table if not exists public.customer_request_group_log_v1 (
  fingerprint text primary key,
  staff_id uuid references public.staff(id),
  branch text not null,
  sent_at timestamptz not null,
  request_day date not null,
  sender_name text,
  customer_code text,
  customer_phone text,
  body text,
  attribution text,
  file_name text,
  imported_by text,
  created_at timestamptz not null default now()
);
create index if not exists customer_request_group_log_v1_day_idx on public.customer_request_group_log_v1 (request_day);
alter table public.customer_request_group_log_v1 enable row level security;
revoke all on public.customer_request_group_log_v1 from anon, authenticated;

create or replace function public.import_customer_request_group_v1(p_file_name text, p_branch text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $function$
declare
  v_branch text := nullif(btrim(p_branch), '');
  v_total integer;
  v_inserted integer := 0;
  v_credited integer := 0;
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
           (select s.id from public.staff s where s.id::text = nullif(btrim(r.staff_id), '')) as staff_id
    from jsonb_to_recordset(p_rows) as r(fingerprint text, sent_at_local text, sender text, customer_code text,
                                         customer_phone text, body text, attribution text, staff_id text)
  ), upserted as (
    insert into public.customer_request_group_log_v1
      (fingerprint, staff_id, branch, sent_at, request_day, sender_name, customer_code, customer_phone, body, attribution, file_name, imported_by)
    select i.fingerprint, i.staff_id, v_branch, i.sent_local at time zone 'Africa/Cairo', i.sent_local::date, i.sender,
           i.customer_code, i.customer_phone, i.body, i.attribution, left(p_file_name, 200),
           public.dawaa_current_staff_account_id_strict()::text
    from rows_in i
    where i.fingerprint is not null and (i.customer_code is not null or i.customer_phone is not null)
    -- A later upload may credit a request that had no doctor; it never moves one already credited.
    on conflict (fingerprint) do update set staff_id = excluded.staff_id, attribution = excluded.attribution
      where customer_request_group_log_v1.staff_id is null and excluded.staff_id is not null
    returning staff_id
  )
  select count(*), count(staff_id) into v_inserted, v_credited from upserted;

  return jsonb_build_object('total', v_total, 'saved', v_inserted, 'credited', v_credited);
end;
$function$;

revoke all on function public.import_customer_request_group_v1(text, text, jsonb) from public;
grant execute on function public.import_customer_request_group_v1(text, text, jsonb) to authenticated, service_role;

create or replace function public.get_customer_request_group_rows_v1(p_start date, p_end date)
returns table (staff_id text, branch text, request_day date, customer_code text, customer_phone text)
language plpgsql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $function$
begin
  if public.dawaa_current_staff_account_id_strict() is null then
    raise exception 'group_requests_not_authorized' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 400 then
    raise exception 'group_requests_invalid_range' using errcode = '22023';
  end if;
  return query
  select l.staff_id::text, l.branch, l.request_day, l.customer_code, l.customer_phone
  from public.customer_request_group_log_v1 l
  where l.request_day between p_start and p_end;
end;
$function$;

revoke all on function public.get_customer_request_group_rows_v1(date, date) from public;
grant execute on function public.get_customer_request_group_rows_v1(date, date) to authenticated, service_role;
