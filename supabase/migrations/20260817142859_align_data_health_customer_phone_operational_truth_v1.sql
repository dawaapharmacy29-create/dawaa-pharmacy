begin;

create or replace function public.compute_app_data_health_v2()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v jsonb;
  v_cycle_start date;
  v_cycle_end date;
begin
  v_cycle_start := case when extract(day from current_date) >= 26
    then make_date(extract(year from current_date)::int, extract(month from current_date)::int, 26)
    else (date_trunc('month', current_date)::date - interval '1 month')::date + 25
  end;
  v_cycle_end := (v_cycle_start + interval '1 month' - interval '1 day')::date;

  select jsonb_build_object(
    'invoices_without_customer', (
      select count(*) from sales_invoices
      where coalesce(trim(customer_code),'')=''
        and coalesce(trim(customer_phone),'')=''
        and coalesce(trim(customer_name),'')=''
    ),
    'unregistered_customer_invoices', (
      select count(*) from sales_invoices where customer_name ilike '%عميل غير مسجل%'
    ),
    'pharmacy_customer_invoices', (
      select count(*) from sales_invoices where customer_name ilike '%عميل الصيدلية%'
    ),
    'invoices_without_doctor', (
      select count(*) from sales_invoices where coalesce(trim(seller_name),'')=''
    ),
    'cycle_invoices_without_doctor', (
      select count(*) from dawaa_sales_invoices_dashboard_v1
      where invoice_date::date between v_cycle_start and least(v_cycle_end,current_date)
        and coalesce(trim(seller_name),'')=''
    ),
    'invoices_without_branch', (
      select count(*) from sales_invoices where coalesce(trim(branch),'')=''
    ),
    'invoice_volume', (
      select count(*) from sales_invoices where invoice_no is not null or invoice_number is not null
    ),
    'cycle_invoice_volume', (
      select count(*) from dawaa_sales_invoices_dashboard_v1
      where invoice_date::date between v_cycle_start and least(v_cycle_end,current_date)
    ),
    'duplicate_invoice_groups', (
      select count(*) from (
        select branch, invoice_date::date,
               coalesce(nullif(trim(invoice_no),''),nullif(trim(invoice_number),'')) k
        from sales_invoices
        where coalesce(nullif(trim(invoice_no),''),nullif(trim(invoice_number),'')) is not null
        group by 1,2,3 having count(*)>1
      ) d
    ),
    'invalid_customer_phones', (
      select count(*) from dawaa_customer_metrics_app_view
      where coalesce(trim(customer_phone),'')='' or customer_phone ilike 'code:%'
    ),
    'customers_without_branch', (
      select count(*) from dawaa_customer_metrics_app_view where coalesce(trim(branch),'')=''
    ),
    'master_customers_without_branch', (
      select count(*) from customers where coalesce(trim(branch),'')=''
    ),
    'customers_without_phone', (
      select count(*) from dawaa_customer_metrics_app_view where coalesce(trim(customer_phone),'')=''
    ),
    'master_customers_without_phone', (
      select count(*) from customers where coalesce(trim(phone),'')=''
    ),
    'inactive_staff', (
      select count(*) from staff where coalesce(active,is_active,true)=false
    ),
    'points_without_staff', (
      select count(*) from employee_transactions where staff_id is null
    ),
    'accounts_without_staff', (
      select count(*) from staff_accounts sa
      where coalesce(sa.active,false)=true and coalesce(sa.can_login,false)=true
        and coalesce(sa.role,'') not in ('general_manager','delivery')
        and (coalesce(trim(sa.staff_id),'')='' or not exists (
          select 1 from staff s where s.id::text=trim(sa.staff_id)
        ))
    ),
    'legacy_inactive_accounts', (
      select count(*) from staff_accounts sa
      where coalesce(sa.active,false)=false and coalesce(sa.can_login,false)=false
        and (coalesce(trim(sa.staff_id),'')='' or not exists (
          select 1 from staff s where s.id::text=trim(sa.staff_id)
        ))
    ),
    'reviews_without_points', (
      select count(*) from conversation_sales_reviews r
      where r.impact_status='pending'
        and not exists (select 1 from employee_transactions et where et.source_id=r.id)
    ),
    'pending_review_approvals', (
      select count(*) from conversation_sales_reviews r
      where r.impact_status='pending'
        and exists (
          select 1 from employee_transactions et
          where et.source_id=r.id and coalesce(et.status,'pending')='pending'
        )
    ),
    'open_customer_requests', (
      select count(*) from customer_requests
      where lower(coalesce(status,'new')) not in ('closed','delivered','cancelled','not_available')
    ),
    'overdue_customer_requests', (
      select count(*) from customer_requests
      where lower(coalesce(status,'new')) not in ('closed','delivered','cancelled','not_available')
        and coalesce(due_date,needed_by_date) < current_date
    ),
    'unassigned_customer_requests', (
      select count(*) from customer_requests
      where lower(coalesce(status,'new')) not in ('closed','delivered','cancelled','not_available')
        and assigned_to is null and primary_responsible_id is null
    ),
    'customer_requests_without_branch', (
      select count(*) from customer_requests
      where lower(coalesce(status,'new')) not in ('closed','delivered','cancelled','not_available')
        and coalesce(trim(branch),'')=''
    ),
    'unresolved_request_sync_conflicts', (
      select count(*) from customer_requests
      where lower(coalesce(status,'new')) not in ('closed','delivered','cancelled','not_available')
        and coalesce(sync_conflict,false)=true
        and sync_conflict_reason='branch_unresolved_after_customer_match'
    ),
    'public_tables_without_rls', (
      select count(*) from pg_class c
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' and not c.relrowsecurity
    ),
    'checked_at', now()
  ) into v;
  return v;
end
$function$;

delete from public.app_data_health_cache where cache_key='main';

commit;
