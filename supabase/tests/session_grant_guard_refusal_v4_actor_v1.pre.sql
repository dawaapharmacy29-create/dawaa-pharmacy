-- Guard refusal case for 20261015140300: the v4 actor resolver no longer uses the verified staff session.
-- The migration must refuse the anon grant (and, being one transaction, leave no v4 function behind).
create or replace function public.employee_operating_actor_id()
returns text language sql stable set search_path to 'public', 'pg_catalog'
as $function$
  select nullif(current_setting('request.jwt.claim.sub', true), '');
$function$;
