create or replace function public.refresh_daily_followup_customer_metrics_for_codes_v2(p_customer_codes text[])
returns integer
language plpgsql
security definer
set search_path='public','pg_catalog'
as $$
declare
  v_codes text[];
  v_updated integer:=0;
begin
  select array_agg(distinct btrim(code)) into v_codes
  from unnest(coalesce(p_customer_codes,array[]::text[])) t(code)
  where nullif(btrim(code),'') is not null;
  if coalesce(cardinality(v_codes),0)=0 then return 0; end if;

  with source as (
    select code.customer_code,c.id customer_id,
      coalesce(nullif(btrim(c.name),''),nullif(btrim(c.customer_name),''),cms.customer_name) customer_name,
      coalesce(c.whatsapp_phone,c.phone,c.customer_phone,cms.customer_phone) customer_phone,
      coalesce(c.effective_branch,c.branch,cms.branch) customer_branch,
      coalesce(cms.invoices_count,0)::bigint invoices_count,
      coalesce(cms.total_spent,0)::numeric total_spent,
      coalesce(cms.avg_invoice,0)::numeric avg_invoice,
      coalesce(cms.avg_monthly,0)::numeric avg_monthly,
      cms.first_purchase,cms.last_purchase,
      coalesce(cms.active_months,case when coalesce(cms.invoices_count,0)>0 then 1 else 0 end)::integer active_months,
      c.segment operational_segment,
      coalesce(c.customer_status,cms.customer_status) operational_status,
      cms.segment analytics_segment
    from unnest(v_codes) code(customer_code)
    left join public.customer_metrics_summary cms on cms.final_customer_key=code.customer_code
    left join lateral (
      select c.* from public.customers c
      where btrim(c.customer_code)=code.customer_code
        and c.merged_into_customer_id is null and coalesce(c.is_duplicate,false)=false
      order by c.updated_at desc nulls last,c.id desc limit 1
    ) c on true
  ), matched as (
    select d.id,s.*,
      case when s.active_months>0 then round(s.invoices_count::numeric/s.active_months,2) else 0::numeric end average_monthly_purchase_count
    from public.daily_followups d join source s on btrim(d.customer_code)=s.customer_code
    where not public.dawaa_is_sales_target_excluded_customer_v1(d.branch,d.customer_code)
  )
  update public.daily_followups d set
    total_spent=m.total_spent,
    last_purchase_date=m.last_purchase,
    average_monthly_purchase_count=m.average_monthly_purchase_count,
    segment=coalesce(m.operational_segment,d.segment),
    customer_status=coalesce(m.operational_status,d.customer_status),
    customer_name=coalesce(nullif(d.customer_name,''),m.customer_name),
    customer_phone=coalesce(nullif(d.customer_phone,''),m.customer_phone),
    customer_metrics=coalesce(d.customer_metrics,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object(
      'customer_id',m.customer_id,'customer_code',m.customer_code,'customer_name',m.customer_name,
      'customer_phone',m.customer_phone,'branch',m.customer_branch,'invoices_count',m.invoices_count,
      'total_spent',m.total_spent,'avg_invoice',m.avg_invoice,'first_purchase',m.first_purchase,
      'last_purchase',m.last_purchase,'avg_monthly',m.avg_monthly,'segment',m.operational_segment,
      'analytics_segment',m.analytics_segment,'customer_status',m.operational_status,
      'average_monthly_purchase_count',m.average_monthly_purchase_count)),
    updated_at=now()
  from matched m where d.id=m.id and (
    d.total_spent is distinct from m.total_spent or d.last_purchase_date is distinct from m.last_purchase
    or d.average_monthly_purchase_count is distinct from m.average_monthly_purchase_count
    or (m.operational_segment is not null and d.segment is distinct from m.operational_segment)
    or (m.operational_status is not null and d.customer_status is distinct from m.operational_status)
    or d.customer_metrics is null
    or coalesce(nullif(d.customer_metrics->>'invoices_count','')::numeric,-1) is distinct from m.invoices_count
    or coalesce(nullif(d.customer_metrics->>'total_spent','')::numeric,-1) is distinct from m.total_spent
    or d.customer_metrics->>'last_purchase' is distinct from coalesce(m.last_purchase::text,null));
  get diagnostics v_updated=row_count;
  return v_updated;
