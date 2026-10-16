-- Guard refusal case for 20261016130000: Production's reader changed after review. The migration must refuse.
create or replace function public.get_customer_service_at_risk_completion_v1(p_date date default current_date, p_actor_id uuid default null)
returns table(branch text, at_risk_total integer, at_risk_handled integer)
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $function$ select 'changed_after_review'::text, 0, 0 where false $function$;
