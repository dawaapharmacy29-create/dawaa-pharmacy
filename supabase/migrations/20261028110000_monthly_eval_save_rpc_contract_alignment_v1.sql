-- Dawaa staff sessions use an opaque x-dawaa-session-token while the
-- Data API request is made as anon. The SECURITY DEFINER RPC resolves the
-- active staff account, verifies the supplied actor ID, role and branch,
-- and guards final approval. Expose only this RPC, not unrestricted writes.
grant execute on function public.save_staff_monthly_evaluation_v5(uuid, jsonb) to anon;

-- V5 web profile has conversations=20 and sales_quality=10 for doctors,
-- as does the original score-truth trigger. Older DB contract drifted to
-- conversations=15 and sales_quality=15, rejecting every doctor's draft.
-- Change only these verified doctor-specific literals; no row scores change.
do $migration$
declare
  definition text;
begin
  select pg_get_functiondef(
    'public.dawaa_monthly_evaluation_profile_contract_v5(text)'::regprocedure
  ) into definition;

  if definition is null then
    raise exception 'monthly_evaluation_profile_contract_function_missing';
  end if;

  if position('"conversations":20' in definition) > 0
     and position('"sales_quality":10' in definition) > 0 then
    return;
  end if;

  if position('"conversations":15' in definition) = 0
     or position('"sales_quality":15' in definition) = 0 then
    raise exception 'monthly_evaluation_profile_contract_unexpected_shape';
  end if;

  execute replace(
    replace(definition, '"conversations":15', '"conversations":20'),
    '"sales_quality":15', '"sales_quality":10'
  );
end;
$migration$;
