-- General-manager approval queue for changes that affect protected WhatsApp evidence.
-- IMPORTANT: approvals here do NOT apply or delete approved records. A separate verified
-- compensating-ledger executor is required before status can ever become 'applied'.

create table if not exists public.whatsapp_gm_change_requests_v1 (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.whatsapp_review_sources(id) on delete restrict,
  case_id text,
  operation text not null check (operation in ('delete_case','delete_conversation','edit_case','edit_conversation')),
  proposed_values jsonb not null default '{}'::jsonb,
  reason text not null check (length(btrim(reason)) >= 10),
  impact jsonb not null,
  impact_fingerprint text not null,
  status text not null default 'pending_confirmation'
    check (status in ('pending_confirmation','approved_pending_reconciliation','cancelled','applied')),
  request_key text not null unique check (request_key ~ '^[A-Za-z0-9:_-]{8,120}$'),
  requested_by uuid not null,
  requested_by_name text,
  requested_at timestamptz not null default now(),
  confirmation_key text unique check (confirmation_key ~ '^[A-Za-z0-9:_-]{8,120}$'),
  confirmed_by uuid,
  confirmed_by_name text,
  confirmed_at timestamptz,
  confirmation_reason text,
  constraint whatsapp_gm_change_request_confirmation_pair_v1 check (
    (status='pending_confirmation' and confirmed_at is null and confirmed_by is null)
    or status in ('approved_pending_reconciliation','cancelled','applied'))
);

create table if not exists public.whatsapp_gm_change_request_audit_v1 (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.whatsapp_gm_change_requests_v1(id) on delete restrict,
  event_type text not null check (event_type in ('requested','confirmed')),
  actor_id uuid not null,
  actor_name text,
  event_payload jsonb not null,
  created_at timestamptz not null default now(),
  unique(request_id,event_type)
);

alter table public.whatsapp_gm_change_requests_v1 enable row level security;
alter table public.whatsapp_gm_change_request_audit_v1 enable row level security;
revoke all on public.whatsapp_gm_change_requests_v1 from public,anon,authenticated;
revoke all on public.whatsapp_gm_change_request_audit_v1 from public,anon,authenticated;
grant select on public.whatsapp_gm_change_requests_v1 to service_role;
grant select on public.whatsapp_gm_change_request_audit_v1 to service_role;

create or replace function public.dawaa_whatsapp_gm_change_audit_append_only_v1()
returns trigger language plpgsql set search_path to 'public','pg_catalog'
as $fn$
begin
  raise exception 'whatsapp_gm_change_audit_is_immutable';
end;
$fn$;
drop trigger if exists whatsapp_gm_change_audit_immutable_v1 on public.whatsapp_gm_change_request_audit_v1;
create trigger whatsapp_gm_change_audit_immutable_v1
  before update or delete on public.whatsapp_gm_change_request_audit_v1
  for each row execute function public.dawaa_whatsapp_gm_change_audit_append_only_v1();
revoke all on function public.dawaa_whatsapp_gm_change_audit_append_only_v1() from public,anon,authenticated;

-- The approval queue deliberately lacks any function that changes protected case/review/ledger data.
create or replace function public.dawaa_request_whatsapp_gm_change_v1(
  p_operation text,p_source_id uuid,p_case_id text,p_proposed_values jsonb,
  p_reason text,p_expected_fingerprint text,p_request_key text
) returns jsonb language plpgsql security definer set search_path to 'public','pg_catalog'
as $fn$
declare
  v_actor record;
  v_existing public.whatsapp_gm_change_requests_v1%rowtype;
  v_impact jsonb;
  v_scope text;
  v_case_ids text[];
  v_id uuid;
