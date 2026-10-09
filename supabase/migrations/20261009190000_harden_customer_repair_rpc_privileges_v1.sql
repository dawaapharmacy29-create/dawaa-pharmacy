-- Retire browser execution for legacy customer repair routines. The standalone
-- customer-operations bootstrap may have installed the optional routines.
do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'dawaa_best_customer_branch(text)',
    'approve_customer_branch_repair_v14(text,text)',
    'ignore_customer_branch_repair_v14(text,text,text)',
    'update_customer_phone_v14_6(text,text,text)',
    'dawaa_run_customer_operations_autofix(text)',
    'mark_customer_branch_repair_reviewed_v14(text,text)'
  ]
  loop
    if to_regprocedure(format('public.%s', v_signature)) is not null then
      execute format(
        'revoke all on function public.%s from public, anon, authenticated',
        v_signature
      );
    end if;
  end loop;
end;
$$;

do $assert$
declare
  v_signature text;
  v_routine regprocedure;
begin
  foreach v_signature in array array[
    'dawaa_best_customer_branch(text)',
    'approve_customer_branch_repair_v14(text,text)',
    'ignore_customer_branch_repair_v14(text,text,text)',
    'update_customer_phone_v14_6(text,text,text)',
    'dawaa_run_customer_operations_autofix(text)',
    'mark_customer_branch_repair_reviewed_v14(text,text)'
  ]
  loop
    v_routine := to_regprocedure(format('public.%s', v_signature));
    if v_routine is not null and (
      has_function_privilege('anon', v_routine::oid, 'EXECUTE')
      or has_function_privilege('authenticated', v_routine::oid, 'EXECUTE')
    ) then
      raise exception 'customer_repair_rpc_browser_execute_still_granted: %', v_signature;
    end if;
  end loop;
end;
$assert$;
