-- Guard refusal case for 20261016090000: Production's dawaa_current_staff_account_id_strict() changed after review
-- (here: a different account ordering). The migration must refuse to overwrite it.
create or replace function public.dawaa_current_staff_account_id_strict()
returns uuid language sql stable security definer set search_path to 'public','auth','pg_catalog'
as $$
  with request_identity as (
    select public.dawaa_request_staff_identifier() as value
  )
  select a.id
  from public.staff_accounts a, request_identity r
  where r.value is not null and coalesce(a.active,false) and coalesce(a.can_login,false) and a.id::text = r.value
  order by a.created_at
  limit 1;
$$;
