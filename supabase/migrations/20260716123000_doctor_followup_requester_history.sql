-- Doctor-requested followups: durable requester identity and real event timeline.
-- Safe additive migration: no deletes and no destructive column changes.
-- This version is schema-tolerant and does not require source_type/request_source
-- or any optional daily_followups column to exist.

DO $$
BEGIN
  IF to_regclass('public.daily_followups') IS NULL THEN
    RAISE NOTICE 'daily_followups is missing; requester/history migration skipped';
    RETURN;
  END IF;

  ALTER TABLE public.daily_followups
    ADD COLUMN IF NOT EXISTS requested_by_staff_id text,
    ADD COLUMN IF NOT EXISTS requested_by_user_id text,
    ADD COLUMN IF NOT EXISTS created_by_staff_id text,
    ADD COLUMN IF NOT EXISTS created_by_user_id text,
    ADD COLUMN IF NOT EXISTS contact_attempts integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS final_result text,
    ADD COLUMN IF NOT EXISTS customer_response text;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'daily_followups' AND column_name = 'created_by'
  ) THEN
    EXECUTE $sql$
      UPDATE public.daily_followups
      SET requested_by_user_id = coalesce(requested_by_user_id, created_by_user_id, created_by::text),
          created_by_user_id = coalesce(created_by_user_id, created_by::text)
      WHERE requested_by_user_id IS NULL OR created_by_user_id IS NULL
    $sql$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'daily_followups' AND column_name = 'source_type'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'daily_followups' AND column_name = 'request_source'
  ) THEN
    EXECUTE $sql$
      UPDATE public.daily_followups
      SET source_type = coalesce(
        source_type,
        CASE WHEN request_source = 'sidebar_quick_followup' THEN 'doctor_requested_followup' END
      )
      WHERE source_type IS NULL
    $sql$;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.daily_followup_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  followup_id text NOT NULL,
  event_type text NOT NULL DEFAULT 'update',
  title text,
  status text,
  notes text,
  result text,
  customer_response text,
  responsible_name text,
  actor_staff_id text,
  actor_user_id text,
  actor_name text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_followup_events_followup_time
  ON public.daily_followup_events(followup_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_daily_followups_requested_staff
  ON public.daily_followups(requested_by_staff_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_daily_followups_requested_user
  ON public.daily_followups(requested_by_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.dawaa_followup_event_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  v_event_type text;
  v_title text;
  v_status text;
  v_notes text;
  v_result text;
  v_customer_response text;
  v_responsible_name text;
  v_actor_staff_id text;
  v_actor_user_id text;
  v_actor_name text;
  v_created_at timestamptz;
  v_new_snapshot jsonb;
  v_old_snapshot jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event_type := 'created';
    v_title := 'تم إنشاء طلب المتابعة';
  ELSE
    v_new_snapshot := jsonb_build_object(
      'status', v_new ->> 'status',
      'followup_status', v_new ->> 'followup_status',
      'contact_status', v_new ->> 'contact_status',
      'contact_result', v_new ->> 'contact_result',
      'followup_result', v_new ->> 'followup_result',
      'followup_summary', v_new ->> 'followup_summary',
      'followup_notes', v_new ->> 'followup_notes',
      'service_notes', v_new ->> 'service_notes',
      'team_notes', v_new ->> 'team_notes',
      'customer_response', v_new ->> 'customer_response',
      'final_result', v_new ->> 'final_result',
      'next_followup_date', v_new ->> 'next_followup_date',
      'responsible_name', v_new ->> 'responsible_name',
      'assigned_to', v_new ->> 'assigned_to',
      'assigned_doctor', v_new ->> 'assigned_doctor',
      'completed_at', v_new ->> 'completed_at',
      'closed_at', v_new ->> 'closed_at',
      'postponed_until', v_new ->> 'postponed_until',
      'contact_attempts', v_new ->> 'contact_attempts'
    );

    v_old_snapshot := jsonb_build_object(
      'status', v_old ->> 'status',
      'followup_status', v_old ->> 'followup_status',
      'contact_status', v_old ->> 'contact_status',
      'contact_result', v_old ->> 'contact_result',
      'followup_result', v_old ->> 'followup_result',
      'followup_summary', v_old ->> 'followup_summary',
      'followup_notes', v_old ->> 'followup_notes',
      'service_notes', v_old ->> 'service_notes',
      'team_notes', v_old ->> 'team_notes',
      'customer_response', v_old ->> 'customer_response',
      'final_result', v_old ->> 'final_result',
      'next_followup_date', v_old ->> 'next_followup_date',
      'responsible_name', v_old ->> 'responsible_name',
      'assigned_to', v_old ->> 'assigned_to',
      'assigned_doctor', v_old ->> 'assigned_doctor',
      'completed_at', v_old ->> 'completed_at',
      'closed_at', v_old ->> 'closed_at',
      'postponed_until', v_old ->> 'postponed_until',
      'contact_attempts', v_old ->> 'contact_attempts'
    );

    IF v_new_snapshot IS NOT DISTINCT FROM v_old_snapshot THEN
      RETURN NEW;
    END IF;

    v_event_type := 'updated';
    v_title := 'تم تحديث المتابعة';
  END IF;

  v_status := coalesce(v_new ->> 'followup_status', v_new ->> 'status', v_new ->> 'contact_status');
  v_notes := coalesce(v_new ->> 'followup_notes', v_new ->> 'service_notes', v_new ->> 'team_notes', v_new ->> 'notes');
  v_result := coalesce(v_new ->> 'final_result', v_new ->> 'followup_result', v_new ->> 'contact_result', v_new ->> 'followup_summary');
  v_customer_response := v_new ->> 'customer_response';
  v_responsible_name := coalesce(v_new ->> 'responsible_name', v_new ->> 'assigned_to', v_new ->> 'assigned_doctor');
  v_actor_staff_id := coalesce(v_new ->> 'updated_by_staff_id', v_new ->> 'created_by_staff_id', v_new ->> 'requested_by_staff_id');
  v_actor_user_id := coalesce(v_new ->> 'updated_by', v_new ->> 'created_by_user_id', v_new ->> 'requested_by_user_id', v_new ->> 'created_by');
  v_actor_name := coalesce(v_new ->> 'evaluated_by_name', v_new ->> 'created_by_name', v_new ->> 'updated_by_name', v_new ->> 'updated_by', 'النظام');
  v_created_at := coalesce(
    nullif(v_new ->> 'updated_at', '')::timestamptz,
    nullif(v_new ->> 'created_at', '')::timestamptz,
    now()
  );

  INSERT INTO public.daily_followup_events (
    followup_id,
    event_type,
    title,
    status,
    notes,
    result,
    customer_response,
    responsible_name,
    actor_staff_id,
    actor_user_id,
    actor_name,
    metadata,
    created_at
  ) VALUES (
    (v_new ->> 'id'),
    v_event_type,
    v_title,
    v_status,
    v_notes,
    v_result,
    v_customer_response,
    v_responsible_name,
    v_actor_staff_id,
    v_actor_user_id,
    v_actor_name,
    jsonb_build_object(
      'next_followup_date', v_new ->> 'next_followup_date',
      'contact_attempts', coalesce(nullif(v_new ->> 'contact_attempts', '')::integer, 0),
      'completed_at', v_new ->> 'completed_at',
      'closed_at', v_new ->> 'closed_at',
      'postponed_until', v_new ->> 'postponed_until'
    ),
    v_created_at
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_daily_followups_event_snapshot ON public.daily_followups;
CREATE TRIGGER trg_daily_followups_event_snapshot
AFTER INSERT OR UPDATE ON public.daily_followups
FOR EACH ROW EXECUTE FUNCTION public.dawaa_followup_event_snapshot();

ALTER TABLE public.daily_followup_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_followup_events_personal_read ON public.daily_followup_events;
CREATE POLICY daily_followup_events_personal_read
ON public.daily_followup_events
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.daily_followups f
    JOIN public.staff_accounts a
      ON a.id::text = coalesce(
        nullif(current_setting('app.current_user_id', true), ''),
        nullif((coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'x-dawaa-user-id'), '')
      )
    WHERE f.id::text = daily_followup_events.followup_id
      AND (
        f.requested_by_staff_id = a.staff_id::text
        OR f.created_by_staff_id = a.staff_id::text
        OR f.requested_by_user_id = a.id::text
        OR f.created_by_user_id = a.id::text
        OR (
          to_jsonb(f) ? 'created_by'
          AND to_jsonb(f) ->> 'created_by' = a.id::text
        )
        OR a.role IN (
          'general_manager',
          'executive_manager',
          'branches_manager',
          'branch_manager',
          'customer_service_manager',
          'customer_service'
        )
      )
  )
);

-- No direct INSERT policy is needed: the SECURITY DEFINER trigger writes timeline rows.
DROP POLICY IF EXISTS daily_followup_events_service_write ON public.daily_followup_events;

COMMENT ON TABLE public.daily_followup_events IS
'Immutable timeline of actual followup creation and meaningful updates; never fabricated from current status.';
