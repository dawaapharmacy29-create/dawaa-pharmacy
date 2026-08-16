create or replace function public.dawaa_invoice_post_import_refresh_v1(p_start_date date,p_end_date date)
returns text
language plpgsql security definer set search_path='public','auth','extensions','pg_temp' as $$
declare
 v_linked integer:=0; v_raw_count integer:=0; v_clean_count integer:=0; v_excluded integer:=0; v_pending integer:=0;
 v_without_customer integer:=0; v_without_doctor integer:=0; v_without_branch integer:=0; v_clean_total numeric:=0;
begin
 perform set_config('statement_timeout','45000',true);
 v_linked:=public.dawaa_backfill_invoice_staff_links_v1(p_start_date,p_end_date);
 refresh materialized view public.staff_sales_summary;

 select count(*)::integer,
        count(*) filter(where public.dawaa_is_sales_target_excluded_customer_v1(branch,customer_code))::integer,
        count(*) filter(where lower(coalesce(save_status,'')) ~ '(معلق|قيد|pending|draft|غير محفوظ)' or lower(coalesce(invoice_type,'')) ~ '(معلق|pending|draft)')::integer,
        count(*) filter(where coalesce(customer_code,'')='' and coalesce(customer_name,'')='')::integer,
        count(*) filter(where coalesce(staff_id,'')='' and coalesce(seller_name,'')='')::integer,
        count(*) filter(where coalesce(branch,'')='')::integer
 into v_raw_count,v_excluded,v_pending,v_without_customer,v_without_doctor,v_without_branch
 from public.sales_invoices
 where coalesce(invoice_date::date,sale_date,created_at::date) between p_start_date and p_end_date;

 select count(*)::integer,coalesce(sum(coalesce(net_total,net_amount,discounted_amount,total_amount,amount,0)),0)
 into v_clean_count,v_clean_total
 from public.dawaa_sales_invoices_dashboard_v1
 where coalesce(invoice_date::date,sale_date,created_at::date) between p_start_date and p_end_date;

 insert into public.invoice_import_health_log(refresh_start,refresh_end,invoices_count,invoices_without_customer,invoices_without_doctor,invoices_without_branch,linked_staff_count,total_net,status,notes)
 values(p_start_date,p_end_date,v_clean_count,v_without_customer,v_without_doctor,v_without_branch,v_linked,v_clean_total,'done',
        format('raw=%s; clean=%s; excluded_internal=%s; pending=%s; staff_sales_summary refreshed from canonical clean truth',v_raw_count,v_clean_count,v_excluded,v_pending));
 perform pg_notify('pgrst','reload schema');
 return format('تم تحديث التحليلات النظيفة: خام %s، صافي %s، أكواد داخلية مستبعدة %s، معلقة %s، صافي مبيعات %s، وربط دكاترة %s',v_raw_count,v_clean_count,v_excluded,v_pending,v_clean_total,v_linked);
end; $$;
