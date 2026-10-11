-- Canonical V3 focused header read model. Detailed same-period/trend work remains in the Performance Eye bundle.
create or replace function public.get_staff_evaluation_sales_summary_v3(p_staff_id uuid,p_start date,p_end_exclusive date)
returns table(sales numeric,invoices bigint,customers bigint,avg_invoice numeric,data_as_of date)
language plpgsql stable security invoker set search_path=public,pg_catalog as $function$
declare
 v_name text; v_branch text; v_start timestamptz; v_end timestamptz; v_aliases text[];
 v_sales numeric:=0; v_invoices bigint:=0; v_customers bigint:=0;
 v_ds numeric:=0; v_di bigint:=0; v_fs numeric:=0; v_fi bigint:=0;
begin
 select s.name,s.branch into v_name,v_branch from public.staff s where s.id=p_staff_id;
 if v_name is null then return query select 0::numeric,0::bigint,0::bigint,0::numeric,null::date; return; end if;
 v_start:=p_start::timestamp at time zone 'Africa/Cairo';
 v_end:=p_end_exclusive::timestamp at time zone 'Africa/Cairo';
 select array_agg(distinct norm) into v_aliases from (
  select public.normalize_cs_identity_name(v_name) norm
  union all
  select coalesce(nullif(a.normalized_alias,''),public.normalize_cs_identity_name(a.alias_name))
  from public.staff_identity_aliases a where a.staff_id=p_staff_id and coalesce(a.active,true)
 ) x where norm<>'';

 select coalesce(sum(coalesce(si.net_total,si.net_amount,si.discounted_amount,si.total_amount,si.amount,si.gross_total,si.gross_amount,0)),0),count(*)
 into v_ds,v_di from public.sales_invoices si
 where si.staff_id=p_staff_id::text and si.invoice_date>=v_start and si.invoice_date<v_end;

 select coalesce(sum(coalesce(si.net_total,si.net_amount,si.discounted_amount,si.total_amount,si.amount,si.gross_total,si.gross_amount,0)),0),count(*)
 into v_fs,v_fi from public.sales_invoices si
 where coalesce(btrim(si.staff_id),'')='' and si.invoice_date>=v_start and si.invoice_date<v_end
 and public.normalize_cs_identity_name(coalesce(nullif(btrim(si.normalized_seller_name),''),nullif(btrim(si.seller_name),''),nullif(btrim(si.staff_name),'')))=any(v_aliases);

 v_sales:=v_ds+v_fs; v_invoices:=v_di+v_fi;
 select count(distinct customer_key) into v_customers from (
  select coalesce(nullif(btrim(si.customer_id::text),''),nullif(btrim(si.customer_code),''),nullif(btrim(si.customer_phone),'')) customer_key
  from public.sales_invoices si where si.staff_id=p_staff_id::text and si.invoice_date>=v_start and si.invoice_date<v_end
  union all
  select coalesce(nullif(btrim(si.customer_id::text),''),nullif(btrim(si.customer_code),''),nullif(btrim(si.customer_phone),''))
  from public.sales_invoices si where coalesce(btrim(si.staff_id),'')='' and si.invoice_date>=v_start and si.invoice_date<v_end
  and public.normalize_cs_identity_name(coalesce(nullif(btrim(si.normalized_seller_name),''),nullif(btrim(si.seller_name),''),nullif(btrim(si.staff_name),'')))=any(v_aliases)
 ) q where customer_key is not null;

 select (max(si.invoice_date) at time zone 'Africa/Cairo')::date into data_as_of
 from public.sales_invoices si where coalesce(nullif(btrim(si.branch_name),''),nullif(btrim(si.branch),''))=v_branch;
 sales:=v_sales; invoices:=v_invoices; customers:=coalesce(v_customers,0);
 avg_invoice:=case when v_invoices>0 then v_sales/v_invoices else 0 end;
 return next;
end
$function$;
revoke all on function public.get_staff_evaluation_sales_summary_v3(uuid,date,date) from public;
revoke execute on function public.get_staff_evaluation_sales_summary_v3(uuid,date,date) from anon;
grant execute on function public.get_staff_evaluation_sales_summary_v3(uuid,date,date) to authenticated;
