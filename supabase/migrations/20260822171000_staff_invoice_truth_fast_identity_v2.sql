create index if not exists idx_sales_invoices_missing_staff_date_v1
on public.sales_invoices (invoice_date)
where coalesce(btrim(staff_id),'')='';

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
  from public.staff s where s.id=p_staff_id limit 1
), aliases as materialized (
  select public.normalize_cs_identity_name(sr.name) norm from staff_row sr
  union
  select public.normalize_cs_identity_name(a.alias_name)
  from public.staff_identity_aliases a
  where a.staff_id=p_staff_id and coalesce(a.active,true)
), matched as materialized (
  select si.*,
    coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),nullif(si.gross_total,0),nullif(si.gross_amount,0),0)::numeric resolved_amount
  from public.sales_invoices si
  where si.invoice_date >= p_start and si.invoice_date < (p_end + 1)::timestamp
    and si.staff_id=p_staff_id::text
  union all
  select si.*,
    coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),nullif(si.gross_total,0),nullif(si.gross_amount,0),0)::numeric resolved_amount
  from public.sales_invoices si
  where si.invoice_date >= p_start and si.invoice_date < (p_end + 1)::timestamp
    and coalesce(btrim(si.staff_id),'')=''
    and public.normalize_cs_identity_name(coalesce(nullif(btrim(si.normalized_seller_name),''),nullif(btrim(si.seller_name),''),nullif(btrim(si.staff_name),''))) in (select norm from aliases where norm<>'')
), branch_stats as (
  select count(*) filter(where amount_value>0)::bigint invoices_count,
         coalesce(avg(amount_value) filter(where amount_value>0),0)::numeric avg_invoice
  from (
    select coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),nullif(si.gross_total,0),nullif(si.gross_amount,0),0)::numeric amount_value
    from public.sales_invoices si cross join staff_row sr
    where si.invoice_date >= p_start and si.invoice_date < (p_end + 1)::timestamp
      and (sr.branch_norm='غير محدد' or (case when coalesce(si.branch,'') ilike '%الشامي%' then 'فرع الشامي' when coalesce(si.branch,'') ilike '%شكري%' then 'فرع شكري' else coalesce(nullif(btrim(si.branch),''),'غير محدد') end)=sr.branch_norm)
      and coalesce(btrim(si.customer_code),'') not in ('54','4902','20','12820','10','170','5')
  ) q
), seller_groups as (
  select coalesce(nullif(btrim(ss.seller_name),''),'غير محدد') seller_name,
         sum(ss.invoices_count)::bigint invoices,coalesce(sum(ss.net_total),0)::numeric sales
  from public.staff_sales_summary ss cross join staff_row sr
  where ss.sale_date between p_start and p_end
    and (sr.branch_norm='غير محدد' or ss.branch=sr.branch_norm)
  group by 1
), seller_diag as (
  select coalesce(jsonb_agg(jsonb_build_object('sellerName',seller_name,'sales',sales,'invoices',invoices) order by sales desc),'[]'::jsonb) sellers
  from (select * from seller_groups order by sales desc limit 50) q
), global_names as (
  select coalesce(jsonb_agg(seller_name order by seller_name),'[]'::jsonb) names
  from (select distinct coalesce(nullif(btrim(ss.seller_name),''),'غير محدد') seller_name from public.staff_sales_summary ss where ss.sale_date between p_start and p_end order by 1 limit 30) q
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
