-- Sales Intelligence Phase H.1A — Schema Foundation (2/7): stable case identity.
-- sales_intelligence_cases is the STABLE identity layer (design doc H.0.1 §3). It carries NO
-- semantic-engine conclusions — those live only on sales_intelligence_case_analyses. customer_id/
-- branch_id here are the CURRENT, correctable canonical references (design doc H.0.2 §15); a past
-- analysis's own identity snapshot lives on that analysis row, never here.
create table if not exists public.sales_intelligence_cases (
  case_id text primary key,
  conversation_id uuid not null references public.whatsapp_review_sources(id),
  source_case_id_v22 text null,
  customer_id uuid null references public.customers(id) on delete set null,
  customer_phone text null,
  branch_id uuid null references public.branches(id) on delete set null,
  branch_name_raw text null,
  case_started_at timestamptz not null,
  case_ended_at timestamptz null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint sales_intelligence_cases_timing_ck check (case_ended_at is null or case_ended_at >= case_started_at)
);

create index if not exists sales_intelligence_cases_conversation_idx on public.sales_intelligence_cases(conversation_id);
create index if not exists sales_intelligence_cases_customer_idx on public.sales_intelligence_cases(customer_id);
create index if not exists sales_intelligence_cases_branch_idx on public.sales_intelligence_cases(branch_id);
create index if not exists sales_intelligence_cases_branch_name_raw_idx on public.sales_intelligence_cases(branch_name_raw);
create index if not exists sales_intelligence_cases_ended_at_idx on public.sales_intelligence_cases(case_ended_at desc);
create index if not exists sales_intelligence_cases_last_seen_idx on public.sales_intelligence_cases(last_seen_at desc);

alter table public.sales_intelligence_cases enable row level security;

-- Mirrors whatsapp_review_sources' own established read-access pattern exactly (same underlying
-- conversations), per instruction #12 (reuse existing role model). NOTE (documented deviation,
-- see the H.1A final report): unlike whatsapp_review_sources, this table has no first-class
-- staff-involvement column yet (that data lives only in case_analyses.evidence_snapshot JSONB and
-- in the not-yet-created baskets/exceptions tables), so the 'pharmacist' role (the nearest
-- canonical equivalent of the design's "doctor" role — real staff are pharmacists addressed as
-- "دكتور/دكتورة" in chat) gets NO direct read grant here in H.1A. This is a deliberate
-- conservative default (deny, not guess), not an oversight — see report item 20.
drop policy if exists sales_intelligence_cases_select_v1 on public.sales_intelligence_cases;
create policy sales_intelligence_cases_select_v1
on public.sales_intelligence_cases
for select
to public
using (
  public.dawaa_actor_is_top_management_v1()
  or exists (
    select 1 from public.staff_accounts me
    where me.id = public.dawaa_current_staff_account_id_strict()
      and coalesce(me.active,false)
      and coalesce(me.can_login,false)
      and (
        lower(trim(coalesce(me.role,''))) in ('team_dawaa_alpha','customer_service_manager')
        or (
          lower(trim(coalesce(me.role,''))) in ('branch_manager','customer_service','shift_supervisor_morning','shift_supervisor_evening')
          and public.dawaa_customer_request_branch_key(me.branch) is not null
          and public.dawaa_customer_request_branch_key(me.branch) = public.dawaa_customer_request_branch_key(sales_intelligence_cases.branch_name_raw)
        )
      )
  )
);

-- Engine-generated table: service-role write only (no INSERT/UPDATE/DELETE policy for any
-- authenticated/public role — RLS with no permissive write policy is a default deny; the
-- Supabase service role bypasses RLS entirely, which is the only intended write path per
-- instruction #11/#17: no writer exists yet in H.1A, but the access boundary is already correct
-- for when H.1B's writer connects, since it will run under the service role).

comment on table public.sales_intelligence_cases is
  'Phase H.1A. Stable case identity only — no engine-analysis output. case_id is the same string the pipeline already computes (conversationId:interactionId[:session:N]). See docs/SALES_INTELLIGENCE_PERSISTENCE_DESIGN.md.';
