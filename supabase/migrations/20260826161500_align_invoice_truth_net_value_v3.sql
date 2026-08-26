create or replace function public.dawaa_invoice_import_truth_check_v1(p_start_date date, p_end_date date)
returns table(metric text, value numeric, notes text)
language sql
security definer
set search_path='public','pg_catalog'
as $$
  with cycle as (
    select * from public.sales_invoices
    where coalesce(sale_date,invoice_date::date) between p_start_date and p_end_date
  ), dup as (
    select branch,invoice_date::date sale_day,btrim(invoice_number) invoice_number,count(*) c
    from cycle where nullif(btrim(coalesce(invoice_number,'')),'') is not null
    group by branch,invoice_date::date,btrim(invoice_number) having count(*)>1
  )
  select 'invoices_count',count(*)::numeric,'عدد الفواتير الخام في sales_invoices' from cycle
  union all select 'net_total',coalesce(sum(coalesce(nullif(net_amount,0),nullif(net_total,0),nullif(total_amount,0),nullif(amount,0),nullif(discounted_amount,0),0)),0)::numeric,'صافي المبيعات المعتمد بدون استخدام Gross كبديل للصافي' from cycle
  union all select 'duplicate_identity_groups',count(*)::numeric,'مجموعات مكررة حسب رقم الفاتورة + الفرع + اليوم' from dup
  union all select 'duplicate_extra_rows',coalesce(sum(c-1),0)::numeric,'عدد الصفوف الزائدة داخل مجموعات التكرار' from dup
  union all select 'invoice_number_alias_mismatch',count(*)::numeric,'صفوف invoice_no لا يطابق invoice_number' from cycle where invoice_number is not null and invoice_no is not null and btrim(invoice_number)<>btrim(invoice_no)
  union all select 'missing_invoice_number',count(*)::numeric,'فواتير بدون رقم فاتورة' from cycle where nullif(btrim(coalesce(invoice_number,'')),'') is null
  union all select 'without_customer',count(*)::numeric,'فواتير بدون كود واسم عميل' from cycle where coalesce(customer_code,'')='' and coalesce(customer_name,'')=''
  union all select 'without_doctor',count(*)::numeric,'فواتير بدون دكتور أو staff_id' from cycle where coalesce(staff_id,'')='' and coalesce(seller_name,'')=''
  union all select 'without_branch',count(*)::numeric,'فواتير بدون فرع' from cycle where coalesce(branch,'')=''
  union all select 'noncanonical_branch',count(*)::numeric,'فواتير بفرع غير فرع شكري/فرع الشامي' from cycle where coalesce(branch,'') not in ('فرع شكري','فرع الشامي')
  union all select 'pending_not_finalized',count(*)::numeric,'فواتير معلقة/غير نهائية لا تدخل الحقيقة النظيفة' from cycle where lower(coalesce(save_status,'')) ~ '(معلق|قيد|pending|draft|غير محفوظ)' or lower(coalesce(invoice_type,'')) ~ '(معلق|pending|draft)'
  union all select 'gross_only_suspicious',count(*)::numeric,'فواتير صافيها صفر/فارغ لكن Gross موجب — تحتاج مراجعة ولا تضاف للصافي تلقائيًا' from cycle where coalesce(nullif(net_amount,0),nullif(net_total,0),nullif(total_amount,0),nullif(amount,0),nullif(discounted_amount,0)) is null and coalesce(nullif(gross_amount,0),nullif(gross_total,0),0)>0;
$$;

revoke all on function public.dawaa_invoice_import_truth_check_v1(date,date) from public;
grant execute on function public.dawaa_invoice_import_truth_check_v1(date,date) to anon,authenticated,service_role;
