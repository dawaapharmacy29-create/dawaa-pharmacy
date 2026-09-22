-- Sales Intelligence Phase H.1A — Schema Foundation (4/7): policy evaluations.
-- H.0.2 fix: protocol_policy_compliance is NOT stored on case_analyses. This table derives it from
-- one IMMUTABLE analysis_id + one IMMUTABLE policy_config_id. A policy change creates a NEW row
-- here for the current analysis; the previous evaluation remains queryable forever.
create table if not exists public.sales_intelligence_policy_evaluations (
  policy_evaluation_id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.sales_intelligence_case_analyses(analysis_id) on delete cascade,
  case_id text not null references public.sales_intelligence_cases(case_id) on delete cascade,
  policy_config_id uuid not null references public.sales_intelligence_policy_config(policy_config_id),
  policy_config_version integer not null,
  protocol_policy_effective_at timestamptz null,
  protocol_applicability text not null,
  protocol_policy_compliance text not null,
  evaluation_version integer not null,
  policy_input_hash text not null,
  is_current boolean not null default true,
  evaluated_at timestamptz not null default now(),
  superseded_at timestamptz null,
  superseded_by_policy_evaluation_id uuid null references public.sales_intelligence_policy_evaluations(policy_evaluation_id),

  constraint sales_intelligence_policy_evaluations_version_ck check (evaluation_version > 0),
  constraint sales_intelligence_policy_evaluations_applicability_ck check (
    protocol_applicability in ('applicable','not_reached','not_applicable','unknown')
  ),
  constraint sales_intelligence_policy_evaluations_compliance_ck check (
    protocol_policy_compliance in ('not_enforced','compliant','non_compliant','not_applicable','not_reached','unknown')
  ),
  constraint sales_intelligence_policy_evaluations_superseded_consistency_ck check (
    (is_current = true and superseded_at is null and superseded_by_policy_evaluation_id is null)
    or (is_current = false)
  )
);

create unique index if not exists sales_intelligence_policy_evaluations_analysis_version_uk
  on public.sales_intelligence_policy_evaluations(analysis_id, evaluation_version);
create unique index if not exists sales_intelligence_policy_evaluations_current_uk
  on public.sales_intelligence_policy_evaluations(analysis_id)
  where is_current = true;
create index if not exists sales_intelligence_policy_evaluations_case_idx on public.sales_intelligence_policy_evaluations(case_id);
create index if not exists sales_intelligence_policy_evaluations_config_idx on public.sales_intelligence_policy_evaluations(policy_config_id);
create index if not exists sales_intelligence_policy_evaluations_compliance_idx on public.sales_intelligence_policy_evaluations(protocol_policy_compliance);
create index if not exists sales_intelligence_policy_evaluations_evaluated_at_idx on public.sales_intelligence_policy_evaluations(evaluated_at desc);

alter table public.sales_intelligence_policy_evaluations enable row level security;

-- Compliance-sensitive: restricted at the same tier as sales_integrity_exceptions in the design
-- doc (broader than a plain case-analysis read) — team_dawaa_alpha/customer_service_manager and
-- top management only, plus branch-scoped managers for their own branch's cases. No direct
-- 'pharmacist' access, matching the same documented deviation as sales_intelligence_cases.
drop policy if exists sales_intelligence_policy_evaluations_select_v1 on public.sales_intelligence_policy_evaluations;
create policy sales_intelligence_policy_evaluations_select_v1
on public.sales_intelligence_policy_evaluations
for select
to public
using (
  public.dawaa_actor_is_top_management_v1()
  or exists (
    select 1
    from public.staff_accounts me
    join public.sales_intelligence_cases c on c.case_id = sales_intelligence_policy_evaluations.case_id
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

comment on table public.sales_intelligence_policy_evaluations is
  'Phase H.1A. Derived, versioned evaluation of one immutable analysis under one immutable policy config. NOT another semantic analysis. See docs/SALES_INTELLIGENCE_PERSISTENCE_DESIGN.md (H.0.2 §7-§14).';
