-- Runs on the DELIVERY project (dawaa-delivery-os, qlugjplnnkjzxcbhwopg), not on the pharmacy project.
-- What the general manager's «مراجعتي اليومية» needs from the delivery app, per branch: yesterday's orders and
-- errands (internal_trips, the /admin/trips page), errands still waiting for approval from before today, and
-- orders still «registered» from before today. Guarded by the same vault key as the invoice bridge.
create or replace function public.management_daily_review_snapshot_v1(p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_key text;
  v_today date := (now() at time zone 'Africa/Cairo')::date;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'delivery_invoice_bridge_key';
  if v_key is null or length(coalesce(p_key, '')) < 64 or p_key is distinct from v_key then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'day', v_today,
    'generated_at', now(),
    'branches', (
      select jsonb_agg(jsonb_build_object(
               'branch', b.name,
               'delivered', o.delivered, 'failed', o.failed, 'stuck', o.stuck,
               'errands', t.errands, 'pending_errands', t.pending, 'oldest_pending', t.oldest)
             order by b.ord)
      from (values (1, 'فرع شكري'), (2, 'فرع الشامي')) b(ord, name)
      cross join lateral (
        select count(*) filter (where x.on_day = v_today - 1 and x.status = 'delivered') delivered,
               count(*) filter (where x.on_day = v_today - 1 and x.status = 'failed') failed,
               count(*) filter (where x.on_day < v_today and x.status = 'registered') stuck
        from (select o.status, (o.created_at at time zone 'Africa/Cairo')::date on_day
              from public.delivery_orders o
              where coalesce(o.branch_name, o.branch) = b.name
                and o.created_at >= ((v_today - 7)::timestamp at time zone 'Africa/Cairo')
                and coalesce(o.is_deleted, false) = false and o.deleted_at is null) x
      ) o
      cross join lateral (
        select count(*) filter (where it.trip_date = v_today - 1 and it.status <> 'rejected') errands,
               count(*) filter (where it.status = 'pending_approval' and it.trip_date < v_today) pending,
               min(it.trip_date) filter (where it.status = 'pending_approval' and it.trip_date < v_today) oldest
        from public.internal_trips it
        where it.branch_name = b.name and it.trip_date >= v_today - 30
      ) t
    )
  );
end;
$function$;

revoke all on function public.management_daily_review_snapshot_v1(text) from public;
grant execute on function public.management_daily_review_snapshot_v1(text) to anon, authenticated, service_role;
