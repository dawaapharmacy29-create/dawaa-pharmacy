-- Backfills two live-only functions that were never committed to migration history
-- (public.list_pending_overtime_v1, public.decide_overtime_approval_v1 on public.staff_overtime_approvals),
-- adds one new read-only function for approved/rejected overtime history, and closes a
-- latent RLS/grant mismatch on the backing table (RLS is enabled with zero policies, which
-- already default-denies anon/authenticated, but the table still carried broad direct
-- GRANTs that do not match this codebase's RPC-only access pattern for tables like this).
--
-- No behavior change to existing functions: bodies below are re-committed verbatim from the
-- live database. This is documentation/reproducibility + a defense-in-depth grant tightening,
-- not a business-logic change.

create or replace function public.list_pending_overtime_v1(p_branch text default null::text)
returns setof staff_overtime_approvals
language sql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select * from public.staff_overtime_approvals
  where status = 'pending'
    and (p_branch is null or branch = p_branch)
    and public.current_user_branch_access_v1(branch, true)
  order by attendance_date desc;
$function$;

create or replace function public.decide_overtime_approval_v1(p_id uuid, p_decision text, p_note text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_can boolean;
  v_actor_name text;
begin
  if p_decision not in ('approved','rejected') then raise exception 'invalid_decision'; end if;
  v_can := public.dawaa_current_actor_can(array['manage_payroll']);
  if not v_can then raise exception 'not_authorized'; end if;

  select coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'email', 'admin') into v_actor_name;

  update public.staff_overtime_approvals
  set status = p_decision, decided_at = now(), decided_by_name = v_actor_name, decision_note = p_note, updated_at = now()
  where id = p_id and status = 'pending';

  if not found then raise exception 'not_found_or_already_decided'; end if;
  return jsonb_build_object('ok', true, 'id', p_id, 'status', p_decision);
end;
$function$;

-- New: read-only approved/rejected overtime history for the manager-facing Overtime tab.
-- Never returns 'pending' rows (that stays list_pending_overtime_v1's job); same branch
-- authorization boundary as the pending list; bounded limit.
create or replace function public.list_overtime_decisions_v1(
  p_branch text default null::text,
  p_status text default null::text,
  p_limit integer default 200
)
returns setof staff_overtime_approvals
language sql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select * from public.staff_overtime_approvals
  where status = coalesce(p_status, status)
    and status in ('approved', 'rejected')
    and (p_branch is null or branch = p_branch)
    and public.current_user_branch_access_v1(branch, true)
  order by decided_at desc nulls last, attendance_date desc
  limit least(coalesce(p_limit, 200), 500);
$function$;

revoke all on table public.staff_overtime_approvals from anon, authenticated;
