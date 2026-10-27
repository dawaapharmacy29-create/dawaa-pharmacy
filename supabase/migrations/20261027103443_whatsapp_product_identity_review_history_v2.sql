-- Forward-only lifecycle extension of the existing audited ledger. No financial writes.
begin;

alter table public.whatsapp_product_identity_manager_reviews_v1
  add column if not exists is_current boolean not null default true,
  add column if not exists supersedes_review_id uuid
    references public.whatsapp_product_identity_manager_reviews_v1(id);

alter table public.whatsapp_product_identity_manager_reviews_v1
  drop constraint if exists whatsapp_product_identity_case_item_unique_v1;
create unique index if not exists whatsapp_product_identity_one_current_v2
  on public.whatsapp_product_identity_manager_reviews_v1(source_id,case_id,basket_item_id)
  where is_current;
create unique index if not exists whatsapp_product_identity_one_successor_v2
  on public.whatsapp_product_identity_manager_reviews_v1(supersedes_review_id)
  where supersedes_review_id is not null;

-- Existing rows retain their evidence and are still independently revalidated by the reader.
-- Being current never makes an old decision sufficient proof by itself.
create or replace function public.dawaa_guard_product_identity_history_v2()
returns trigger language plpgsql set search_path to 'public','pg_catalog' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'product_identity_history_immutable' using errcode = '42501';
  end if;
  if (to_jsonb(new) - 'is_current') is distinct from (to_jsonb(old) - 'is_current')
     or old.is_current is not true or new.is_current is not false then
    raise exception 'product_identity_history_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.dawaa_guard_product_identity_history_v2() from public,anon,authenticated;
drop trigger if exists whatsapp_product_identity_history_guard_v2 on public.whatsapp_product_identity_manager_reviews_v1;
create trigger whatsapp_product_identity_history_guard_v2
  before update or delete on public.whatsapp_product_identity_manager_reviews_v1
  for each row execute function public.dawaa_guard_product_identity_history_v2();

revoke all on public.whatsapp_product_identity_manager_reviews_v1 from public,anon,authenticated,service_role;
grant select on public.whatsapp_product_identity_manager_reviews_v1 to service_role;

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

  if p_source_id is null or p_analysis_id is null or p_invoice_item_id is null then
    raise exception 'product_identity_evidence_reference_required' using errcode = '22023';
  end if;

  select * into v_source from public.whatsapp_review_sources where id = p_source_id for update;
  if not found then raise exception 'product_identity_source_not_found' using errcode = 'P0002'; end if;
  if not coalesce(v_source.invoice_link_confirmed, false)
     or nullif(btrim(v_source.invoice_link_confirmed_invoice_id), '') is null then
    raise exception 'product_identity_invoice_unconfirmed' using errcode = '22023';
  end if;

  if nullif(btrim(v_source.source_hash), '') is null then
    raise exception 'product_identity_source_hash_required' using errcode = '22023';
  end if;
  -- Serialize with canonical publication as well as other decisions on this source.
  perform 1 from public.sales_intelligence_cases
    where case_id = p_case_id and published_analysis_id = p_analysis_id for update;
  if not found then
    raise exception 'product_identity_analysis_not_current' using errcode = '22023';
  end if;

  select analysis_id, evidence_snapshot into v_analysis
    from public.sales_intelligence_current_case_analyses
    where case_id = p_case_id;
  if not found or v_analysis.analysis_id is distinct from p_analysis_id then
    raise exception 'product_identity_analysis_not_current' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.sales_intelligence_current_attributions a
    where a.case_id = p_case_id and a.analysis_id = p_analysis_id
      and a.selected_invoice_id = v_source.invoice_link_confirmed_invoice_id
  ) then
    raise exception 'product_identity_current_case_invoice_mismatch' using errcode = '22023';
  end if;
  if (v_analysis.evidence_snapshot #>> '{caseIntelligence,caseId}') is distinct from p_case_id then
    raise exception 'product_identity_snapshot_mismatch' using errcode = '22023';
  end if;

  select elem into v_item
    from jsonb_array_elements(coalesce(v_analysis.evidence_snapshot #> '{caseIntelligence,basket,activeItems}', '[]'::jsonb)) elem
    where elem->>'itemId' = p_basket_item_id;
  if v_item is null or v_item->>'resolutionStatus' = 'proven'
     or nullif(btrim(v_item->>'sourceMessageId'), '') is null
     or nullif(btrim(v_item->>'productNameRaw'), '') is null
     or jsonb_typeof(v_item->'quantity') is distinct from 'number' then
    raise exception 'product_identity_basket_evidence_invalid' using errcode = '22023';
  end if;

  select * into v_product from public.products
    where id::text = v_item->>'productId'
      and product_code = v_item->>'productCode' for share;
  if not found then raise exception 'product_identity_catalog_mismatch' using errcode = '22023'; end if;

  select * into v_line from public.sales_invoice_items_v21 where id = p_invoice_item_id for share;
  if not found
     or v_line.invoice_id is distinct from v_source.invoice_link_confirmed_invoice_id
     or v_line.product_id is distinct from v_product.id::text
     or v_line.product_code is distinct from v_product.product_code then
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
  if v_net_quantity is null or v_net_quantity <= 0 or v_net_quantity <> (v_item->>'quantity')::numeric then
    raise exception 'product_identity_quantity_mismatch' using errcode = '22023';
  end if;

  select * into v_existing from public.whatsapp_product_identity_manager_reviews_v1
    where source_id = p_source_id and case_id = p_case_id and basket_item_id = p_basket_item_id
      and is_current for update;
  if found then
    -- The submitted analysis MUST be current, but a semantically identical refresh
    -- does not invalidate unchanged evidence or create another historical decision.
    if v_existing.source_hash = v_source.source_hash
       and v_existing.source_message_id = v_item->>'sourceMessageId'
       and v_existing.raw_phrase = v_item->>'productNameRaw'
       and v_existing.invoice_id = v_line.invoice_id
       and v_existing.catalog_product_code = v_product.product_code
       and v_existing.invoice_item_id = p_invoice_item_id
       and v_existing.catalog_product_id = v_product.id and v_existing.quantity = v_net_quantity then
      return jsonb_build_object('ok', true, 'idempotent', true, 'review_id', v_existing.id);
    end if;
    -- Only lifecycle metadata changes; every original evidence/reviewer field survives.
    update public.whatsapp_product_identity_manager_reviews_v1
      set is_current = false where id = v_existing.id;
  end if;

  insert into public.whatsapp_product_identity_manager_reviews_v1 (
    source_id,source_hash,case_id,analysis_id,basket_item_id,source_message_id,raw_phrase,
    catalog_product_id,catalog_product_code,invoice_id,invoice_item_id,
    quantity,decision,reviewer_account_id,reviewer_name,reviewer_note,supersedes_review_id
  ) values (
    p_source_id,v_source.source_hash,p_case_id,p_analysis_id,p_basket_item_id,v_item->>'sourceMessageId',v_item->>'productNameRaw',
    v_product.id,v_product.product_code,v_line.invoice_id,v_line.id,
    v_net_quantity,'identity_confirmed',v_actor_id,v_actor_name,btrim(p_reviewer_note),v_existing.id
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
      'reviewedAt', r.reviewed_at, 'decision', r.decision,
      'isCurrent', r.is_current, 'supersedesReviewId', r.supersedes_review_id
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

notify pgrst, 'reload schema';
commit;
