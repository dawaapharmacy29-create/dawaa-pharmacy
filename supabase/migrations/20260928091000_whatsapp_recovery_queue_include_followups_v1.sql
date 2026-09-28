create or replace view public.whatsapp_recovery_work_queue_v2 as
select
  q.action_id,
  q.source_id,
  q.action_key,
  q.action_type,
  q.materialization_status,
  q.work_status,
  q.confidence,
  q.auto_eligible,
  q.branch,
  q.customer_id,
  q.customer_code,
  q.customer_name,
  q.customer_phone,
  q.staff_id,
  q.staff_name,
  q.product_id,
  q.product_code,
  q.product_name,
  q.quantity,
  q.due_at,
  q.reason,
  q.assigned_to_id,
  q.assigned_to_name,
  q.assigned_at,
  q.started_at,
  q.completed_at,
  q.outcome,
  q.outcome_note,
  q.recovered_invoice_id,
  q.recovered_invoice_number,
  q.recovered_invoice_value,
  q.recovered_at,
  q.created_at,
  q.updated_at,
  q.conversation_started_at,
  q.conversation_ended_at,
  q.invoice_match_status,
  q.matched_invoice_number,
  q.matched_invoice_value,
  q.analysis_confidence,
  q.review_status,
  q.work_priority_rank,
  a.followup_attempts,
  a.next_followup_at,
  a.last_followup_at,
  a.sla_due_at,
  a.sla_breached_at,
  a.payload as action_payload,
  case
    when a.work_status not in ('completed','cancelled','failed')
      and coalesce(a.next_followup_at, a.sla_due_at, a.due_at) < now()
    then true else false
  end as is_overdue,
  greatest(
    0::numeric,
    extract(epoch from (now() - coalesce(a.next_followup_at, a.sla_due_at, a.due_at))) / 3600.0
  ) as overdue_hours
from public.whatsapp_recovery_work_queue_v1 q
join public.whatsapp_conversation_actions a on a.id = q.action_id
where
  q.action_key like 'recovery:%'
  or q.action_type in ('complaint_followup','customer_followup');