begin
  select * into v_actor from public.dawaa_whatsapp_deletion_actor_v1();
  if p_operation not in ('delete_case','delete_conversation','edit_case','edit_conversation') then
    raise exception 'whatsapp_gm_change_invalid_operation';
  end if;
  if length(btrim(coalesce(p_reason,''))) < 10 then raise exception 'whatsapp_gm_change_reason_required'; end if;
  if coalesce(p_request_key,'') !~ '^[A-Za-z0-9:_-]{8,120}$' then
    raise exception 'whatsapp_gm_change_invalid_request_key';
  end if;
  if jsonb_typeof(coalesce(p_proposed_values,'{}'::jsonb)) <> 'object' then
    raise exception 'whatsapp_gm_change_invalid_payload';
  end if;

  perform 1 from public.whatsapp_review_sources where id=p_source_id for update;
  if not found then raise exception 'whatsapp_source_not_found'; end if;
  select * into v_existing from public.whatsapp_gm_change_requests_v1 where request_key=p_request_key;
  if found then
    if v_existing.source_id <> p_source_id or v_existing.operation <> p_operation
      or v_existing.case_id is distinct from p_case_id
      or v_existing.proposed_values is distinct from coalesce(p_proposed_values,'{}'::jsonb)
      or v_existing.reason <> btrim(p_reason)
      or v_existing.impact_fingerprint is distinct from p_expected_fingerprint then
      raise exception 'whatsapp_gm_change_request_key_conflict';
    end if;
    return jsonb_build_object('ok',true,'status',v_existing.status,'requestId',v_existing.id,'replayed',true);
  end if;

  v_scope := case when p_operation in ('delete_case','edit_case') then 'case' else 'conversation' end;
  if v_scope='case' then
    if not exists(select 1 from public.sales_intelligence_cases
                  where case_id=p_case_id and conversation_id=p_source_id and deleted_at is null) then
      raise exception 'whatsapp_case_not_found';
    end if;
    v_case_ids:=array[p_case_id];
  else
    if p_case_id is not null then raise exception 'whatsapp_gm_change_case_not_expected'; end if;
    select coalesce(array_agg(case_id order by case_id),'{}'::text[]) into v_case_ids
    from public.sales_intelligence_cases where conversation_id=p_source_id and deleted_at is null;
  end if;
  v_impact:=public.dawaa_whatsapp_deletion_impact_v1(p_source_id,v_scope,v_case_ids);
  if v_impact->>'fingerprint' is distinct from p_expected_fingerprint then
    raise exception 'whatsapp_gm_change_preview_stale';
  end if;

  insert into public.whatsapp_gm_change_requests_v1
    (source_id,case_id,operation,proposed_values,reason,impact,impact_fingerprint,
     request_key,requested_by,requested_by_name)
  values (p_source_id,p_case_id,p_operation,coalesce(p_proposed_values,'{}'::jsonb),
     btrim(p_reason),v_impact,p_expected_fingerprint,p_request_key,v_actor.actor_id,v_actor.actor_name)
  returning id into v_id;
  insert into public.whatsapp_gm_change_request_audit_v1
    (request_id,event_type,actor_id,actor_name,event_payload)
  values (v_id,'requested',v_actor.actor_id,v_actor.actor_name,
    jsonb_build_object('operation',p_operation,'proposedValues',p_proposed_values,
      'reason',btrim(p_reason),'impactFingerprint',p_expected_fingerprint));
  return jsonb_build_object('ok',true,'status','pending_confirmation','requestId',v_id);
end;
$fn$;

create or replace function public.dawaa_confirm_whatsapp_gm_change_v1(
  p_request_id uuid,p_confirmation text,p_reason text,p_request_key text
) returns jsonb language plpgsql security definer set search_path to 'public','pg_catalog'
as $fn$
declare
  v_actor record;
  v_request public.whatsapp_gm_change_requests_v1%rowtype;
  v_case_ids text[];
  v_scope text;
  v_now jsonb;
