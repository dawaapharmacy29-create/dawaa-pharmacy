-- V52: Canonical Review Gate (STEP 3C-5).
--
-- Review storage and official review eligibility are separate, like Sale Proof:
--   public.conversation_sales_reviews            — storage; every review row, kept as evidence.
--   public.conversation_sales_reviews_official_v1 — the only owner of official eligibility.
-- A review is official when it is not tied to a WhatsApp source (branch, call and manual
-- WhatsApp reviews entered by staff without a source link), or when its WhatsApp source is
-- admitted by the canonical operational owner public.whatsapp_operational_canonical_sources_v1
-- (V51: active, not superseded/coarse, exactly one Customer Case V22). Reviews on non-canonical,
-- summary-only, V22-less, superseded or archived WhatsApp sources stay stored as history and never
-- reach official KPI, incentives or doctor quality. No predicate is duplicated: readers only swap
-- the storage table for the owner view.
--
-- Official staff KPI / incentive / quality readers are switched to the owner. Each allowlisted
-- function body is re-emitted from its live definition with only the table name replaced; the
-- migration fails closed if a function is missing, writes the review table, or still references
-- storage afterwards. Storage-level readers (history lists, attachments, points writers, data
-- health, the retired V35 archive) are intentionally untouched. No row is written or deleted.

create or replace view public.conversation_sales_reviews_official_v1
with (security_invoker = true)
as
select r.*
from public.conversation_sales_reviews r
where r.whatsapp_review_source_id is null
   or exists (
     select 1
     from public.whatsapp_operational_canonical_sources_v1 o
     where o.source_id = r.whatsapp_review_source_id
   );

comment on view public.conversation_sales_reviews_official_v1 is
  'Official conversation reviews (Canonical Review Gate V52). Storage stays in conversation_sales_reviews.';

grant select on public.conversation_sales_reviews_official_v1 to anon, authenticated, service_role;

do $$
declare
  v_fn text;
  v_oid oid;
  v_def text;
  v_new text;
  v_readers text[] := array[
    'get_doctor_incentive_breakdown',
    'get_doctor_conversation_quality_summary',
    'get_doctor_competition_support_v1',
    'get_doctor_conversation_conversion_summary_v1',
    'get_branch_conversation_conversion_summary_v1',
    'get_cs_manager_supporting_metrics_v1',
    'get_cs_dashboard_reviews',
    'calculate_weekly_manager_metrics',
    'calculate_weekly_manager_metrics_v2',
    'get_manager_doctor_alerts',
    'get_doctor_conversation_review_coverage',
    'get_doctor_today_review_count',
    'get_doctor_cycle_reviews_v1'
  ];
  v_storage constant text := '\mconversation_sales_reviews\M(?!_official_v1)';
begin
  foreach v_fn in array v_readers loop
    select p.oid into v_oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_fn;
    if v_oid is null then
      raise exception 'v52_reader_missing:%', v_fn;
    end if;
    if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = v_fn) <> 1 then
      raise exception 'v52_reader_overloaded:%', v_fn;
    end if;
    v_def := pg_get_functiondef(v_oid);
    if v_def ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?conversation_sales_reviews\M' then
      raise exception 'v52_reader_writes_review_storage:%', v_fn;
    end if;
    if v_def !~ v_storage then
      if position('conversation_sales_reviews_official_v1' in v_def) > 0 then
        continue; -- already gated (idempotent re-run)
      end if;
      raise exception 'v52_reader_without_review_reference:%', v_fn;
    end if;
    v_new := regexp_replace(v_def, v_storage, 'conversation_sales_reviews_official_v1', 'g');
    execute v_new;
    if pg_get_functiondef(v_oid) ~ v_storage then
      raise exception 'v52_reader_still_reads_storage:%', v_fn;
    end if;
  end loop;
end $$;

-- 30-day staff KPI summary view: same definition, official reviews only.
do $$
declare
  v_def text := pg_get_viewdef('public.employee_kpi_30d_summary'::regclass, true);
  v_storage constant text := '\mconversation_sales_reviews\M(?!_official_v1)';
begin
  if v_def !~ v_storage then
    if position('conversation_sales_reviews_official_v1' in v_def) > 0 then
      return;
    end if;
    raise exception 'v52_kpi_view_without_review_reference';
  end if;
  execute 'create or replace view public.employee_kpi_30d_summary with (security_invoker = true) as '
    || regexp_replace(v_def, v_storage, 'conversation_sales_reviews_official_v1', 'g');
  if pg_get_viewdef('public.employee_kpi_30d_summary'::regclass, true) ~ v_storage then
    raise exception 'v52_kpi_view_still_reads_storage';
  end if;
end $$;
