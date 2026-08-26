-- Data repair for Points Architecture V3.
-- Backfill only missing cycle labels from the transaction's own business date.

update public.employee_transactions et
set month_cycle = public.dawaa_points_cycle_label_for_date_v3(
      coalesce(et.transaction_date, (et.created_at at time zone 'Africa/Cairo')::date)
    ),
    updated_at = now()
where (et.month_cycle is null or trim(et.month_cycle) = '')
  and coalesce(et.transaction_date, (et.created_at at time zone 'Africa/Cairo')::date) is not null;
