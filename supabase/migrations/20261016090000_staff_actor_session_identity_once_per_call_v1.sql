-- dawaa_current_staff_account_id_strict: resolve the verified session identity once per call.
--
-- Production smoke after DB-A (2026-10-16): /hr-settings (attendance_policy_shadow_audit_v1), /hr-workforce
-- (hr_workforce_cycle_readiness_v2) and /hr-data-quality (hr_canonical_architecture_health_v1) were cancelled at
-- the 15s anon statement_timeout. Every cancel landed inside dawaa_session_account_id_v1, reached through
-- dawaa_current_staff_account_id_strict from a per-row authorization helper.
--
-- Cause: the request_identity CTE is referenced once, so the planner inlines it and substitutes
-- dawaa_request_staff_identifier() (and through it the session-token lookup) into the per-row filter and sort
-- key of the staff_accounts scan. With a verified session the lookup runs ~3 times per active account row
-- (~120 lookups per call) instead of once. Read-only Production measurement, 20 calls: 10,286 buffers /
-- 103 ms as written; 1,317 buffers / 5.3 ms with the CTE materialized.
--
-- MATERIALIZED evaluates the identity once per call. The function text is otherwise the exact Production
-- definition (2026-10-16, identical to 20260823184500); resolution order, attributes and grants are unchanged.

do $guard$
declare
  v_body text;
begin
  select btrim(regexp_replace(prosrc, '\s+', ' ', 'g')) into v_body
  from pg_proc where oid = to_regprocedure('public.dawaa_current_staff_account_id_strict()');
  if v_body is null then
    raise exception 'dawaa_current_staff_account_id_strict() is missing; refusing to create it here';
  end if;
  if md5(replace(v_body, 'request_identity as materialized (', 'request_identity as (')) <> 'ce2150dbd94109f6861f3e453ebecec0' then
    raise exception 'dawaa_current_staff_account_id_strict() differs from the reviewed definition; regenerate this migration';
  end if;
end;
$guard$;

create or replace function public.dawaa_current_staff_account_id_strict()
returns uuid
language sql
stable security definer
set search_path to 'public','auth','pg_catalog'
as $$
  with request_identity as materialized (
    select public.dawaa_request_staff_identifier() as value
  )
  select coalesce(
    (
      select a.id
      from public.staff_accounts a
      where auth.uid() is not null
        and a.auth_user_id = auth.uid()
        and coalesce(a.active,false)
        and coalesce(a.can_login,false)
      limit 1
    ),
    (
      select a.id
      from public.user_profiles up
      join public.staff_accounts a on a.id = up.staff_account_id
      where auth.uid() is not null
        and up.auth_user_id = auth.uid()
        and coalesce(up.active,false)
        and coalesce(a.active,false)
        and coalesce(a.can_login,false)
      limit 1
    ),
    (
      select a.id
      from public.staff_accounts a, request_identity r
      where r.value is not null
        and coalesce(a.active,false)
        and coalesce(a.can_login,false)
        and (
          a.id::text = r.value
          or a.staff_id::text = r.value
          or lower(trim(coalesce(a.username,''))) = lower(r.value)
        )
      order by
        case
          when a.id::text = r.value then 1
          when a.staff_id::text = r.value then 2
          else 3
        end,
        coalesce(a.updated_at,a.created_at) desc nulls last
      limit 1
    )
  );
$$;

notify pgrst, 'reload schema';
