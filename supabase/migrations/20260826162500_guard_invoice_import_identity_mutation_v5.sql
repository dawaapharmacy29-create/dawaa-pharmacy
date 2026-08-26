create or replace function public.dawaa_guard_invoice_import_identity_mutation_v1()
returns trigger
language plpgsql
set search_path='public','pg_catalog'
as $$
declare
  v_old_day date;
  v_new_day date;
  v_old_number text;
  v_new_number text;
  v_old_branch text;
  v_new_branch text;
begin
  if new.import_batch is not distinct from old.import_batch then
    return new;
  end if;

  v_old_day := (old.invoice_date at time zone 'Africa/Cairo')::date;
  v_new_day := (new.invoice_date at time zone 'Africa/Cairo')::date;
  v_old_number := btrim(coalesce(old.invoice_number,old.invoice_no,''));
  v_new_number := btrim(coalesce(new.invoice_number,new.invoice_no,''));
  v_old_branch := btrim(coalesce(old.branch,''));
  v_new_branch := btrim(coalesce(new.branch,''));

  if v_old_number is distinct from v_new_number
     or v_old_branch is distinct from v_new_branch
     or v_old_day is distinct from v_new_day then
    raise exception using
      errcode='23514',
      message='إعادة الاستيراد لا يمكنها تغيير هوية فاتورة موجودة (رقم + فرع + يوم). راجع الفاتورة كحالة تعارض بدل نقل السجل القديم.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_invoice_import_identity_mutation_v1 on public.sales_invoices;
create trigger trg_guard_invoice_import_identity_mutation_v1
before update of import_batch,branch,invoice_number,invoice_no,invoice_date
on public.sales_invoices
for each row execute function public.dawaa_guard_invoice_import_identity_mutation_v1();
