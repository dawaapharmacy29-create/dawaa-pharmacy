-- Update shift_schedules table to use staff_id instead of staff_name
-- This ensures proper foreign key relationship with staff table

-- Add staff_id column if it doesn't exist
alter table public.shift_schedules add column if not exists staff_id uuid references public.staff(id) on delete cascade;

-- Add branch_id column if it doesn't exist
alter table public.shift_schedules add column if not exists branch_id text;

-- Add notes column if it doesn't exist
alter table public.shift_schedules add column if not exists notes text;

-- Update existing records to populate staff_id from staff_name
update public.shift_schedules ss
set staff_id = s.id
from public.staff s
where ss.staff_id is null
  and s.name = ss.staff_name
  and s.branch = ss.branch;

-- Make staff_id not nullable after migration
-- Note: This might fail if there are records without matching staff, so we'll keep it nullable for now
-- alter table public.shift_schedules alter column staff_id set not null;

-- Create index on staff_id for performance
create index if not exists shift_schedules_staff_id_idx on public.shift_schedules(staff_id);
create index if not exists shift_schedules_day_of_week_idx on public.shift_schedules(day_name);

-- Add comments
comment on column public.shift_schedules.staff_id is 'Reference to the staff member (primary key)';
comment on column public.shift_schedules.staff_name is 'Legacy field for backward compatibility (use staff_id instead)';
comment on column public.shift_schedules.branch_id is 'Branch identifier';
comment on column public.shift_schedules.notes is 'Additional notes for this schedule';

-- Ensure day_name has proper constraint
alter table public.shift_schedules add constraint if not exists valid_day_name 
check (day_name in ('السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'));
