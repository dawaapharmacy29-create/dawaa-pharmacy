-- Canonical daily sales truth for doctor/branch dashboards.
-- Built from the cleaned invoice view so stale sales_daily_summary rows cannot zero current cycles.

CREATE OR REPLACE VIEW public.dawaa_sales_daily_dashboard_v1
WITH (security_invoker = true)
AS
SELECT
  COALESCE(invoice_date::date, sale_date) AS sale_date,
  branch,
  SUM(COALESCE(net_total, net_amount, discounted_amount, total_amount, amount, 0))::numeric(14,2) AS net_total,
  COUNT(*)::bigint AS invoices_count,
  CASE
    WHEN COUNT(*) > 0 THEN (SUM(COALESCE(net_total, net_amount, discounted_amount, total_amount, amount, 0)) / COUNT(*))::numeric(14,2)
    ELSE 0::numeric
  END AS avg_invoice,
  COUNT(DISTINCT COALESCE(NULLIF(BTRIM(customer_code), ''), NULLIF(BTRIM(customer_phone), ''), NULLIF(BTRIM(customer_name), '')))::bigint AS unique_customers
FROM public.dawaa_sales_invoices_dashboard_v1
GROUP BY COALESCE(invoice_date::date, sale_date), branch;

GRANT SELECT ON public.dawaa_sales_daily_dashboard_v1 TO anon, authenticated, service_role;
