-- After a refused run of 20261016145000 nothing was granted or created.
do $$
begin
  if has_function_privilege('anon', 'public.decide_overtime_approval_v3(uuid,text,text)', 'execute')
     or to_regprocedure('public.list_stale_overtime_approvals_v1(text,text)') is not null
     or to_regprocedure('public.review_stale_overtime_approval_v1(uuid,text,text,integer,numeric,numeric)') is not null
     or md5(btrim(regexp_replace(pg_get_functiondef('public.payroll_finalization_gate_current_v1(uuid,text)'::regprocedure), '\s+', ' ', 'g')))
        <> '589d42c7e675cb157de9284ea05d0ace' then
    raise exception 'refused overtime review migration still changed objects';
  end if;
end;
$$;
