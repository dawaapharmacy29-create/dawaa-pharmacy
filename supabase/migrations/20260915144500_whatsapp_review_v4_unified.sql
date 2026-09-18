-- Unified WhatsApp Review V4
-- Consolidates the strongest ideas from the former chat-intelligence branch with the export analyzer branch.
-- Safe-by-default: AI output is evidence and queue metadata only. Official review/points remain human-confirmed.

create table if not exists public.whatsapp_review_sources (
  id uuid primary key default gen_random_uuid(),
  source_hash text not null,
  source_type text not null default 'whatsapp_export',
  source_filename text null,
  inner_filename text null,
  branch text null,
  customer_id uuid null,
  customer_code text null,
  customer_name text null,
  customer_phone text null,
  staff_id uuid null,
  staff_name text null,
  conversation_started_at timestamptz null,
  conversation_ended_at timestamptz null,
  message_count integer not null default 0,
  parser_version text not null default 'whatsapp-review-v4',
  analysis_version text not null default 'whatsapp-review-v4',
  analysis_status text not null default 'queued',
  review_status text not null default 'new',
  priority text not null default 'normal',
  analysis_confidence numeric null,
  service_score numeric null,
  commercial_score numeric null,
  commercial_eligible boolean null,
  chat_suggested_sold boolean null,
  followup_required boolean not null default false,
  suggested_followup_reason text null,
  analysis_json jsonb not null default '{}'::jsonb,
  raw_text text null,

  invoice_match_status text not null default 'pending',
  matched_invoice_id uuid null,
  matched_invoice_number text null,
  matched_invoice_date timestamptz null,
  matched_invoice_value numeric null,
  invoice_match_confidence numeric null,
  invoice_match_reason text null,

  official_review_id uuid null references public.conversation_sales_reviews(id) on delete set null,
  reviewer_confirmed boolean not null default false,
  reviewer_id text null,
  reviewer_name text null,
  reviewer_confirmed_at timestamptz null,
  created_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint whatsapp_review_sources_hash_uk unique (source_hash),
  constraint whatsapp_review_sources_analysis_status_ck check (analysis_status in ('queued','parsing','analyzed','needs_review','failed')),
  constraint whatsapp_review_sources_review_status_ck check (review_status in ('new','ready_quick','ready_detailed','needs_context','approved','rejected','archived')),
  constraint whatsapp_review_sources_priority_ck check (priority in ('normal','important','urgent')),
  constraint whatsapp_review_sources_invoice_ck check (invoice_match_status in ('pending','verified','probable','not_found','needs_review','not_applicable','rejected')),
  constraint whatsapp_review_sources_confidence_ck check (analysis_confidence is null or (analysis_confidence >= 0 and analysis_confidence <= 100)),
  constraint whatsapp_review_sources_invoice_confidence_ck check (invoice_match_confidence is null or (invoice_match_confidence >= 0 and invoice_match_confidence <= 1)),
  constraint whatsapp_review_sources_service_score_ck check (service_score is null or (service_score >= 0 and service_score <= 100)),
  constraint whatsapp_review_sources_commercial_score_ck check (commercial_score is null or (commercial_score >= 0 and commercial_score <= 100)),
  constraint whatsapp_review_sources_invoice_value_ck check (matched_invoice_value is null or matched_invoice_value >= 0)
);

create index if not exists whatsapp_review_sources_queue_idx on public.whatsapp_review_sources(review_status, priority, created_at desc);
create index if not exists whatsapp_review_sources_staff_idx on public.whatsapp_review_sources(staff_id, conversation_started_at desc);
create index if not exists whatsapp_review_sources_branch_idx on public.whatsapp_review_sources(branch, conversation_started_at desc);
create index if not exists whatsapp_review_sources_customer_code_idx on public.whatsapp_review_sources(customer_code);
create index if not exists whatsapp_review_sources_customer_phone_idx on public.whatsapp_review_sources(customer_phone);
create index if not exists whatsapp_review_sources_followup_idx on public.whatsapp_review_sources(followup_required, review_status, created_at desc);
create index if not exists whatsapp_review_sources_invoice_idx on public.whatsapp_review_sources(invoice_match_status, branch, conversation_started_at desc);

alter table public.whatsapp_review_sources enable row level security;

