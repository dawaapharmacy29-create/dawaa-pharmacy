-- Dawaa Pharmacy - Conversation Reviews Stability & History Upgrade
-- شغّل هذا الملف مرة واحدة من Supabase SQL Editor
-- الهدف: منع فشل حفظ تقييم المحادثات بسبب اختلاف الأعمدة + تفعيل سجل تقييمات المحادثات + فهارس للسرعة

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.conversation_sales_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.conversation_sales_reviews
  ADD COLUMN IF NOT EXISTS reviewer_id uuid,
  ADD COLUMN IF NOT EXISTS reviewer_name text,
  ADD COLUMN IF NOT EXISTS reviewer_role text,
  ADD COLUMN IF NOT EXISTS staff_id uuid,
  ADD COLUMN IF NOT EXISTS doctor_id uuid,
  ADD COLUMN IF NOT EXISTS staff_name text,
  ADD COLUMN IF NOT EXISTS doctor_name text,
  ADD COLUMN IF NOT EXISTS staff_role text,
  ADD COLUMN IF NOT EXISTS branch text,
  ADD COLUMN IF NOT EXISTS branch_id uuid,
  ADD COLUMN IF NOT EXISTS customer_id text,
  ADD COLUMN IF NOT EXISTS customer_name text,
  ADD COLUMN IF NOT EXISTS customer_code text,
  ADD COLUMN IF NOT EXISTS customer_phone text,
  ADD COLUMN IF NOT EXISTS evaluation_kind text,
  ADD COLUMN IF NOT EXISTS conversation_type text,
  ADD COLUMN IF NOT EXISTS conversation_date timestamptz,
  ADD COLUMN IF NOT EXISTS invoice_number text,
  ADD COLUMN IF NOT EXISTS invoice_time timestamptz,
  ADD COLUMN IF NOT EXISTS evaluation_reason text,
  ADD COLUMN IF NOT EXISTS base_score numeric DEFAULT 100,
  ADD COLUMN IF NOT EXISTS positive_points numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS negative_points numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS severe_error_points numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_score numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_score numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS level text,
  ADD COLUMN IF NOT EXISTS conversation_level text,
  ADD COLUMN IF NOT EXISTS point_impact numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS base_points_impact numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extra_penalty_points numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS doctor_points_impact numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS impact_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS total_applicable_items integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_not_applicable_items integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_applicable_points numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS earned_points numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS main_positive_reason text,
  ADD COLUMN IF NOT EXISTS main_negative_reason text,
  ADD COLUMN IF NOT EXISTS top_positive_reason text,
  ADD COLUMN IF NOT EXISTS top_deduction_reason text,
  ADD COLUMN IF NOT EXISTS forgotten_customer boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS missed_sales_opportunity boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS missed_sale_opportunity boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS successful_cross_sell boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS handled_angry_customer_well boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS excellent_case boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_critical_error boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS repeated_error_type text,
  ADD COLUMN IF NOT EXISTS repeat_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS repeat_multiplier numeric DEFAULT 1,
  ADD COLUMN IF NOT EXISTS month_cycle text,
  ADD COLUMN IF NOT EXISTS raw_scores jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS review_items jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS first_customer_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_staff_reply_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_response_minutes integer,
  ADD COLUMN IF NOT EXISTS response_speed_score numeric,
  ADD COLUMN IF NOT EXISTS greeting_score numeric,
  ADD COLUMN IF NOT EXISTS greeting_message_used text,
  ADD COLUMN IF NOT EXISTS doctor_name_used_in_greeting boolean,
  ADD COLUMN IF NOT EXISTS doctor_name_used boolean,
  ADD COLUMN IF NOT EXISTS doctor_name_score numeric,
  ADD COLUMN IF NOT EXISTS customer_name_used boolean,
  ADD COLUMN IF NOT EXISTS customer_name_score numeric,
  ADD COLUMN IF NOT EXISTS tone_language_score numeric,
  ADD COLUMN IF NOT EXISTS bad_tone_flag boolean,
  ADD COLUMN IF NOT EXISTS severe_bad_tone_flag boolean,
  ADD COLUMN IF NOT EXISTS understanding_score numeric,
  ADD COLUMN IF NOT EXISTS rushed_response_flag boolean,
  ADD COLUMN IF NOT EXISTS misunderstood_customer_flag boolean,
  ADD COLUMN IF NOT EXISTS follow_up_promised boolean,
  ADD COLUMN IF NOT EXISTS follow_up_delay_minutes integer,
  ADD COLUMN IF NOT EXISTS follow_up_score numeric,
  ADD COLUMN IF NOT EXISTS consultation_quality_score numeric,
  ADD COLUMN IF NOT EXISTS dosage_explanation_score numeric,
  ADD COLUMN IF NOT EXISTS alternative_handling_score numeric,
  ADD COLUMN IF NOT EXISTS bad_alternative_flag boolean,
  ADD COLUMN IF NOT EXISTS sales_quality_score numeric,
  ADD COLUMN IF NOT EXISTS upsell_cross_sell_score numeric,
  ADD COLUMN IF NOT EXISTS complaint_handling_score numeric,
  ADD COLUMN IF NOT EXISTS order_confirmation_score numeric,
  ADD COLUMN IF NOT EXISTS closing_message_score numeric,
  ADD COLUMN IF NOT EXISTS closing_message_used boolean,
  ADD COLUMN IF NOT EXISTS has_complaint boolean,
  ADD COLUMN IF NOT EXISTS has_medical_error boolean,
  ADD COLUMN IF NOT EXISTS has_invoice_error boolean,
  ADD COLUMN IF NOT EXISTS has_delivery_issue boolean,
  ADD COLUMN IF NOT EXISTS reviewer_notes text,
  ADD COLUMN IF NOT EXISTS training_recommendation text;

