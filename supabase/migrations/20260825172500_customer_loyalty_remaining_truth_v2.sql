update public.customer_cashback_cycles
set remaining_value=greatest(0,coalesce(cashback_value,0)-coalesce(redeemed_value,0)),
    updated_at=now()
where (branch='فرع الشامي' and cycle_start='2026-04-01' and cycle_end='2026-07-31')
   or (branch='فرع شكري' and cycle_start='2026-05-01' and cycle_end='2026-07-31');

create or replace function public.dawaa_customer_cashback_remaining_guard_v2()
returns trigger
language plpgsql
set search_path='public'
as $$
begin
  new.remaining_value := greatest(0,coalesce(new.cashback_value,0)-coalesce(new.redeemed_value,0));
  return new;
end;
$$;

drop trigger if exists trg_customer_cashback_remaining_truth_v2 on public.customer_cashback_cycles;
create trigger trg_customer_cashback_remaining_truth_v2
before insert or update of cashback_value,redeemed_value on public.customer_cashback_cycles
for each row execute function public.dawaa_customer_cashback_remaining_guard_v2();

revoke all on function public.dawaa_customer_cashback_remaining_guard_v2() from public,anon,authenticated;

update public.app_role_permissions
set allowed_pages=case
      when not ('/customer-points-ledger'=any(allowed_pages)) then array_append(allowed_pages,'/customer-points-ledger')
      else allowed_pages
    end,
    updated_at=now()
where role_key='pharmacist';
