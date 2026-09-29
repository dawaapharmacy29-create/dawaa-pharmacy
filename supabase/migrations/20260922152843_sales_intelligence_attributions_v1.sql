-- Sales Intelligence Phase H.1A — Schema Foundation (5/7): attribution.
-- Analysis-version-owned, independently evaluable (design doc H.0.1 §9-§11): scoped to one
-- (analysis_id, evaluation_version), re-evaluable without a full semantic re-analysis (customer
-- identity merge, branch mapping fix, new invoice candidates). selected_invoice_id/_number are
-- plain text with NO foreign key — sales_invoices.id is not a safe relational FK target in the
-- current database (text, sometimes non-uuid synthetic ids like 'recovery20260821_shokry_68440').
create table if not exists public.sales_intelligence_attributions (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.sales_intelligence_case_analyses(analysis_id) on delete cascade,
  case_id text not null references public.sales_intelligence_cases(case_id) on delete cascade,
  evaluation_version integer not null,
  is_current_evaluation boolean not null default true,
  evaluated_at timestamptz not null default now(),
  superseded_at timestamptz null,
  superseded_by_evaluation_version integer null,

  attribution_engine_version text not null,
  attribution_input_hash text not null,
  identity_customer_id uuid null,
  identity_customer_phone text null,

  selected_invoice_id text null,
  selected_invoice_number text null,
  attribution_level text not null,
  confidence_score numeric not null,
  is_official_for_staff_evaluation boolean not null default false,

  competing_case_ids text[] not null default '{}',
  ambiguity_status text not null default 'none',
  identity_conflict text not null default 'none',
  branch_conflict boolean not null default false,

  candidate_count integer not null default 0,
  primary_evidence jsonb not null default '[]'::jsonb,
  contradictions text[] not null default '{}',
  rule_ids text[] not null default '{}',
  legacy_evidence_used boolean not null default false,

  constraint sales_intelligence_attributions_version_ck check (evaluation_version > 0),
  constraint sales_intelligence_attributions_confidence_ck check (confidence_score >= 0 and confidence_score <= 1),
  constraint sales_intelligence_attributions_candidate_count_ck check (candidate_count >= 0),
  constraint sales_intelligence_attributions_level_ck check (
    attribution_level in ('proven','strongly_inferred','weakly_inferred','unknown')
  ),
  constraint sales_intelligence_attributions_ambiguity_ck check (
    ambiguity_status in ('none','ambiguous_multiple_candidates')
  ),
  constraint sales_intelligence_attributions_identity_conflict_ck check (
    identity_conflict in ('none','phone_vs_customer_id_conflict')
  ),
  constraint sales_intelligence_attributions_superseded_consistency_ck check (
    (is_current_evaluation = true and superseded_at is null and superseded_by_evaluation_version is null)
    or (is_current_evaluation = false)
  ),
  -- selected_invoice_id must be present whenever an invoice was actually selected; never a level
  -- above weakly_inferred with no selection (structural sanity, mirrors saleAttributionEngine.ts).
  constraint sales_intelligence_attributions_selection_consistency_ck check (
    (attribution_level in ('proven','strongly_inferred') and selected_invoice_id is not null)
    or (attribution_level in ('weakly_inferred','unknown'))
  )
);

create unique index if not exists sales_intelligence_attributions_analysis_version_uk
  on public.sales_intelligence_attributions(analysis_id, evaluation_version);
create unique index if not exists sales_intelligence_attributions_current_uk
  on public.sales_intelligence_attributions(analysis_id)
  where is_current_evaluation = true;

create index if not exists sales_intelligence_attributions_case_idx on public.sales_intelligence_attributions(case_id);
create index if not exists sales_intelligence_attributions_selected_invoice_idx on public.sales_intelligence_attributions(selected_invoice_id);
create index if not exists sales_intelligence_attributions_level_idx on public.sales_intelligence_attributions(attribution_level);
create index if not exists sales_intelligence_attributions_official_idx on public.sales_intelligence_attributions(is_official_for_staff_evaluation);
create index if not exists sales_intelligence_attributions_competing_gin_idx on public.sales_intelligence_attributions using gin (competing_case_ids);

alter table public.sales_intelligence_attributions enable row level security;

drop policy if exists sales_intelligence_attributions_select_v1 on public.sales_intelligence_attributions;
create policy sales_intelligence_attributions_select_v1
on public.sales_intelligence_attributions
for select
to public
using (
  public.dawaa_actor_is_top_management_v1()
  or exists (
    select 1
    from public.staff_accounts me
    join public.sales_intelligence_cases c on c.case_id = sales_intelligence_attributions.case_id
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

-- Engine-generated: service-role write only.

comment on table public.sales_intelligence_attributions is
  'Phase H.1A. Analysis-version-owned, independently evaluable Phase D output. competing_case_ids is first-class, written once at insert time from batch-level cross-case resolution, never recomputed lazily. See docs/SALES_INTELLIGENCE_PERSISTENCE_DESIGN.md.';
