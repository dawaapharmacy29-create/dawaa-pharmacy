-- Audited, case-scoped manager decision. Intentionally does NOT alter canonical
-- sale proof, staff attribution, the analysis snapshot, evaluation or payroll.
create table if not exists public.whatsapp_product_identity_manager_reviews_v1 (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.whatsapp_review_sources(id),
  source_hash text not null,
  case_id text not null,
  analysis_id uuid not null,
  basket_item_id text not null,
  source_message_id text not null,
  raw_phrase text not null,
  catalog_product_id uuid not null references public.products(id),
  catalog_product_code text not null,
  invoice_id text not null,
  invoice_item_id uuid not null references public.sales_invoice_items_v21(id),
  quantity numeric not null check (quantity > 0),
  decision text not null check (decision = 'identity_confirmed'),
  reviewer_account_id uuid not null references public.staff_accounts(id),
  reviewer_name text not null,
  reviewer_note text not null check (length(btrim(reviewer_note)) >= 8),
  reviewed_at timestamptz not null default clock_timestamp(),
  constraint whatsapp_product_identity_case_item_unique_v1 unique (source_id, case_id, basket_item_id)
);

create index if not exists whatsapp_product_identity_manager_reviews_case_v1
  on public.whatsapp_product_identity_manager_reviews_v1(case_id, reviewed_at desc);

alter table public.whatsapp_product_identity_manager_reviews_v1 enable row level security;
revoke all on public.whatsapp_product_identity_manager_reviews_v1 from public, anon, authenticated;
grant select on public.whatsapp_product_identity_manager_reviews_v1 to service_role;
-- Read through a narrowly authorized RPC, never directly through Data API.

