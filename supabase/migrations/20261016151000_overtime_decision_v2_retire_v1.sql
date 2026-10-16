-- Retire the legacy overtime decision RPC so all new manager decisions use the current v3 rule.
-- v2 can approve precomputed pending values without recalculating them from current attendance truth;
-- the active app caller uses decide_overtime_approval_v3 instead.

do $guard$
begin
  if to_regprocedure('public.decide_overtime_approval_v2(uuid,text,text)') is null
     or to_regprocedure('public.decide_overtime_approval_v3(uuid,text,text)') is null then
    raise exception 'overtime decision dependencies are missing';
  end if;

  if md5(btrim(regexp_replace(pg_get_functiondef('public.decide_overtime_approval_v2(uuid,text,text)'::regprocedure), '\s+', ' ', 'g')))
       <> '8ec22d97317f863c6c965c1a88a53b19' then
    raise exception 'decide_overtime_approval_v2 differs from the reviewed legacy definition';
  end if;

  if md5(btrim(regexp_replace(pg_get_functiondef('public.decide_overtime_approval_v3(uuid,text,text)'::regprocedure), '\s+', ' ', 'g')))
       <> '8c739c78aa528c4d704951df5dc19342' then
    raise exception 'decide_overtime_approval_v3 differs from the reviewed current definition';
  end if;

  if not has_function_privilege('anon','public.decide_overtime_approval_v3(uuid,text,text)','EXECUTE')
     or not has_function_privilege('authenticated','public.decide_overtime_approval_v3(uuid,text,text)','EXECUTE')
     or not has_function_privilege('service_role','public.decide_overtime_approval_v3(uuid,text,text)','EXECUTE') then
    raise exception 'current overtime decision path is not fully available';
  end if;
end;
$guard$;

revoke all on function public.decide_overtime_approval_v2(uuid,text,text) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