begin
  select * into v_actor from public.dawaa_whatsapp_deletion_actor_v1();
  if p_confirmation is distinct from 'أؤكد التصحيح المعتمد' then
    raise exception 'whatsapp_gm_change_confirmation_required';
  end if;
  if length(btrim(coalesce(p_reason,''))) < 10 then raise exception 'whatsapp_gm_change_reason_required'; end if;
  if coalesce(p_request_key,'') !~ '^[A-Za-z0-9:_-]{8,120}$' then
    raise exception 'whatsapp_gm_change_invalid_request_key';
  end if;
  select * into v_request from public.whatsapp_gm_change_requests_v1
  where id=p_request_id for update;
  if not found then raise exception 'whatsapp_gm_change_not_found'; end if;
  if v_request.status='approved_pending_reconciliation' then
    if v_request.confirmation_key=p_request_key then
      return jsonb_build_object('ok',true,'status',v_request.status,'requestId',v_request.id,'replayed',true);
    end if;
    raise exception 'whatsapp_gm_change_already_confirmed';
  end if;
  if v_request.status <> 'pending_confirmation' then raise exception 'whatsapp_gm_change_not_pending'; end if;

  -- Serialize with source-level edits before comparing the complete current impact.
  perform 1 from public.whatsapp_review_sources where id=v_request.source_id for update;
  v_scope:=case when v_request.operation in ('delete_case','edit_case') then 'case' else 'conversation' end;
  if v_scope='case' then v_case_ids:=array[v_request.case_id];
  else
    select coalesce(array_agg(case_id order by case_id),'{}'::text[]) into v_case_ids
    from public.sales_intelligence_cases where conversation_id=v_request.source_id and deleted_at is null;
  end if;
  v_now:=public.dawaa_whatsapp_deletion_impact_v1(v_request.source_id,v_scope,v_case_ids);
  if v_now->>'fingerprint' is distinct from v_request.impact_fingerprint then
    raise exception 'whatsapp_gm_change_preview_stale';
  end if;
  update public.whatsapp_gm_change_requests_v1 set
    status='approved_pending_reconciliation',confirmation_key=p_request_key,
    confirmed_by=v_actor.actor_id,confirmed_by_name=v_actor.actor_name,
    confirmed_at=now(),confirmation_reason=btrim(p_reason)
  where id=v_request.id;
  insert into public.whatsapp_gm_change_request_audit_v1
    (request_id,event_type,actor_id,actor_name,event_payload)
  values (v_request.id,'confirmed',v_actor.actor_id,v_actor.actor_name,
    jsonb_build_object('confirmation',p_confirmation,'reason',btrim(p_reason),
      'impactFingerprint',v_request.impact_fingerprint,'settlementRequired',true));
  return jsonb_build_object('ok',true,'status','approved_pending_reconciliation',
    'requestId',v_request.id,'applied',false,'settlementRequired',true);
end;
$fn$;

create or replace function public.dawaa_list_whatsapp_gm_changes_v1(p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_catalog'
as $fn$
begin
  perform 1 from public.dawaa_whatsapp_deletion_actor_v1();
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',r.id,'sourceId',r.source_id,'caseId',r.case_id,'operation',r.operation,
    'status',r.status,'reason',r.reason,'requestedBy',r.requested_by_name,
    'requestedAt',r.requested_at,'confirmedBy',r.confirmed_by_name,
    'confirmedAt',r.confirmed_at,'caseCount',jsonb_array_length(coalesce(r.impact->'cases','[]'::jsonb)),
    'blockerCount',jsonb_array_length(coalesce(r.impact->'blockers','[]'::jsonb)),
    'customerName',r.impact #>> '{conversation,customerName}',
    'customerCode',r.impact #>> '{conversation,customerCode}') order by r.requested_at desc,r.id)
    from (select * from public.whatsapp_gm_change_requests_v1
          order by requested_at desc,id limit least(greatest(coalesce(p_limit,50),1),100)) r),
    '[]'::jsonb);
end;
$fn$;

revoke all on function public.dawaa_request_whatsapp_gm_change_v1(text,uuid,text,jsonb,text,text,text)
  from public,anon,authenticated;
revoke all on function public.dawaa_confirm_whatsapp_gm_change_v1(uuid,text,text,text)
  from public,anon,authenticated;
grant execute on function public.dawaa_request_whatsapp_gm_change_v1(text,uuid,text,jsonb,text,text,text)
  to anon,authenticated,service_role;
grant execute on function public.dawaa_confirm_whatsapp_gm_change_v1(uuid,text,text,text)
  to anon,authenticated,service_role;
revoke all on function public.dawaa_list_whatsapp_gm_changes_v1(integer)
  from public,anon,authenticated;
grant execute on function public.dawaa_list_whatsapp_gm_changes_v1(integer)
  to anon,authenticated,service_role;