create or replace function public.dawaa_confirm_whatsapp_product_identity_v1(
  p_source_id uuid,
  p_case_id text,
  p_analysis_id uuid,
  p_basket_item_id text,
  p_invoice_item_id uuid,
  p_reviewer_note text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor_id uuid;
  v_actor_name text;
  v_source public.whatsapp_review_sources%rowtype;
  v_analysis record;
  v_item jsonb;
  v_product public.products%rowtype;
  v_line public.sales_invoice_items_v21%rowtype;
  v_net_quantity numeric;
  v_existing public.whatsapp_product_identity_manager_reviews_v1%rowtype;
  v_result_id uuid;
begin
  v_actor_id := public.dawaa_current_staff_account_id_strict();
  if v_actor_id is null or public.dawaa_actor_is_top_management_v1() is not true
     or public.dawaa_current_actor_can(array['approve_reviews','manage_conversation_evaluations']) is not true then
    raise exception 'product_identity_review_not_authorized' using errcode = '42501';
  end if;
  select coalesce(nullif(btrim(staff_name), ''), nullif(btrim(name), ''))
    into v_actor_name from public.staff_accounts
    where id = v_actor_id and coalesce(active, false) and coalesce(can_login, false);
  if v_actor_name is null then
    raise exception 'verified_manager_account_required' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reviewer_note, ''))) < 8 then
    raise exception 'product_identity_review_note_required' using errcode = '22023';
  end if;
  if p_case_id is null or split_part(p_case_id, ':', 1) <> p_source_id::text then
    raise exception 'product_identity_case_source_mismatch' using errcode = '22023';
  end if;

  select * into v_source from public.whatsapp_review_sources where id = p_source_id for update;
  if not found then raise exception 'product_identity_source_not_found' using errcode = 'P0002'; end if;
  if not coalesce(v_source.invoice_link_confirmed, false)
     or nullif(btrim(v_source.invoice_link_confirmed_invoice_id), '') is null then
    raise exception 'product_identity_invoice_unconfirmed' using errcode = '22023';
  end if;

  select analysis_id, evidence_snapshot into v_analysis
    from public.sales_intelligence_current_case_analyses
    where case_id = p_case_id;
  if not found or v_analysis.analysis_id <> p_analysis_id then
    raise exception 'product_identity_analysis_not_current' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.sales_intelligence_current_attributions a
    where a.case_id = p_case_id and a.analysis_id = p_analysis_id
      and a.selected_invoice_id = v_source.invoice_link_confirmed_invoice_id
  ) then
    raise exception 'product_identity_current_case_invoice_mismatch' using errcode = '22023';
  end if;
  if v_analysis.evidence_snapshot #>> '{caseIntelligence,caseId}' <> p_case_id then
    raise exception 'product_identity_snapshot_mismatch' using errcode = '22023';
  end if;

  select elem into v_item
    from jsonb_array_elements(coalesce(v_analysis.evidence_snapshot #> '{caseIntelligence,basket,activeItems}', '[]'::jsonb)) elem
    where elem->>'itemId' = p_basket_item_id;
  if v_item is null or v_item->>'resolutionStatus' = 'proven'
     or nullif(btrim(v_item->>'sourceMessageId'), '') is null
     or nullif(btrim(v_item->>'productNameRaw'), '') is null
     or jsonb_typeof(v_item->'quantity') <> 'number' then
    raise exception 'product_identity_basket_evidence_invalid' using errcode = '22023';
  end if;

  select * into v_product from public.products
    where id::text = v_item->>'productId'
      and product_code = v_item->>'productCode';
  if not found then raise exception 'product_identity_catalog_mismatch' using errcode = '22023'; end if;

  select * into v_line from public.sales_invoice_items_v21 where id = p_invoice_item_id for share;
  if not found
     or v_line.invoice_id <> v_source.invoice_link_confirmed_invoice_id
     or v_line.product_id <> v_product.id::text
     or v_line.product_code <> v_product.product_code then
    raise exception 'product_identity_invoice_line_mismatch' using errcode = '22023';
  end if;
  if (select count(*) from public.sales_invoice_items_v21
      where invoice_id = v_line.invoice_id
        and (product_id = v_product.id::text or product_code = v_product.product_code)) <> 1 then
    raise exception 'product_identity_invoice_line_ambiguous' using errcode = '22023';
  end if;

  v_net_quantity := coalesce(
    nullif(v_line.raw_data #>> '{__dawaa_commercial,effective_quantity}', '')::numeric,
    v_line.quantity - coalesce(
      nullif(v_line.raw_data #>> '{__dawaa_commercial,returned_quantity}', '')::numeric,
      nullif(v_line.raw_data->>'returned', '')::numeric,
      0
    )
  );
  if v_net_quantity <= 0 or v_net_quantity <> (v_item->>'quantity')::numeric then
    raise exception 'product_identity_quantity_mismatch' using errcode = '22023';
  end if;

  select * into v_existing from public.whatsapp_product_identity_manager_reviews_v1
    where source_id = p_source_id and case_id = p_case_id and basket_item_id = p_basket_item_id;
  if found then
    if v_existing.analysis_id = p_analysis_id and v_existing.invoice_item_id = p_invoice_item_id
       and v_existing.catalog_product_id = v_product.id and v_existing.quantity = v_net_quantity then
      return jsonb_build_object('ok', true, 'idempotent', true, 'review_id', v_existing.id);
    end if;
    raise exception 'product_identity_prior_decision_conflict' using errcode = '23505';
  end if;

  insert into public.whatsapp_product_identity_manager_reviews_v1 (
    source_id,source_hash,case_id,analysis_id,basket_item_id,source_message_id,raw_phrase,
    catalog_product_id,catalog_product_code,invoice_id,invoice_item_id,
    quantity,decision,reviewer_account_id,reviewer_name,reviewer_note
  ) values (
    p_source_id,v_source.source_hash,p_case_id,p_analysis_id,p_basket_item_id,v_item->>'sourceMessageId',v_item->>'productNameRaw',
    v_product.id,v_product.product_code,v_line.invoice_id,v_line.id,
    v_net_quantity,'identity_confirmed',v_actor_id,v_actor_name,btrim(p_reviewer_note)
  ) returning id into v_result_id;
  return jsonb_build_object('ok', true, 'idempotent', false, 'review_id', v_result_id);
end;
$function$;

revoke all on function public.dawaa_confirm_whatsapp_product_identity_v1(uuid,text,uuid,text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.dawaa_confirm_whatsapp_product_identity_v1(uuid,text,uuid,text,uuid,text)
  to anon, authenticated;

create or replace function public.dawaa_list_whatsapp_product_identity_reviews_v1(p_case_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  if public.dawaa_current_staff_account_id_strict() is null
     or public.dawaa_actor_is_top_management_v1() is not true then
    raise exception 'product_identity_reviews_not_authorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'basketItemId', r.basket_item_id,
      'invoiceItemId', r.invoice_item_id, 'analysisId', r.analysis_id,
      'reviewerName', r.reviewer_name, 'reviewerNote', r.reviewer_note,
      'reviewedAt', r.reviewed_at, 'decision', r.decision
    ) order by r.reviewed_at desc)
    from public.whatsapp_product_identity_manager_reviews_v1 r
    where r.case_id = p_case_id
  ), '[]'::jsonb);
end;
$function$;
revoke all on function public.dawaa_list_whatsapp_product_identity_reviews_v1(text)
  from public, anon, authenticated;
grant execute on function public.dawaa_list_whatsapp_product_identity_reviews_v1(text)
  to anon, authenticated;
