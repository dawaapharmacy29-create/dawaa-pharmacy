-- After the refused 20261016090000: the changed helper was left exactly as it was.
do $$
begin
  if position('order by a.created_at' in pg_get_functiondef('public.dawaa_current_staff_account_id_strict()'::regprocedure)) = 0
     or position('materialized' in lower(pg_get_functiondef('public.dawaa_current_staff_account_id_strict()'::regprocedure))) > 0 then
    raise exception 'refused migration still replaced dawaa_current_staff_account_id_strict()';
  end if;
end;
$$;
