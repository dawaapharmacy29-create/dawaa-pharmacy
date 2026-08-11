-- Enforce branch scope inside every customer-intelligence read/write path.
create or replace function public.dawaa_can_access_customer_intelligence_branch(p_branch text)
returns boolean
language sql stable security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.staff_accounts a
    where a.id=public.dawaa_current_staff_account_id_strict()
      and coalesce(a.active,false) and coalesce(a.can_login,false)
      and (
        lower(coalesce(a.role,'')) in ('admin','owner','general_manager','executive_manager','branches_manager','manager')
        or (
          lower(coalesce(a.role,'')) in ('customer_service_manager','customer_service')
          and lower(btrim(coalesce(a.branch,'')))=lower(btrim(coalesce(p_branch,'')))
        )
      )
  )
$$;
revoke all on function public.dawaa_can_access_customer_intelligence_branch(text) from public;
grant execute on function public.dawaa_can_access_customer_intelligence_branch(text) to anon,authenticated;

drop policy if exists customer_service_watchlist_read on public.customer_service_watchlist;
create policy customer_service_watchlist_read on public.customer_service_watchlist
  for select to anon,authenticated
  using (public.dawaa_can_access_customer_intelligence_branch(branch));
drop policy if exists customer_service_watchlist_write on public.customer_service_watchlist;
create policy customer_service_watchlist_write on public.customer_service_watchlist
  for all to anon,authenticated
  using (public.dawaa_can_access_customer_intelligence_branch(branch))
  with check (public.dawaa_can_access_customer_intelligence_branch(branch));

-- Patch the three privileged RPCs in-place with a mandatory branch guard.
create or replace function public.dawaa_assert_customer_intelligence_branch(p_branch text)
returns void language plpgsql stable security definer
set search_path=public,pg_catalog
as $$
begin
  if nullif(btrim(p_branch),'') is null or not public.dawaa_can_access_customer_intelligence_branch(p_branch) then
    raise exception 'not authorized for this customer intelligence branch';
  end if;
end;
$$;
revoke all on function public.dawaa_assert_customer_intelligence_branch(text) from public;

-- Add the guard at the first PL/pgSQL BEGIN in each existing RPC while preserving its tested body.
do $$
declare v_def text; v_name text;
begin
  foreach v_name in array array[
    'get_customer_service_cycle_cohorts',
    'get_customer_service_watchlist_performance',
    'replace_customer_service_watchlist'
  ] loop
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=v_name order by p.oid desc limit 1;
    if v_def is null then raise exception 'missing required RPC: %',v_name; end if;
    if position('perform public.dawaa_assert_customer_intelligence_branch(p_branch);' in v_def)=0 then
      v_def:=regexp_replace(
        v_def,
        E'\nbegin\n',
        E'\nbegin\n  perform public.dawaa_assert_customer_intelligence_branch(p_branch);\n'
      );
      if position('perform public.dawaa_assert_customer_intelligence_branch(p_branch);' in v_def)=0 then
        raise exception 'could not harden RPC: %',v_name;
      end if;
      execute v_def;
    end if;
  end loop;
end;
$$;
