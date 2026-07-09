-- Customer Data Review foundation views/RPCs.
-- Keeps /customer-data-review useful even if the advanced invoice-analysis views are not installed yet.

CREATE TABLE IF NOT EXISTS public.customer_branch_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_code text,
  customer_phone text,
  customer_name text,
  old_branch text,
  new_branch text,
  suggested_branch text,
  reason text,
  status text NOT NULL DEFAULT 'approved',
  created_by text,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- If the table already existed, CREATE TABLE IF NOT EXISTS will not add missing columns.
ALTER TABLE public.customer_branch_overrides ADD COLUMN IF NOT EXISTS customer_code text;
ALTER TABLE public.customer_branch_overrides ADD COLUMN IF NOT EXISTS customer_phone text;
ALTER TABLE public.customer_branch_overrides ADD COLUMN IF NOT EXISTS customer_name text;
ALTER TABLE public.customer_branch_overrides ADD COLUMN IF NOT EXISTS old_branch text;
ALTER TABLE public.customer_branch_overrides ADD COLUMN IF NOT EXISTS new_branch text;
ALTER TABLE public.customer_branch_overrides ADD COLUMN IF NOT EXISTS suggested_branch text;
ALTER TABLE public.customer_branch_overrides ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE public.customer_branch_overrides ADD COLUMN IF NOT EXISTS status text DEFAULT 'approved';
ALTER TABLE public.customer_branch_overrides ADD COLUMN IF NOT EXISTS created_by text;
ALTER TABLE public.customer_branch_overrides ADD COLUMN IF NOT EXISTS created_by_name text;
ALTER TABLE public.customer_branch_overrides ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.customer_branch_overrides ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
UPDATE public.customer_branch_overrides SET status = 'approved' WHERE status IS NULL;

CREATE INDEX IF NOT EXISTS idx_customer_branch_overrides_code ON public.customer_branch_overrides (customer_code);
CREATE INDEX IF NOT EXISTS idx_customer_branch_overrides_status ON public.customer_branch_overrides (status);

CREATE TABLE IF NOT EXISTS public.customer_data_review_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_code text,
  action_type text NOT NULL,
  reviewed_by text,
  reason text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_data_review_actions ADD COLUMN IF NOT EXISTS customer_code text;
ALTER TABLE public.customer_data_review_actions ADD COLUMN IF NOT EXISTS action_type text DEFAULT 'reviewed';
ALTER TABLE public.customer_data_review_actions ADD COLUMN IF NOT EXISTS reviewed_by text;
ALTER TABLE public.customer_data_review_actions ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE public.customer_data_review_actions ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.customer_data_review_actions ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

CREATE OR REPLACE VIEW public.dawaa_customer_invalid_phone_review_v14_6 AS
SELECT
  c.customer_code,
  c.name AS customer_name,
  COALESCE(NULLIF(c.phone, ''), NULLIF(c.mobile, ''), NULLIF(c.whatsapp, '')) AS customer_phone,
  c.branch,
  'customers'::text AS source_table,
  CASE
    WHEN COALESCE(NULLIF(c.phone, ''), NULLIF(c.mobile, ''), NULLIF(c.whatsapp, '')) IS NULL THEN 'لا يوجد رقم مسجل'
    ELSE 'رقم غير صالح أو يحتاج تنظيف'
  END AS invalid_reason,
  COALESCE(c.updated_at, c.created_at) AS last_seen_at
FROM public.customers c
WHERE COALESCE(NULLIF(c.phone, ''), NULLIF(c.mobile, ''), NULLIF(c.whatsapp, '')) IS NULL
   OR regexp_replace(COALESCE(c.phone, c.mobile, c.whatsapp, ''), '\D', '', 'g') !~ '^(01[0125][0-9]{8}|201[0125][0-9]{8})$';

