-- Follow-up requests doctors post in the WhatsApp group, counted per doctor for the competition.
-- Message text is not kept: it describes customers' health, and the fingerprint is enough to stop
-- a re-uploaded export from counting twice.
create table if not exists public.doctor_followup_request_log_v1 (
  fingerprint text primary key,
  staff_id uuid not null references public.staff (id),
  sent_at timestamptz not null,
  request_day date not null,
  sender_name text not null,
  file_name text,
  imported_by text,
  created_at timestamptz not null default now()
);
create index if not exists doctor_followup_request_log_v1_day_staff_idx
  on public.doctor_followup_request_log_v1 (request_day, staff_id);

create table if not exists public.doctor_followup_request_targets_v1 (
  branch text primary key,
  target integer not null check (target > 0),
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.doctor_followup_request_log_v1 enable row level security;
alter table public.doctor_followup_request_targets_v1 enable row level security;
revoke all on public.doctor_followup_request_log_v1 from anon, authenticated;
revoke all on public.doctor_followup_request_targets_v1 from anon, authenticated;

create or replace function public.resolve_followup_request_senders_v1(p_senders text[])
returns table (sender text, staff_id text, staff_name text)
language plpgsql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $function$
begin
  if not coalesce(public.dawaa_current_actor_can(array['manage_staff_accounts']), false) then
    raise exception 'followup_requests_not_authorized' using errcode = '42501';
  end if;
  return query
  select s.sender_name, min(a.staff_id::text), min(st.name)
  from unnest(p_senders) as s(sender_name)
  left join public.staff_identity_aliases a
    on a.active and a.normalized_alias = public.dawaa_normalize_staff_alias_v1(s.sender_name)
  left join public.staff st on st.id = a.staff_id
  group by s.sender_name;
end;
$function$;

-- The WhatsApp display name becomes a normal staff alias, so identity stays in one place.
create or replace function public.link_followup_request_sender_v1(p_sender text, p_staff_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $function$
begin
  if not coalesce(public.dawaa_current_actor_can(array['manage_staff_accounts']), false) then
    raise exception 'followup_requests_not_authorized' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_sender, '')), '') is null or p_staff_id is null then
    raise exception 'followup_request_sender_invalid' using errcode = '22023';
  end if;
  insert into public.staff_identity_aliases (staff_id, alias_name, normalized_alias, source, confidence, active)
  select p_staff_id, btrim(p_sender), public.dawaa_normalize_staff_alias_v1(p_sender), 'whatsapp_followup_group', 1, true
  where not exists (
    select 1 from public.staff_identity_aliases a
    where a.active and a.normalized_alias = public.dawaa_normalize_staff_alias_v1(p_sender)
  );
end;
$function$;

create or replace function public.import_doctor_followup_requests_v1(p_file_name text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $function$
declare
  v_total integer;
  v_inserted integer := 0;
  v_unmatched jsonb;
begin
  if not coalesce(public.dawaa_current_actor_can(array['manage_staff_accounts']), false) then
    raise exception 'followup_requests_not_authorized' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'followup_requests_invalid_rows' using errcode = '22023';
  end if;
  v_total := jsonb_array_length(p_rows);

  with rows_in as (
    select r.sender, r.sent_at_local::timestamp as sent_local, coalesce(r.body, '') as body
    from jsonb_to_recordset(p_rows) as r(sender text, sent_at_local text, body text)
  ), matched as (
    select i.*, a.staff_id
    from rows_in i
    join lateral (
      select min(x.staff_id::text)::uuid as staff_id
      from public.staff_identity_aliases x
      where x.active and x.normalized_alias = public.dawaa_normalize_staff_alias_v1(i.sender)
      having count(distinct x.staff_id) = 1
    ) a on true
  ), inserted as (
    insert into public.doctor_followup_request_log_v1 (fingerprint, staff_id, sent_at, request_day, sender_name, file_name, imported_by)
    select md5(public.dawaa_normalize_staff_alias_v1(m.sender) || '|' || m.sent_local::text || '|' || regexp_replace(m.body, '\s+', '', 'g')),
           m.staff_id, m.sent_local at time zone 'Africa/Cairo', m.sent_local::date, m.sender, left(p_file_name, 200),
           public.dawaa_current_staff_account_id_strict()::text
    from matched m
    on conflict (fingerprint) do nothing
    returning 1
  )
  select count(*) into v_inserted from inserted;

  select coalesce(jsonb_agg(distinct r.sender), '[]'::jsonb) into v_unmatched
  from jsonb_to_recordset(p_rows) as r(sender text)
  where not exists (
    select 1 from public.staff_identity_aliases x
    where x.active and x.normalized_alias = public.dawaa_normalize_staff_alias_v1(r.sender)
  );

  return jsonb_build_object('total', v_total, 'inserted', v_inserted, 'unmatched_senders', v_unmatched);
end;
$function$;

create or replace function public.get_doctor_followup_request_counts_v1(p_start date, p_end date)
returns table (staff_id text, branch text, requests bigint)
language plpgsql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $function$
begin
  if public.dawaa_current_staff_account_id_strict() is null then
    raise exception 'followup_requests_not_authorized' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 400 then
    raise exception 'followup_requests_invalid_range' using errcode = '22023';
  end if;
  return query
  select l.staff_id::text, s.branch, count(*)
  from public.doctor_followup_request_log_v1 l
  join public.staff s on s.id = l.staff_id
  where l.request_day between p_start and p_end
  group by l.staff_id, s.branch;
end;
$function$;

create or replace function public.get_doctor_followup_request_targets_v1()
returns table (branch text, target integer)
language plpgsql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $function$
begin
  if public.dawaa_current_staff_account_id_strict() is null then
    raise exception 'followup_requests_not_authorized' using errcode = '42501';
  end if;
  return query select t.branch, t.target from public.doctor_followup_request_targets_v1 t;
end;
$function$;

create or replace function public.set_doctor_followup_request_target_v1(p_branch text, p_target integer)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $function$
begin
  if not coalesce(public.dawaa_current_actor_can(array['manage_staff_accounts']), false) then
    raise exception 'followup_requests_not_authorized' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_branch, '')), '') is null or coalesce(p_target, 0) <= 0 then
    raise exception 'followup_request_target_invalid' using errcode = '22023';
  end if;
  insert into public.doctor_followup_request_targets_v1 (branch, target, updated_at, updated_by)
  values (btrim(p_branch), p_target, now(), public.dawaa_current_staff_account_id_strict()::text)
  on conflict (branch) do update
    set target = excluded.target, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
end;
$function$;

revoke all on function public.resolve_followup_request_senders_v1(text[]) from public;
revoke all on function public.link_followup_request_sender_v1(text, uuid) from public;
revoke all on function public.import_doctor_followup_requests_v1(text, jsonb) from public;
revoke all on function public.get_doctor_followup_request_counts_v1(date, date) from public;
revoke all on function public.get_doctor_followup_request_targets_v1() from public;
revoke all on function public.set_doctor_followup_request_target_v1(text, integer) from public;
grant execute on function public.resolve_followup_request_senders_v1(text[]) to anon, authenticated, service_role;
grant execute on function public.link_followup_request_sender_v1(text, uuid) to anon, authenticated, service_role;
grant execute on function public.import_doctor_followup_requests_v1(text, jsonb) to anon, authenticated, service_role;
grant execute on function public.get_doctor_followup_request_counts_v1(date, date) to anon, authenticated, service_role;
grant execute on function public.get_doctor_followup_request_targets_v1() to anon, authenticated, service_role;
grant execute on function public.set_doctor_followup_request_target_v1(text, integer) to anon, authenticated, service_role;
