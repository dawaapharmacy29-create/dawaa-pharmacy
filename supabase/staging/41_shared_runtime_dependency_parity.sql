alter table public.customer_requests
  add column if not exists customer_code text,
  add column if not exists customer_phone text,
  add column if not exists customer_name text,
  add column if not exists medicine_name text not null,
  add column if not exists medicine_image_url text,
  add column if not exists quantity numeric,
  add column if not exists urgency text,
  add column if not exists request_type text,
  add column if not exists needs_customer_confirmation boolean,
  add column if not exists is_expensive_or_special boolean,
  add column if not exists doctor_id uuid,
  add column if not exists doctor_name text,
  add column if not exists purchasing_assignee text,
  add column if not exists doctor_notes text,
  add column if not exists supplier_hint text,
  add column if not exists purchasing_notes text,
  add column if not exists customer_confirmation_status text,
  add column if not exists contact_summary text,
  add column if not exists expected_arrival_date date,
  add column if not exists closed_at timestamptz,
  add column if not exists created_by text,
  add column if not exists created_by_name text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz,
  add column if not exists current_stage text,
  add column if not exists item_image_url text,
  add column if not exists item_image_path text,
  add column if not exists expected_price numeric,
  add column if not exists supplier_notes text,
  add column if not exists assigned_to uuid,
  add column if not exists due_date date,
  add column if not exists last_action_at timestamptz,
  add column if not exists priority text not null default 'medium',
  add column if not exists is_urgent boolean not null default false,
  add column if not exists needed_by_date date,
  add column if not exists expected_fulfillment_days integer,
  add column if not exists potential_source_id uuid,
  add column if not exists potential_source_name text,
  add column if not exists requested_at timestamptz default now(),
  add column if not exists potential_source_text text,
  add column if not exists purchasing_received_by_name text,
  add column if not exists searching_by_name text,
  add column if not exists provided_by_name text,
  add column if not exists customer_contacted_by_name text,
  add column if not exists delivered_by_name text,
  add column if not exists unavailable_since timestamptz,
  add column if not exists shortage_item_id uuid,
  add column if not exists moved_to_shortage_at timestamptz,
  add column if not exists source_system text,
  add column if not exists source_entity text,
  add column if not exists source_record_id text,
  add column if not exists source_order_number text,
  add column if not exists source_status text,
  add column if not exists source_updated_at timestamptz,
  add column if not exists source_last_seen_at timestamptz,
  add column if not exists source_request_channel text,
  add column if not exists source_assigned_employee text,
  add column if not exists source_notes text,
  add column if not exists source_selling_price numeric,
  add column if not exists source_payload jsonb,
  add column if not exists sync_conflict boolean not null default false,
  add column if not exists sync_conflict_reason text,
  add column if not exists product_id uuid,
  add column if not exists product_code text,
  add column if not exists product_price numeric,
  add column if not exists primary_responsible_id uuid,
  add column if not exists primary_responsible_name text,
  add column if not exists primary_responsible_role text,
  add column if not exists source_assigned_staff_id uuid,
  add column if not exists source_recorded_staff_id uuid,
  add column if not exists points_tier text,
  add column if not exists points_awarded numeric,
  add column if not exists next_action_at timestamptz;

