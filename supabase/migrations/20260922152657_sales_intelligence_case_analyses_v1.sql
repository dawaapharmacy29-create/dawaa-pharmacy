-- Sales Intelligence Phase H.1A — Schema Foundation (3/7): immutable semantic analysis.
-- IMMUTABLE ONCE WRITTEN (design doc H.0.2 §7/§8) — no application code path may ever UPDATE a
-- row in this table after insert; a re-analysis inserts a NEW row and marks the old one
-- is_current=false/superseded_at (enforced structurally in H.1B's writer, not by SQL trigger here,
-- per instruction #9's preference for declarative constraints over triggers).
create table if not exists public.sales_intelligence_case_analyses (
  analysis_id uuid primary key default gen_random_uuid(),
  case_id text not null references public.sales_intelligence_cases(case_id) on delete cascade,
  analysis_version integer not null,
  pipeline_version text not null,

  engine_version_case_segmentation text not null,
  engine_version_historical_closure text not null,
  engine_version_commercial_confirmation text not null,
  engine_version_protocol_applicability text not null,

  semantic_source_hash text not null,
  analyzed_at timestamptz not null default now(),
  is_current boolean not null default true,
  superseded_at timestamptz null,
  superseded_by_analysis_id uuid null references public.sales_intelligence_case_analyses(analysis_id),

  case_type text not null,
  case_status text not null,
  pipeline_status text not null,
  overall_evidence_level text not null,

  -- Immutable identity snapshot AT ANALYSIS TIME (design doc H.0.2 §15) — deliberately separate
  -- from sales_intelligence_cases' own current/correctable pointer fields.
  identity_customer_id uuid null,
  identity_customer_phone text null,
  identity_branch_id uuid null,
  identity_branch_name_raw text null,

  case_started_at timestamptz not null,
  case_ended_at timestamptz null,

  -- SEMANTIC FACTS ONLY (design doc H.0.2 §9) — never protocol_policy_compliance, which lives on
  -- sales_intelligence_policy_evaluations instead.
  historical_closure_level text not null,
  commercial_confirmation_state text not null,
  protocol_applicability text not null,

  -- Denormalized read-optimization only — never authoritative (design doc, persistence/types.ts).
  attribution_level text not null,
  integrity_evaluation_scope text not null,

  needs_human_review boolean not null default false,
  human_review_reasons text[] not null default '{}',
  failure_reasons text[] not null default '{}',
  pipeline_warnings text[] not null default '{}',

  evidence_snapshot jsonb not null default '{}'::jsonb,

  constraint sales_intelligence_case_analyses_version_ck check (analysis_version > 0),
  constraint sales_intelligence_case_analyses_superseded_consistency_ck check (
    (is_current = true and superseded_at is null and superseded_by_analysis_id is null)
    or (is_current = false)
  ),
  constraint sales_intelligence_case_analyses_case_type_ck check (
    case_type in ('information_only','sales_opportunity','complaint','follow_up','mixed','unknown')
  ),
  constraint sales_intelligence_case_analyses_case_status_ck check (
    case_status in ('information_only','sales_opportunity','basket_building','awaiting_customer_confirmation',
      'customer_confirmed','sent_for_fulfillment','invoiced','delivered','lost','cancelled','unknown')
  ),
  constraint sales_intelligence_case_analyses_pipeline_status_ck check (
    pipeline_status in ('analyzed','partial','needs_human_review','insufficient_data')
  ),
  constraint sales_intelligence_case_analyses_evidence_level_ck check (
    overall_evidence_level in ('high','medium','low','insufficient')
  ),
  constraint sales_intelligence_case_analyses_historical_closure_ck check (
    historical_closure_level in ('explicit','strongly_inferred','weakly_inferred','not_closed','unknown')
  ),
  constraint sales_intelligence_case_analyses_commercial_state_ck check (
    commercial_confirmation_state in ('basket_in_progress','awaiting_customer_confirmation','customer_confirmed',
      'modified_after_confirmation','commercial_confirmation_complete','rejected','unknown')
  ),
  constraint sales_intelligence_case_analyses_applicability_ck check (
    protocol_applicability in ('applicable','not_reached','not_applicable','unknown')
  ),
  constraint sales_intelligence_case_analyses_attribution_level_ck check (
    attribution_level in ('proven','strongly_inferred','weakly_inferred','unknown')
  ),
  constraint sales_intelligence_case_analyses_integrity_scope_ck check (
    integrity_evaluation_scope in ('header_only','header_and_items','insufficient')
  ),
  constraint sales_intelligence_case_analyses_timing_ck check (case_ended_at is null or case_ended_at >= case_started_at)
);

create unique index if not exists sales_intelligence_case_analyses_case_version_uk
  on public.sales_intelligence_case_analyses(case_id, analysis_version);
create unique index if not exists sales_intelligence_case_analyses_current_uk
  on public.sales_intelligence_case_analyses(case_id)
  where is_current = true;

create index if not exists sales_intelligence_case_analyses_ended_at_idx on public.sales_intelligence_case_analyses(case_ended_at desc);
create index if not exists sales_intelligence_case_analyses_customer_idx on public.sales_intelligence_case_analyses(identity_customer_id);
create index if not exists sales_intelligence_case_analyses_branch_idx on public.sales_intelligence_case_analyses(identity_branch_id);
create index if not exists sales_intelligence_case_analyses_attribution_level_idx on public.sales_intelligence_case_analyses(attribution_level);
create index if not exists sales_intelligence_case_analyses_integrity_scope_idx on public.sales_intelligence_case_analyses(integrity_evaluation_scope);
create index if not exists sales_intelligence_case_analyses_needs_review_idx on public.sales_intelligence_case_analyses(needs_human_review);
create index if not exists sales_intelligence_case_analyses_analyzed_at_idx on public.sales_intelligence_case_analyses(analyzed_at desc);
create index if not exists sales_intelligence_case_analyses_current_partial_idx
  on public.sales_intelligence_case_analyses(case_id, analyzed_at desc)
  where is_current = true;

alter table public.sales_intelligence_case_analyses enable row level security;

drop policy if exists sales_intelligence_case_analyses_select_v1 on public.sales_intelligence_case_analyses;
create policy sales_intelligence_case_analyses_select_v1
on public.sales_intelligence_case_analyses
for select
to public
using (
  public.dawaa_actor_is_top_management_v1()
  or exists (
    select 1
    from public.staff_accounts me
    join public.sales_intelligence_cases c on c.case_id = sales_intelligence_case_analyses.case_id
    where me.id = public.dawaa_current_staff_account_id_strict()
      and coalesce(me.active,false)
      and coalesce(me.can_login,false)
      and (
        lower(trim(coalesce(me.role,''))) in ('team_dawaa_alpha','customer_service_manager')
        or (
          lower(trim(coalesce(me.role,''))) in ('branch_manager','customer_service','shift_supervisor_morning','shift_supervisor_evening')
          and public.dawaa_customer_request_branch_key(me.branch) is not null
          and public.dawaa_customer_request_branch_key(me.branch) = public.dawaa_customer_request_branch_key(c.branch_name_raw)
        )
      )
  )
);

-- Engine-generated: service-role write only, no authenticated/public write policy of any kind.

comment on table public.sales_intelligence_case_analyses is
  'Phase H.1A. Fully immutable once written — no field, including protocol compliance, is ever updated in place. See docs/SALES_INTELLIGENCE_PERSISTENCE_DESIGN.md (H.0.2).';
