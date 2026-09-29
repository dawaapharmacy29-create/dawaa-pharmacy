-- V45: read-only classification of Sales Intelligence cases that have no Customer Case V22 link.
--
-- Purpose: an unlinked Sales Intelligence case must always have a deterministic, explained reason.
-- This function never writes, never links, and never guesses by name/phone/nearest time.
--
-- Classes (per unlinked sales_intelligence_cases row, derived from its whatsapp_review_sources row):
--   source_missing                       the analyzed source no longer exists                         (FAIL)
--   direct_v22_unique_unlinked           exactly one V22 case owns the source but link is missing   (FAIL: bridge bug)
--   direct_v22_ambiguous                 more than one V22 case owns the source                     (human exception)
--   source_archived                      source was archived/superseded explicitly
--   segmentation_superseded_exact        same export file, every contained finer source is text-contained
--                                        in this source, all of them belong to exactly one V22 case, and
--                                        their message counts partition this source exactly
--   segmentation_superseded_partial      as above, but some contained finer sources have no V22 case
--   segmentation_superseded_ambiguous    contained finer sources belong to more than one V22 case    (human exception)
--   segmentation_identity_conflict       contained finer sources map to a V22 case of another customer_id (human exception)
--   historical_pre_v22_source            source was created before the first V22 case existed
--   unexplained_orphan                   none of the above                                          (FAIL)
--
-- candidateV22CaseId is diagnostic only. Nothing in this function writes it anywhere.

create or replace function public.dawaa_sales_intelligence_v22_link_audit_v45()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
with v22_era as (
  select min(created_at) as started_at from public.whatsapp_customer_cases_v22
),
unlinked as (
  select sic.case_id, sic.conversation_id, sic.customer_id, sic.customer_phone
  from public.sales_intelligence_cases sic
  where nullif(trim(coalesce(sic.source_case_id_v22, '')), '') is null
),
src as (
  select distinct on (u.conversation_id)
    u.conversation_id as source_id,
    s.id is not null as source_exists,
    s.review_status,
    s.created_at,
    s.source_filename,
    s.conversation_started_at as started_at,
    s.conversation_ended_at as ended_at,
    s.message_count,
    s.raw_text,
    s.customer_id,
    s.customer_phone
  from unlinked u
  left join public.whatsapp_review_sources s on s.id = u.conversation_id
  order by u.conversation_id
),
direct_v22 as (
  select src.source_id, count(distinct c.id) as n, min(c.id::text) as v22_id
  from src
  join public.whatsapp_customer_cases_v22 c
    on c.root_source_id = src.source_id or src.source_id = any(c.source_ids)
  group by src.source_id
),
children as (
  select src.source_id, o.id as child_id, o.message_count
  from src
  join public.whatsapp_review_sources o
    on o.source_filename = src.source_filename
   and o.id <> src.source_id
   and o.conversation_started_at >= src.started_at
   and o.conversation_ended_at <= src.ended_at
   and coalesce(o.review_status, '') <> 'archived'
  where src.source_exists
    and src.source_filename is not null
    and nullif(o.raw_text, '') is not null
    and strpos(src.raw_text, o.raw_text) > 0
),
child_v22 as (
  select ch.source_id, ch.child_id, ch.message_count, c.id as v22_id, c.customer_id as v22_customer_id, c.customer_phone as v22_phone
  from children ch
  left join public.whatsapp_customer_cases_v22 c
    on c.root_source_id = ch.child_id or ch.child_id = any(c.source_ids)
),
child_summary as (
  select
    cv.source_id,
    count(distinct cv.child_id) as contained_children,
    count(distinct cv.child_id) filter (where cv.v22_id is not null) as children_in_v22,
    count(distinct cv.v22_id) as v22_cases,
    min(cv.v22_id::text) as v22_id,
    bool_or(cv.v22_id is not null and cv.v22_customer_id is distinct from src.customer_id) as customer_conflict,
    bool_or(cv.v22_id is not null and cv.v22_phone is distinct from src.customer_phone) as phone_mismatch
  from child_v22 cv
  join src on src.source_id = cv.source_id
  group by cv.source_id
),
child_messages as (
  select source_id, sum(message_count) as contained_message_count
  from children
  group by source_id
),
classified as (
  select
    src.source_id,
    src.message_count,
    cm.contained_message_count,
    cs.contained_children,
    cs.children_in_v22,
    coalesce(cs.phone_mismatch, false) as phone_mismatch,
    case
      when not src.source_exists then 'source_missing'
      when dv.n = 1 then 'direct_v22_unique_unlinked'
      when dv.n > 1 then 'direct_v22_ambiguous'
      when src.review_status = 'archived' then 'source_archived'
      when coalesce(cs.v22_cases, 0) > 1 then 'segmentation_superseded_ambiguous'
      when cs.v22_cases = 1 and cs.customer_conflict then 'segmentation_identity_conflict'
      when cs.v22_cases = 1
        and cs.children_in_v22 = cs.contained_children
        and cm.contained_message_count = src.message_count then 'segmentation_superseded_exact'
      when cs.v22_cases = 1 then 'segmentation_superseded_partial'
      when src.created_at < (select started_at from v22_era) then 'historical_pre_v22_source'
      else 'unexplained_orphan'
    end as link_class,
    case
      when dv.n = 1 then dv.v22_id
      when cs.v22_cases = 1 and not coalesce(cs.customer_conflict, false) then cs.v22_id
      else null
    end as candidate_v22_case_id
  from src
  left join direct_v22 dv on dv.source_id = src.source_id
  left join child_summary cs on cs.source_id = src.source_id
  left join child_messages cm on cm.source_id = src.source_id
),
audit_rows as (
  select u.case_id, c.*
  from unlinked u
  join classified c on c.source_id = u.conversation_id
),
by_class as (
  select link_class, count(*) as cases, count(distinct source_id) as sources
  from audit_rows
  group by link_class
)
select jsonb_build_object(
  'ok', not exists (
    select 1 from audit_rows
    where link_class in ('source_missing', 'direct_v22_unique_unlinked', 'unexplained_orphan')
  ),
  'version', 'v45',
  'generatedAt', now(),
  'totals', jsonb_build_object(
    'salesIntelligenceCases', (select count(*) from public.sales_intelligence_cases),
    'linked', (select count(*) from public.sales_intelligence_cases
               where nullif(trim(coalesce(source_case_id_v22, '')), '') is not null),
    'unlinked', (select count(*) from unlinked),
    'unlinkedSources', (select count(*) from src)
  ),
  'byClass', coalesce((select jsonb_object_agg(link_class, jsonb_build_object('cases', cases, 'sources', sources)) from by_class), '{}'::jsonb),
  'failingClasses', jsonb_build_array('source_missing', 'direct_v22_unique_unlinked', 'unexplained_orphan'),
  'cases', coalesce((
    select jsonb_agg(jsonb_build_object(
      'salesCaseId', case_id,
      'sourceId', source_id,
      'linkClass', link_class,
      'candidateV22CaseId', candidate_v22_case_id,
      'sourceMessageCount', message_count,
      'containedMessageCount', contained_message_count,
      'containedSources', contained_children,
      'containedSourcesInV22', children_in_v22,
      'phoneMismatchWithV22', phone_mismatch
    ) order by link_class, source_id, case_id)
    from audit_rows
  ), '[]'::jsonb)
);
$function$;

revoke all on function public.dawaa_sales_intelligence_v22_link_audit_v45()
from public, anon, authenticated;

grant execute on function public.dawaa_sales_intelligence_v22_link_audit_v45()
to service_role;
