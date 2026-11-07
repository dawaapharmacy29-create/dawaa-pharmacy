-- Owner decision 2026-11-07: every assistant sees their own schedule and their own points.
-- Own only: hr_canonical_schedule_week_v2 already returns just the caller's rows for these roles, and the read
-- scope below gives them 'own' on employee_transactions. An explicit false on the account still wins.
-- Team Dawaa Alpha already holds view_points but had read scope 'none', so their page stayed empty.
do $migration$
declare
  v_before text;
  v_after text;
begin
  v_before := pg_get_functiondef('public.get_user_permissions(uuid)'::regprocedure);
  v_after := replace(
    v_before,
    $q$elsif v_role_key in ('customer_service_manager','customer_service','pharmacist','team_dawaa_alpha') then v_can_view_points := true;$q$,
    $q$elsif v_role_key in ('customer_service_manager','customer_service','pharmacist','team_dawaa_alpha','assistant','مساعد') then v_can_view_points := true;$q$
  );
  if v_after = v_before then
    raise exception 'get_user_permissions: view_points branch not found';
  end if;
  v_before := v_after;
  v_after := replace(
    v_before,
    $q$  return v_effective;
end;$q$,
    $q$  if v_role_key in ('assistant','مساعد') then
    v_effective := jsonb_set(v_effective, '{view_schedule}', to_jsonb(coalesce(nullif(v_account_permissions->>'view_schedule','')::boolean, true) and coalesce(nullif(v_override_json->>'view_schedule','')::boolean, true)), true);
  end if;

  return v_effective;
end;$q$
  );
  if v_after = v_before then
    raise exception 'get_user_permissions: return not found';
  end if;
  execute v_after;

  v_before := pg_get_functiondef('public.dawaa_employee_transaction_read_scope_v1()'::regprocedure);
  v_after := replace(
    v_before,
    $q$elsif v_role = 'pharmacist' then$q$,
    $q$elsif v_role in ('pharmacist','assistant','مساعد','team_dawaa_alpha') then$q$
  );
  if v_after = v_before then
    raise exception 'dawaa_employee_transaction_read_scope_v1: pharmacist branch not found';
  end if;
  execute v_after;
end;
$migration$;
