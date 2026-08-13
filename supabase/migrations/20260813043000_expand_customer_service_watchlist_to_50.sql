-- Expand the customer service watchlist from 20 to 50 customers.
CREATE OR REPLACE FUNCTION public.replace_customer_service_watchlist(p_branch text, p_customers jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_actor uuid := public.dawaa_current_staff_account_id_strict();
  v_count integer;
begin
  perform public.dawaa_assert_customer_intelligence_branch(p_branch);
  if not public.dawaa_can_manage_customer_intelligence() then
    raise exception 'not authorized to manage customer watchlist';
  end if;
  if nullif(btrim(p_branch), '') is null or jsonb_typeof(p_customers) <> 'array' then
    raise exception 'branch and customer array are required';
  end if;
  v_count := jsonb_array_length(p_customers);
  if v_count < 1 or v_count > 50 then
    raise exception 'watchlist must contain between 1 and 50 customers';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_customers) item
    where nullif(btrim(item->>'customer_code'), '') is null
  ) then
    raise exception 'every watchlist customer requires a customer code';
  end if;
  if (select count(distinct btrim(item->>'customer_code')) from jsonb_array_elements(p_customers) item) <> v_count then
    raise exception 'duplicate customer codes are not allowed';
  end if;

  update public.customer_service_watchlist
    set active = false, updated_at = now()
    where branch = p_branch and active;

  insert into public.customer_service_watchlist
    (branch, customer_code, customer_name, phone, rank, note, active, added_by, updated_at)
  select p_branch, btrim(item->>'customer_code'), nullif(btrim(item->>'customer_name'), ''),
    nullif(btrim(item->>'phone'), ''), ordinal::integer, nullif(btrim(item->>'note'), ''), true, v_actor, now()
  from jsonb_array_elements(p_customers) with ordinality as rows(item, ordinal)
  on conflict (branch, customer_code) do update set
    customer_name = excluded.customer_name,
    phone = excluded.phone,
    rank = excluded.rank,
    note = excluded.note,
    active = true,
    added_by = excluded.added_by,
    updated_at = now();
  return v_count;
end;
$function$;