-- لو عندك عمود doctor_name فارغ والقديم بيحفظ في staff_name
UPDATE public.conversation_sales_reviews
SET doctor_name = COALESCE(doctor_name, staff_name)
WHERE doctor_name IS NULL AND staff_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS conversation_sales_reviews_created_at_idx
  ON public.conversation_sales_reviews (created_at DESC);

CREATE INDEX IF NOT EXISTS conversation_sales_reviews_branch_created_at_idx
  ON public.conversation_sales_reviews (branch, created_at DESC);

CREATE INDEX IF NOT EXISTS conversation_sales_reviews_staff_created_at_idx
  ON public.conversation_sales_reviews (staff_id, created_at DESC);

CREATE INDEX IF NOT EXISTS conversation_sales_reviews_reviewer_created_at_idx
  ON public.conversation_sales_reviews (reviewer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS conversation_sales_reviews_month_cycle_idx
  ON public.conversation_sales_reviews (month_cycle);

CREATE INDEX IF NOT EXISTS conversation_sales_reviews_score_idx
  ON public.conversation_sales_reviews (final_score);

ALTER TABLE public.conversation_sales_reviews ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'conversation_sales_reviews'
      AND policyname = 'conversation_sales_reviews_select_all'
  ) THEN
    CREATE POLICY conversation_sales_reviews_select_all
      ON public.conversation_sales_reviews
      FOR SELECT
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'conversation_sales_reviews'
      AND policyname = 'conversation_sales_reviews_insert_all'
  ) THEN
    CREATE POLICY conversation_sales_reviews_insert_all
      ON public.conversation_sales_reviews
      FOR INSERT
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'conversation_sales_reviews'
      AND policyname = 'conversation_sales_reviews_update_all'
  ) THEN
    CREATE POLICY conversation_sales_reviews_update_all
      ON public.conversation_sales_reviews
      FOR UPDATE
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- تحديث تلقائي لعمود updated_at عند التعديل
CREATE OR REPLACE FUNCTION public.set_conversation_review_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_conversation_review_updated_at ON public.conversation_sales_reviews;
CREATE TRIGGER trg_conversation_review_updated_at
BEFORE UPDATE ON public.conversation_sales_reviews
FOR EACH ROW
EXECUTE FUNCTION public.set_conversation_review_updated_at();

SELECT 'CONVERSATION_REVIEWS_HISTORY_FIX completed successfully' AS result;
