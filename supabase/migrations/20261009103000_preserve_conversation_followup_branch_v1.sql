-- Repo-only draft. No live application without final approval.
-- Provenance is an existing action/source/target relation, never a name or source label.
begin;

do $guard$
begin
  if to_regprocedure('public.sync_customer_branch_to_open_followups_and_daily_queue()') is null then
    raise exception 'existing_customer_branch_sync_required';
  end if;
end;
$guard$;

create index if not exists whatsapp_actions_followup_target_lineage_idx
  on public.whatsapp_conversation_actions(target_id)
  where target_table = 'daily_followups';
create index if not exists customer_service_followup_events_lineage_target_idx
  on public.customer_service_followup_events(followup_id)
  where event_type in ('created', 'request_linked');

create or replace function public.dawaa_followup_has_conversation_lineage_v1(p_followup_id text)
returns boolean language sql stable
set search_path to 'public', 'pg_catalog'
as $function$
  select
    exists (
      select 1 from public.whatsapp_conversation_actions a
      join public.whatsapp_review_sources s on s.id = a.source_id
      where a.target_table = 'daily_followups' and a.target_id = p_followup_id
    )
    or exists (
      select 1 from public.daily_followups f
      join public.whatsapp_conversation_actions a on a.id = case
        when f.client_request_id ~ '^whatsapp-action:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then substring(f.client_request_id from 17)::uuid else null end
      join public.whatsapp_review_sources s on s.id = a.source_id
      where f.id = p_followup_id
    )
    or exists (
      select 1 from public.customer_service_followup_events e
      join public.whatsapp_conversation_actions a on a.id = case
        when e.metadata->>'client_request_id' ~ '^whatsapp-action:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then substring(e.metadata->>'client_request_id' from 17)::uuid else null end
      join public.whatsapp_review_sources s on s.id = a.source_id
      where e.followup_id = p_followup_id and e.event_type in ('created', 'request_linked')
    );
$function$;
revoke all on function public.dawaa_followup_has_conversation_lineage_v1(text) from public, anon, authenticated;
grant execute on function public.dawaa_followup_has_conversation_lineage_v1(text) to service_role;

create or replace function public.sync_customer_branch_to_open_followups_and_daily_queue()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.branch is distinct from old.branch and nullif(trim(coalesce(new.branch, '')), '') is not null then
    update public.daily_followups f
       set branch = new.branch,
           updated_at = now(),
           updated_by = coalesce(updated_by, 'customer_branch_sync')
     where customer_id = new.id::text
       and completed_at is null
       and cancelled_at is null
       and archived_at is null
       and not public.dawaa_followup_has_conversation_lineage_v1(f.id);

    update public.customer_service_daily_queue_items q
       set branch = new.branch,
           metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
             'canonicalBranch', new.branch,
             'branchSyncedAt', now(),
             'branchSyncSource', 'customers.branch'
           )
     where customer_id = new.id::text
       and queue_date >= (now() at time zone 'Africa/Cairo')::date
       and status <> 'completed'
       and not public.dawaa_followup_has_conversation_lineage_v1(q.linked_followup_id);
  end if;
  return new;
end;
$function$;
commit;
