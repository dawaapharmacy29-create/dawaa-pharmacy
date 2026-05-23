-- Keep default branch targets limited to Shokry and El-Shamy.
-- Extra branches can still be added later from the analytics page.

delete from public.branch_sales_targets
where branch_name in ('فرع أبو العزم', 'فرع ابو العزم', 'أبو العزم', 'ابو العزم')
  and coalesce(active, true) = true;

insert into public.branch_sales_targets (branch_name, cycle_start_day, target_amount, active)
values
  ('فرع الشامي', 26, 1000000, true),
  ('فرع شكري', 26, 1500000, true)
on conflict (branch_name) do update
set
  cycle_start_day = excluded.cycle_start_day,
  target_amount = excluded.target_amount,
  active = true,
  updated_at = now();
