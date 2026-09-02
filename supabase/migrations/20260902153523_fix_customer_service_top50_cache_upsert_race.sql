create or replace function public.get_customer_service_recent_top50_cached(p_scope text)
returns table(
  customer_rank integer,
  branch text,
  customer_code text,
  customer_name text,
  customer_phone text,
  recent_sales numeric,
  invoice_count bigint,
  active_months integer,
  avg_invoice numeric,
  last_purchase date,
  importance_score numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.customer_service_top50_cache%rowtype;
  v_payload jsonb;
begin
  select *
  into v_row
  from public.customer_service_top50_cache c
  where c.scope = p_scope;

  if v_row.scope is null or v_row.computed_at < now() - interval '2 hours' then
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
    into v_payload
    from public.get_customer_service_recent_top50_core(90, p_scope) t;

    insert into public.customer_service_top50_cache (scope, computed_at, payload)
    values (p_scope, now(), v_payload)
    on conflict (scope) do update
      set computed_at = excluded.computed_at,
          payload = excluded.payload
    returning * into v_row;
  end if;

  return query
  select
    (x->>'customer_rank')::integer,
    x->>'branch',
    x->>'customer_code',
    x->>'customer_name',
    x->>'customer_phone',
    (x->>'recent_sales')::numeric,
    (x->>'invoice_count')::bigint,
    (x->>'active_months')::integer,
    (x->>'avg_invoice')::numeric,
    (x->>'last_purchase')::date,
    (x->>'importance_score')::numeric
  from jsonb_array_elements(v_row.payload) x;
end;
$$;
