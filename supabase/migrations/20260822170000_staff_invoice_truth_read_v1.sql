create or replace function public.get_staff_invoice_truth_read_v1(
  p_staff_id uuid,
  p_start date,
  p_end date
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_catalog
as $function$
with staff_row as (
  select s.id,s.name,s.branch,s.role,
         case when coalesce(s.branch,'') ilike '%الشامي%' then 'فرع الشامي'
              when coalesce(s.branch,'') ilike '%شكري%' then 'فرع شكري'
              else coalesce(nullif(btrim(s.branch),''),'غير محدد') end branch_norm
  from public.staff s
  where s.id=p_staff_id
  limit 1
), aliases as (
  select public.normalize_cs_identity_name(sr.name) norm from staff_row sr
  union
  select public.normalize_cs_identity_name(a.alias_name)
  from public.staff_identity_aliases a
  where a.staff_id=p_staff_id and coalesce(a.active,true)
), period_rows as materialized (
  select
    si.id,si.invoice_number,si.invoice_no,si.invoice_date,si.sale_date,si.branch,si.branch_name,
    case when coalesce(si.branch,'') ilike '%الشامي%' then 'فرع الشامي'
         when coalesce(si.branch,'') ilike '%شكري%' then 'فرع شكري'
         else coalesce(nullif(btrim(si.branch),''),'غير محدد') end branch_norm,
    si.staff_id,si.seller_name,si.normalized_seller_name,si.staff_name,
    si.customer_name,si.customer_code,si.customer_phone,si.phone,si.customer_address,si.customer_segment,
    si.invoice_type,si.invoice_category,si.shift,
    si.net_total,si.net_amount,si.discounted_amount,si.total_amount,si.amount,si.gross_total,si.gross_amount,
    coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),nullif(si.gross_total,0),nullif(si.gross_amount,0),0)::numeric resolved_amount,
    public.normalize_cs_identity_name(coalesce(nullif(btrim(si.normalized_seller_name),''),nullif(btrim(si.seller_name),''),nullif(btrim(si.staff_name),''))) seller_norm
  from public.dawaa_sales_invoices_dashboard_v1 si
  where si.invoice_date >= p_start and si.invoice_date < (p_end + 1)::timestamp
), matched as materialized (
  select pr.* from period_rows pr
  where pr.staff_id::text=p_staff_id::text
     or pr.seller_norm in (select norm from aliases where norm<>'')
), branch_rows as materialized (
  select pr.* from period_rows pr cross join staff_row sr
  where (sr.branch_norm='غير محدد' or pr.branch_norm=sr.branch_norm)
    and coalesce(btrim(pr.customer_code),'') not in ('54','4902','20','12820','10','170','5')
), branch_stats as (
  select count(*) filter(where resolved_amount>0)::bigint invoices_count,
         coalesce(avg(resolved_amount) filter(where resolved_amount>0),0)::numeric avg_invoice
  from branch_rows
), seller_groups as (
  select coalesce(nullif(btrim(coalesce(normalized_seller_name,seller_name,staff_name)),''),'غير محدد') seller_name,
         count(*)::bigint invoices,coalesce(sum(resolved_amount),0)::numeric sales
  from branch_rows group by 1
), seller_diag as (
  select coalesce(jsonb_agg(jsonb_build_object('sellerName',seller_name,'sales',sales,'invoices',invoices) order by sales desc),'[]'::jsonb) sellers
  from (select * from seller_groups order by sales desc limit 50) q
), global_names as (
  select coalesce(jsonb_agg(seller_name order by seller_name),'[]'::jsonb) names
  from (
    select distinct coalesce(nullif(btrim(coalesce(normalized_seller_name,seller_name,staff_name)),''),'غير محدد') seller_name
    from period_rows order by 1 limit 30
  ) q
), matched_json as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'invoice_number',invoice_number,'invoice_no',invoice_no,'invoice_date',invoice_date,'sale_date',sale_date,
    'branch',branch,'branch_name',branch_name,'staff_id',staff_id,'seller_name',seller_name,'normalized_seller_name',normalized_seller_name,'staff_name',staff_name,
    'customer_name',customer_name,'customer_code',customer_code,'customer_phone',customer_phone,'phone',phone,'customer_address',customer_address,'customer_segment',customer_segment,
    'invoice_type',invoice_type,'invoice_category',invoice_category,'shift',shift,
    'net_total',net_total,'net_amount',net_amount,'discounted_amount',discounted_amount,'total_amount',total_amount,'amount',amount,'gross_total',gross_total,'gross_amount',gross_amount
  ) order by invoice_date desc,id),'[]'::jsonb) rows,
  count(*)::bigint matched_count,coalesce(sum(resolved_amount),0)::numeric matched_sales
  from matched
)
select jsonb_build_object(
  'staff',(select to_jsonb(sr) - 'branch_norm' from staff_row sr),
  'rows',mj.rows,'matchedCount',mj.matched_count,'matchedSales',mj.matched_sales,
  'branchAverage',bs.avg_invoice,'branchInvoicesCount',bs.invoices_count,
  'sellerDiagnostics',sd.sellers,'globalSellerNames',gn.names
)
from matched_json mj cross join branch_stats bs cross join seller_diag sd cross join global_names gn;
$function$;

grant execute on function public.get_staff_invoice_truth_read_v1(uuid,date,date) to authenticated;
