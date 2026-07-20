-- Performance indexes for advanced customer-service waiting and operations views.
create index if not exists daily_followups_open_branch_status_idx
  on public.daily_followups (branch, completed_at, is_hidden, next_followup_date);

create index if not exists daily_followups_waiting_contact_idx
  on public.daily_followups (contact_status, followup_status, response_status, contacted_at)
  where completed_at is null and coalesce(is_hidden, false) = false;

create index if not exists daily_followups_assignee_open_idx
  on public.daily_followups (responsible_name, assigned_to, assigned_doctor, next_followup_date)
  where completed_at is null and coalesce(is_hidden, false) = false;