-- Same business scope as conversation reviews, with Dawaa Alpha intentionally cross-branch.
-- The app currently supports authenticated and staff-header identities, so policies use the
-- existing strict actor helpers rather than auth.uid() alone.
drop policy if exists whatsapp_review_sources_select_v1 on public.whatsapp_review_sources;
create policy whatsapp_review_sources_select_v1
on public.whatsapp_review_sources
for select
to public
using (
  public.dawaa_current_actor_can(array['view_reviews','view_conversation_reviews','manage_conversation_evaluations'])
  and (
    public.dawaa_actor_is_top_management_v1()
    or exists (
      select 1
      from public.staff_accounts me
      where me.id = public.dawaa_current_staff_account_id_strict()
        and coalesce(me.active,false)
        and coalesce(me.can_login,false)
        and (
          lower(trim(coalesce(me.role,''))) in ('team_dawaa_alpha','customer_service_manager')
          or me.staff_id = whatsapp_review_sources.staff_id::text
          or (
            lower(trim(coalesce(me.role,''))) in ('branch_manager','customer_service','shift_supervisor_morning','shift_supervisor_evening')
            and public.dawaa_customer_request_branch_key(me.branch) is not null
            and public.dawaa_customer_request_branch_key(me.branch) = public.dawaa_customer_request_branch_key(whatsapp_review_sources.branch)
          )
        )
    )
  )
);

drop policy if exists whatsapp_review_sources_insert_v1 on public.whatsapp_review_sources;
create policy whatsapp_review_sources_insert_v1
on public.whatsapp_review_sources
for insert
to public
with check (
  public.dawaa_current_actor_can(array['add_reviews','reviews.action.create','manage_conversation_evaluations'])
  and (
    public.dawaa_actor_is_top_management_v1()
    or exists (
      select 1
      from public.staff_accounts me
      where me.id = public.dawaa_current_staff_account_id_strict()
        and coalesce(me.active,false)
        and coalesce(me.can_login,false)
        and (
          lower(trim(coalesce(me.role,''))) in ('team_dawaa_alpha','customer_service_manager')
          or (
            whatsapp_review_sources.branch is not null
            and public.dawaa_customer_request_branch_key(me.branch) = public.dawaa_customer_request_branch_key(whatsapp_review_sources.branch)
          )
        )
    )
  )
);

drop policy if exists whatsapp_review_sources_update_v1 on public.whatsapp_review_sources;
create policy whatsapp_review_sources_update_v1
on public.whatsapp_review_sources
for update
to public
using (
  public.dawaa_current_actor_can(array['edit_reviews','approve_reviews','manage_conversation_evaluations'])
  and (
    public.dawaa_actor_is_top_management_v1()
    or exists (
      select 1
      from public.staff_accounts me
      where me.id = public.dawaa_current_staff_account_id_strict()
        and coalesce(me.active,false)
        and coalesce(me.can_login,false)
        and (
          lower(trim(coalesce(me.role,''))) in ('team_dawaa_alpha','customer_service_manager')
          or me.staff_id = whatsapp_review_sources.staff_id::text
          or (
            lower(trim(coalesce(me.role,''))) in ('branch_manager','customer_service','shift_supervisor_morning','shift_supervisor_evening')
            and public.dawaa_customer_request_branch_key(me.branch) = public.dawaa_customer_request_branch_key(whatsapp_review_sources.branch)
          )
        )
    )
  )
)
with check (
  public.dawaa_current_actor_can(array['edit_reviews','approve_reviews','manage_conversation_evaluations'])
  and (
    public.dawaa_actor_is_top_management_v1()
    or exists (
      select 1
      from public.staff_accounts me
      where me.id = public.dawaa_current_staff_account_id_strict()
        and coalesce(me.active,false)
        and coalesce(me.can_login,false)
        and (
          lower(trim(coalesce(me.role,''))) in ('team_dawaa_alpha','customer_service_manager')
          or me.staff_id = whatsapp_review_sources.staff_id::text
          or (
            lower(trim(coalesce(me.role,''))) in ('branch_manager','customer_service','shift_supervisor_morning','shift_supervisor_evening')
            and public.dawaa_customer_request_branch_key(me.branch) = public.dawaa_customer_request_branch_key(whatsapp_review_sources.branch)
          )
        )
    )
  )
);

create table if not exists public.whatsapp_review_audit (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.whatsapp_review_sources(id) on delete cascade,
  action text not null,
  actor_id text null,
  actor_name text null,
  actor_role text null,
  before_state jsonb null,
  after_state jsonb null,
  note text null,
  created_at timestamptz not null default now()
);
create index if not exists whatsapp_review_audit_source_idx on public.whatsapp_review_audit(source_id, created_at desc);
alter table public.whatsapp_review_audit enable row level security;

-- Audit is append-only from the client: no UPDATE/DELETE policy by design.
drop policy if exists whatsapp_review_audit_select_v1 on public.whatsapp_review_audit;
create policy whatsapp_review_audit_select_v1
on public.whatsapp_review_audit
for select
to public
using (
  exists (
    select 1 from public.whatsapp_review_sources s
    where s.id = whatsapp_review_audit.source_id
  )
);

