-- Customer Service daily followup hardening
-- Required business rule:
--   30 core followups per branch/day: 10 important/VIP + 10 at-risk >60d + 10 stopped/strong-history.
--   Extra rows may appear only as quick_followup, scheduled_followup, carried_over, or doctor_requested_followup.
--   The same customer must not appear twice for the same branch/day.

DO $$
BEGIN
  IF to_regclass('public.daily_followups') IS NULL THEN
    RAISE NOTICE 'daily_followups table not found; skipping customer service followup hardening';
    RETURN;
  END IF;

  ALTER TABLE public.daily_followups
    ADD COLUMN IF NOT EXISTS canonical_customer_key text,
    ADD COLUMN IF NOT EXISTS source_type text,
    ADD COLUMN IF NOT EXISTS source_tags text[],
    ADD COLUMN IF NOT EXISTS source_reason text,
    ADD COLUMN IF NOT EXISTS followup_day date;
END $$;

CREATE OR REPLACE FUNCTION public.dawaa_normalize_customer_followup_key(
  p_customer_id text,
  p_customer_code text,
  p_customer_phone text,
  p_phone text,
  p_customer_name text,
  p_branch text
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(nullif(trim(coalesce(
    nullif(p_customer_id, ''),
    nullif(p_customer_code, ''),
    nullif(regexp_replace(coalesce(p_customer_phone, p_phone, ''), '[^0-9]', '', 'g'), ''),
    nullif(regexp_replace(coalesce(p_customer_name, ''), '\s+', ' ', 'g'), '') || ':' || nullif(regexp_replace(coalesce(p_branch, ''), '\s+', ' ', 'g'), '')
  )), ''));
$$;

DO $$
BEGIN
  IF to_regclass('public.daily_followups') IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.daily_followups
  SET
    canonical_customer_key = public.dawaa_normalize_customer_followup_key(
      customer_id::text,
      customer_code::text,
      customer_phone::text,
      phone::text,
      customer_name::text,
      branch::text
    ),
    followup_day = coalesce(
      followup_date::date,
      followup_datetime::date,
      date::date,
      created_at::date,
      now()::date
    ),
    source_type = coalesce(
      nullif(source_type, ''),
      CASE
        WHEN request_type = 'doctor_requested_followup' OR followup_type IN ('doctor_request', 'doctor_requested_followup') THEN 'doctor_requested_followup'
        WHEN followup_type = 'exceptional' OR request_details IS NOT NULL OR request_type IS NOT NULL THEN 'quick_followup'
        WHEN next_followup_date::date = current_date OR followup_date::date = current_date THEN 'scheduled_followup'
        WHEN created_at::date < current_date AND completed_at IS NULL AND cancelled_at IS NULL THEN 'carried_over'
        ELSE 'daily_core'
      END
    ),
    source_reason = coalesce(source_reason, followup_reason, suggested_action, category, notes)
  WHERE canonical_customer_key IS NULL
     OR followup_day IS NULL
     OR source_type IS NULL
     OR source_reason IS NULL;

  -- Keep one row only for each customer/branch/day before adding the unique index.
  WITH ranked AS (
    SELECT
      id,
      row_number() OVER (
        PARTITION BY followup_day, coalesce(branch, ''), canonical_customer_key
        ORDER BY
          CASE WHEN completed_at IS NULL AND cancelled_at IS NULL THEN 0 ELSE 1 END,
          coalesce(updated_at, created_at, followup_datetime, now()) DESC,
          id DESC
      ) AS rn
    FROM public.daily_followups
    WHERE canonical_customer_key IS NOT NULL
      AND followup_day IS NOT NULL
  )
  DELETE FROM public.daily_followups d
  USING ranked r
  WHERE d.id = r.id
    AND r.rn > 1;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_followups_branch_day_customer
ON public.daily_followups (followup_day, coalesce(branch, ''), canonical_customer_key)
WHERE canonical_customer_key IS NOT NULL
  AND followup_day IS NOT NULL
  AND cancelled_at IS NULL;

CREATE OR REPLACE VIEW public.dawaa_customer_service_current_queue_v166 AS
SELECT
  d.*,
  CASE
    WHEN d.source_type = 'daily_core' THEN 'القائمة اليومية الأساسية'
    WHEN d.source_type = 'quick_followup' THEN 'متابعة سريعة'
    WHEN d.source_type = 'scheduled_followup' THEN 'متابعة مجدولة اليوم'
    WHEN d.source_type = 'carried_over' THEN 'مرحلة من يوم سابق'
    WHEN d.source_type = 'doctor_requested_followup' THEN 'طلب متابعة من دكتور'
    ELSE coalesce(d.category, d.followup_type, 'متابعة')
  END AS source_type_label,
  CASE
    WHEN d.source_type = 'daily_core' AND d.category ILIKE '%مهم%' THEN '10 عملاء مهمين / مهمين جدًا'
    WHEN d.source_type = 'daily_core' AND (d.customer_status ILIKE '%مهدد%' OR d.category ILIKE '%مهدد%') THEN '10 عملاء مهددين بالتوقف أكثر من شهرين'
    WHEN d.source_type = 'daily_core' AND (d.customer_status ILIKE '%متوقف%' OR d.category ILIKE '%متوقف%') THEN '10 عملاء متوقفين من فترة كبيرة'
    ELSE coalesce(d.source_reason, d.followup_reason, d.suggested_action, d.request_details, d.notes)
  END AS appearance_reason
FROM public.daily_followups d
WHERE d.cancelled_at IS NULL
  AND (
    d.followup_day = current_date
    OR d.followup_date::date = current_date
    OR d.followup_datetime::date = current_date
    OR d.next_followup_date::date = current_date
    OR (d.completed_at IS NULL AND d.postponed_until IS NULL AND coalesce(d.followup_day, d.created_at::date) < current_date)
  );

COMMENT ON VIEW public.dawaa_customer_service_current_queue_v166 IS
'Current customer service queue: core daily followups + quick + scheduled + carry-over rows, protected from duplicate customer rows per branch/day.';
