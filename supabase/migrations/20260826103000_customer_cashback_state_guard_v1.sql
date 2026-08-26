create or replace function public.dawaa_customer_cashback_state_guard_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  old_rank integer;
  new_rank integer;
begin
  old_rank := case coalesce(old.status,'calculated')
    when 'calculated' then 0 when 'notified' then 1 when 'bconnect_updated' then 2
    when 'partially_redeemed' then 3 when 'settled' then 4 else 0 end;
  new_rank := case coalesce(new.status,'calculated')
    when 'calculated' then 0 when 'notified' then 1 when 'bconnect_updated' then 2
    when 'partially_redeemed' then 3 when 'settled' then 4 else old_rank end;

  if new_rank < old_rank then
    new.status := old.status;
  end if;

  if old.notified_at is not null and new.notified_at is distinct from old.notified_at then
    raise exception 'تم تسجيل تبليغ العميل بالفعل';
  end if;
  if old.bconnect_updated_at is not null and new.bconnect_updated_at is distinct from old.bconnect_updated_at then
    raise exception 'تم تسجيل تحديث بي كونكت بالفعل';
  end if;

  if new.redeemed_value is distinct from old.redeemed_value then
    if coalesce(new.redeemed_value,0) < coalesce(old.redeemed_value,0) - 0.009 then
      raise exception 'لا يمكن تقليل المبلغ المسحوب؛ حدّث الصفحة وحاول مرة أخرى';
    end if;
    if abs(coalesce(new.redeemed_value,0)-coalesce(old.redeemed_value,0)) <= 0.009 then
      raise exception 'تم تحديث رصيد العميل بالفعل؛ حدّث الصفحة';
    end if;
    if coalesce(new.redeemed_value,0) > coalesce(new.cashback_value,0) + 0.009 then
      raise exception 'قيمة السحب أكبر من رصيد نقاط العميل';
    end if;
  end if;

  if old.settled_at is not null and new.settled_at is null then new.settled_at := old.settled_at; end if;
  if old.partially_redeemed_at is not null and new.partially_redeemed_at is null then new.partially_redeemed_at := old.partially_redeemed_at; end if;
  return new;
end;
$function$;

drop trigger if exists trg_customer_cashback_state_guard_v1 on public.customer_cashback_cycles;
create trigger trg_customer_cashback_state_guard_v1
before update of status,notified_at,bconnect_updated_at,redeemed_value,settled_at,partially_redeemed_at
on public.customer_cashback_cycles
for each row execute function public.dawaa_customer_cashback_state_guard_v1();
