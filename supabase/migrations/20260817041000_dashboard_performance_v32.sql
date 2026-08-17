-- Dashboard performance v32
-- Final, measured production state only.

CREATE SCHEMA IF NOT EXISTS internal;
REVOKE ALL ON SCHEMA internal FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS internal.dashboard_sales_daily_cache_v1 (
  sale_date date NOT NULL,
  branch text NOT NULL,
  sales_total numeric NOT NULL DEFAULT 0,
  invoices_count bigint NOT NULL DEFAULT 0,
  avg_invoice numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sale_date, branch)
);

REVOKE ALL ON internal.dashboard_sales_daily_cache_v1 FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION internal.refresh_dashboard_sales_daily_cache_v1(
  p_start date,
  p_end date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  DELETE FROM internal.dashboard_sales_daily_cache_v1
  WHERE sale_date BETWEEN p_start AND p_end;

  INSERT INTO internal.dashboard_sales_daily_cache_v1(
    sale_date, branch, sales_total, invoices_count, avg_invoice, updated_at
  )
  WITH excluded AS (
    SELECT customer_code
    FROM public.customer_flags
    WHERE flag_key = 'system_generic_code'
      AND coalesce(is_active, false)
  ),
  agg AS (
    SELECT
      si.invoice_date::date AS d,
      coalesce(nullif(btrim(si.branch), ''), 'غير محدد') AS b,
      sum(coalesce(si.net_total, si.net_amount, si.discounted_amount, si.total_amount, si.amount, 0))::numeric AS s,
      count(*)::bigint AS c
    FROM public.sales_invoices si
    LEFT JOIN excluded e
      ON e.customer_code = btrim(coalesce(si.customer_code, ''))
    WHERE si.invoice_date >= p_start
      AND si.invoice_date < (p_end + 1)::timestamp
      AND e.customer_code IS NULL
      AND NOT (
        lower(coalesce(si.save_status, '')) ~ '(معلق|قيد|pending|draft|غير محفوظ)'
        OR lower(coalesce(si.invoice_type, '')) ~ '(معلق|pending|draft)'
      )
    GROUP BY 1, 2
  )
  SELECT d, b, s, c, CASE WHEN c > 0 THEN s / c ELSE 0 END, now()
  FROM agg;
END
$function$;

REVOKE ALL ON FUNCTION internal.refresh_dashboard_sales_daily_cache_v1(date, date)
FROM PUBLIC, anon, authenticated;

DO $block$
DECLARE
  v_min date;
  v_max date;
BEGIN
  SELECT min(invoice_date::date), max(invoice_date::date)
  INTO v_min, v_max
  FROM public.sales_invoices;

  IF v_min IS NOT NULL AND v_max IS NOT NULL THEN
    PERFORM internal.refresh_dashboard_sales_daily_cache_v1(v_min, v_max);
  END IF;
END
$block$;

CREATE OR REPLACE FUNCTION public.get_dashboard_sales_summary_v171(
  p_start date,
  p_end date,
  p_branch text DEFAULT NULL::text
)
RETURNS TABLE(
  invoices_count bigint,
  sales_total numeric,
  avg_invoice numeric,
  linked_invoices bigint,
  unregistered_customer_invoices bigint,
  linked_sales numeric,
  unregistered_customer_sales numeric,
  customer_link_rate_percent numeric,
  linked_customers bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
WITH excluded AS (
  SELECT customer_code FROM public.customer_flags
  WHERE flag_key = 'system_generic_code' AND coalesce(is_active, false)
),
s AS (
  SELECT
    coalesce(si.net_total, si.net_amount, si.discounted_amount, si.total_amount, si.amount, 0) AS v,
    nullif(btrim(si.customer_code), '') AS code,
    lower(coalesce(si.customer_name, '')) AS nm
  FROM public.sales_invoices si
  LEFT JOIN excluded e ON e.customer_code = btrim(coalesce(si.customer_code, ''))
  WHERE si.invoice_date >= p_start
    AND si.invoice_date < (p_end + 1)::timestamp
    AND e.customer_code IS NULL
    AND NOT (
      lower(coalesce(si.save_status, '')) ~ '(معلق|قيد|pending|draft|غير محفوظ)'
      OR lower(coalesce(si.invoice_type, '')) ~ '(معلق|pending|draft)'
    )
    AND (
      p_branch IS NULL OR btrim(p_branch) = '' OR p_branch IN ('كل الفروع', 'الكل') OR si.branch = p_branch
    )
),
m AS (
  SELECT *,
    code IS NOT NULL
    AND code NOT IN ('0', '-', 'null', 'NULL')
    AND nm NOT LIKE '%غير مسجل%' AS linked
  FROM s
)
SELECT
  count(*)::bigint,
  coalesce(sum(v), 0)::numeric,
  (coalesce(sum(v), 0) / nullif(count(*), 0))::numeric,
  count(*) FILTER (WHERE linked)::bigint,
  count(*) FILTER (WHERE NOT linked)::bigint,
  coalesce(sum(v) FILTER (WHERE linked), 0)::numeric,
  coalesce(sum(v) FILTER (WHERE NOT linked), 0)::numeric,
  CASE WHEN count(*) > 0 THEN count(*) FILTER (WHERE linked)::numeric * 100 / count(*) ELSE 0 END,
  count(DISTINCT code) FILTER (WHERE linked)::bigint
FROM m
$function$;

CREATE OR REPLACE FUNCTION public.get_dashboard_daily_sales_v171(
  p_start date,
  p_end date,
  p_branch text DEFAULT NULL::text
)
RETURNS TABLE(sale_date date, branch text, daily_sales numeric, invoices_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
SELECT c.sale_date, c.branch, c.sales_total, c.invoices_count
FROM internal.dashboard_sales_daily_cache_v1 c
WHERE c.sale_date BETWEEN p_start AND p_end
  AND (
    p_branch IS NULL OR btrim(p_branch) = '' OR p_branch IN ('كل الفروع', 'الكل') OR c.branch = p_branch
  )
ORDER BY c.sale_date, c.branch
$function$;

CREATE OR REPLACE FUNCTION public.get_dashboard_branch_distribution_v171(
  p_start date,
  p_end date,
  p_branch text DEFAULT NULL::text
)
RETURNS TABLE(branch text, sales_total numeric, invoices_count bigint, avg_invoice numeric, linked_customers bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
WITH excluded AS (
  SELECT customer_code FROM public.customer_flags
  WHERE flag_key = 'system_generic_code' AND coalesce(is_active, false)
),
s AS (
  SELECT
    coalesce(nullif(btrim(si.branch), ''), 'غير محدد') AS b,
    coalesce(si.net_total, si.net_amount, si.discounted_amount, si.total_amount, si.amount, 0) AS v,
    nullif(btrim(si.customer_code), '') AS code,
    lower(coalesce(si.customer_name, '')) AS nm
  FROM public.sales_invoices si
  LEFT JOIN excluded e ON e.customer_code = btrim(coalesce(si.customer_code, ''))
  WHERE si.invoice_date >= p_start
    AND si.invoice_date < (p_end + 1)::timestamp
    AND e.customer_code IS NULL
    AND NOT (
      lower(coalesce(si.save_status, '')) ~ '(معلق|قيد|pending|draft|غير محفوظ)'
      OR lower(coalesce(si.invoice_type, '')) ~ '(معلق|pending|draft)'
    )
    AND (
      p_branch IS NULL OR btrim(p_branch) = '' OR p_branch IN ('كل الفروع', 'الكل') OR si.branch = p_branch
    )
)
SELECT
  b,
  sum(v)::numeric,
  count(*)::bigint,
  (sum(v) / nullif(count(*), 0))::numeric,
  count(DISTINCT code) FILTER (
    WHERE code IS NOT NULL AND code NOT IN ('0', '-', 'null', 'NULL') AND nm NOT LIKE '%غير مسجل%'
  )::bigint
FROM s
GROUP BY b
ORDER BY 2 DESC
$function$;

CREATE OR REPLACE FUNCTION public.get_dashboard_doctor_sales_v171(
  p_start date,
  p_end date,
  p_branch text DEFAULT NULL::text
)
RETURNS TABLE(doctor_name text, branch text, sales_total numeric, invoices_count bigint, avg_invoice numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
WITH excluded AS (
  SELECT customer_code FROM public.customer_flags
  WHERE flag_key = 'system_generic_code' AND coalesce(is_active, false)
)
SELECT
  coalesce(nullif(btrim(si.seller_name), ''), nullif(btrim(si.staff_name), ''), 'غير مربوط'),
  coalesce(nullif(btrim(si.branch), ''), 'غير محدد'),
  sum(coalesce(si.net_total, si.net_amount, si.discounted_amount, si.total_amount, si.amount, 0))::numeric,
  count(*)::bigint,
  (sum(coalesce(si.net_total, si.net_amount, si.discounted_amount, si.total_amount, si.amount, 0)) / nullif(count(*), 0))::numeric
FROM public.sales_invoices si
LEFT JOIN excluded e ON e.customer_code = btrim(coalesce(si.customer_code, ''))
WHERE si.invoice_date >= p_start
  AND si.invoice_date < (p_end + 1)::timestamp
  AND e.customer_code IS NULL
  AND NOT (
    lower(coalesce(si.save_status, '')) ~ '(معلق|قيد|pending|draft|غير محفوظ)'
    OR lower(coalesce(si.invoice_type, '')) ~ '(معلق|pending|draft)'
  )
  AND (
    p_branch IS NULL OR btrim(p_branch) = '' OR p_branch IN ('كل الفروع', 'الكل') OR si.branch = p_branch
  )
  AND coalesce(si.seller_name, si.staff_name, '') !~* '(delivery|courier|rider|دليفري|توصيل|مندوب)'
  AND coalesce(nullif(btrim(si.seller_name), ''), nullif(btrim(si.staff_name), ''), 'غير مربوط') NOT IN ('غير مربوط', 'غير محدد')
GROUP BY 1, 2
ORDER BY 3 DESC
LIMIT 50
$function$;

CREATE OR REPLACE FUNCTION public.get_dashboard_monthly_sales_v171(
  p_end date,
  p_branch text DEFAULT NULL::text,
  p_months integer DEFAULT 6
)
RETURNS TABLE(month_start date, month_label text, branch text, sales_total numeric, invoices_count bigint, avg_invoice numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
WITH bounds AS (
  SELECT
    (date_trunc('month', p_end)::date - ((greatest(coalesce(p_months, 6), 1) - 1) * interval '1 month'))::date AS start_date,
    (date_trunc('month', p_end)::date + interval '1 month')::date AS end_date
),
s AS (
  SELECT
    date_trunc('month', c.sale_date)::date AS m,
    c.branch AS b,
    c.sales_total AS s,
    c.invoices_count AS n
  FROM internal.dashboard_sales_daily_cache_v1 c, bounds x
  WHERE c.sale_date >= x.start_date
    AND c.sale_date < x.end_date
    AND (
      p_branch IS NULL OR btrim(p_branch) = '' OR p_branch IN ('كل الفروع', 'الكل') OR c.branch = p_branch
    )
)
SELECT
  m,
  to_char(m, 'YYYY-MM'),
  b,
  sum(s)::numeric,
  sum(n)::bigint,
  (sum(s) / nullif(sum(n), 0))::numeric
FROM s
GROUP BY m, b
ORDER BY m, b
$function$;

CREATE OR REPLACE FUNCTION public.get_dashboard_sales_truth_audit_v1(
  p_start date,
  p_end date,
  p_branch text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
WITH excluded AS (
  SELECT customer_code FROM public.customer_flags
  WHERE flag_key = 'system_generic_code' AND coalesce(is_active, false)
),
raw AS (
  SELECT
    si.id, si.branch, si.branch_name, si.invoice_number, si.invoice_no,
    si.invoice_date, si.sale_date, si.created_at, si.updated_at,
    coalesce(si.net_amount, si.net_total, si.amount, si.total_amount, si.discounted_amount, si.gross_amount, 0)::numeric AS truth_value,
    (e.customer_code IS NOT NULL) AS excluded_code,
    (
      lower(coalesce(si.save_status, '')) ~ '(معلق|قيد|pending|draft|غير محفوظ)'
      OR lower(coalesce(si.invoice_type, '')) ~ '(معلق|pending|draft)'
    ) AS nonfinal
  FROM public.sales_invoices si
  LEFT JOIN excluded e ON e.customer_code = btrim(coalesce(si.customer_code, ''))
  WHERE si.invoice_date >= p_start
    AND si.invoice_date < (p_end + 1)::timestamp
    AND (
      p_branch IS NULL OR p_branch = '' OR lower(p_branch) = 'all' OR p_branch LIKE '%كل%'
      OR coalesce(nullif(btrim(si.branch), ''), nullif(btrim(si.branch_name), '')) = p_branch
    )
),
eligible_ranked AS (
  SELECT r.*,
    row_number() OVER (
      PARTITION BY
        coalesce(nullif(btrim(r.branch), ''), nullif(btrim(r.branch_name), ''), 'غير محدد'),
        CASE
          WHEN nullif(btrim(coalesce(r.invoice_number, r.invoice_no)), '') IS NOT NULL
            THEN btrim(coalesce(r.invoice_number, r.invoice_no))
          ELSE concat('__row__', r.id)
        END,
        r.invoice_date::date
      ORDER BY coalesce(r.updated_at, r.created_at) DESC NULLS LAST, r.created_at DESC NULLS LAST, r.id DESC
    ) AS truth_rank
  FROM raw r
  WHERE NOT r.excluded_code AND NOT r.nonfinal
),
clean AS (
  SELECT * FROM eligible_ranked WHERE truth_rank = 1
)
SELECT jsonb_build_object(
  'raw_rows', (SELECT count(*) FROM raw),
  'raw_total', (SELECT round(coalesce(sum(truth_value), 0), 2) FROM raw),
  'excluded_internal_rows', (SELECT count(*) FROM raw WHERE excluded_code),
  'excluded_internal_value', (SELECT round(coalesce(sum(truth_value), 0), 2) FROM raw WHERE excluded_code),
  'nonfinal_rows', (SELECT count(*) FROM raw WHERE nonfinal AND NOT excluded_code),
  'nonfinal_value', (SELECT round(coalesce(sum(truth_value), 0), 2) FROM raw WHERE nonfinal AND NOT excluded_code),
  'duplicate_rows', (SELECT count(*) FROM eligible_ranked WHERE truth_rank > 1),
  'duplicate_value', (SELECT round(coalesce(sum(truth_value), 0), 2) FROM eligible_ranked WHERE truth_rank > 1),
  'clean_rows', (SELECT count(*) FROM clean),
  'clean_total', (SELECT round(coalesce(sum(truth_value), 0), 2) FROM clean),
  'adjustment_value', (
    (SELECT round(coalesce(sum(truth_value), 0), 2) FROM raw)
    - (SELECT round(coalesce(sum(truth_value), 0), 2) FROM clean)
  )
)
$function$;

CREATE OR REPLACE FUNCTION public.dawaa_invoice_post_import_refresh_v1(
  p_start_date date,
  p_end_date date
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_linked integer := 0;
  v_raw_count integer := 0;
  v_clean_count integer := 0;
  v_excluded integer := 0;
  v_pending integer := 0;
  v_without_customer integer := 0;
  v_without_doctor integer := 0;
  v_without_branch integer := 0;
  v_clean_total numeric := 0;
  v_customer_refresh jsonb;
BEGIN
  PERFORM set_config('statement_timeout', '120000', true);
  v_linked := public.dawaa_backfill_invoice_staff_links_v1(p_start_date, p_end_date);
  REFRESH MATERIALIZED VIEW public.staff_sales_summary;
  PERFORM internal.refresh_dashboard_sales_daily_cache_v1(p_start_date, p_end_date);
  v_customer_refresh := public.dawaa_customer_sales_truth_refresh_v2();

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE public.dawaa_is_sales_target_excluded_customer_v1(branch, customer_code))::integer,
    count(*) FILTER (WHERE lower(coalesce(save_status, '')) ~ '(معلق|قيد|pending|draft|غير محفوظ)' OR lower(coalesce(invoice_type, '')) ~ '(معلق|pending|draft)')::integer,
    count(*) FILTER (WHERE coalesce(customer_code, '') = '' AND coalesce(customer_name, '') = '')::integer,
    count(*) FILTER (WHERE coalesce(staff_id, '') = '' AND coalesce(seller_name, '') = '')::integer,
    count(*) FILTER (WHERE coalesce(branch, '') = '')::integer
  INTO v_raw_count, v_excluded, v_pending, v_without_customer, v_without_doctor, v_without_branch
  FROM public.sales_invoices
  WHERE invoice_date::date BETWEEN p_start_date AND p_end_date;

  SELECT
    count(*)::integer,
    coalesce(sum(coalesce(net_total, net_amount, discounted_amount, total_amount, amount, 0)), 0)
  INTO v_clean_count, v_clean_total
  FROM public.dawaa_sales_invoices_dashboard_v1
  WHERE invoice_date::date BETWEEN p_start_date AND p_end_date;

  INSERT INTO public.invoice_import_health_log(
    refresh_start, refresh_end, invoices_count, invoices_without_customer,
    invoices_without_doctor, invoices_without_branch, linked_staff_count,
    total_net, status, notes
  ) VALUES (
    p_start_date, p_end_date, v_clean_count, v_without_customer,
    v_without_doctor, v_without_branch, v_linked, v_clean_total, 'done',
    format(
      'raw=%s; clean=%s; excluded_internal=%s; pending=%s; staff+customer+dashboard cache refreshed; customer_refresh=%s',
      v_raw_count, v_clean_count, v_excluded, v_pending, v_customer_refresh::text
    )
  );

  PERFORM pg_notify('pgrst', 'reload schema');
  RETURN format(
    'تم تحديث التحليلات والعملاء: خام %s، صافي %s، أكواد داخلية مستبعدة %s، معلقة %s، صافي مبيعات %s، وربط دكاترة %s',
    v_raw_count, v_clean_count, v_excluded, v_pending, v_clean_total, v_linked
  );
END
$function$;

CREATE OR REPLACE VIEW public.dawaa_sales_invoices_dashboard_v1
WITH (security_invoker = true)
AS
SELECT
  si.id, si.phone, si.name, si.amount, si.date, si.branch, si.invoice_no, si.created_at,
  si.import_batch, si.invoice_number, si.invoice_type, si.customer_code, si.customer_name,
  si.customer_phone, si.invoice_date, si.seller_name, si.close_time, si.delivery_staff,
  si.specialty, si.raw_data, si.invoice_datetime, si.close_datetime, si.analysis_datetime,
  si.gross_amount, si.discounted_amount, si.net_amount, si.discount_amount, si.courier_cash,
  si.extra_fees, si.line_items_count, si.shift_name, si.clinic, si.delivery_address, si.notes,
  si.save_status, si.device_name, si.customer_link_status, si.import_validation_status,
  si.import_warning, si.source_row_number, si.customer_id, si.customer_address,
  si.customer_segment, si.customer_type, si.invoice_category, si.shift,
  si.normalized_seller_name, si.branch_name, si.staff_id, si.net_total, si.gross_total,
  si.updated_at, si.whatsapp_phone, si.sale_date, si.total_amount, si.staff_name, si.source,
  1::bigint AS truth_rank
FROM public.sales_invoices si
WHERE NOT EXISTS (
  SELECT 1
  FROM public.customer_flags f
  WHERE f.customer_code = btrim(coalesce(si.customer_code, ''))
    AND f.flag_key = 'system_generic_code'
    AND coalesce(f.is_active, false)
)
AND NOT (
  lower(coalesce(si.save_status, '')) ~ '(معلق|قيد|pending|draft|غير محفوظ)'
  OR lower(coalesce(si.invoice_type, '')) ~ '(معلق|pending|draft)'
);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON public.dawaa_sales_invoices_dashboard_v1 FROM anon, authenticated;
GRANT SELECT ON public.dawaa_sales_invoices_dashboard_v1 TO anon, authenticated, service_role;
