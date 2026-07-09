-- Strong daily customer-service generator RPC.
-- It creates exactly 30 core followups per branch when enough candidates exist:
--   10 important/VIP + 10 at-risk older than 60 days + 10 stopped/strong-history older than 90 days.
-- It never duplicates the same canonical customer key for the same branch/day.

CREATE OR REPLACE FUNCTION public.dawaa_customer_followup_key(
  p_customer_id text,
  p_customer_code text,
  p_customer_phone text,
  p_customer_name text,
  p_branch text
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(nullif(trim(coalesce(
    nullif(p_customer_id, ''),
    nullif(p_customer_code, ''),
    nullif(regexp_replace(coalesce(p_customer_phone, ''), '[^0-9]', '', 'g'), ''),
    nullif(regexp_replace(coalesce(p_customer_name, ''), '\s+', ' ', 'g'), '') || ':' || nullif(regexp_replace(coalesce(p_branch, ''), '\s+', ' ', 'g'), '')
  )), ''));
$$;

CREATE OR REPLACE FUNCTION public.dawaa_generate_customer_service_daily_followups_v2(
  p_branch text DEFAULT NULL,
  p_created_by_name text DEFAULT 'خدمة العملاء',
  p_followup_day date DEFAULT CURRENT_DATE
) RETURNS TABLE(branch text, created_count integer, skipped_duplicates integer, candidate_count integer)
LANGUAGE plpgsql
AS $$
DECLARE
  v_branch text;
  v_created integer;
  v_skipped integer;
  v_candidates integer;
BEGIN
  IF to_regclass('public.daily_followups') IS NULL THEN
    RAISE EXCEPTION 'daily_followups table is required';
  END IF;
  IF to_regclass('public.dawaa_customer_metrics_app_view') IS NULL THEN
    RAISE EXCEPTION 'dawaa_customer_metrics_app_view is required';
  END IF;

  FOR v_branch IN
    SELECT unnest(CASE
      WHEN p_branch IS NULL OR trim(p_branch) = '' OR p_branch IN ('الكل','كل الفروع','all')
        THEN ARRAY['فرع الشامي','فرع شكري']::text[]
      ELSE ARRAY[p_branch]::text[]
    END)
  LOOP
    WITH candidates AS (
      SELECT
        c.*,
        CASE
          WHEN coalesce(c.segment, c.type, '') IN ('مهم جدًا','VIP','vip','مهم جدا') OR coalesce(c.total_spent, c.total_purchases, 0) >= 8000 THEN 'important_vip'
          WHEN coalesce(c.customer_status, c.status, '') ILIKE '%مهدد%' OR (c.last_purchase IS NOT NULL AND c.last_purchase::date <= p_followup_day - interval '60 days') THEN 'at_risk_60'
          WHEN coalesce(c.customer_status, c.status, '') ILIKE '%متوقف%' OR (c.last_purchase IS NOT NULL AND c.last_purchase::date <= p_followup_day - interval '90 days') THEN 'stopped_strong'
          ELSE 'other'
        END AS bucket,
        public.dawaa_customer_followup_key(
          c.customer_id::text,
          c.customer_code::text,
          c.customer_phone::text,
          c.customer_name::text,
          c.branch::text
        ) AS canonical_key,
        row_number() OVER (
          PARTITION BY
            CASE
              WHEN coalesce(c.segment, c.type, '') IN ('مهم جدًا','VIP','vip','مهم جدا') OR coalesce(c.total_spent, c.total_purchases, 0) >= 8000 THEN 'important_vip'
              WHEN coalesce(c.customer_status, c.status, '') ILIKE '%مهدد%' OR (c.last_purchase IS NOT NULL AND c.last_purchase::date <= p_followup_day - interval '60 days') THEN 'at_risk_60'
              WHEN coalesce(c.customer_status, c.status, '') ILIKE '%متوقف%' OR (c.last_purchase IS NOT NULL AND c.last_purchase::date <= p_followup_day - interval '90 days') THEN 'stopped_strong'
              ELSE 'other'
            END
          ORDER BY coalesce(c.avg_monthly, 0) DESC, coalesce(c.total_spent, c.total_purchases, 0) DESC, c.last_purchase NULLS FIRST
        ) AS bucket_rank
      FROM public.dawaa_customer_metrics_app_view c
      WHERE c.branch = v_branch
        AND coalesce(c.customer_name, c.customer_code, c.customer_phone) IS NOT NULL
    ), selected AS (
      SELECT * FROM candidates WHERE bucket = 'important_vip' AND bucket_rank <= 10
      UNION ALL
      SELECT * FROM candidates WHERE bucket = 'at_risk_60' AND bucket_rank <= 10
      UNION ALL
      SELECT * FROM candidates WHERE bucket = 'stopped_strong' AND bucket_rank <= 10
    ), deduped AS (
      SELECT DISTINCT ON (canonical_key) *
      FROM selected
      WHERE canonical_key IS NOT NULL
      ORDER BY canonical_key, bucket_rank
    ), insertable AS (
      SELECT d.*
      FROM deduped d
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.daily_followups f
        WHERE coalesce(f.followup_day, f.followup_date::date, f.followup_datetime::date, f.date::date, f.created_at::date) = p_followup_day
          AND coalesce(f.branch, '') = coalesce(v_branch, '')
          AND coalesce(f.cancelled_at, null) IS NULL
          AND coalesce(f.canonical_customer_key, public.dawaa_customer_followup_key(f.customer_id::text, f.customer_code::text, coalesce(f.customer_phone::text, f.phone::text), f.customer_name::text, f.branch::text)) = d.canonical_key
      )
    ), inserted AS (
      INSERT INTO public.daily_followups (
        date, followup_day, followup_date, followup_datetime,
        customer_id, customer_code, customer_name, name, customer_phone, phone,
        branch, segment, classification, customer_status, total_spent, last_purchase_date,
        followup_type, category, source_type, source_reason, canonical_customer_key,
        priority, followup_reason, suggested_action,
        status, followup_status, contact_status,
        assigned_to, responsible_name, created_by_name, notes
      )
      SELECT
        p_followup_day, p_followup_day, p_followup_day, now(),
        i.customer_id, i.customer_code, i.customer_name, i.customer_name, i.customer_phone, i.customer_phone,
        v_branch, i.segment, i.segment, i.customer_status, coalesce(i.total_spent, i.total_purchases, 0), i.last_purchase,
        'smart_daily_core',
        CASE i.bucket
          WHEN 'important_vip' THEN '10 عملاء مهمين / VIP'
          WHEN 'at_risk_60' THEN '10 عملاء مهددين بالتوقف أكثر من شهرين'
          WHEN 'stopped_strong' THEN '10 عملاء متوقفين فترة كبيرة'
          ELSE 'قائمة يومية'
        END,
        'daily_core',
        CASE i.bucket
          WHEN 'important_vip' THEN 'عميل مهم أو مهم جدًا يحتاج متابعة جودة واحتياجات شهرية'
          WHEN 'at_risk_60' THEN 'عميل مهدد بالتوقف ولم يتعامل منذ أكثر من شهرين'
          WHEN 'stopped_strong' THEN 'عميل متوقف فترة كبيرة وله تاريخ تعامل جيد'
          ELSE 'قائمة يومية'
        END,
        i.canonical_key,
        CASE WHEN i.bucket IN ('at_risk_60','stopped_strong') THEN 'عاجل' ELSE 'مهم' END,
        CASE i.bucket
          WHEN 'important_vip' THEN 'متابعة احتياجات العميل الشهرية وتحسين الولاء'
          WHEN 'at_risk_60' THEN 'منع توقف العميل ومعرفة سبب قلة التعامل'
          WHEN 'stopped_strong' THEN 'استرجاع عميل متوقف كان يتعامل جيدًا'
          ELSE 'متابعة دورية'
        END,
        'تواصل احترافي وتسجيل نتيجة واضحة وموعد متابعة قادم عند الحاجة',
        'معلق', 'معلق', 'معلق',
        coalesce(p_created_by_name, 'خدمة العملاء'), coalesce(p_created_by_name, 'خدمة العملاء'), p_created_by_name,
        'تم الإنشاء من daw aa daily followups v2'
      FROM insertable i
      ON CONFLICT DO NOTHING
      RETURNING id
    )
    SELECT
      (SELECT count(*) FROM inserted),
      (SELECT count(*) FROM selected) - (SELECT count(*) FROM insertable),
      (SELECT count(*) FROM selected)
    INTO v_created, v_skipped, v_candidates;

    branch := v_branch;
    created_count := coalesce(v_created, 0);
    skipped_duplicates := coalesce(v_skipped, 0);
    candidate_count := coalesce(v_candidates, 0);
    RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.dawaa_generate_customer_service_daily_followups_v2(text, text, date) IS
'Creates the core 30-per-branch daily customer-service followups with strong dedupe and source_type=daily_core.';
