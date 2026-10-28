-- Audited general-manager correction of a candidate invoice match that was never confirmed.
-- This does not alter invoices, verified sales proof, reviews, incentives or ledger entries.
-- Confirmed/financial changes require a separate compensating-ledger workflow.

create table if not exists public.whatsapp_invoice_candidate_corrections_v1 (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.whatsapp_review_sources(id) on delete restrict,
  request_key text not null unique check (request_key ~ '^[A-Za-z0-9:_-]{8,120}$'),
  old_candidate jsonb not null,
  reason text not null check (length(btrim(reason)) >= 10),
  actor_id uuid not null,
  actor_name text,
  created_at timestamptz not null default now()
);

alter table public.whatsapp_invoice_candidate_corrections_v1 enable row level security;
revoke all on public.whatsapp_invoice_candidate_corrections_v1 from public, anon, authenticated;
grant select on public.whatsapp_invoice_candidate_corrections_v1 to service_role;

create or replace function public.dawaa_clear_whatsapp_unconfirmed_invoice_candidate_v1(
  p_source_id uuid, p_expected_candidate_id uuid, p_expected_invoice_number text,
  p_reason text, p_confirmation text, p_request_key text
) returns jsonb
language plpgsql security definer set search_path to 'public','pg_catalog'
as $fn$
declare
  v_actor record;
  v_source public.whatsapp_review_sources%rowtype;
  v_prior jsonb;
  v_impact jsonb;
  v_prior_record public.whatsapp_invoice_candidate_corrections_v1%rowtype;
  v_audit_id uuid;
begin
  select * into v_actor from public.dawaa_whatsapp_deletion_actor_v1();
  if length(btrim(coalesce(p_reason,''))) < 10 then
    raise exception 'whatsapp_candidate_reason_required';
  end if;
  if p_confirmation is distinct from 'تصحيح ربط الفاتورة' then
    raise exception 'whatsapp_candidate_confirmation_required';
  end if;
  if coalesce(p_request_key,'') !~ '^[A-Za-z0-9:_-]{8,120}$' then
    raise exception 'whatsapp_candidate_request_key_invalid';
  end if;

  select * into v_source from public.whatsapp_review_sources
    where id=p_source_id for update;
  if not found then raise exception 'whatsapp_source_not_found'; end if;

  select * into v_prior_record from public.whatsapp_invoice_candidate_corrections_v1
    where request_key=p_request_key;
  if found then
    if v_prior_record.source_id <> p_source_id then
      raise exception 'whatsapp_candidate_request_key_conflict';
    end if;
    return jsonb_build_object('ok',true,'status','replayed','auditId',v_prior_record.id);
  end if;

  if coalesce(v_source.invoice_link_confirmed,false)
     or v_source.invoice_link_confirmed_invoice_id is not null
     or v_source.invoice_link_confirmed_invoice_number is not null
     or coalesce(v_source.reviewer_confirmed,false)
     or v_source.official_review_id is not null then
    raise exception 'whatsapp_candidate_confirmed_link_requires_financial_review';
  end if;
  if v_source.matched_invoice_id is distinct from p_expected_candidate_id
     or v_source.matched_invoice_number is distinct from p_expected_invoice_number then
    raise exception 'whatsapp_candidate_changed_since_preview';
  end if;
  if v_source.matched_invoice_id is null then
    return jsonb_build_object('ok',true,'status','already_clear');
  end if;

  -- Re-use the canonical scope-impact checker, and refuse all blockers except the
  -- weak candidate itself. Do not amend cases with human/financial evidence.
  select public.dawaa_whatsapp_deletion_impact_v1(
    p_source_id, 'conversation',
    coalesce(array(select case_id from public.sales_intelligence_cases
                   where conversation_id=p_source_id), '{}'::text[])) into v_impact;
  if exists(select 1 from jsonb_array_elements(coalesce(v_impact->'blockers','[]'::jsonb)) b
            where b->>'code' <> 'conversation_has_invoice_link') then
    raise exception 'whatsapp_candidate_other_protected_work';
  end if;
  if exists(select 1 from public.sales_intelligence_attributions a
      join public.sales_intelligence_cases c on c.case_id=a.case_id
      where c.conversation_id=p_source_id and a.is_current_evaluation
        and (a.selected_invoice_id is not null or a.is_official_for_staff_evaluation
             or a.attribution_level='proven')) then
    raise exception 'whatsapp_candidate_case_attribution_requires_review';
  end if;

  v_prior := jsonb_build_object('matchedInvoiceId',v_source.matched_invoice_id,
    'matchedInvoiceNumber',v_source.matched_invoice_number,
    'matchedInvoiceDate',v_source.matched_invoice_date,
    'matchedInvoiceValue',v_source.matched_invoice_value,
    'invoiceMatchStatus',v_source.invoice_match_status,
    'invoiceMatchConfidence',v_source.invoice_match_confidence,
    'invoiceMatchReason',v_source.invoice_match_reason);

  insert into public.whatsapp_invoice_candidate_corrections_v1
    (source_id,request_key,old_candidate,reason,actor_id,actor_name)
  values (p_source_id,p_request_key,v_prior,btrim(p_reason),v_actor.actor_id,v_actor.actor_name)
  returning id into v_audit_id;

  update public.whatsapp_review_sources set
    matched_invoice_id=null, matched_invoice_number=null, matched_invoice_date=null,
    matched_invoice_value=null, invoice_match_confidence=null,
    invoice_match_status='needs_review',
    invoice_match_reason='أزال المدير العام مرشح فاتورة غير معتمد بعد مراجعة موثقة',
    updated_at=now()
  where id=p_source_id;

  return jsonb_build_object('ok',true,'status','corrected','auditId',v_audit_id);
end;
$fn$;

revoke all on function public.dawaa_clear_whatsapp_unconfirmed_invoice_candidate_v1(uuid,uuid,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.dawaa_clear_whatsapp_unconfirmed_invoice_candidate_v1(uuid,uuid,text,text,text,text)
  to anon, authenticated, service_role;
