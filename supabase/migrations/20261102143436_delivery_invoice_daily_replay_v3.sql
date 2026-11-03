-- Source changes run immediately after the quiet window. Catch-up without a new file is daily to avoid repeated whole-cycle snapshots.
-- Match getInvoiceNetValue in the canonical management invoice reader: first nonzero stored value, never a maximum.
create or replace function public.claim_delivery_invoice_export_v1() returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.delivery_invoice_export_jobs; rows jsonb; v_lease uuid := gen_random_uuid();
begin
 select * into j from public.delivery_invoice_export_jobs
 where period_start=public.delivery_invoice_open_cycle_v1() and due_at<=now()
 and (lease_until is null or lease_until<now())
 and (revision>processed_revision or last_success_at<now()-interval '1 day')
 order by due_at limit 1 for update skip locked;
 if not found then return null; end if;
 if (select count(*) from public.sales_invoices where sale_date>=j.period_start and sale_date<(j.period_start+interval '1 month')::date)>30000 then
  raise exception 'delivery_export_cycle_too_large'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
 'source_id',s.id,'invoice_number',coalesce(nullif(s.invoice_number,''),s.invoice_no),
 'branch_name',coalesce(nullif(s.branch_name,''),s.branch),'invoice_date',s.sale_date,
 'invoice_type',s.invoice_type,'customer_code',s.customer_code,'customer_name',s.customer_name,
 'customer_phone',s.customer_phone,'net_total',coalesce(nullif(s.net_total,0),nullif(s.net_amount,0),nullif(s.discounted_amount,0),nullif(s.total_amount,0),nullif(s.amount,0),nullif(s.gross_total,0),s.gross_amount),
 'gross_total',coalesce(nullif(s.gross_total,0),nullif(s.gross_amount,0),s.amount),'delivery_address',s.delivery_address,
 'system_user_name',s.seller_name) order by s.id),'[]') into rows
 from public.sales_invoices s where s.sale_date>=j.period_start and s.sale_date<(j.period_start+interval '1 month')::date
 and s.import_validation_status='valid' and s.save_status='تم حفظها';
 update public.delivery_invoice_export_jobs set lease_id=v_lease,lease_until=now()+interval '5 minutes' where period_start=j.period_start;
 return jsonb_build_object('period_start',j.period_start,'period_end',(j.period_start+interval '1 month'-interval '1 day')::date,
 'revision',j.revision,'lease_id',v_lease,'rows',rows);
end; $$;
revoke all on function public.claim_delivery_invoice_export_v1() from public,anon,authenticated;
grant execute on function public.claim_delivery_invoice_export_v1() to service_role;

