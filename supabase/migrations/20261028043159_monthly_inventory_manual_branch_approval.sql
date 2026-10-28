-- Branch managers propose monthly inventory scores in drafts. Only a branches
-- manager (or an executive/administrator) may publish the complete evaluation
-- when an inventory axis is present. Existing audit/snapshot triggers preserve
-- the proposed score, subsequent changes, and the final approved score.

create or replace function public.trg_monthly_inventory_branches_manager_approval_v1()
returns trigger
language plpgsql
security invoker
set search_path = 'public', 'pg_catalog'
as $function$
begin
  if new.status not in ('sent', 'approved') then
    return new;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(new.sections, '[]'::jsonb)) section
    where section->>'key' = 'inventory'
  ) and coalesce(new.evaluator_role,'') in (
    'branch_manager', 'branch_manager_shamy', 'branch_manager_shokry'
  ) then
    raise exception 'monthly_inventory_requires_branches_manager_approval'
      using errcode = '23514',
            detail = 'The branch manager may save a draft; the branches manager must publish the inventory evaluation.';
  end if;

  return new;
end;
$function$;

drop trigger if exists zy_monthly_inventory_branches_manager_approval_v1
  on public.staff_monthly_manager_evaluations;

create trigger zy_monthly_inventory_branches_manager_approval_v1
before insert or update of sections, status, evaluator_role
on public.staff_monthly_manager_evaluations
for each row
execute function public.trg_monthly_inventory_branches_manager_approval_v1();

revoke all on function public.trg_monthly_inventory_branches_manager_approval_v1()
  from public, anon, authenticated;
