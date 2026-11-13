-- Monthly evaluation v6.9 (owner decision 2026-11-13): "الزي والأذونات والتعليمات" is one item, so the
-- branch manager can also record leaving or arriving without permission ("أذونات", 1 point).
alter table public.staff_compliance_violations drop constraint if exists staff_compliance_violations_category_check;
alter table public.staff_compliance_violations add constraint staff_compliance_violations_category_check
  check (category in ('uniform', 'appearance', 'pconnect', 'instructions', 'permission'));

create or replace function public.record_staff_violation_v1(
  p_staff_account_id uuid, p_category text, p_note text, p_occurred_on date default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.dawaa_current_staff_account_id_strict();
  v_scope text := public.staff_violation_actor_scope_v1();
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_day date := coalesce(p_occurred_on, (now() at time zone 'Africa/Cairo')::date);
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_branch text;
  v_points smallint;
  v_id uuid;
begin
  if v_actor is null or v_scope = 'NONE' then raise exception 'not_authorized' using errcode = '42501'; end if;
  v_points := case p_category when 'uniform' then 1 when 'appearance' then 1 when 'permission' then 1 when 'pconnect' then 2 when 'instructions' then 2 end;
  if v_points is null then raise exception 'invalid_category'; end if;
  if v_note is null then raise exception 'note_required'; end if;
  if v_day > v_today or v_day < v_today - 7 then raise exception 'invalid_day'; end if;
  if p_staff_account_id = v_actor then raise exception 'not_authorized' using errcode = '42501'; end if;

  select public.dawaa_customer_request_branch_key(sa.branch) into v_branch
  from public.staff_accounts sa
  where sa.id = p_staff_account_id and coalesce(sa.active, false);
  if not found then raise exception 'staff_not_found'; end if;
  if v_scope <> 'ALL' and v_branch is distinct from v_scope then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  insert into public.staff_compliance_violations (staff_account_id, branch_key, category, points, occurred_on, note, recorded_by)
  values (p_staff_account_id, v_branch, p_category, v_points, v_day, v_note, v_actor)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'points', v_points);
end;
$function$;
