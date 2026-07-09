-- Customer service alert layer
-- This view powers the bottom ticker and manager notifications in the application.
-- It is intentionally read-only and defensive; the frontend still falls back to daily_followups if this view is not applied yet.

CREATE OR REPLACE VIEW public.customer_service_overdue_followup_alerts_v1 AS
WITH base AS (
  SELECT
    d.*,
    coalesce(
      d.followup_datetime,
      d.followup_date::timestamp with time zone,
      d.next_followup_date::timestamp with time zone,
      d.date::timestamp with time zone,
      d.created_at
    ) AS due_at
  FROM public.daily_followups d
  WHERE d.cancelled_at IS NULL
    AND d.completed_at IS NULL
    AND d.postponed_until IS NULL
)
SELECT
  b.id,
  b.customer_id,
  b.customer_code,
  b.customer_name,
  b.name,
  b.customer_phone,
  b.phone,
  b.branch,
  b.responsible_name,
  b.assigned_to,
  b.assigned_doctor,
  b.followup_datetime,
  b.followup_date,
  b.next_followup_date,
  b.date,
  b.created_at,
  b.status,
  b.followup_status,
  b.contact_status,
  b.completed_at,
  b.cancelled_at,
  b.postponed_until,
  b.source_type,
  CASE
    WHEN b.source_type = 'daily_core' THEN 'القائمة اليومية الأساسية'
    WHEN b.source_type = 'quick_followup' THEN 'متابعة سريعة'
    WHEN b.source_type = 'scheduled_followup' THEN 'متابعة مجدولة'
    WHEN b.source_type = 'carried_over' THEN 'متابعة مرحلة'
    WHEN b.source_type = 'doctor_requested_followup' THEN 'طلب متابعة من دكتور'
    ELSE coalesce(b.category, b.followup_type, 'متابعة')
  END AS source_type_label,
  coalesce(b.source_reason, b.followup_reason, b.suggested_action, b.request_details, b.notes) AS appearance_reason,
  b.due_at,
  greatest(0, floor(extract(epoch from (now() - b.due_at)) / 60))::int AS minutes_late,
  CASE
    WHEN now() - b.due_at >= interval '2 hours' THEN 'critical'
    WHEN now() - b.due_at >= interval '1 hour' THEN 'urgent'
    ELSE 'high'
  END AS alert_priority
FROM base b
WHERE b.due_at IS NOT NULL
  AND now() - b.due_at >= interval '15 minutes'
ORDER BY minutes_late DESC;

COMMENT ON VIEW public.customer_service_overdue_followup_alerts_v1 IS
'Open customer service followups delayed by at least 15 minutes. Used by GlobalCustomerServiceAlerts for manager and branch alerts.';

CREATE OR REPLACE VIEW public.customer_service_daily_queue_mix_v1 AS
SELECT
  coalesce(followup_day, followup_date::date, followup_datetime::date, date::date, created_at::date) AS followup_day,
  branch,
  coalesce(source_type, 'unknown') AS source_type,
  count(*) AS rows_count,
  count(*) FILTER (WHERE completed_at IS NULL AND cancelled_at IS NULL) AS open_count,
  count(*) FILTER (WHERE completed_at IS NOT NULL) AS completed_count
FROM public.daily_followups
GROUP BY 1, 2, 3;

COMMENT ON VIEW public.customer_service_daily_queue_mix_v1 IS
'Daily customer-service queue mix by branch/source_type: daily_core, quick_followup, scheduled_followup, carried_over, doctor_requested_followup.';
