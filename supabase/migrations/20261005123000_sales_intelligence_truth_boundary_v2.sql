-- Sales Intelligence truth-boundary hardening V2.
-- Goals:
-- 1) Canonical sale proof on Customer Case V22 is service-owned and cannot be erased by a browser re-upsert.
-- 2) Product conversion becomes database-reconciled and cannot be promoted to won/product_verified by a direct client write.
-- 3) Legacy client-callable writers are retired from anon/authenticated execution.
-- 4) Legacy conversation reviews are superseded once a current automatic case review exists.

-- -----------------------------------------------------------------------------
-- 1. Retire legacy client writers. Current browser flows use V2/V5/command RPCs.
-- -----------------------------------------------------------------------------
revoke all on function public.create_or_link_customer_followup(jsonb)
  from public, anon, authenticated;
grant execute on function public.create_or_link_customer_followup(jsonb)
  to service_role;

revoke all on function public.create_customer_request_canonical_v1(
  uuid,uuid,uuid,text,numeric,text,text,text,date,integer,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.create_customer_request_canonical_v1(
  uuid,uuid,uuid,text,numeric,text,text,text,date,integer,text,text,text,text
) to service_role;

revoke all on function public.save_staff_monthly_evaluation_safe(uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.save_staff_monthly_evaluation_safe(uuid,jsonb)
  to service_role;

revoke all on function public.settle_monthly_narrative_evaluation(uuid)
  from public, anon, authenticated;
grant execute on function public.settle_monthly_narrative_evaluation(uuid)
  to service_role;

revoke all on function public.dawaa_reconcile_whatsapp_product_conversion_v21(uuid)
  from public, anon, authenticated;
grant execute on function public.dawaa_reconcile_whatsapp_product_conversion_v21(uuid)
  to service_role;

-- -----------------------------------------------------------------------------
-- 2. Canonical Customer Case sale truth guard.
-- Browser V22 persistence is still allowed to refresh operational fields, but it may not
-- create/change verified sale truth. If a legacy upsert omits canonicalSaleProof, preserve it.
-- -----------------------------------------------------------------------------
create or replace function public.dawaa_guard_whatsapp_case_sale_truth_v2()
returns trigger
language plpgsql
set search_path to 'public','pg_catalog'
as $function$
declare
  v_privileged boolean := current_user in ('postgres','service_role','supabase_admin');
  v_old_proof jsonb;
  v_new_proof jsonb;
begin
  v_new_proof := coalesce(new.case_json->'canonicalSaleProof','null'::jsonb);

  if tg_op = 'INSERT' then
    if not v_privileged and (
      new.verified_invoice_id is not null
      or new.verified_invoice_number is not null
      or new.verified_revenue is not null
      or new.verified_sale_at is not null
      or coalesce(new.case_json #>> '{canonicalSaleProof,state}','') <> ''
      or new.confirmed_outcome = 'verified_sale'
      or new.proposed_outcome = 'verified_sale'
    ) then
      raise exception 'customer_case_sale_truth_is_service_owned'
        using errcode='42501';
    end if;
    return new;
  end if;

  if v_privileged then
    return new;
  end if;

  v_old_proof := coalesce(old.case_json->'canonicalSaleProof','null'::jsonb);

  -- Normal V22 browser persistence reconstructs case_json and historically omitted the proof.
  -- Preserve an existing server-owned proof rather than letting a reanalysis erase trusted truth.
  if v_old_proof <> 'null'::jsonb and v_new_proof = 'null'::jsonb then
    new.case_json := jsonb_set(coalesce(new.case_json,'{}'::jsonb),'{canonicalSaleProof}',v_old_proof,true);
    v_new_proof := v_old_proof;
  end if;

  if v_new_proof is distinct from v_old_proof
     or new.verified_invoice_id is distinct from old.verified_invoice_id
     or new.verified_invoice_number is distinct from old.verified_invoice_number
     or new.verified_revenue is distinct from old.verified_revenue
     or new.verified_sale_at is distinct from old.verified_sale_at
     or (
       new.confirmed_outcome is distinct from old.confirmed_outcome
       and (new.confirmed_outcome='verified_sale' or old.confirmed_outcome='verified_sale')
     )
     or (
       new.proposed_outcome is distinct from old.proposed_outcome
       and (new.proposed_outcome='verified_sale' or old.proposed_outcome='verified_sale')
     )
  then
    raise exception 'customer_case_sale_truth_is_service_owned'
      using errcode='42501';
  end if;

  return new;
end;
$function$;

revoke all on function public.dawaa_guard_whatsapp_case_sale_truth_v2()
  from public, anon, authenticated;
grant execute on function public.dawaa_guard_whatsapp_case_sale_truth_v2()
  to service_role;

drop trigger if exists whatsapp_case_sale_truth_guard_v2
  on public.whatsapp_customer_cases_v22;
create trigger whatsapp_case_sale_truth_guard_v2
before insert or update
on public.whatsapp_customer_cases_v22
for each row
execute function public.dawaa_guard_whatsapp_case_sale_truth_v2();

-- -----------------------------------------------------------------------------
-- 3. Product truth: fix the stage contract and make reconciliation server-owned.
-- -----------------------------------------------------------------------------
alter table public.whatsapp_sales_opportunities_v17
  drop constraint if exists whatsapp_sales_opportunities_v17_current_stage_check;
alter table public.whatsapp_sales_opportunities_v17
  add constraint whatsapp_sales_opportunities_v17_current_stage_check
  check (current_stage = any (array[
    'detected'::text,
    'requested'::text,
    'available'::text,
    'unavailable'::text,
    'alternative_offered'::text,
    'recommended'::text,
    'accepted'::text,
    'rejected'::text,
    'order_confirmed'::text,
    'awaiting_invoice'::text,
    'verified_sale'::text,
    'product_verified'::text,
    'lost'::text,
    'needs_followup'::text
  ]));

-- Harden the reconciler: invoice + branch + customer + product + reasonable time window.
create or replace function public.dawaa_reconcile_whatsapp_product_conversion_v21(p_item_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_item public.sales_invoice_items_v21%rowtype;
  v_count integer := 0;
begin
  select * into v_item
  from public.sales_invoice_items_v21
  where id = p_item_id;
  if not found then return 0; end if;

  update public.whatsapp_sales_opportunities_v17 o
  set
    sale_verified_scope = 'product',
    status = 'won',
    current_stage = 'product_verified',
    matched_invoice_id = coalesce(nullif(btrim(o.matched_invoice_id),''),v_item.invoice_id),
    matched_invoice_number = coalesce(nullif(btrim(o.matched_invoice_number),''),v_item.invoice_number),
    matched_invoice_value = coalesce(o.matched_invoice_value,v_item.line_total),
    matched_invoice_item_id = v_item.id,
    matched_invoice_item_value = v_item.line_total,
    product_verified_at = coalesce(v_item.invoice_date,now()),
    evidence_json = coalesce(o.evidence_json,'{}'::jsonb) || jsonb_build_object(
      'product_verification',jsonb_build_object(
        'invoice_item_id',v_item.id,
        'invoice_number',v_item.invoice_number,
        'product_code',v_item.product_code,
        'product_name',v_item.product_name,
        'quantity',v_item.quantity,
        'line_total',v_item.line_total,
        'match_rule',case
          when nullif(btrim(o.product_code),'') is not null
           and nullif(btrim(v_item.product_code),'') is not null
            then 'exact_product_code'
          else 'exact_normalized_product_name'
        end,
        'truth_owner','database_reconciliation_v22'
      )
    ),
    updated_at = now()
  where
    public.dawaa_customer_request_branch_key(o.branch)
      = public.dawaa_customer_request_branch_key(v_item.branch)
    and (
      (o.customer_id is not null and v_item.customer_id is not null and o.customer_id=v_item.customer_id)
      or (
        nullif(btrim(o.customer_code),'') is not null
        and nullif(btrim(v_item.customer_code),'') is not null
        and btrim(o.customer_code)=btrim(v_item.customer_code)
      )
    )
    and (
      (nullif(btrim(o.matched_invoice_id),'') is not null and o.matched_invoice_id=v_item.invoice_id)
      or (
        nullif(btrim(o.matched_invoice_number),'') is not null
        and o.matched_invoice_number=v_item.invoice_number
      )
    )
    and (
      (nullif(btrim(o.product_code),'') is not null
       and nullif(btrim(v_item.product_code),'') is not null
       and btrim(o.product_code)=btrim(v_item.product_code))
      or (
        (nullif(btrim(o.product_code),'') is null or nullif(btrim(v_item.product_code),'') is null)
        and public.dawaa_normalize_product_match_v21(o.product_name) <> ''
        and public.dawaa_normalize_product_match_v21(o.product_name)
          = public.dawaa_normalize_product_match_v21(v_item.product_name)
      )
    )
    and (
      v_item.invoice_date is null
      or o.opened_at is null
      or v_item.invoice_date between o.opened_at - interval '10 minutes'
        and coalesce(o.last_stage_at,o.opened_at) + interval '36 hours'
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function public.dawaa_reconcile_whatsapp_product_conversion_v21(uuid)
  from public, anon, authenticated;
grant execute on function public.dawaa_reconcile_whatsapp_product_conversion_v21(uuid)
  to service_role;

-- Browser/legacy opportunity writers may propose invoice evidence, but cannot publish official truth.
-- Existing official truth is preserved across a browser reanalysis.
create or replace function public.dawaa_guard_product_opportunity_truth_v22()
returns trigger
language plpgsql
set search_path to 'public','pg_catalog'
as $function$
declare
  v_privileged boolean := current_user in ('postgres','service_role','supabase_admin');
  v_old_official boolean := false;
  v_new_attempt boolean := false;
begin
  -- Compatibility normalization: the client planner historically used product_invoice_item.
  if new.sale_verified_scope = 'product_invoice_item' then
    new.sale_verified_scope := 'product';
  end if;

  if v_privileged then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_old_official := coalesce(old.sale_verified_scope,'none') in ('conversation','product');
  end if;
  v_new_attempt :=
    coalesce(new.sale_verified_scope,'none') in ('conversation','product')
    or new.status='won'
    or new.current_stage in ('verified_sale','product_verified')
    or new.matched_invoice_item_id is not null
    or new.matched_invoice_item_value is not null
    or new.product_verified_at is not null;

  if tg_op='UPDATE' and v_old_official then
    -- Operational reanalysis may refresh wording/stage evidence but must never erase/rewrite
    -- server-published product truth.
    new.sale_verified_scope := old.sale_verified_scope;
    new.status := old.status;
    new.current_stage := old.current_stage;
    new.matched_invoice_id := old.matched_invoice_id;
    new.matched_invoice_number := old.matched_invoice_number;
    new.matched_invoice_value := old.matched_invoice_value;
    new.matched_invoice_item_id := old.matched_invoice_item_id;
    new.matched_invoice_item_value := old.matched_invoice_item_value;
    new.product_verified_at := old.product_verified_at;
    return new;
  end if;

  if v_new_attempt then
    -- Keep candidate invoice identity as evidence for server reconciliation, but downgrade
    -- any client-published sale claim to a non-official awaiting-invoice state.
    new.sale_verified_scope := 'none';
    if new.status='won' then new.status := 'open'; end if;
    if new.current_stage in ('verified_sale','product_verified') then
      new.current_stage := 'awaiting_invoice';
    end if;
    new.matched_invoice_item_id := null;
    new.matched_invoice_item_value := null;
    new.product_verified_at := null;
  end if;

  return new;
end;
$function$;

revoke all on function public.dawaa_guard_product_opportunity_truth_v22()
  from public, anon, authenticated;
grant execute on function public.dawaa_guard_product_opportunity_truth_v22()
  to service_role;

drop trigger if exists whatsapp_product_opportunity_truth_guard_v22
  on public.whatsapp_sales_opportunities_v17;
create trigger whatsapp_product_opportunity_truth_guard_v22
before insert or update
on public.whatsapp_sales_opportunities_v17
for each row
execute function public.dawaa_guard_product_opportunity_truth_v22();

-- When an opportunity carries candidate invoice evidence, reconcile it server-side against
-- actual invoice items. The hardened reconciler will fail closed unless every identity matches.
create or replace function public.dawaa_reconcile_product_opportunity_after_write_v22()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_item record;
begin
  if coalesce(new.sale_verified_scope,'none') <> 'none' then
    return new;
  end if;
  if nullif(btrim(coalesce(new.matched_invoice_id,'')),'') is null
     and nullif(btrim(coalesce(new.matched_invoice_number,'')),'') is null then
    return new;
  end if;

  for v_item in
    select i.id
    from public.sales_invoice_items_v21 i
    where public.dawaa_customer_request_branch_key(i.branch)
            = public.dawaa_customer_request_branch_key(new.branch)
      and (
        (nullif(btrim(coalesce(new.matched_invoice_id,'')),'') is not null
         and i.invoice_id=new.matched_invoice_id)
        or (
          nullif(btrim(coalesce(new.matched_invoice_number,'')),'') is not null
          and i.invoice_number=new.matched_invoice_number
        )
      )
  loop
    perform public.dawaa_reconcile_whatsapp_product_conversion_v21(v_item.id);
  end loop;

  return new;
end;
$function$;

revoke all on function public.dawaa_reconcile_product_opportunity_after_write_v22()
  from public, anon, authenticated;
grant execute on function public.dawaa_reconcile_product_opportunity_after_write_v22()
  to service_role;

drop trigger if exists whatsapp_product_opportunity_reconcile_v22
  on public.whatsapp_sales_opportunities_v17;
create trigger whatsapp_product_opportunity_reconcile_v22
after insert or update of matched_invoice_id,matched_invoice_number,product_id,product_code,product_name,customer_id,customer_code,branch,opened_at,last_stage_at
on public.whatsapp_sales_opportunities_v17
for each row
execute function public.dawaa_reconcile_product_opportunity_after_write_v22();

-- Also reconcile when invoice items arrive after the opportunity.
create or replace function public.dawaa_reconcile_product_conversion_from_invoice_item_v22()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
begin
  perform public.dawaa_reconcile_whatsapp_product_conversion_v21(new.id);
  return new;
end;
$function$;

revoke all on function public.dawaa_reconcile_product_conversion_from_invoice_item_v22()
  from public, anon, authenticated;
grant execute on function public.dawaa_reconcile_product_conversion_from_invoice_item_v22()
  to service_role;

drop trigger if exists sales_invoice_item_product_reconcile_v22
  on public.sales_invoice_items_v21;
create trigger sales_invoice_item_product_reconcile_v22
after insert or update of invoice_id,invoice_number,branch,invoice_date,customer_id,customer_code,product_id,product_code,product_name,quantity,line_total
on public.sales_invoice_items_v21
for each row
execute function public.dawaa_reconcile_product_conversion_from_invoice_item_v22();

-- -----------------------------------------------------------------------------
-- 4. Conversation-review current truth.
-- Once a current automatic Case-level review exists, legacy source-level reviews remain as audit
-- history but are no longer current. Multiple current automatic cases for the same source remain.
-- -----------------------------------------------------------------------------
create or replace function public.dawaa_supersede_legacy_review_on_automatic_v2()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
begin
  if coalesce(new.is_current,true) is not true
     or lower(trim(coalesce(new.evaluation_kind,''))) <> 'automatic'
     or new.whatsapp_review_source_id is null
     or new.sales_intelligence_case_id is null then
    return new;
  end if;

  update public.conversation_sales_reviews r
  set is_current=false,
      updated_at=now()
  where r.id<>new.id
    and r.whatsapp_review_source_id=new.whatsapp_review_source_id
    and r.sales_intelligence_case_id is null
    and coalesce(r.is_current,true)=true;

  return new;
end;
$function$;

revoke all on function public.dawaa_supersede_legacy_review_on_automatic_v2()
  from public, anon, authenticated;
grant execute on function public.dawaa_supersede_legacy_review_on_automatic_v2()
  to service_role;

drop trigger if exists conversation_review_supersede_legacy_v2
  on public.conversation_sales_reviews;
create trigger conversation_review_supersede_legacy_v2
after insert or update of is_current,evaluation_kind,whatsapp_review_source_id,sales_intelligence_case_id
on public.conversation_sales_reviews
for each row
execute function public.dawaa_supersede_legacy_review_on_automatic_v2();

create or replace view public.conversation_sales_reviews_canonical_v2
with (security_invoker = true)
as
with current_rows as (
  select r.*
  from public.conversation_sales_reviews r
  where coalesce(r.is_current,true)=true
    and (
      r.whatsapp_review_source_id is null
      or exists (
        select 1
        from public.whatsapp_operational_canonical_sources_v1 s
        where s.source_id=r.whatsapp_review_source_id
      )
    )
)
select r.*
from current_rows r
where r.whatsapp_review_source_id is null
   or r.sales_intelligence_case_id is not null
   or not exists (
     select 1
     from current_rows a
     where a.whatsapp_review_source_id=r.whatsapp_review_source_id
       and a.sales_intelligence_case_id is not null
   );

revoke all on public.conversation_sales_reviews_canonical_v2 from public;
grant select on public.conversation_sales_reviews_canonical_v2
  to anon, authenticated, service_role;

comment on view public.conversation_sales_reviews_canonical_v2 is
  'Current canonical conversation-review read model: current canonical sources only; Case-level automatic reviews supersede legacy source-level rows without deleting audit history.';

comment on function public.dawaa_guard_whatsapp_case_sale_truth_v2() is
  'Fail-closed guard for Customer Case V22 sale truth. Browser re-upserts may refresh operational case fields but cannot create, change, or erase Canonical Sale Proof.';
comment on function public.dawaa_guard_product_opportunity_truth_v22() is
  'Separates client product evidence proposals from database-owned product sale truth and preserves previously verified product truth.';
comment on function public.dawaa_reconcile_whatsapp_product_conversion_v21(uuid) is
  'Database-owned product verification: requires invoice identity, branch, customer identity, product identity, and a bounded time window before publishing product sale truth.';

notify pgrst,'reload schema';
