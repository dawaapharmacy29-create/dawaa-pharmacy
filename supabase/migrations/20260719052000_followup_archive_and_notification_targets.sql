-- Preserve followups while allowing managers to remove invalid rows from operational queues.
alter table public.daily_followups
  add column if not exists is_hidden boolean not null default false,
  add column if not exists hidden_at timestamptz,
  add column if not exists hidden_by text,
  add column if not exists hidden_reason text;

create index if not exists daily_followups_visible_queue_idx
  on public.daily_followups (branch, created_at desc)
  where is_hidden = false;

comment on column public.daily_followups.is_hidden is
  'Soft archive flag. Hidden followups remain available for audit and are never physically deleted.';