alter table public.daily_followups
  add column if not exists staff_id uuid,
  add column if not exists followup_summary text,
  add column if not exists assigned_staff_id uuid,
  add column if not exists contact_method text,
  add column if not exists purchase_after_followup boolean default false,
  add column if not exists purchase_amount numeric default 0,
  add column if not exists purchase_invoice_no text,
  add column if not exists purchase_date date,
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by text,
  add column if not exists last_purchase_date date,
  add column if not exists purchase_count_current_month integer default 0,
  add column if not exists average_monthly_purchase_count numeric default 0,
  add column if not exists purchase_frequency_status text,
  add column if not exists quality_rating integer,
  add column if not exists customer_satisfaction text,
  add column if not exists response_status text,
  add column if not exists needs_manager boolean default false,
  add column if not exists preferred_contact_method text,
  add column if not exists personality_note text,
  add column if not exists requested_by text,
  add column if not exists internal_rating numeric,
  add column if not exists need_understood boolean,
  add column if not exists cross_sell_offered boolean default false,
  add column if not exists up_sell_offered boolean default false,
  add column if not exists needs_next_followup boolean default false,
  add column if not exists no_purchase_reason text,
  add column if not exists doctor_internal_note text,
  add column if not exists evaluated_by text,
  add column if not exists evaluated_by_name text,
  add column if not exists evaluated_at timestamptz,
  add column if not exists assigned_to_staff_id text,
  add column if not exists handled_by_staff_id text,
  add column if not exists first_attempt_at timestamptz,
  add column if not exists duplicate_of text,
  add column if not exists duplicate_reason text,
  add column if not exists duplicate_archived_at timestamptz,
  add column if not exists archived_by text,
  add column if not exists source_file text,
  add column if not exists source_sheet text,
  add column if not exists source_batch_id uuid,
  add column if not exists source_row_number integer,
  add column if not exists import_batch_id text,
  add column if not exists import_fingerprint text,
  add column if not exists import_source text,
  add column if not exists linked_to_invoice_today boolean,
  add column if not exists flagged_at timestamptz,
  add column if not exists followup_reason_key text,
  add column if not exists points_value numeric,
  add column if not exists counts_toward_quota boolean not null default true,
  add column if not exists is_flagged boolean not null default false,
  add column if not exists flag_reason text,
  add column if not exists flagged_by text;

