-- A request belongs to the branch whose WhatsApp group it was posted in, not to the doctor's home
-- branch: د/ علا is on «كل الفروع», so her 31 Shamy-group requests counted toward no branch.

alter table public.doctor_followup_request_log_v1 add column if not exists branch text;

-- The two exports saved before this change: «Customer Service shamy branch» is the Shamy group and
-- «Classification, customer service» is the Shokry group (all its doctors are Shokry staff).
update public.doctor_followup_request_log_v1
   set branch = 'فرع الشامي'
 where branch is null and file_name ilike 'Customer Service shamy branch%';
update public.doctor_followup_request_log_v1
   set branch = 'فرع شكري'
 where branch is null and file_name ilike 'Classification, customer service%';

drop function if exists public.import_doctor_followup_requests_v1(text, jsonb);

create or replace function public.import_doctor_followup_requests_v1(p_file_name text, p_rows jsonb, p_branch text default null)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $function$
declare
  v_total integer;
  v_inserted integer := 0;
  v_unmatched jsonb;
  v_branch text := nullif(btrim(p_branch), '');
begin
  if not coalesce(public.dawaa_current_actor_can(array['manage_staff_accounts']), false) then
    raise exception 'followup_requests_not_authorized' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'followup_requests_invalid_rows' using errcode = '22023';
  end if;
  if v_branch is not null and not exists (select 1 from public.staff s where btrim(s.branch) = v_branch) then
    raise exception 'followup_requests_invalid_branch' using errcode = '22023';
  end if;
  v_total := jsonb_array_length(p_rows);

  with rows_in as (
    select r.sender, r.sent_at_local::timestamp as sent_local, coalesce(r.body, '') as body, nullif(btrim(r.staff_id), '') as named
    from jsonb_to_recordset(p_rows) as r(sender text, sent_at_local text, body text, staff_id text)
  ), competition as (
    select c.staff_id from public.get_competition_doctor_accounts_v1() c
  ), matched as (
    select i.sender, i.sent_local, i.body,
           coalesce(
             (select min(x.staff_id::text)::uuid
                from public.staff_identity_aliases x
               where x.active and x.normalized_alias = public.dawaa_normalize_staff_alias_v1(i.sender)
              having count(distinct x.staff_id) = 1),
             (select c.staff_id::uuid from competition c where c.staff_id = i.named)
           ) as staff_id
    from rows_in i
  ), inserted as (
    insert into public.doctor_followup_request_log_v1 (fingerprint, staff_id, sent_at, request_day, sender_name, file_name, imported_by, branch)
    select md5(public.dawaa_normalize_staff_alias_v1(m.sender) || '|' || m.sent_local::text || '|' || regexp_replace(m.body, '\s+', '', 'g')),
           m.staff_id, m.sent_local at time zone 'Africa/Cairo', m.sent_local::date, m.sender, left(p_file_name, 200),
           public.dawaa_current_staff_account_id_strict()::text, v_branch
    from matched m
    where m.staff_id is not null
    on conflict (fingerprint) do nothing
    returning 1
  )
  select (select count(*) from inserted),
         (select coalesce(jsonb_agg(distinct m.sender), '[]'::jsonb) from matched m where m.staff_id is null)
    into v_inserted, v_unmatched;

  return jsonb_build_object('total', v_total, 'inserted', v_inserted, 'unmatched_senders', v_unmatched);
end;
$function$;

revoke all on function public.import_doctor_followup_requests_v1(text, jsonb, text) from public;
grant execute on function public.import_doctor_followup_requests_v1(text, jsonb, text) to anon, authenticated, service_role;

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
  select l.staff_id::text, coalesce(l.branch, s.branch), count(*)
  from public.doctor_followup_request_log_v1 l
  join public.staff s on s.id = l.staff_id
  where l.request_day between p_start and p_end
  group by l.staff_id, coalesce(l.branch, s.branch);
end;
$function$;
