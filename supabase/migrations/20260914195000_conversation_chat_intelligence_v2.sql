-- Development-only migration for feature/whatsapp-chat-intelligence-v2.
-- Do not apply to production until the conversation intelligence workflow is reviewed.

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
  reviewer_confirmed boolean not null default false,
  reviewer_id text null,
  reviewer_name text null,
  reviewer_confirmed_at timestamptz null,
  created_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversation_chat_sources_analysis_status_ck check (analysis_status in ('parsed','analyzed','needs_review','confirmed','failed'))
);

create index if not exists conversation_chat_sources_review_idx on public.conversation_chat_sources(review_id);
create index if not exists conversation_chat_sources_staff_date_idx on public.conversation_chat_sources(staff_id, conversation_started_at desc);
create index if not exists conversation_chat_sources_customer_phone_idx on public.conversation_chat_sources(customer_phone);
create index if not exists conversation_chat_sources_analysis_status_idx on public.conversation_chat_sources(analysis_status, created_at desc);

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

comment on table public.conversation_chat_sources is 'Raw WhatsApp exports and their evidence-linked analysis. Raw text remains immutable evidence; reviewer confirmation is separate.';
comment on table public.conversation_chat_analysis_audit is 'Audit trail for changes and reviewer confirmation of conversation intelligence.';
