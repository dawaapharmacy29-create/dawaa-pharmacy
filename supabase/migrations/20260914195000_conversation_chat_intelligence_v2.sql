-- Development-only migration for feature/whatsapp-chat-intelligence-v2.
-- Do not apply to production until the conversation intelligence workflow is reviewed.
-- Conversion KPIs are derived from confirmed source rows; no aggregate table is stored,
-- so branch/doctor percentages cannot become stale or drift from the underlying chats.

create table if not exists public.conversation_chat_sources (
  id uuid primary key default gen_random_uuid(),
  review_id uuid null references public.conversation_sales_reviews(id) on delete set null,
  customer_id uuid null,
  customer_name text null,
  customer_phone text null,
  staff_id uuid null,
  staff_name text null,
  branch text null,
  source_type text not null default 'whatsapp_export',
  source_filename text null,
  conversation_started_at timestamptz null,
  conversation_ended_at timestamptz null,
  message_count integer not null default 0,
  raw_text text not null,
  raw_text_sha256 text null,
  parser_version text not null default 'wa-chat-intelligence-v2',
  analysis_status text not null default 'parsed',
  analysis_confidence numeric null,
  analysis_json jsonb not null default '{}'::jsonb,

  -- Conversion classification is stored as a reviewed fact, not as an aggregate percentage.
  commercial_eligible boolean null,
  conversion_status text not null default 'pending',
  conversion_confidence numeric null,
  conversion_source text not null default 'ai_suggestion',
  conversion_reason text null,

  reviewer_confirmed boolean not null default false,
  reviewer_id text null,
  reviewer_name text null,
  reviewer_confirmed_at timestamptz null,
  created_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversation_chat_sources_analysis_status_ck check (analysis_status in ('parsed','analyzed','needs_review','confirmed','failed')),
  constraint conversation_chat_sources_conversion_status_ck check (conversion_status in ('pending','converted','not_converted','excluded')),
  constraint conversation_chat_sources_conversion_source_ck check (conversion_source in ('ai_suggestion','reviewer','invoice_match','manual')),
  constraint conversation_chat_sources_analysis_confidence_ck check (analysis_confidence is null or (analysis_confidence >= 0 and analysis_confidence <= 1)),
  constraint conversation_chat_sources_conversion_confidence_ck check (conversion_confidence is null or (conversion_confidence >= 0 and conversion_confidence <= 1))
);

create index if not exists conversation_chat_sources_review_idx on public.conversation_chat_sources(review_id);
create index if not exists conversation_chat_sources_staff_date_idx on public.conversation_chat_sources(staff_id, conversation_started_at desc);
create index if not exists conversation_chat_sources_branch_date_idx on public.conversation_chat_sources(branch, conversation_started_at desc);
create index if not exists conversation_chat_sources_customer_phone_idx on public.conversation_chat_sources(customer_phone);
create index if not exists conversation_chat_sources_analysis_status_idx on public.conversation_chat_sources(analysis_status, created_at desc);
create index if not exists conversation_chat_sources_conversion_idx on public.conversation_chat_sources(branch, staff_id, commercial_eligible, conversion_status, reviewer_confirmed);

alter table public.conversation_chat_sources enable row level security;

create table if not exists public.conversation_chat_analysis_audit (
  id uuid primary key default gen_random_uuid(),
  chat_source_id uuid not null references public.conversation_chat_sources(id) on delete cascade,
  action text not null,
  actor_id text null,
  actor_name text null,
  actor_role text null,
  before_state jsonb null,
  after_state jsonb null,
  note text null,
  created_at timestamptz not null default now()
);

create index if not exists conversation_chat_analysis_audit_source_idx on public.conversation_chat_analysis_audit(chat_source_id, created_at desc);
alter table public.conversation_chat_analysis_audit enable row level security;

