-- Correct the v1 seed so newly-requested assistant responsibilities are never
-- assigned to every assistant by role. Ownership must be explicit per employee.

begin;

-- Remove only the newly introduced assistant responsibility definitions from the
-- role-backfill assignments created by the immediately preceding migration.
delete from public.staff_daily_checklist_assignments a
using public.staff_daily_checklist_items i
where i.id = a.item_id
  and i.item_key in (
    'shelf_tablets',
    'shelf_lab_supplies',
    'shelf_accessories',
    'weekly_inventory_list'
  );

-- The two cleaning responsibility holders are explicit and branch-specific.
-- Ensure the new cleaning definitions are assigned to exactly those canonical staff rows.
insert into public.staff_daily_checklist_assignments(
  item_id,staff_id,branch,cadence,weekday,active_from,active
)
select i.id,s.id,s.branch,'daily',null,(timezone('Africa/Cairo',now()))::date,true
from public.staff_daily_checklist_items i
join public.staff s on s.id in (
  '1bd09898-eb99-4c25-b6b3-4c25f109abf9'::uuid, -- أ/ هبه — فرع شكري
  'c628ac45-f4f5-410f-a124-ebfa761356c4'::uuid  -- حبيبه — فرع الشامي
)
where i.item_key in ('clean_door_entry','clean_signage')
  and i.active = true
  and coalesce(s.active,true) = true
on conflict do nothing;

commit;