create or replace function public.dawaa_can_access_customer_request_branch(
  p_permission text,
  p_branch text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor_id uuid;
  v_role text;
  v_branch text;
begin
  v_actor_id := public.dawaa_current_staff_account_id_strict();
  if v_actor_id is null then return false; end if;
  if not public.dawaa_current_actor_can(array[p_permission]) then return false; end if;

  select lower(trim(coalesce(sa.role,''))), sa.branch
    into v_role, v_branch
  from public.staff_accounts sa
  where sa.id = v_actor_id
    and coalesce(sa.active,false)
    and coalesce(sa.can_login,false)
  limit 1;

  if not found then return false; end if;
  if v_role in ('general_manager','executive_manager','branches_manager','admin') then return true; end if;

  return public.dawaa_customer_request_branch_key(v_branch) is not null
    and public.dawaa_customer_request_branch_key(v_branch) = public.dawaa_customer_request_branch_key(p_branch);
end;
$$;

alter table public.customer_requests enable row level security;
revoke all on public.customer_requests from anon, authenticated;
grant select, insert, update on public.customer_requests to anon, authenticated;

drop policy if exists customer_requests_local_select_active_actor on public.customer_requests;
drop policy if exists customer_requests_scoped_select on public.customer_requests;
drop policy if exists customer_requests_scoped_insert on public.customer_requests;
drop policy if exists customer_requests_scoped_update on public.customer_requests;

create policy customer_requests_scoped_select
on public.customer_requests
for select to anon, authenticated
using (public.dawaa_can_access_customer_request_branch('view_customer_requests', branch));

create policy customer_requests_scoped_insert
on public.customer_requests
for insert to anon, authenticated
with check (public.dawaa_can_access_customer_request_branch('manage_customer_requests', branch));

create policy customer_requests_scoped_update
on public.customer_requests
for update to anon, authenticated
using (public.dawaa_can_access_customer_request_branch('manage_customer_requests', branch))
with check (public.dawaa_can_access_customer_request_branch('manage_customer_requests', branch));

create table if not exists public.staff_identity_aliases (
  id uuid not null default gen_random_uuid() primary key,
  staff_id uuid,
  alias_name text not null,
  normalized_alias text not null default 'alias',
  source text default 'manual',
  confidence numeric default 1,
  active boolean default true,
  created_at timestamptz default now(),
  created_by text,
  updated_at timestamptz default now(),
  priority integer default 1
);

alter table public.staff_identity_aliases enable row level security;
revoke all on public.staff_identity_aliases from anon, authenticated;
grant select, insert, update on public.staff_identity_aliases to anon, authenticated;

drop policy if exists staff_identity_aliases_select_active_actor on public.staff_identity_aliases;
create policy staff_identity_aliases_select_active_actor
on public.staff_identity_aliases
for select to anon, authenticated
using (public.dawaa_current_staff_account_id_strict() is not null);

drop policy if exists staff_identity_aliases_manage_staff_accounts on public.staff_identity_aliases;
create policy staff_identity_aliases_manage_staff_accounts
on public.staff_identity_aliases
for all to anon, authenticated
using (public.dawaa_current_actor_can(array['manage_staff_accounts']))
with check (public.dawaa_current_actor_can(array['manage_staff_accounts']));

create table if not exists public.shift_notes (
  id uuid not null default gen_random_uuid() primary key,
  title text not null,
  details text,
  note_type text default 'general',
  branch text,
  customer_id uuid,
  customer_name text,
  customer_phone text,
  invoice_id uuid,
  invoice_no text,
  author_id text,
  author_name text,
  due_at timestamptz,
  assigned_to_id text,
  assigned_to_name text,
  priority text default 'normal',
  status text default 'new',
  is_recurring boolean default false,
  repeat_days integer,
  recurrence_times text[] default '{}',
  handed_over boolean default false,
  handed_over_at timestamptz,
  closed_at timestamptz,
  closed_by_id text,
  closed_by_name text,
  closure_reason text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  note_kind text default 'note',
  action_required text,
  assigned_at timestamptz,
  received_by_id text,
  received_by_name text,
  received_at timestamptz,
  postponed_until timestamptz,
  postponement_reason text,
  handed_over_by_id text,
  handed_over_by_name text,
  handover_note text,
  amount_due numeric,
  expected_payment_method text,
  payment_deadline timestamptz,
  collected_amount numeric,
  collected_by text,
  collected_at timestamptz,
  nurse_name text,
  nursing_time timestamptz,
  patient_address text,
  location_link text,
  customer_confirmation_status text,
  delivery_person text,
  delivery_address text,
  delivery_status text,
  delivery_confirmation_note text,
  complaint_level text,
  resolution_required text,
  manager_notified boolean default false,
  customer_code text,
  whatsapp_phone text,
  whatsapp_link text,
  completed_by_name text,
  completed_at timestamptz,
  cancelled_by_name text,
  cancelled_at timestamptz,
  deleted_at timestamptz,
  deleted_by_name text,
  deleted_by_id uuid
);

alter table public.shift_notes enable row level security;
revoke all on public.shift_notes from anon, authenticated;
grant select, insert, update on public.shift_notes to anon, authenticated;

drop policy if exists shift_notes_select_active_actor on public.shift_notes;
create policy shift_notes_select_active_actor
on public.shift_notes
for select to anon, authenticated
using (public.dawaa_current_staff_account_id_strict() is not null);

drop policy if exists shift_notes_insert_active_actor on public.shift_notes;
create policy shift_notes_insert_active_actor
on public.shift_notes
for insert to anon, authenticated
with check (public.dawaa_current_staff_account_id_strict() is not null);

drop policy if exists shift_notes_update_active_actor on public.shift_notes;
create policy shift_notes_update_active_actor
on public.shift_notes
for update to anon, authenticated
using (public.dawaa_current_staff_account_id_strict() is not null)
with check (public.dawaa_current_staff_account_id_strict() is not null);

alter table public.daily_followups enable row level security;
revoke all on public.daily_followups from anon, authenticated;
grant select, insert, update on public.daily_followups to anon, authenticated;

drop policy if exists daily_followups_select_active_actor on public.daily_followups;
create policy daily_followups_select_active_actor
on public.daily_followups
for select to anon, authenticated
using (public.dawaa_current_actor_can(array['view_customer_requests']));

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text default '',
  body text default '',
  type text default 'system',
  notification_type text,
  priority text not null default 'normal',
  recipient_staff_id text,
  recipient_user_id text,
  recipient_role text,
  staff_id text,
  user_id uuid,
  branch text,
  target_type text,
  target_id text,
  entity_type text,
  entity_id text,
  action_url text,
  target_route text,
  route text,
  link text,
  related_table text,
  related_id text,
  status text not null default 'new',
  is_read boolean not null default false,
  read boolean not null default false,
  read_at timestamptz,
  requires_action boolean default false,
  action_status text,
  sound_enabled boolean default true,
  created_by uuid,
  created_by_name text,
  metadata jsonb not null default '{}'::jsonb,
  details jsonb,
  description text,
  dedupe_key text,
  is_global boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  archive_reason text
);

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to anon, authenticated;
grant select on public.notifications to service_role;

notify pgrst, 'reload schema';