drop policy if exists whatsapp_review_audit_insert_v1 on public.whatsapp_review_audit;
create policy whatsapp_review_audit_insert_v1
on public.whatsapp_review_audit
for insert
to public
with check (
  public.dawaa_current_actor_can(array['add_reviews','edit_reviews','approve_reviews','manage_conversation_evaluations'])
  and exists (
    select 1 from public.whatsapp_review_sources s
    where s.id = whatsapp_review_audit.source_id
  )
);

-- Reviewer-confirmed conversion truth only. Chat text never becomes an official sale by itself.
create or replace view public.whatsapp_review_confirmed_conversion_v1
with (security_invoker = true)
as
select
  id,
  coalesce(nullif(trim(branch), ''), 'غير محدد') as branch,
  staff_id,
  coalesce(nullif(trim(staff_name), ''), 'غير محدد') as staff_name,
  commercial_eligible,
  chat_suggested_sold,
  invoice_match_status,
  matched_invoice_id,
  matched_invoice_number,
  matched_invoice_value,
  (conversation_started_at at time zone 'Africa/Cairo')::date as conversation_date,
  case
    when extract(day from (conversation_started_at at time zone 'Africa/Cairo')::date) >= 26
      then make_date(
        extract(year from (conversation_started_at at time zone 'Africa/Cairo')::date)::int,
        extract(month from (conversation_started_at at time zone 'Africa/Cairo')::date)::int,
        26
      )
    else (date_trunc('month', (conversation_started_at at time zone 'Africa/Cairo')::date) - interval '1 month' + interval '25 days')::date
  end as cycle_start
from public.whatsapp_review_sources
where reviewer_confirmed = true
  and commercial_eligible = true
  and review_status = 'approved'
  and conversation_started_at is not null;

create or replace view public.whatsapp_review_queue_kpis_v1
with (security_invoker = true)
as
select
  coalesce(nullif(trim(branch), ''), 'غير محدد') as branch,
  count(*)::integer as total,
  count(*) filter (where review_status in ('new','ready_quick','ready_detailed','needs_context'))::integer as pending,
  count(*) filter (where priority = 'urgent' and review_status not in ('approved','rejected','archived'))::integer as urgent_pending,
  count(*) filter (where followup_required = true and review_status not in ('approved','rejected','archived'))::integer as followup_pending,
  count(*) filter (where review_status = 'approved')::integer as approved,
  count(*) filter (where invoice_match_status = 'verified')::integer as invoice_verified,
  round(avg(analysis_confidence), 1) as avg_analysis_confidence,
  round(avg(service_score), 1) as avg_service_score,
  round(avg(commercial_score), 1) as avg_commercial_score
from public.whatsapp_review_sources
group by coalesce(nullif(trim(branch), ''), 'غير محدد');

create or replace view public.whatsapp_review_verified_revenue_v1
with (security_invoker = true)
as
select
  cycle_start,
  branch,
  staff_id,
  staff_name,
  count(*) filter (where invoice_match_status = 'verified' and matched_invoice_id is not null)::integer as verified_conversions,
  count(distinct matched_invoice_id) filter (where invoice_match_status = 'verified' and matched_invoice_id is not null)::integer as verified_invoices,
  round(coalesce(sum(matched_invoice_value) filter (where invoice_match_status = 'verified' and matched_invoice_id is not null), 0), 2) as verified_revenue
from public.whatsapp_review_confirmed_conversion_v1
group by cycle_start, branch, staff_id, staff_name;

grant select, insert, update on public.whatsapp_review_sources to anon, authenticated;
grant select, insert on public.whatsapp_review_audit to anon, authenticated;
grant select on public.whatsapp_review_confirmed_conversion_v1 to anon, authenticated;
grant select on public.whatsapp_review_queue_kpis_v1 to anon, authenticated;
grant select on public.whatsapp_review_verified_revenue_v1 to anon, authenticated;

comment on table public.whatsapp_review_sources is 'Unified WhatsApp export/session review queue. AI output is evidence only; official review and points require reviewer confirmation.';
comment on table public.whatsapp_review_audit is 'Append-only audit trail for AI analysis, invoice matching, reviewer edits and approvals.';
comment on view public.whatsapp_review_confirmed_conversion_v1 is 'Reviewer-confirmed, sales-eligible WhatsApp sessions using the pharmacy 26-to-25 cycle.';
comment on view public.whatsapp_review_queue_kpis_v1 is 'Live operational queue KPIs by branch.';
comment on view public.whatsapp_review_verified_revenue_v1 is 'Invoice-backed revenue only from reviewer-confirmed sessions.';