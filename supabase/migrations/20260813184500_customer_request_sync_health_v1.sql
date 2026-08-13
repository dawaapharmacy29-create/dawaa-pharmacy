create or replace function public.get_customer_request_sync_health_v1()
returns jsonb
language sql
stable
set search_path to 'public'
as $$
with source_stats as (
  select count(*)::int total_synced,
    count(*) filter (where (coalesce(source_last_seen_at,updated_at) at time zone 'Africa/Cairo')::date=(now() at time zone 'Africa/Cairo')::date)::int seen_today,
    count(*) filter (where coalesce(source_last_seen_at,updated_at)>=now()-interval '1 hour')::int seen_last_hour,
    max(source_updated_at) latest_source_update,
    max(source_last_seen_at) last_received,
    count(*) filter (where coalesce(sync_conflict,false))::int sync_conflicts,
    count(*) filter (where nullif(btrim(coalesce(branch,'')),'') is null)::int no_branch,
    count(*) filter (where customer_id is null)::int unlinked_customer,
    count(*) filter (where lower(coalesce(status,'new')) not in ('closed','delivered','cancelled','not_available'))::int open_requests
  from public.customer_requests where source_system='dawaawael' and source_entity='CustomerOrder'
), inbox_stats as (
  select count(*)::int inbox_total,
    count(*) filter (where processing_status='imported')::int imported,
    count(*) filter (where processing_status='updated')::int updated,
    count(*) filter (where processing_status in ('conflict','rejected','failed'))::int failed_or_conflict,
    count(*) filter (where processing_status in ('received','pending','processing'))::int pending,
    max(received_at) inbox_last_received,max(processed_at) inbox_last_processed
  from public.customer_request_sync_inbox where source_system='dawaawael' and source_entity='CustomerOrder'
), branch_stats as (
  select coalesce(jsonb_agg(jsonb_build_object('branch',branch_name,'total',total,'open',open_count,'last_received',last_received) order by branch_name),'[]'::jsonb) branches
  from (select coalesce(nullif(btrim(branch),''),'بدون فرع') branch_name,count(*)::int total,
    count(*) filter(where lower(coalesce(status,'new')) not in ('closed','delivered','cancelled','not_available'))::int open_count,max(source_last_seen_at) last_received
    from public.customer_requests where source_system='dawaawael' and source_entity='CustomerOrder' group by 1) x
), latest_rows as (
  select coalesce(jsonb_agg(jsonb_build_object('source_record_id',source_record_id,'order_number',source_order_number,'customer_name',customer_name,'branch',branch,'medicine_name',medicine_name,'status',status,'source_status',source_status,'source_updated_at',source_updated_at,'received_at',source_last_seen_at,'sync_conflict',coalesce(sync_conflict,false)) order by coalesce(source_last_seen_at,source_updated_at) desc),'[]'::jsonb) latest
  from (select * from public.customer_requests where source_system='dawaawael' and source_entity='CustomerOrder' order by coalesce(source_last_seen_at,source_updated_at) desc nulls last limit 8) q
)
select jsonb_build_object('source_system','dawaawael','source_entity','CustomerOrder','total_synced',s.total_synced,'seen_today',s.seen_today,'seen_last_hour',s.seen_last_hour,'latest_source_update',s.latest_source_update,'last_received',coalesce(s.last_received,i.inbox_last_received),'sync_lag_minutes',case when coalesce(s.last_received,i.inbox_last_received) is null then null else greatest(0,round(extract(epoch from(now()-coalesce(s.last_received,i.inbox_last_received)))/60.0))::int end,'sync_conflicts',s.sync_conflicts,'no_branch',s.no_branch,'unlinked_customer',s.unlinked_customer,'open_requests',s.open_requests,'inbox_total',i.inbox_total,'imported',i.imported,'updated',i.updated,'failed_or_conflict',i.failed_or_conflict,'pending',i.pending,'last_processed',i.inbox_last_processed,'branches',b.branches,'latest',l.latest)
from source_stats s cross join inbox_stats i cross join branch_stats b cross join latest_rows l;
$$;
