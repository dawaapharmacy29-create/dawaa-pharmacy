-- A shared account (the branch phone) posts requests for several doctors and names the doctor in
-- the text. The page may now send that doctor's staff_id per row. A sender linked to a doctor still
-- wins, and a named staff_id only counts when it is on the competition list. The fingerprint is
-- unchanged, so rows saved before this are not counted again.
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
    insert into public.doctor_followup_request_log_v1 (fingerprint, staff_id, sent_at, request_day, sender_name, file_name, imported_by)
    select md5(public.dawaa_normalize_staff_alias_v1(m.sender) || '|' || m.sent_local::text || '|' || regexp_replace(m.body, '\s+', '', 'g')),
           m.staff_id, m.sent_local at time zone 'Africa/Cairo', m.sent_local::date, m.sender, left(p_file_name, 200),
           public.dawaa_current_staff_account_id_strict()::text
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