CREATE OR REPLACE VIEW public.dawaa_customer_branch_review_queue_v14 AS
SELECT
  c.customer_code,
  c.name AS customer_name,
  COALESCE(NULLIF(c.phone, ''), NULLIF(c.mobile, ''), NULLIF(c.whatsapp, '')) AS customer_phone,
  c.branch AS current_branch,
  COALESCE(o.new_branch, o.suggested_branch, c.branch) AS suggested_branch,
  COALESCE(c.invoices_count, 0)::numeric AS invoices_count,
  COALESCE(c.total_spent, 0)::numeric AS total_spent,
  COALESCE(c.last_purchase, c.last_order_date, c.updated_at::date) AS last_invoice_date,
  CASE
    WHEN c.branch IS NULL OR trim(c.branch) = '' OR c.branch IN ('غير محدد', 'unknown') THEN 'manual_review'
    WHEN o.id IS NOT NULL THEN 'high'
    ELSE 'fallback_customer'
  END AS confidence_level,
  CASE WHEN o.id IS NOT NULL THEN 'manual_approved' ELSE 'pending' END AS repair_status,
  CASE
    WHEN c.branch IS NULL OR trim(c.branch) = '' OR c.branch IN ('غير محدد', 'unknown') THEN 'فرع غير محدد في جدول العملاء'
    WHEN o.id IS NOT NULL THEN 'يوجد override معتمد'
    ELSE 'مراجعة دورية من جدول العملاء'
  END AS review_label,
  CASE
    WHEN COALESCE(NULLIF(c.phone, ''), NULLIF(c.mobile, ''), NULLIF(c.whatsapp, '')) IS NULL THEN NULL
    ELSE 'https://wa.me/2' || regexp_replace(COALESCE(c.phone, c.mobile, c.whatsapp, ''), '\D', '', 'g')
  END AS whatsapp_link
FROM public.customers c
LEFT JOIN LATERAL (
  SELECT * FROM public.customer_branch_overrides o
  WHERE o.customer_code = c.customer_code
    AND coalesce(o.status, 'approved') = 'approved'
  ORDER BY o.created_at DESC NULLS LAST
  LIMIT 1
) o ON true
WHERE c.customer_code IS NOT NULL
  AND (
    c.branch IS NULL
    OR trim(c.branch) = ''
    OR c.branch IN ('غير محدد', 'unknown')
    OR o.id IS NOT NULL
    OR COALESCE(NULLIF(c.phone, ''), NULLIF(c.mobile, ''), NULLIF(c.whatsapp, '')) IS NULL
  );

CREATE OR REPLACE VIEW public.dawaa_customer_branch_review_summary_v14 AS
SELECT
  confidence_level,
  repair_status,
  COUNT(*)::integer AS customers_count,
  SUM(total_spent)::numeric AS total_spent,
  SUM(invoices_count)::numeric AS invoices_count
FROM public.dawaa_customer_branch_review_queue_v14
GROUP BY confidence_level, repair_status;

CREATE OR REPLACE FUNCTION public.mark_customer_branch_repair_reviewed_v14(
  p_customer_code text,
  p_reviewed_by text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.customer_data_review_actions (customer_code, action_type, reviewed_by, reason)
  VALUES (p_customer_code, 'branch_reviewed', p_reviewed_by, 'تمت المراجعة من صفحة مراجعة بيانات العملاء');
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.ignore_customer_branch_repair_v14(
  p_customer_code text,
  p_reviewed_by text DEFAULT NULL,
  p_reason text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.customer_data_review_actions (customer_code, action_type, reviewed_by, reason)
  VALUES (p_customer_code, 'branch_ignored', p_reviewed_by, p_reason);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_customer_phone_v14_6(
  p_customer_code text,
  p_new_phone text,
  p_reviewed_by text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.customers
  SET phone = p_new_phone,
      mobile = COALESCE(NULLIF(mobile, ''), p_new_phone),
      whatsapp = COALESCE(NULLIF(whatsapp, ''), p_new_phone),
      updated_at = now()
  WHERE customer_code = p_customer_code;

  INSERT INTO public.customer_data_review_actions (customer_code, action_type, reviewed_by, reason, metadata)
  VALUES (p_customer_code, 'phone_updated', p_reviewed_by, 'تم تحديث رقم العميل من مراجعة البيانات', jsonb_build_object('new_phone', p_new_phone));
  RETURN FOUND;
END;
$$;