end;
$$;

create or replace function public.refresh_daily_followup_customer_metrics(p_customer_code text default null)
returns integer language plpgsql security definer set search_path='public','pg_catalog' as $$
begin
  if nullif(btrim(coalesce(p_customer_code,'')),'') is null then
    return public.refresh_daily_followup_customer_metrics_for_codes_v2(
      (select array_agg(distinct btrim(customer_code)) from public.daily_followups where nullif(btrim(customer_code),'') is not null));
  end if;
  return public.refresh_daily_followup_customer_metrics_for_codes_v2(array[btrim(p_customer_code)]);
end;
$$;

create or replace function public.refresh_followup_metrics_after_sales_invoice_insert_v2()
returns trigger language plpgsql security definer set search_path='public','pg_catalog' as $$
declare v_codes text[];
begin
  select array_agg(distinct btrim(customer_code)) into v_codes from new_rows where nullif(btrim(customer_code),'') is not null;
  perform public.refresh_daily_followup_customer_metrics_for_codes_v2(v_codes); return null;
end;
$$;
create or replace function public.refresh_followup_metrics_after_sales_invoice_update_v2()
returns trigger language plpgsql security definer set search_path='public','pg_catalog' as $$
declare v_codes text[];
begin
  select array_agg(distinct code) into v_codes from (
    select btrim(customer_code) code from new_rows where nullif(btrim(customer_code),'') is not null
    union select btrim(customer_code) code from old_rows where nullif(btrim(customer_code),'') is not null) s;
  perform public.refresh_daily_followup_customer_metrics_for_codes_v2(v_codes); return null;
end;
$$;
create or replace function public.refresh_followup_metrics_after_sales_invoice_delete_v2()
returns trigger language plpgsql security definer set search_path='public','pg_catalog' as $$
declare v_codes text[];
begin
  select array_agg(distinct btrim(customer_code)) into v_codes from old_rows where nullif(btrim(customer_code),'') is not null;
  perform public.refresh_daily_followup_customer_metrics_for_codes_v2(v_codes); return null;
end;
$$;

drop trigger if exists sales_invoices_refresh_followup_metrics_insert on public.sales_invoices;
drop trigger if exists sales_invoices_refresh_followup_metrics_update on public.sales_invoices;
drop trigger if exists sales_invoices_refresh_followup_metrics_delete on public.sales_invoices;
drop trigger if exists zz_sales_invoices_refresh_followup_metrics_insert_v2 on public.sales_invoices;
drop trigger if exists zz_sales_invoices_refresh_followup_metrics_update_v2 on public.sales_invoices;
drop trigger if exists zz_sales_invoices_refresh_followup_metrics_delete_v2 on public.sales_invoices;

create trigger zz_sales_invoices_refresh_followup_metrics_insert_v2 after insert on public.sales_invoices
referencing new table as new_rows for each statement execute function public.refresh_followup_metrics_after_sales_invoice_insert_v2();
create trigger zz_sales_invoices_refresh_followup_metrics_update_v2 after update on public.sales_invoices
referencing old table as old_rows new table as new_rows for each statement execute function public.refresh_followup_metrics_after_sales_invoice_update_v2();
create trigger zz_sales_invoices_refresh_followup_metrics_delete_v2 after delete on public.sales_invoices
referencing old table as old_rows for each statement execute function public.refresh_followup_metrics_after_sales_invoice_delete_v2();

revoke all on function public.refresh_daily_followup_customer_metrics_for_codes_v2(text[]) from public;
revoke all on function public.refresh_followup_metrics_after_sales_invoice_insert_v2() from public;
revoke all on function public.refresh_followup_metrics_after_sales_invoice_update_v2() from public;
revoke all on function public.refresh_followup_metrics_after_sales_invoice_delete_v2() from public;
grant execute on function public.refresh_daily_followup_customer_metrics_for_codes_v2(text[]) to service_role;
grant execute on function public.refresh_followup_metrics_after_sales_invoice_insert_v2() to service_role;
grant execute on function public.refresh_followup_metrics_after_sales_invoice_update_v2() to service_role;
grant execute on function public.refresh_followup_metrics_after_sales_invoice_delete_v2() to service_role;
