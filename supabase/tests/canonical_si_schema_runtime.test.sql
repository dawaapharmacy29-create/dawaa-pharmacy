-- Prove the captured composite row types/constraints support actual canonical writers, not stubs.
begin;
set local role service_role;
insert into public.sales_intelligence_policy_config(policy_config_id,policy_config_version,created_by)
values ('00000000-0000-4000-8000-000000000091',1,'synthetic');
insert into public.whatsapp_customer_cases_v22(id,case_key,root_source_id,case_type,case_state,started_at,last_event_at)
values ('00000000-0000-4000-8000-000000000092','SYN-CANONICAL-RUNTIME','00000000-0000-4000-8000-000000000052',
  'order','open','2026-09-16T06:00:00Z','2026-09-16T07:00:00Z');
update public.sales_intelligence_cases set source_case_id_v22='00000000-0000-4000-8000-000000000092' where case_id='syn-case-2';
do $test$
declare
  aid uuid; first jsonb; retry jsonb; attr_id uuid; row_input jsonb;
begin
  select analysis_id into strict aid from public.sales_intelligence_case_analyses where case_id='syn-case-2' and is_current;
  row_input := jsonb_build_object('case_id','syn-case-2','attribution_engine_version','synthetic',
    'attribution_input_hash','SYN-ATTR','attribution_level','unknown','confidence_score',0);
  first := public.sales_intelligence_write_attribution(aid,row_input);
  retry := public.sales_intelligence_write_attribution(aid,row_input);
  if (first->>'is_new')::boolean is not true or (retry->>'is_new')::boolean is not false
    or first->>'id'<>retry->>'id' then raise exception 'attribution retry/schema drift'; end if;
  attr_id := (first->>'id')::uuid;
  row_input := jsonb_build_object('case_id','syn-case-2','attribution_row_id',attr_id,
    'matching_engine_version','synthetic','matching_input_hash','SYN-MATCH',
    'total_match','insufficient_data','item_match','insufficient_data','quantity_match','insufficient_data',
    'overall_match','insufficient_data','integrity_evaluation_scope','insufficient');
  first := public.sales_intelligence_write_basket_invoice_match(aid,row_input);
  retry := public.sales_intelligence_write_basket_invoice_match(aid,row_input);
  if (retry->>'is_new')::boolean is not false or first->>'id'<>retry->>'id' then
    raise exception 'basket match retry/schema drift'; end if;
  row_input := jsonb_build_object('case_id','syn-case-2','policy_config_id','00000000-0000-4000-8000-000000000091',
    'policy_config_version',1,'protocol_applicability','unknown','protocol_policy_compliance','unknown','policy_input_hash','SYN-POLICY');
  first := public.sales_intelligence_write_policy_evaluation(aid,row_input);
  retry := public.sales_intelligence_write_policy_evaluation(aid,row_input);
  if (retry->>'is_new')::boolean is not false or first->>'policy_evaluation_id'<>retry->>'policy_evaluation_id' then
    raise exception 'policy retry/schema drift'; end if;
  first := public.dawaa_reconcile_sales_intelligence_case_v22_v1('syn-case-2');
  if first->>'status'<>'not_proven_no_change' then raise exception 'missing evidence invented a sale: %',first; end if;
  first := public.dawaa_revoke_whatsapp_canonical_sale_proof_v46('00000000-0000-4000-8000-000000000092','synthetic');
  if first->>'status'<>'not_proven_no_change' then raise exception 'unproven revocation changed truth'; end if;
  if exists(select 1 from public.whatsapp_customer_cases_v22 where id='00000000-0000-4000-8000-000000000092'
    and (verified_invoice_id is not null or confirmed_outcome='verified_sale')) then raise exception 'false sale proof'; end if;
end $test$;
reset role;
rollback;
