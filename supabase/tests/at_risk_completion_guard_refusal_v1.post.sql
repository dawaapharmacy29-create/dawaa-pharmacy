-- After the refused 20261016130000: the changed reader was left exactly as it was.
do $$
begin
  if position('changed_after_review' in pg_get_functiondef('public.get_customer_service_at_risk_completion_v1(date,uuid)'::regprocedure)) = 0 then
    raise exception 'refused migration still replaced get_customer_service_at_risk_completion_v1';
  end if;
end;
$$;
