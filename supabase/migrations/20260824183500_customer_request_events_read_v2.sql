-- Secure, branch-scoped Customer Request timeline reader.
-- Avoids coupling the V2 drawer to direct customer_request_events RLS behavior.

create or replace function public.get_customer_request_events_v2(p_request_id uuid)
returns setof public.customer_request_events
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_branch text;
begin
  select cr.branch
    into v_branch
  from public.customer_requests cr
  where cr.id=p_request_id;

  if not found then
    raise exception 'customer_request_not_found';
  end if;

  if not public.dawaa_can_access_customer_request_branch('view_customer_requests',v_branch) then
    raise exception 'customer_request_view_forbidden';
  end if;

  return query
  select e.*
  from public.customer_request_events e
  where e.request_id=p_request_id
  order by e.created_at desc nulls last,e.id desc;
end;
$$;

revoke all on function public.get_customer_request_events_v2(uuid) from public;
grant execute on function public.get_customer_request_events_v2(uuid)
  to anon, authenticated, service_role;

comment on function public.get_customer_request_events_v2(uuid) is
  'Branch-authorized Customer Request timeline reader for the canonical V2 workspace.';
