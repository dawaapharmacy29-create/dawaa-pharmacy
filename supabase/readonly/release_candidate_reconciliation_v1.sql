-- Release Candidate read-only reconciliation report (v1).
-- READ ONLY: runs inside a READ ONLY transaction and ends with ROLLBACK. It contains no
-- UPDATE / DELETE / INSERT / MERGE and creates nothing. Run it before activation, with a
-- read-only role, and review the output by hand. Any repair is a separate, reviewed change.
-- It depends only on tables and columns that exist before the Release Candidate migrations,
-- so it can run before them (it does not call functions those migrations add).
-- Every list is capped (LIMIT 500); each section starts with its total count.
begin transaction isolation level repeatable read read only;

-- Shared relations as psql variables (a READ ONLY transaction cannot create even temporary views).
-- rc_lineage: same three paths as dawaa_followup_conversation_sources_v1.
-- rc_actions: actions plus the branch key of dawaa_customer_request_branch_key and identity parts.
\set rc_lineage 'select a.target_id as followup_id, a.id as action_id, s.id as source_id, s.branch as source_branch, ''action_target'' as path from public.whatsapp_conversation_actions a join public.whatsapp_review_sources s on s.id = a.source_id where a.target_table = ''daily_followups'' and a.target_id is not null union all select f.id::text, a.id, s.id, s.branch, ''client_request_id'' from public.daily_followups f join public.whatsapp_conversation_actions a on a.id = case when f.client_request_id ~ ''^whatsapp-action:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'' then substring(f.client_request_id from 17)::uuid else null end join public.whatsapp_review_sources s on s.id = a.source_id union all select e.followup_id::text, a.id, s.id, s.branch, ''event_'' || e.event_type from public.customer_service_followup_events e join public.whatsapp_conversation_actions a on a.id = case when e.metadata->>''client_request_id'' ~ ''^whatsapp-action:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'' then substring(e.metadata->>''client_request_id'' from 17)::uuid else null end join public.whatsapp_review_sources s on s.id = a.source_id where e.event_type in (''created'', ''request_linked'')'
\set rc_actions 'select a.*, case when lower(trim(coalesce(a.branch,''''))) in (''فرع شكري'',''شكري'',''shokry'',''shoukry'') then ''shokry'' when lower(trim(coalesce(a.branch,''''))) in (''فرع الشامي'',''الشامي'',''الشامى'',''elshamy'',''el-shamy'',''alshamy'') then ''elshamy'' when trim(coalesce(a.branch,'''')) = '''' then null else lower(trim(a.branch)) end as branch_key, split_part(a.followup_identity, ''|'', 2) as identity_anchor, split_part(a.followup_identity, ''|'', 3) || ''|'' || split_part(a.followup_identity, ''|'', 4) || ''|'' || split_part(a.followup_identity, ''|'', 5) as identity_suffix from public.whatsapp_conversation_actions a'

\echo '== 1. Duplicate operation candidates: different rows, same action type, identical evidence'
with rc_lineage as (:rc_lineage), rc_actions as (:rc_actions)
select count(*) as candidate_pairs from rc_actions a join rc_actions b
  on a.id < b.id and a.action_type = b.action_type and a.evidence = b.evidence
  and jsonb_typeof(a.evidence) = 'array' and jsonb_array_length(a.evidence) > 0;
with rc_lineage as (:rc_lineage), rc_actions as (:rc_actions)
select a.id as row_a, b.id as row_b, a.action_type, a.followup_identity as identity_a, b.followup_identity as identity_b,
       a.source_id as source_a, b.source_id as source_b, a.customer_id as customer_a, b.customer_id as customer_b,
       a.status as status_a, b.status as status_b, a.target_id as target_a, b.target_id as target_b
from rc_actions a join rc_actions b
  on a.id < b.id and a.action_type = b.action_type and a.evidence = b.evidence
  and jsonb_typeof(a.evidence) = 'array' and jsonb_array_length(a.evidence) > 0
order by a.action_type, a.id limit 500;

\echo '== 2. Conflicting stable identities: same episode/type/reason under more than one anchor'
with rc_lineage as (:rc_lineage), rc_actions as (:rc_actions)
select count(*) as groups from (
  select identity_suffix from rc_actions where followup_identity like 'fu1|%'
  group by identity_suffix having count(distinct identity_anchor) > 1) g;
with rc_lineage as (:rc_lineage), rc_actions as (:rc_actions)
select identity_suffix, array_agg(distinct identity_anchor order by identity_anchor) as anchors,
       array_agg(id order by id) as row_ids, array_agg(distinct customer_id) as customers
from rc_actions where followup_identity like 'fu1|%'
group by identity_suffix having count(distinct identity_anchor) > 1
order by identity_suffix limit 500;

\echo '== 3. Legacy alias collisions: pre-contract keys (case:/customer:) sharing a suffix with another row'
with rc_lineage as (:rc_lineage), rc_actions as (:rc_actions)
select a.id, a.followup_identity, a.customer_id, a.source_id,
       array_agg(b.id order by b.id) as other_rows, array_agg(b.followup_identity order by b.id) as other_identities
from rc_actions a join rc_actions b
  on b.id <> a.id and b.identity_suffix = a.identity_suffix and b.action_type = a.action_type
where a.identity_anchor like 'case:%' or a.identity_anchor like 'customer:%'
group by a.id, a.followup_identity, a.customer_id, a.source_id
order by a.followup_identity limit 500;

\echo '== 4. Customer attribution different from source truth (action vs its source)'
with rc_lineage as (:rc_lineage), rc_actions as (:rc_actions)
select count(*) as rows from rc_actions a join public.whatsapp_review_sources s on s.id = a.source_id
  where a.customer_id is distinct from s.customer_id;
