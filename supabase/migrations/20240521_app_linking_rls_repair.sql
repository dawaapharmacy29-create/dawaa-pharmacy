-- RLS repair for linked app modules: activity logs, notifications, shifts, customers and stagnant dispense metadata.
-- Date: 2024-05-21

alter table if exists public.stagnant_medicines
  add column if not exists product_code text;

alter table if exists public.stagnant_medicine_dispenses
  add column if not exists customer_name text,
  add column if not exists customer_code text,
  add column if not exists customer_phone text,
  add column if not exists invoice_no text,
  add column if not exists product_code text;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'activity_logs',
    'activity_log',
    'notifications',
    'shift_schedules',
    'shift_exceptions',
    'customers',
    'customer_analysis',
    'stagnant_medicines',
    'stagnant_medicine_dispenses',
    'point_records',
    'points_transactions'
  ]
  loop
    if to_regclass('public.' || table_name) is not null then
      execute format('alter table public.%I enable row level security', table_name);

      execute format('drop policy if exists %I on public.%I', table_name || '_client_read', table_name);
      execute format('drop policy if exists %I on public.%I', table_name || '_client_write', table_name);

      execute format(
        'create policy %I on public.%I for select to anon, authenticated using (true)',
        table_name || '_client_read',
        table_name
      );

      execute format(
        'create policy %I on public.%I for all to anon, authenticated using (true) with check (true)',
        table_name || '_client_write',
        table_name
      );

      execute format('grant select, insert, update, delete on public.%I to anon, authenticated', table_name);
    end if;
  end loop;
end $$;
