alter table if exists public.shift_notes
  add column if not exists note_kind text default 'note',
  add column if not exists action_required text,
  add column if not exists assigned_at timestamptz,
  add column if not exists received_by_id text,
  add column if not exists received_by_name text,
  add column if not exists received_at timestamptz,
  add column if not exists postponed_until timestamptz,
  add column if not exists postponement_reason text,
  add column if not exists handed_over_by_id text,
  add column if not exists handed_over_by_name text,
  add column if not exists handover_note text,
  add column if not exists amount_due numeric,
  add column if not exists expected_payment_method text,
  add column if not exists payment_deadline timestamptz,
  add column if not exists collected_amount numeric,
  add column if not exists collected_by text,
  add column if not exists collected_at timestamptz,
  add column if not exists nurse_name text,
  add column if not exists nursing_time timestamptz,
  add column if not exists patient_address text,
  add column if not exists location_link text,
  add column if not exists customer_confirmation_status text,
  add column if not exists delivery_person text,
  add column if not exists delivery_address text,
  add column if not exists delivery_status text,
  add column if not exists delivery_confirmation_note text,
  add column if not exists complaint_level text,
  add column if not exists resolution_required text,
  add column if not exists manager_notified boolean default false;

alter table if exists public.shift_note_occurrences
  add column if not exists scheduled_time timestamptz,
  add column if not exists completion_note text;

update public.shift_note_occurrences
set scheduled_time = occurrence_at
where scheduled_time is null and occurrence_at is not null;

create index if not exists idx_shift_notes_kind on public.shift_notes(note_kind);
create index if not exists idx_shift_notes_action_required on public.shift_notes(action_required);
create index if not exists idx_shift_notes_received_at on public.shift_notes(received_at);
create index if not exists idx_shift_notes_postponed_until on public.shift_notes(postponed_until);

notify pgrst, 'reload schema';
