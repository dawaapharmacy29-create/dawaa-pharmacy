-- Sales Intelligence Phase H.1A — Schema Foundation (6/7): basket-invoice matching.
-- References the EXACT attribution row it was computed against (attribution_row_id), never
-- "whichever is current now". invoice_id/_number are plain text, no FK, same reason as
-- attributions. The item_evidence_gate check enforces, at the database level, that item-level
-- match fields can never imply item evidence exists while sales_invoice_items_v21 = 0 rows in
-- production (instruction #8).
create table if not exists public.sales_intelligence_basket_invoice_matches (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.sales_intelligence_case_analyses(analysis_id) on delete cascade,
  case_id text not null references public.sales_intelligence_cases(case_id) on delete cascade,
  attribution_row_id uuid not null references public.sales_intelligence_attributions(id) on delete cascade,
  evaluation_version integer not null,
  is_current_evaluation boolean not null default true,
  evaluated_at timestamptz not null default now(),
  superseded_at timestamptz null,
  superseded_by_evaluation_version integer null,

  matching_engine_version text not null,

  basket_id text null,
  basket_version integer null,
  invoice_id text null,
  invoice_number text null,

  total_match text not null,
  item_match text not null,
  quantity_match text not null,
  overall_match text not null,

  header_evidence_ready boolean not null default false,
  item_evidence_ready boolean not null default false,
  integrity_evaluation_scope text not null,

  differences jsonb not null default '[]'::jsonb,

  needs_human_review boolean not null default false,
  human_review_reasons text[] not null default '{}',

  constraint sales_intelligence_bim_version_ck check (evaluation_version > 0),
  constraint sales_intelligence_bim_total_match_ck check (total_match in ('exact','near_match','partial','mismatch','insufficient_data')),
  constraint sales_intelligence_bim_item_match_ck check (item_match in ('exact','near_match','partial','mismatch','insufficient_data')),
  constraint sales_intelligence_bim_quantity_match_ck check (quantity_match in ('exact','near_match','partial','mismatch','insufficient_data')),
  constraint sales_intelligence_bim_overall_match_ck check (overall_match in ('exact','near_match','partial','mismatch','insufficient_data')),
  constraint sales_intelligence_bim_scope_ck check (integrity_evaluation_scope in ('header_only','header_and_items','insufficient')),
  constraint sales_intelligence_bim_item_evidence_gate_ck check (
    item_evidence_ready = true or item_match = 'insufficient_data'
  ),
  constraint sales_intelligence_bim_header_evidence_gate_ck check (
    header_evidence_ready = true or total_match = 'insufficient_data'
  ),
  constraint sales_intelligence_bim_scope_evidence_consistency_ck check (
    (integrity_evaluation_scope = 'insufficient' and header_evidence_ready = false)
    or (integrity_evaluation_scope = 'header_only' and header_evidence_ready = true and item_evidence_ready = false)
    or (integrity_evaluation_scope = 'header_and_items' and header_evidence_ready = true and item_evidence_ready = true)
  ),
  constraint sales_intelligence_bim_superseded_consistency_ck check (
    (is_current_evaluation = true and superseded_at is null and superseded_by_evaluation_version is null)
    or (is_current_evaluation = false)
  )
);

create unique index if not exists sales_intelligence_bim_analysis_version_uk
  on public.sales_intelligence_basket_invoice_matches(analysis_id, evaluation_version);
create unique index if not exists sales_intelligence_bim_current_uk
  on public.sales_intelligence_basket_invoice_matches(analysis_id)
  where is_current_evaluation = true;

create index if not exists sales_intelligence_bim_case_idx on public.sales_intelligence_basket_invoice_matches(case_id);
create index if not exists sales_intelligence_bim_attribution_idx on public.sales_intelligence_basket_invoice_matches(attribution_row_id);
create index if not exists sales_intelligence_bim_invoice_idx on public.sales_intelligence_basket_invoice_matches(invoice_id);
create index if not exists sales_intelligence_bim_scope_idx on public.sales_intelligence_basket_invoice_matches(integrity_evaluation_scope);
create index if not exists sales_intelligence_bim_needs_review_idx on public.sales_intelligence_basket_invoice_matches(needs_human_review);

alter table public.sales_intelligence_basket_invoice_matches enable row level security;

drop policy if exists sales_intelligence_bim_select_v1 on public.sales_intelligence_basket_invoice_matches;
create policy sales_intelligence_bim_select_v1
on public.sales_intelligence_basket_invoice_matches
for select
to public
using (
  public.dawaa_actor_is_top_management_v1()
  or exists (
    select 1
    from public.staff_accounts me
    join public.sales_intelligence_cases c on c.case_id = sales_intelligence_basket_invoice_matches.case_id
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

comment on table public.sales_intelligence_basket_invoice_matches is
  'Phase H.1A. References the exact attribution evaluation it was computed against. item_evidence_ready must be checked before trusting any item-level field — sales_invoice_items_v21 has 0 rows in production today. See docs/SALES_INTELLIGENCE_PERSISTENCE_DESIGN.md.';
