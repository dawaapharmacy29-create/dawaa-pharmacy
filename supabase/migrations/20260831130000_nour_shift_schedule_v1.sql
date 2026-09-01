insert into public.shift_schedules (id, staff_name, employee_name, role, branch, day_name, shift_start, shift_end, is_off, staff_id, is_day_off, status, source)
select gen_random_uuid(), 'نور', 'نور', 'assistant', 'فرع الشامي', d.day_name,
       case when d.day_name = 'الجمعة' then null else '10:00:00' end,
       case when d.day_name = 'الجمعة' then null else '18:00:00' end,
       (d.day_name = 'الجمعة'), '82b9c2a1-6139-4b07-9937-ef80a6e926d8', (d.day_name = 'الجمعة'),
       'scheduled', 'manual_entry_2026-08-31'
from (values ('السبت'),('الأحد'),('الاثنين'),('الثلاثاء'),('الأربعاء'),('الخميس'),('الجمعة')) as d(day_name)
where not exists (
  select 1 from public.shift_schedules s
  where s.staff_id = '82b9c2a1-6139-4b07-9937-ef80a6e926d8' and s.day_name = d.day_name
);