-- Shared confirmed dataset used by all KPI views.
create or replace view public.conversation_conversion_confirmed_v1 as
select
  id,
  coalesce(nullif(trim(branch), ''), 'غير محدد') as branch,
  staff_id,
  coalesce(nullif(trim(staff_name), ''), 'غير محدد') as staff_name,
  conversion_status,
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
from public.conversation_chat_sources
where reviewer_confirmed = true
  and commercial_eligible = true
  and conversion_status in ('converted', 'not_converted')
  and conversation_started_at is not null;

-- Official all-time conversion percentages computed live from reviewer-confirmed, sales-eligible chats.
create or replace view public.conversation_conversion_kpis_v1 as
with confirmed as (
  select branch, staff_id, staff_name, conversion_status
  from public.conversation_conversion_confirmed_v1
), branch_rows as (
  select
    'branch'::text as dimension,
    branch as dimension_key,
    branch as dimension_label,
    count(*)::integer as eligible_conversations,
    count(*) filter (where conversion_status = 'converted')::integer as converted_conversations
  from confirmed
  group by branch
), doctor_rows as (
  select
    'doctor'::text as dimension,
    coalesce(staff_id::text, staff_name) as dimension_key,
    staff_name as dimension_label,
    count(*)::integer as eligible_conversations,
    count(*) filter (where conversion_status = 'converted')::integer as converted_conversations
  from confirmed
  group by coalesce(staff_id::text, staff_name), staff_name
)
select
  dimension,
  dimension_key,
  dimension_label,
  eligible_conversations,
  converted_conversations,
  (eligible_conversations - converted_conversations)::integer as not_converted_conversations,
  case when eligible_conversations > 0
    then round((converted_conversations::numeric / eligible_conversations::numeric) * 100, 1)
    else null end as conversion_rate
from (
  select * from branch_rows
  union all
  select * from doctor_rows
) x;

-- Same KPI broken by the pharmacy cycle (26 -> 25), so current and previous cycles
-- are compared from source facts instead of a stored snapshot.
create or replace view public.conversation_conversion_cycle_kpis_v1 as
with base as (
  select
    cycle_start,
    (cycle_start + interval '1 month' - interval '1 day')::date as cycle_end,
    branch,
    staff_id,
    staff_name,
    conversion_status
  from public.conversation_conversion_confirmed_v1
), rows as (
  select
    cycle_start,
    cycle_end,
    'branch'::text as dimension,
    branch as dimension_key,
    branch as dimension_label,
    count(*)::integer as eligible_conversations,
    count(*) filter (where conversion_status = 'converted')::integer as converted_conversations
  from base
  group by cycle_start, cycle_end, branch
  union all
  select
    cycle_start,
    cycle_end,
    'doctor'::text as dimension,
    coalesce(staff_id::text, staff_name) as dimension_key,
    staff_name as dimension_label,
    count(*)::integer as eligible_conversations,
    count(*) filter (where conversion_status = 'converted')::integer as converted_conversations
  from base
  group by cycle_start, cycle_end, coalesce(staff_id::text, staff_name), staff_name
)
select
  cycle_start,
  cycle_end,
  dimension,
  dimension_key,
  dimension_label,
  eligible_conversations,
  converted_conversations,
  (eligible_conversations - converted_conversations)::integer as not_converted_conversations,
  case when eligible_conversations > 0
    then round((converted_conversations::numeric / eligible_conversations::numeric) * 100, 1)
    else null end as conversion_rate
from rows;

comment on table public.conversation_chat_sources is 'Raw WhatsApp exports and evidence-linked analysis. Raw text remains evidence; official conversion status requires reviewer confirmation.';
comment on table public.conversation_chat_analysis_audit is 'Audit trail for analysis changes and reviewer confirmation.';
comment on view public.conversation_conversion_confirmed_v1 is 'Reviewer-confirmed sales-eligible conversion facts with Cairo date and 26-to-25 cycle start.';
comment on view public.conversation_conversion_kpis_v1 is 'Live confirmed all-time conversion rate by branch and doctor. No persisted aggregate percentages.';
comment on view public.conversation_conversion_cycle_kpis_v1 is 'Live confirmed conversion rate by branch and doctor for each pharmacy cycle 26-to-25.';
