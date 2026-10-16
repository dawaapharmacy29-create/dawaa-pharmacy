-- 20261016120000_cleaning_daily_rating_cards_stars_type_v1: the cleaning rating cards load (the Production
-- definition failed with 42804), with the same rows, scope and authorization.
do $$
begin
  if (select error from public.test_before) not like '42804 %' then
    raise exception 'fixture baseline: the Production definition should fail with 42804, got %', (select error from public.test_before);
  end if;
end;
$$;

-- General manager, all branches: both cleaners, rated stars returned as integer, readiness unchanged.
do $$
declare v text;
begin
  perform set_config('test.role', 'general_manager', false);
  perform set_config('test.branch', '', false);
  select string_agg(staff_name || ':' || required_items || '/' || approved_items || ':' || coalesce(stars::text, '-') || ':' || max_stars || ':' || rating_ready, ',' order by staff_name)
    into v from public.get_cleaning_daily_rating_cards_v2('2026-10-16', null);
  if v is distinct from 'A cleaner:2/2:5:5:true,B cleaner:1/0:-:0:false' then raise exception 'general manager cards: %', v; end if;
  if pg_typeof((select stars from public.get_cleaning_daily_rating_cards_v2('2026-10-16', null) where stars is not null limit 1))::text <> 'integer' then
    raise exception 'stars is not integer';
  end if;
end;
$$;

-- Branch manager: own branch only; another branch and other roles are refused as before.
do $$
declare v text;
begin
  perform set_config('test.role', 'branch_manager', false);
  perform set_config('test.branch', 'فرع الشامي', false);
  select string_agg(staff_name, ',') into v from public.get_cleaning_daily_rating_cards_v2('2026-10-16', null);
  if v is distinct from 'B cleaner' then raise exception 'branch manager cards: %', v; end if;
  begin
    perform * from public.get_cleaning_daily_rating_cards_v2('2026-10-16', 'فرع شكري');
    raise exception using errcode = 'P0901', message = 'branch manager read another branch';
  exception
    when sqlstate 'P0901' then raise;
    when others then if sqlerrm <> 'not_authorized_for_branch' then raise; end if;
  end;
  perform set_config('test.role', 'pharmacist', false);
  begin
    perform * from public.get_cleaning_daily_rating_cards_v2('2026-10-16', null);
    raise exception using errcode = 'P0901', message = 'pharmacist read cleaning cards';
  exception
    when sqlstate 'P0901' then raise;
    when others then if sqlerrm <> 'not_authorized' then raise; end if;
  end;
end;
$$;
