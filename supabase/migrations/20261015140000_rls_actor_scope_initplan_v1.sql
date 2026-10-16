-- RLS actor scope resolved once per statement (initplan) instead of once per row.
--
-- Production smoke (2026-10-15): every app request runs as `anon` with a verified staff session token
-- and statement_timeout=15s. These SELECT policies called a permission function with row columns as
-- arguments, so the session actor, the staff account row and get_user_permissions() were resolved again
-- for every row (employee_transactions: a VOLATILE function, ~2k rows -> RPCs cancelled at 15s).
--
-- Each policy keeps exactly the same authorization semantics. The actor-only part moves into a STABLE
-- SECURITY DEFINER scope function referenced through scalar sub-selects (planned as InitPlans, evaluated
-- once), and only the cheap row comparison stays per row. The previous row-level helper functions are
-- intentionally left in place: other functions still call them with explicit arguments.

-- ---------------------------------------------------------------------------------------------------
-- employee_transactions — same rules as dawaa_can_read_employee_transaction(staff_id, branch):
--   active+can_login account with view_points; global roles read all; pharmacist reads own staff_id;
--   branch roles read their (trimmed) branch; everyone else reads nothing.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.dawaa_employee_transaction_read_scope_v1()
returns table(read_mode text, own_staff_id text, own_branch text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_account_id uuid;
  v_role text;
  v_branch text;
  v_staff_id text;
  v_permissions jsonb;
begin
  v_account_id := public.dawaa_current_staff_account_id_strict();
  if v_account_id is null then
    return query select 'none'::text, null::text, null::text;
    return;
  end if;

  select lower(trim(coalesce(sa.role,''))), sa.branch, sa.staff_id, public.get_user_permissions(sa.id)
    into v_role, v_branch, v_staff_id, v_permissions
  from public.staff_accounts sa
  where sa.id = v_account_id
    and coalesce(sa.active,false)
    and coalesce(sa.can_login,false)
  limit 1;

  if not found
     or not public.dawaa_jsonb_has_true_any(coalesce(v_permissions,'{}'::jsonb), array['view_points']) then
    return query select 'none'::text, null::text, null::text;
    return;
  end if;

  if v_role in ('general_manager','executive_manager','branches_manager','admin') then
    return query select 'all'::text, null::text, null::text;
  elsif v_role = 'pharmacist' then
    return query select 'own'::text, nullif(trim(coalesce(v_staff_id,'')),''), null::text;
  elsif v_role in ('branch_manager','customer_service_manager','customer_service','shift_supervisor_morning','shift_supervisor_evening') then
    return query select 'branch'::text, null::text, trim(v_branch);
  else
    return query select 'none'::text, null::text, null::text;
  end if;
end;
$function$;

revoke all on function public.dawaa_employee_transaction_read_scope_v1() from public;
grant execute on function public.dawaa_employee_transaction_read_scope_v1() to anon, authenticated, service_role;

alter policy employee_transactions_select_scoped_actor on public.employee_transactions
using (
  (select s.read_mode from public.dawaa_employee_transaction_read_scope_v1() s) = 'all'
  or (
    (select s.read_mode from public.dawaa_employee_transaction_read_scope_v1() s) = 'own'
    and staff_id is not null
    and staff_id::text = (select s.own_staff_id from public.dawaa_employee_transaction_read_scope_v1() s)
  )
  or (
    (select s.read_mode from public.dawaa_employee_transaction_read_scope_v1() s) = 'branch'
    and branch is not null
    and trim(branch) = (select s.own_branch from public.dawaa_employee_transaction_read_scope_v1() s)
  )
);

-- ---------------------------------------------------------------------------------------------------
-- staff_attendance_logs — same rules as dawaa_can_read_staff_attendance_log(staff_id, branch_name):
--   active+can_login account; global roles read all; any role reads its own attendance subject;
--   branch_manager/shift supervisors also read their non-empty (trimmed) branch.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.dawaa_staff_attendance_log_read_scope_v1()
returns table(read_mode text, subject_id uuid, branch_scope text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_account_id uuid;
  v_role text;
  v_branch text;
begin
  v_account_id := public.dawaa_current_staff_account_id_strict();
  if v_account_id is null then
    return query select 'none'::text, null::uuid, null::text;
    return;
  end if;

  select lower(trim(sa.role)), trim(coalesce(sa.branch,''))
    into v_role, v_branch
  from public.staff_accounts sa
  where sa.id = v_account_id and sa.active = true and sa.can_login = true;

  if v_role is null then
    return query select 'none'::text, null::uuid, null::text;
    return;
  end if;

  if v_role in ('general_manager','executive_manager','branches_manager','admin') then
    return query select 'all'::text, null::uuid, null::text;
    return;
  end if;

  return query select
    'scoped'::text,
    public.dawaa_current_attendance_subject_id(),
    case
      when v_role in ('branch_manager','shift_supervisor_morning','shift_supervisor_evening')
       and nullif(v_branch,'') is not null then v_branch
      else null
    end;
end;
$function$;

revoke all on function public.dawaa_staff_attendance_log_read_scope_v1() from public;
grant execute on function public.dawaa_staff_attendance_log_read_scope_v1() to anon, authenticated, service_role;

alter policy staff_attendance_logs_select_scoped on public.staff_attendance_logs
using (
  (select s.read_mode from public.dawaa_staff_attendance_log_read_scope_v1() s) = 'all'
  or (
    (select s.read_mode from public.dawaa_staff_attendance_log_read_scope_v1() s) = 'scoped'
    and (
      (staff_id is not null and staff_id = (select s.subject_id from public.dawaa_staff_attendance_log_read_scope_v1() s))
      or trim(coalesce(branch_name,'')) = (select s.branch_scope from public.dawaa_staff_attendance_log_read_scope_v1() s)
    )
  )
);

-- ---------------------------------------------------------------------------------------------------
-- conversation_sales_reviews — same rules as dawaa_can_read_conversation_review_row_v2(actor, ...):
--   is_current, view_reviews, and an active+can_login actor that is global, the reviewer, the reviewed
--   staff/doctor, or a branch role whose canonical branch key matches the row branch key.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.dawaa_conversation_review_read_scope_v1()
returns table(read_mode text, actor_id uuid, actor_staff_id text, branch_key text)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  with me as (
    select sa.id, sa.staff_id, lower(trim(coalesce(sa.role,''))) as role, sa.branch
    from public.staff_accounts sa
    where sa.id = public.dawaa_current_staff_account_id_strict()
      and coalesce(sa.active,false)
      and coalesce(sa.can_login,false)
    limit 1
  )
  select
    case
      when me.id is null then 'none'
      when me.role in ('general_manager','executive_manager','branches_manager','admin','team_dawaa_alpha') then 'all'
      else 'scoped'
    end,
    me.id,
    me.staff_id,
    case
      when me.role in ('branch_manager','customer_service_manager','customer_service','shift_supervisor_morning','shift_supervisor_evening')
        then public.dawaa_customer_request_branch_key(me.branch)
      else null
    end
  from (select 1) one
  left join me on true
$function$;

revoke all on function public.dawaa_conversation_review_read_scope_v1() from public;
grant execute on function public.dawaa_conversation_review_read_scope_v1() to anon, authenticated, service_role;

alter policy conversation_sales_reviews_select_canonical on public.conversation_sales_reviews
using (
  is_current = true
  and (select public.dawaa_current_actor_can(array['view_reviews']))
  and (
    (select s.read_mode from public.dawaa_conversation_review_read_scope_v1() s) = 'all'
    or (
      (select s.read_mode from public.dawaa_conversation_review_read_scope_v1() s) = 'scoped'
      and (
        reviewer_id = (select s.actor_id from public.dawaa_conversation_review_read_scope_v1() s)
        or staff_id::text = (select s.actor_staff_id from public.dawaa_conversation_review_read_scope_v1() s)
        or doctor_id::text = (select s.actor_staff_id from public.dawaa_conversation_review_read_scope_v1() s)
        or public.dawaa_customer_request_branch_key(branch) = (select s.branch_key from public.dawaa_conversation_review_read_scope_v1() s)
      )
    )
  )
);

-- ---------------------------------------------------------------------------------------------------
-- activity_log — the permission check has no row arguments; wrapping it in a scalar sub-select makes it
-- an InitPlan instead of a per-row call. Semantics are unchanged.
-- ---------------------------------------------------------------------------------------------------
alter policy activity_log_select_authorized on public.activity_log
using ((select public.dawaa_current_actor_can(array['view_activity_log','view_activity_logs'])));

notify pgrst, 'reload schema';
