-- Keep doctor/staff sales summaries on the same canonical clean invoice truth used by the dashboard.
-- Raw invoices remain untouched in sales_invoices for audit/reconciliation.

DROP MATERIALIZED VIEW IF EXISTS public.staff_sales_summary;

CREATE MATERIALIZED VIEW public.staff_sales_summary AS
SELECT
  invoice_date::date AS sale_date,
  COALESCE(branch, 'غير محدد'::text) AS branch,
  COALESCE(NULLIF(BTRIM(seller_name), ''), NULLIF(BTRIM(normalized_seller_name), ''), NULLIF(BTRIM(staff_name), ''), 'غير محدد'::text) AS seller_name,
  COUNT(*) AS invoices_count,
  COALESCE(SUM(COALESCE(net_amount, net_total, total_amount, amount, 0::numeric)), 0::numeric) AS net_total,
  COALESCE(SUM(COALESCE(gross_amount, gross_total, total_amount, amount, net_amount, 0::numeric)), 0::numeric) AS gross_total,
  COALESCE(SUM(COALESCE(discount_amount, 0::numeric)), 0::numeric) AS discount_total,
  COALESCE(AVG(COALESCE(net_amount, net_total, total_amount, amount, 0::numeric)), 0::numeric) AS avg_invoice,
  COUNT(DISTINCT COALESCE(
    NULLIF(customer_code, ''::text),
    customer_id::text,
    NULLIF(regexp_replace(COALESCE(customer_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), ''::text),
    NULLIF(customer_name, ''::text)
  )) AS unique_customers
FROM public.dawaa_sales_invoices_dashboard_v1
WHERE invoice_date IS NOT NULL
  AND COALESCE(NULLIF(BTRIM(seller_name), ''), NULLIF(BTRIM(normalized_seller_name), ''), NULLIF(BTRIM(staff_name), '')) IS NOT NULL
GROUP BY
  invoice_date::date,
  COALESCE(branch, 'غير محدد'::text),
  COALESCE(NULLIF(BTRIM(seller_name), ''), NULLIF(BTRIM(normalized_seller_name), ''), NULLIF(BTRIM(staff_name), ''), 'غير محدد'::text)
WITH DATA;

CREATE UNIQUE INDEX staff_sales_summary_unique_idx
  ON public.staff_sales_summary (sale_date, branch, seller_name);
CREATE INDEX staff_sales_summary_date_idx
  ON public.staff_sales_summary (sale_date DESC);
CREATE INDEX staff_sales_summary_branch_idx
  ON public.staff_sales_summary (branch);
CREATE INDEX staff_sales_summary_seller_idx
  ON public.staff_sales_summary (seller_name);

GRANT SELECT ON public.staff_sales_summary TO anon, authenticated, service_role;

COMMENT ON MATERIALIZED VIEW public.staff_sales_summary IS
  'Doctor/staff sales summary derived only from daw aa canonical clean invoice truth: internal/system codes, non-final invoices and duplicate invoice identities are excluded upstream.';