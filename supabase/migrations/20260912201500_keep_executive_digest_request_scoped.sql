-- Executive branch cards must be computed in the requesting manager's RLS context.
-- A privileged cron would aggregate rows that the manager should not see and can
-- therefore inflate counts. Keep the RPC request-scoped and remove any old producer.

delete from public.notifications
where dedupe_key like 'executive-branch-digest:%';

do $$
declare j record;
begin
  if exists (select 1 from pg_extension where extname='pg_cron') then
    for j in select jobid from cron.job where jobname='dawaa-executive-notification-digest-v3' loop
      perform cron.unschedule(j.jobid);
    end loop;
  end if;
end $$;

drop function if exists public.refresh_executive_notification_digest_v3();

grant execute on function public.get_executive_notification_branch_cards_v2() to anon, authenticated;
