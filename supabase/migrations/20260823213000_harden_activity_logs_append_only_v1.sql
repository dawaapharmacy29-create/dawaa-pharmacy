do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname='public' and tablename in ('activity_log','activity_logs')
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

create policy activity_log_select_authorized
on public.activity_log
for select
to public
using (public.dawaa_current_actor_can(array['view_activity_log','view_activity_logs']));

create policy activity_log_insert_active_actor
on public.activity_log
for insert
to public
with check (public.dawaa_current_staff_account_id_strict() is not null);

create policy activity_logs_select_authorized
on public.activity_logs
for select
to public
using (public.dawaa_current_actor_can(array['view_activity_log','view_activity_logs']));

create policy activity_logs_insert_active_actor
on public.activity_logs
for insert
to public
with check (public.dawaa_current_staff_account_id_strict() is not null);

comment on table public.activity_log is
  'Append-only activity audit stream. Client UPDATE/DELETE are intentionally denied by RLS.';
comment on table public.activity_logs is
  'Legacy/secondary append-only activity audit stream. Client UPDATE/DELETE are intentionally denied by RLS.';
