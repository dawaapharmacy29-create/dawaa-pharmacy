-- Shift handovers: link the person who closed to their staff account by name when the purchasing app
-- sends no staff id (e.g. «محمد عمر», an assistant in فرع الشامي, closes most night and evening shifts
-- and every one of them came with an empty submitted_by_staff_id).
-- The name is read the way the page reads it (personKey in src/lib/shiftHandoverCoverage.ts): no
-- «د» / «د/» / «دكتور», أ/إ/آ → ا, ة → ه, ى → ي. Only one account in the branch may match; an active
-- account wins over a stopped one; with no match in the branch, one in the other branch is used. A staff id sent by the source is never replaced.

create or replace function public.dawaa_person_key_v1(p_name text)
returns text
language sql
immutable
set search_path to 'public', 'pg_catalog'
as $function$
  select nullif(btrim(regexp_replace(
           translate(
             regexp_replace(coalesce(p_name, ''), '^\s*(دكتوره|دكتور|د\.|د)\s*/?\s*', ''),
             'أإآةىـ', 'اااهي'),
           '\s+', ' ', 'g')), '');
$function$;

create or replace function public.shift_handover_closer_staff_v1(p_branch text, p_name text)
returns uuid
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  -- The branch's own accounts first; a doctor who covers the other branch is found there.
  with named as (
    select s.id, s.branch = p_branch as home, coalesce(s.active, s.is_active, true) as live
    from public.staff_accounts s
    where public.dawaa_person_key_v1(coalesce(s.staff_name, s.name)) = public.dawaa_person_key_v1(p_name)
  ),
  m as (
    select * from named where home or not exists (select 1 from named where home)
  )
  select case
    when (select count(*) from m where live) = 1 then (select id from m where live)
    when (select count(*) from m where live) = 0 and (select count(*) from m) = 1 then (select id from m)
  end;
$function$;
revoke all on function public.shift_handover_closer_staff_v1(text, text) from public, anon, authenticated;

create or replace function public.shift_handover_link_closer_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  if new.submitted_by_staff_id is null and new.submitted_by is not null then
    new.submitted_by_staff_id := public.shift_handover_closer_staff_v1(new.branch, new.submitted_by);
  end if;
  return new;
end;
$function$;

drop trigger if exists shift_handover_link_closer on public.shift_handovers;
create trigger shift_handover_link_closer
  before insert or update of submitted_by, submitted_by_staff_id, branch on public.shift_handovers
  for each row execute function public.shift_handover_link_closer_v1();

-- The handovers already synced.
update public.shift_handovers h
   set submitted_by_staff_id = public.shift_handover_closer_staff_v1(h.branch, h.submitted_by)
 where h.submitted_by_staff_id is null and h.submitted_by is not null;
