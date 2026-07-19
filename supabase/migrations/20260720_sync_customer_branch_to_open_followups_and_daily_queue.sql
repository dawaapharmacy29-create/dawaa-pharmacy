create or replace function public.sync_customer_branch_to_open_followups_and_daily_queue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.branch is distinct from old.branch
     and nullif(trim(coalesce(new.branch, '')), '') is not null then
    update public.daily_followups
       set branch = new.branch,
           updated_at = now(),
           updated_by = coalesce(updated_by, 'customer_branch_sync')
     where customer_id = new.id::text
       and completed_at is null
       and cancelled_at is null
       and archived_at is null;

    update public.customer_service_daily_queue_items
       set branch = new.branch,
           metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
             'canonicalBranch', new.branch,
             'branchSyncedAt', now(),
             'branchSyncSource', 'customers.branch'
           )
     where customer_id = new.id::text
       and queue_date >= (now() at time zone 'Africa/Cairo')::date
       and status <> 'completed';
  end if;

  return new;
end;
$$;

revoke all on function public.sync_customer_branch_to_open_followups_and_daily_queue()
from public, anon, authenticated;

drop trigger if exists trg_sync_customer_branch_to_followups on public.customers;
create trigger trg_sync_customer_branch_to_followups
after update of branch on public.customers
for each row
execute function public.sync_customer_branch_to_open_followups_and_daily_queue();
