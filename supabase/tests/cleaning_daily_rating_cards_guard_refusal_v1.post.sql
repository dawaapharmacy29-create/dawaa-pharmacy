-- After the refused 20261016120000: the changed function was left exactly as it was.
do $$
begin
  if position('changed_after_review' in pg_get_functiondef('public.get_cleaning_daily_rating_cards_v2(date,text)'::regprocedure)) = 0 then
    raise exception 'refused migration still replaced get_cleaning_daily_rating_cards_v2';
  end if;
end;
$$;
