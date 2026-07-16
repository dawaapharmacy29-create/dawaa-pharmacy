-- Doctor-requested followups: durable requester identity and real event timeline.
-- Safe additive migration: no deletes and no destructive column changes.

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

  UPDATE public.daily_followups
  SET requested_by_user_id = coalesce(requested_by_user_id, created_by_user_id, created_by::text),
      created_by_user_id = coalesce(created_by_user_id, created_by::text),
      source_type = coalesce(source_type, CASE WHEN request_source = 'sidebar_quick_followup' THEN 'doctor_requested_followup' END)
  WHERE requested_by_user_id IS NULL OR created_by_user_id IS NULL OR source_type IS NULL;
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
  v_event_type text;
  v_title text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event_type := 'created';
    v_title := 'تم إنشاء طلب المتابعة';
  ELSE
    IF row(NEW.status, NEW.followup_status, NEW.contact_status, NEW.contact_result,
           NEW.followup_result, NEW.followup_summary, NEW.followup_notes,
           NEW.service_notes, NEW.team_notes, NEW.customer_response,
           NEW.final_result, NEW.next_followup_date, NEW.responsible_name,
           NEW.assigned_to, NEW.assigned_doctor, NEW.completed_at,
           NEW.closed_at, NEW.postponed_until, NEW.contact_attempts)
       IS NOT DISTINCT FROM
       row(OLD.status, OLD.followup_status, OLD.contact_status, OLD.contact_result,
           OLD.followup_result, OLD.followup_summary, OLD.followup_notes,
           OLD.service_notes, OLD.team_notes, OLD.customer_response,
           OLD.final_result, OLD.next_followup_date, OLD.responsible_name,
           OLD.assigned_to, OLD.assigned_doctor, OLD.completed_at,
           OLD.closed_at, OLD.postponed_until, OLD.contact_attempts) THEN
      RETURN NEW;
    END IF;
    v_event_type := 'updated';
    v_title := 'تم تحديث المتابعة';
  END IF;

  INSERT INTO public.daily_followup_events (
    followup_id, event_type, title, status, notes, result, customer_response,
    responsible_name, actor_user_id, actor_name, metadata, created_at
  ) VALUES (
    NEW.id::text,
    v_event_type,
    v_title,
    coalesce(NEW.followup_status, NEW.status, NEW.contact_status),
    coalesce(NEW.followup_notes, NEW.service_notes, NEW.team_notes, NEW.notes),
    coalesce(NEW.final_result, NEW.followup_result, NEW.contact_result, NEW.followup_summary),
    NEW.customer_response,
    coalesce(NEW.responsible_name, NEW.assigned_to, NEW.assigned_doctor),
    coalesce(NEW.updated_by::text, NEW.created_by_user_id, NEW.created_by::text),
    coalesce(NEW.evaluated_by_name, NEW.created_by_name, NEW.updated_by::text, 'النظام'),
    jsonb_build_object(
      'next_followup_date', NEW.next_followup_date,
      'contact_attempts', coalesce(NEW.contact_attempts, 0),
      'completed_at', NEW.completed_at,
      'closed_at', NEW.closed_at,
      'postponed_until', NEW.postponed_until
    ),
    coalesce(NEW.updated_at, NEW.created_at, now())
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
    LEFT JOIN public.staff_accounts a
      ON a.id::text = coalesce(nullif(current_setting('app.current_user_id', true), ''),
                               nullif(current_setting('request.headers', true)::jsonb ->> 'x-dawaa-user-id', ''))
    WHERE f.id::text = daily_followup_events.followup_id
      AND (
        f.requested_by_staff_id = a.staff_id::text
        OR f.created_by_staff_id = a.staff_id::text
        OR f.requested_by_user_id = a.id::text
        OR f.created_by_user_id = a.id::text
        OR f.created_by::text = a.id::text
        OR a.role IN ('general_manager','executive_manager','branches_manager','branch_manager','customer_service_manager','customer_service')
      )
  )
);

DROP POLICY IF EXISTS daily_followup_events_service_write ON public.daily_followup_events;
CREATE POLICY daily_followup_events_service_write
ON public.daily_followup_events
FOR INSERT
WITH CHECK (true);

COMMENT ON TABLE public.daily_followup_events IS
'Immutable timeline of actual followup creation and meaningful updates; never fabricated from current status.';