with rc_lineage as (:rc_lineage), rc_actions as (:rc_actions)
select a.id, a.followup_identity, a.customer_id as action_customer, s.customer_id as source_customer,
       a.status, a.target_table, a.target_id,
       case when s.customer_id is null then 'source_unresolved' when a.customer_id is null then 'action_unresolved' else 'different_customer' end as kind
from rc_actions a join public.whatsapp_review_sources s on s.id = a.source_id
where a.customer_id is distinct from s.customer_id
order by kind, a.id limit 500;

\echo '== 5a. Branch mismatches: action branch vs its source branch'
with rc_lineage as (:rc_lineage), rc_actions as (:rc_actions)
select a.id, a.branch as action_branch, s.branch as source_branch, a.status, a.target_table, a.target_id
from rc_actions a join public.whatsapp_review_sources s on s.id = a.source_id
where a.branch_key is distinct from (
  case when lower(trim(coalesce(s.branch,''))) in ('فرع شكري','شكري','shokry','shoukry') then 'shokry'
       when lower(trim(coalesce(s.branch,''))) in ('فرع الشامي','الشامي','الشامى','elshamy','el-shamy','alshamy') then 'elshamy'
       when trim(coalesce(s.branch,'')) = '' then null else lower(trim(s.branch)) end)
order by a.id limit 500;

\echo '== 5b. Conversation follow-ups whose branch differs from their source branch (guard would refuse further moves; realignment candidates)'
with rc_lineage as (:rc_lineage), rc_actions as (:rc_actions)
select f.id, f.branch as followup_branch, array_agg(distinct l.source_branch) as source_branches,
       array_agg(distinct l.path) as lineage_paths, f.completed_at is null and f.cancelled_at is null and f.archived_at is null as is_open,
       case when count(distinct l.source_branch) > 1 then 'ambiguous_sources_manual_review' else 'single_source_realign_candidate' end as kind
from public.daily_followups f join rc_lineage l on l.followup_id = f.id::text
group by f.id, f.branch, f.completed_at, f.cancelled_at, f.archived_at
having bool_or(
  case when lower(trim(coalesce(f.branch,''))) in ('فرع شكري','شكري') then 'shokry'
       when lower(trim(coalesce(f.branch,''))) in ('فرع الشامي','الشامي','الشامى') then 'elshamy'
       else lower(trim(coalesce(f.branch,''))) end
  is distinct from
  case when lower(trim(coalesce(l.source_branch,''))) in ('فرع شكري','شكري') then 'shokry'
       when lower(trim(coalesce(l.source_branch,''))) in ('فرع الشامي','الشامي','الشامى') then 'elshamy'
       else lower(trim(coalesce(l.source_branch,''))) end)
order by kind, f.id limit 500;

\echo '== 6. Orphaned proof / lineage references'
with rc_lineage as (:rc_lineage), rc_actions as (:rc_actions)
select 'action_target_missing_followup' as kind, a.id::text as ref, a.target_id as target
from rc_actions a left join public.daily_followups f on f.id::text = a.target_id
where a.target_table = 'daily_followups' and a.target_id is not null and f.id is null
union all
select 'followup_client_key_missing_action', f.id::text, f.client_request_id
from public.daily_followups f left join public.whatsapp_conversation_actions a on a.id = case
  when f.client_request_id ~ '^whatsapp-action:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  then substring(f.client_request_id from 17)::uuid else null end
where f.client_request_id like 'whatsapp-action:%' and a.id is null
union all
select 'action_source_missing', a.id::text, a.source_id::text
from rc_actions a left join public.whatsapp_review_sources s on s.id = a.source_id
where a.source_id is not null and s.id is null
order by 1, 2 limit 500;

\echo '== 7. Rows the Release Candidate migrations would treat differently'
with rc_lineage as (:rc_lineage), rc_actions as (:rc_actions)
select
  (select count(distinct followup_id) from rc_lineage) as conversation_followups_now_branch_protected,
  (select count(*) from public.daily_followups f where f.completed_at is null and f.cancelled_at is null and f.archived_at is null
     and coalesce(f.is_hidden, false) = false and exists (select 1 from rc_lineage l where l.followup_id = f.id::text)) as open_conversation_followups,
  (select count(*) from rc_actions where followup_identity is null) as actions_without_identity,
  (select count(*) from public.customer_service_daily_queue_items q
     where q.completed_at is null and exists (select 1 from rc_lineage l where l.followup_id = q.linked_followup_id::text)) as open_queue_items_linked_to_conversation;

\echo '== 8. Open follow-up uniqueness: customer+branch vs customer+branch+request_type (unique-index decision input)'
with rc_lineage as (:rc_lineage), rc_actions as (:rc_actions)
select count(*) filter (where open_cases > 1) as customer_branch_groups_with_multiple_open,
       count(*) filter (where open_types > 1) as customer_branch_groups_with_multiple_request_types
from (
  select identity_key, branch, count(*) as open_cases, count(distinct coalesce(nullif(btrim(request_type), ''), 'general')) as open_types
  from public.daily_followups
  where identity_key is not null and completed_at is null and cancelled_at is null and archived_at is null
    and coalesce(is_hidden, false) = false and duplicate_of is null
  group by identity_key, branch) g;

\echo '== 9. Ambiguous records: never repair automatically'
with rc_lineage as (:rc_lineage), rc_actions as (:rc_actions)
select f.id, array_agg(distinct l.source_id) as sources, array_agg(distinct l.source_branch) as source_branches
from public.daily_followups f join rc_lineage l on l.followup_id = f.id::text
group by f.id having count(distinct coalesce(l.source_branch, '∅')) > 1
order by f.id limit 500;

rollback;
