-- Make the quarterly loyalty runner use each setting owner for authorization,
-- then schedule it daily when pg_cron is available.

create or replace function public.run_due_customer_loyalty_cycles(
  p_actor_id text default null,
  p_actor_name text default 'النظام'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  v_done integer := 0;
  v_errors integer := 0;
begin
  for s in
    select id, created_by, created_by_name
    from public.customer_loyalty_settings
    where active
      and calculation_mode = 'automatic'
      and next_due_date <= current_date
  loop
    begin
      perform public.calculate_customer_loyalty_cycle(
        s.id,
        null,
        null,
        null,
        coalesce(p_actor_id, s.created_by),
        coalesce(nullif(p_actor_name, 'النظام'), s.created_by_name, 'النظام')
      );
      v_done := v_done + 1;
    exception when others then
      v_errors := v_errors + 1;
    end;
  end loop;

  return jsonb_build_object('calculated', v_done, 'errors', v_errors);
end;
$$;

grant execute on function public.run_due_customer_loyalty_cycles(text,text) to authenticated;

-- Supabase normally provides pg_cron. The block is intentionally tolerant:
-- if the extension is unavailable, the app button can still run due cycles.
do $$
begin
  begin
    create extension if not exists pg_cron with schema extensions;
  exception when others then
    raise notice 'pg_cron is not available; automatic cycles can still be run from the app.';
  end;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'dawaa-quarterly-customer-loyalty';

    perform cron.schedule(
      'dawaa-quarterly-customer-loyalty',
      '15 2 * * *',
      $cron$select public.run_due_customer_loyalty_cycles(null, 'النظام');$cron$
    );
  end if;
exception when others then
  raise notice 'Could not schedule loyalty cron: %', sqlerrm;
end;
$$;
