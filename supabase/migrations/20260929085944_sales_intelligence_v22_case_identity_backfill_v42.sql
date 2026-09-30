-- V42: connect existing Sales Intelligence cases to the unique Customer Case V22
-- that already owns the same whatsapp_review_sources conversation.
--
-- Safety rules:
-- - only rows with source_case_id_v22 IS NULL are eligible;
-- - exactly one distinct V22 candidate must exist;
-- - ambiguous or missing mappings remain untouched;
-- - no sale proof, outcome, invoice, revenue, story, journey or recovery fields are changed.

with candidate_links as (
  select distinct
    sic.case_id as sales_case_id,
    c.id::text as candidate_v22_case_id
  from public.sales_intelligence_cases sic
  join public.whatsapp_customer_cases_v22 c
    on sic.conversation_id = c.root_source_id
    or sic.conversation_id = any(c.source_ids)
  where sic.source_case_id_v22 is null
),
unique_links as (
  select
    sales_case_id,
    min(candidate_v22_case_id) as candidate_v22_case_id
  from candidate_links
  group by sales_case_id
  having count(distinct candidate_v22_case_id) = 1
)
update public.sales_intelligence_cases sic
set source_case_id_v22 = u.candidate_v22_case_id,
    last_seen_at = greatest(coalesce(sic.last_seen_at, sic.first_seen_at), now())
from unique_links u
where sic.case_id = u.sales_case_id
  and sic.source_case_id_v22 is null;
