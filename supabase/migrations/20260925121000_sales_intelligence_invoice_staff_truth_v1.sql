-- Canonical invoice-staff truth for official Sales Intelligence attributions.
-- This view intentionally separates conversation attribution from the staff identity stored on
-- the B-Connect invoice. Name fallback is accepted only when the normalized staff name resolves
-- to exactly one staff row. Ambiguous names remain unresolved and visible for QA.

create or replace view public.sales_intelligence_invoice_staff_truth_v1
with (security_invoker = true)
as
select
  a.id as attribution_row_id,
  a.analysis_id,
  a.case_id,
  a.evaluated_at,
  a.selected_invoice_id,
  a.selected_invoice_number,
  a.attribution_level,
  a.confidence_score,
  a.is_official_for_staff_evaluation,
  i.invoice_datetime,
  i.branch as invoice_branch,
  coalesce(i.total_amount, i.amount) as invoice_amount,
  nullif(trim(i.staff_id), '') as invoice_staff_id_raw,
  nullif(trim(i.staff_name), '') as invoice_staff_name_raw,
  coalesce(staff_by_id.id, staff_by_name.id) as canonical_staff_id,
  coalesce(staff_by_id.name, staff_by_name.name) as canonical_staff_name,
  coalesce(staff_by_id.role, staff_by_name.role) as canonical_staff_role,
  coalesce(staff_by_id.type, staff_by_name.type) as canonical_staff_type,
  coalesce(staff_by_id.branch, staff_by_name.branch) as canonical_staff_branch,
  coalesce(staff_by_id.is_active, staff_by_name.is_active) as canonical_staff_is_active,
  case
    when staff_by_id.id is not null then 'resolved_by_staff_id'
    when name_resolution.match_count = 1 and staff_by_name.id is not null then 'resolved_by_unique_name'
    when name_resolution.match_count > 1 then 'ambiguous_name'
    when nullif(trim(i.staff_id), '') is null and nullif(trim(i.staff_name), '') is null then 'missing_invoice_staff'
    else 'unresolved'
  end as staff_resolution_status,
  coalesce(staff_by_id.id, staff_by_name.id) is not null as is_staff_resolved,
  exists (
    select 1
    from public.sales_invoice_items_v21 item
    where item.invoice_id = a.selected_invoice_id
  ) as item_evidence_available
from public.sales_intelligence_attributions a
join public.sales_invoices i
  on i.id = a.selected_invoice_id
left join public.staff staff_by_id
  on staff_by_id.id::text = nullif(trim(i.staff_id), '')
left join lateral (
  select
    count(*)::integer as match_count,
    (array_agg(s.id order by s.id))[1] as candidate_staff_id
  from public.staff s
  where nullif(trim(i.staff_name), '') is not null
    and public.dawaa_normalize_staff_name_v1(s.name)
      = public.dawaa_normalize_staff_name_v1(i.staff_name)
) name_resolution on true
left join public.staff staff_by_name
  on staff_by_id.id is null
 and name_resolution.match_count = 1
 and staff_by_name.id = name_resolution.candidate_staff_id
where a.is_current_evaluation = true
  and a.is_official_for_staff_evaluation = true
  and a.selected_invoice_id is not null;

comment on view public.sales_intelligence_invoice_staff_truth_v1 is
'Official Sales Intelligence invoice attribution joined to B-Connect invoice staff. Direct staff_id wins; normalized-name fallback is used only when exactly one staff row matches. Ambiguous names stay unresolved for QA.';

grant select on public.sales_intelligence_invoice_staff_truth_v1 to authenticated, anon;
