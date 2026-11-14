-- Fix of 20261114120000: the purchasing app's submitted_by_staff_id is a public.staff id (the one the
-- punches use), not a staff_accounts id. That migration matched names against staff_accounts and put
-- account ids on 103 handovers; they are matched again here against public.staff.
-- Also: closers whose name in the purchasing app is not their full name are linked by hand
-- (shift_handover_closer_aliases_v1), owner decision 2026-11-14:
--   «د اسلام» (شكري) = د اسلام فاروق · «د عليا» (الشامي) = د/ علياء · «ا عبد الحميد» (شكري) = ا عبد الحميد.
-- «د حسن» left and stays unlinked.

create table if not exists public.shift_handover_closer_aliases_v1 (
  branch text not null,
  name_key text not null,
  staff_id uuid not null references public.staff(id),
  note text,
  created_at timestamptz not null default now(),
  primary key (branch, name_key)
);
alter table public.shift_handover_closer_aliases_v1 enable row level security;

insert into public.shift_handover_closer_aliases_v1 (branch, name_key, staff_id, note) values
  ('فرع شكري', public.dawaa_person_key_v1('د اسلام'), '3b2f682d-be41-4374-a0b8-25411ee6e8d3', 'د اسلام فاروق'),
  ('فرع الشامي', public.dawaa_person_key_v1('د عليا'), '43c5a028-9fcc-419b-8453-2ae0b43a9707', 'د/ علياء سامي'),
  ('فرع شكري', public.dawaa_person_key_v1('ا عبد الحميد'), '8a926517-39ba-4162-8832-a877dfd44456', 'مساعد فرع شكري')
on conflict (branch, name_key) do update set staff_id = excluded.staff_id, note = excluded.note;

create or replace function public.shift_handover_closer_staff_v1(p_branch text, p_name text)
returns uuid
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  -- A hand-made link first; then the branch's own staff, then the other branch's. Merged duplicate
  -- records never match. Only one person may match; an active one wins over a stopped one.
  with alias as (
    select a.staff_id from public.shift_handover_closer_aliases_v1 a
    where a.branch = p_branch and a.name_key = public.dawaa_person_key_v1(p_name)
  ),
  named as (
    select s.id, s.branch = p_branch as home, coalesce(s.active, s.is_active, true) as live
    from public.staff s
    where public.dawaa_person_key_v1(s.name) = public.dawaa_person_key_v1(p_name)
      and s.name not like '%سجل مكرر%'
  ),
  m as (
    select * from named where home or not exists (select 1 from named where home)
  )
  select coalesce(
    (select staff_id from alias),
    case
      when (select count(*) from m where live) = 1 then (select id from m where live)
      when (select count(*) from m where live) = 0 and (select count(*) from m) = 1 then (select id from m)
    end);
$function$;
revoke all on function public.shift_handover_closer_staff_v1(text, text) from public, anon, authenticated;

-- The handovers linked to an account id, and those still unlinked.
update public.shift_handovers h
   set submitted_by_staff_id = public.shift_handover_closer_staff_v1(h.branch, h.submitted_by)
 where h.submitted_by is not null
   and (h.submitted_by_staff_id is null
        or not exists (select 1 from public.staff s where s.id = h.submitted_by_staff_id));
