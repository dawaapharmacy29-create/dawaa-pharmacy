-- Canonical customer-service ownership by branch.
-- الشامي => د/ ضحى
-- شكري  => د/ دنيا

create or replace function public.normalize_customer_service_branch_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_branch text;
  canonical_owner text;
begin
  normalized_branch := trim(coalesce(new.branch, ''));

  if normalized_branch in ('الشامي', 'فرع الشامي', 'شامي') then
    new.branch := 'فرع الشامي';
    canonical_owner := 'د/ ضحى';
  elsif normalized_branch in ('شكري', 'فرع شكري', 'شكرى', 'فرع شكرى') then
    new.branch := 'فرع شكري';
    canonical_owner := 'د/ دنيا';
  else
    return new;
  end if;

  -- The customer-service owner is fixed by branch.
  -- Keep assigned_doctor unchanged because it may hold the doctor who requested the follow-up.
  new.responsible_name := canonical_owner;
  new.assigned_to := canonical_owner;

  return new;
end;
$$;

drop trigger if exists trg_daily_followups_branch_owner on public.daily_followups;
create trigger trg_daily_followups_branch_owner
before insert or update of branch, responsible_name, assigned_to
on public.daily_followups
for each row
execute function public.normalize_customer_service_branch_owner();

-- Clean historical records so reports collapse to the two real customer-service owners.
update public.daily_followups
set
  branch = 'فرع الشامي',
  responsible_name = 'د/ ضحى',
  assigned_to = 'د/ ضحى',
  updated_at = now()
where trim(coalesce(branch, '')) in ('الشامي', 'فرع الشامي', 'شامي')
  and (
    coalesce(responsible_name, '') <> 'د/ ضحى'
    or coalesce(assigned_to, '') <> 'د/ ضحى'
    or branch <> 'فرع الشامي'
  );

update public.daily_followups
set
  branch = 'فرع شكري',
  responsible_name = 'د/ دنيا',
  assigned_to = 'د/ دنيا',
  updated_at = now()
where trim(coalesce(branch, '')) in ('شكري', 'فرع شكري', 'شكرى', 'فرع شكرى')
  and (
    coalesce(responsible_name, '') <> 'د/ دنيا'
    or coalesce(assigned_to, '') <> 'د/ دنيا'
    or branch <> 'فرع شكري'
  );

comment on function public.normalize_customer_service_branch_owner() is
'Enforces canonical customer-service ownership: فرع الشامي = د/ ضحى, فرع شكري = د/ دنيا.';
