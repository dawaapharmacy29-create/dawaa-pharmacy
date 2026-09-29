revoke insert,update,delete,truncate,references,trigger
on table public.shift_schedules
from anon,authenticated;

grant select on table public.shift_schedules to anon,authenticated;
