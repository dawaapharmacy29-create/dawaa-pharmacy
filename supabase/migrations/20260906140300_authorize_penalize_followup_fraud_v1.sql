-- CRITICAL finding: penalize_followup_fraud is a punitive action (cancels a followup
-- and invalidates 3 of the target doctor's oldest quota-counting followups this month,
-- zeroing their points) that was only gated in the UI (isManagerRole(user) hides the
-- button for non-managers in DoctorRequestedFollowups.tsx) -- the SECURITY DEFINER
-- database function itself performed NO authorization check at all, and trusted a
-- client-supplied p_flagged_by string with no link to who actually called it. Any
-- authenticated doctor account could call this RPC directly (bypassing the UI) to
-- cancel a rival doctor's followup quota and damage their monthly incentive, while
-- spoofing the "flagged_by" attribution to look like a manager action.
--
-- Fix: require the caller to actually hold a manager role server-side (mirrors the
-- existing isManagerRole check: general_manager/executive_manager/branches_manager/
-- branch_manager), and derive the "flagged_by" name from the authenticated session
-- instead of trusting the client-supplied parameter.
--
-- APPLIED DIRECTLY TO PRODUCTION on 2026-09-06 via Supabase MCP. This file mirrors
-- that change into version control -- it does not need to be re-applied.

create or replace function public.penalize_followup_fraud(p_followup_id text, p_flagged_by text, p_reason text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_doctor text;
  v_month text := to_char(current_date, 'YYYY-MM');
  v_invalidated integer := 0;
  v_actor_id uuid;
  v_actor_role text;
  v_actor_name text;
begin
  v_actor_id := public.dawaa_current_staff_account_id_strict();
  if v_actor_id is null then
    raise exception using errcode='42501', message='active staff actor required';
  end if;

  select lower(trim(coalesce(sa.role,''))), sa.name
    into v_actor_role, v_actor_name
  from public.staff_accounts sa
  where sa.id = v_actor_id
    and coalesce(sa.active,false)
    and coalesce(sa.can_login,false)
  limit 1;

  if v_actor_role is null or v_actor_role not in ('general_manager','executive_manager','branches_manager','branch_manager','admin') then
    raise exception using errcode='42501', message='manager role required to flag followup fraud';
  end if;

  select assigned_doctor into v_doctor from public.daily_followups where id = p_followup_id;
  if v_doctor is null then
    raise exception 'متابعة غير موجودة أو بدون دكتور مُسند';
  end if;

  update public.daily_followups
  set is_flagged = true, counts_toward_quota = false,
      flag_reason = p_reason, flagged_by = coalesce(v_actor_name, p_flagged_by), flagged_at = now(), points_value = 0
  where id = p_followup_id;

  with oldest as (
    select id from public.daily_followups
    where assigned_doctor = v_doctor
      and to_char(created_at, 'YYYY-MM') = v_month
      and coalesce(counts_toward_quota, true) = true
      and id <> p_followup_id
    order by created_at asc
    limit 3
  )
  update public.daily_followups
  set counts_toward_quota = false, is_flagged = true,
      flag_reason = 'تم إلغاؤها كعقوبة على تلاعب مُثبت في متابعة أخرى',
      flagged_by = coalesce(v_actor_name, p_flagged_by), flagged_at = now(), points_value = 0
  where id in (select id from oldest);
  get diagnostics v_invalidated = row_count;

  return v_invalidated;
end;
$function$;
