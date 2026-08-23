alter function public.calculate_weekly_manager_metrics_v5(text,text,date,date) volatile;

create or replace function public.set_current_user_context(p_user_id text default null)
returns jsonb
language sql
volatile
security definer
set search_path = public
as $$
  select jsonb_build_object('success', true, 'user_id', nullif(btrim(coalesce(p_user_id,'')),''));
$$;

revoke all on function public.set_current_user_context(text) from public;
grant execute on function public.set_current_user_context(text) to authenticated;

create view public.app_notifications
with (security_invoker = true)
as select * from public.notifications;

grant select on public.app_notifications to authenticated;
