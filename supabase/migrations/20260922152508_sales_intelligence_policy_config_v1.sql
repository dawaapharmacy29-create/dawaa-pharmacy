-- Sales Intelligence Phase H.1A — Schema Foundation (1/7): policy config.
-- Design source: docs/SALES_INTELLIGENCE_PERSISTENCE_DESIGN.md, src/lib/salesIntelligence/persistence/types.ts.
-- Append-only/versioned: every policy change is a NEW row, never an update to an existing one.
create table if not exists public.sales_intelligence_policy_config (
  policy_config_id uuid primary key default gen_random_uuid(),
  policy_config_version integer not null,
  protocol_policy_effective_at timestamptz null,
  enabled boolean not null default false,
  effective_from timestamptz not null default now(),
  superseded_at timestamptz null,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  created_by text not null,

  constraint sales_intelligence_policy_config_version_ck check (policy_config_version > 0),
  constraint sales_intelligence_policy_config_superseded_consistency_ck check (
    (is_current = true and superseded_at is null)
    or (is_current = false and superseded_at is not null)
  )
);

create unique index if not exists sales_intelligence_policy_config_version_uk
  on public.sales_intelligence_policy_config(policy_config_version);
create unique index if not exists sales_intelligence_policy_config_current_uk
  on public.sales_intelligence_policy_config(is_current)
  where is_current = true;
create index if not exists sales_intelligence_policy_config_created_at_idx
  on public.sales_intelligence_policy_config(created_at desc);

alter table public.sales_intelligence_policy_config enable row level security;

-- Reuses the existing canonical actor/role helpers (dawaa_actor_is_top_management_v1,
-- dawaa_current_staff_account_id_strict) already used by whatsapp_review_sources and other
-- Sales-domain tables, per Phase H.1A instruction #12 — no parallel authorization system.
drop policy if exists sales_intelligence_policy_config_select_v1 on public.sales_intelligence_policy_config;
create policy sales_intelligence_policy_config_select_v1
on public.sales_intelligence_policy_config
for select
to public
using (
  public.dawaa_actor_is_top_management_v1()
  or exists (
    select 1 from public.staff_accounts me
    where me.id = public.dawaa_current_staff_account_id_strict()
      and coalesce(me.active,false)
      and coalesce(me.can_login,false)
      and lower(trim(coalesce(me.role,''))) in ('team_dawaa_alpha','customer_service_manager')
  )
);

-- Append-only: writes restricted to top management/admin only. No UPDATE or DELETE policy is
-- ever created for this table — a "change" is always a new row (design doc H.0.2 §10).
drop policy if exists sales_intelligence_policy_config_insert_v1 on public.sales_intelligence_policy_config;
create policy sales_intelligence_policy_config_insert_v1
on public.sales_intelligence_policy_config
for insert
to public
with check (
  public.dawaa_actor_is_top_management_v1()
);

comment on table public.sales_intelligence_policy_config is
  'Phase H.1A. Append-only/versioned protocol policy configuration. Never updated in place — a policy change is always a new row with the previous row marked is_current=false/superseded_at. See docs/SALES_INTELLIGENCE_PERSISTENCE_DESIGN.md.';
