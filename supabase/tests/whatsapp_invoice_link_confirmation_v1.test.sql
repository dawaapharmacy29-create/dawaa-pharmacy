do $$
declare
  v_result jsonb;
  v_confirmed_at timestamptz;
  v_actor_id uuid := '10000000-0000-4000-8000-000000000001';
begin
  perform set_config('test.actor_id', '', true);
  perform set_config('test.can_edit_reviews', 'true', true);
  begin
    perform public.dawaa_confirm_whatsapp_invoice_link_v1(
      '20000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000001',
      '74880',
      null
    );
    raise exception 'expected_missing_session';
  exception when sqlstate '42501' then null;
  end;

  perform set_config('test.actor_id', v_actor_id::text, true);
  perform set_config('test.can_edit_reviews', 'false', true);
  perform set_config('test.can_approve_reviews', 'false', true);
  perform set_config('test.can_manage_conversation_evaluations', 'false', true);
  begin
    perform public.dawaa_confirm_whatsapp_invoice_link_v1(
      '20000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000001',
      '74880',
      null
    );
    raise exception 'expected_permission_denied';
  exception when sqlstate '42501' then null;
  end;

  perform set_config('test.can_edit_reviews', 'true', true);
  perform set_config('test.actor_id', '10000000-0000-4000-8000-000000000002', true);
  begin
    perform public.dawaa_confirm_whatsapp_invoice_link_v1(
      '20000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000001',
      '74880',
      null
    );
    raise exception 'expected_scope_denied';
  exception when sqlstate '42501' then null;
  end;

  perform set_config('test.actor_id', v_actor_id::text, true);
  begin
    perform public.dawaa_confirm_whatsapp_invoice_link_v1(
      '20000000-0000-4000-8000-000000000004',
      '50000000-0000-4000-8000-000000000001',
      '74880',
      null
    );
    raise exception 'expected_null_branch_scope_denied';
  exception when sqlstate '42501' then
    if sqlerrm <> 'review_source_out_of_scope' then raise; end if;
  end;

  begin
    perform public.dawaa_confirm_whatsapp_invoice_link_v1(
      '20000000-0000-4000-8000-000000000099',
      '50000000-0000-4000-8000-000000000001',
      '74880',
      null
    );
    raise exception 'expected_source_missing';
  exception when sqlstate 'P0002' then
    if sqlerrm <> 'review_source_not_found' then raise; end if;
  end;

  begin
    perform public.dawaa_confirm_whatsapp_invoice_link_v1(
      '20000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000099',
      '74880',
      null
    );
    raise exception 'expected_invoice_missing';
  exception when sqlstate 'P0002' then
    if sqlerrm <> 'invoice_not_found' then raise; end if;
  end;

  begin
    perform public.dawaa_confirm_whatsapp_invoice_link_v1(
      '20000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000001',
      '74966',
      null
    );
    raise exception 'expected_invoice_number_mismatch';
  exception when sqlstate '22023' then
    if sqlerrm <> 'invoice_id_number_mismatch' then raise; end if;
  end;

  begin
    perform public.dawaa_confirm_whatsapp_invoice_link_v1(
      '20000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000003',
      '74967',
      null
    );
    raise exception 'expected_customer_conflict';
  exception when sqlstate '22023' then
    if sqlerrm <> 'invoice_customer_identity_conflict' then raise; end if;
  end;

  update public.whatsapp_review_sources
  set matched_invoice_id = '50000000-0000-4000-8000-000000000002'
  where id = '20000000-0000-4000-8000-000000000001';
  begin
    perform public.dawaa_confirm_whatsapp_invoice_link_v1(
      '20000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000001',
      '74880',
      null
    );
    raise exception 'expected_matched_invoice_conflict';
  exception when sqlstate '22023' then
    if sqlerrm <> 'matched_invoice_conflict' then raise; end if;
  end;
  update public.whatsapp_review_sources
  set matched_invoice_id = null
  where id = '20000000-0000-4000-8000-000000000001';

  v_result := public.dawaa_confirm_whatsapp_invoice_link_v1(
    '20000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    '74880',
    'Reviewed candidate'
  );
  if v_result->>'idempotent' <> 'false' then raise exception 'expected_first_write'; end if;

  select invoice_link_confirmed_at into v_confirmed_at
  from public.whatsapp_review_sources
  where id = '20000000-0000-4000-8000-000000000001';
  if v_confirmed_at is null then raise exception 'server_timestamp_missing'; end if;
  if (select invoice_link_confirmed_by from public.whatsapp_review_sources where id = '20000000-0000-4000-8000-000000000001') <> v_actor_id::text
    then raise exception 'actor_identity_was_not_server_derived'; end if;
  if (select invoice_link_confirmed_by_name from public.whatsapp_review_sources where id = '20000000-0000-4000-8000-000000000001') <> 'Verified Staff'
    then raise exception 'actor_name_was_not_server_derived'; end if;

  v_result := public.dawaa_confirm_whatsapp_invoice_link_v1(
    '20000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    '74880',
    'Ignored idempotent note'
  );
  if v_result->>'idempotent' <> 'true' then raise exception 'same_invoice_not_idempotent'; end if;
  if (select invoice_link_confirmed_at from public.whatsapp_review_sources where id = '20000000-0000-4000-8000-000000000001') <> v_confirmed_at
    then raise exception 'idempotent_call_wrote_again'; end if;

  begin
    perform public.dawaa_confirm_whatsapp_invoice_link_v1(
      '20000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000002',
      '74966',
      null
    );
    raise exception 'expected_different_confirmation_conflict';
  exception when sqlstate '22023' then
    if sqlerrm <> 'different_invoice_already_confirmed' then raise; end if;
  end;

  if (select proargnames from pg_proc where oid = 'public.dawaa_confirm_whatsapp_invoice_link_v1(uuid,uuid,text,text)'::regprocedure)
      <> array['p_source_id','p_invoice_id','p_invoice_number','p_confirmation_note']::text[] then
    raise exception 'unexpected_actor_argument_in_rpc_contract';
  end if;
  if pg_get_functiondef('public.dawaa_confirm_whatsapp_invoice_link_v1(uuid,uuid,text,text)'::regprocedure)
      ~* '(sale_proven|canonical_outcome|revenue_countable)' then
    raise exception 'rpc_must_not_write_sales_intelligence_outcome';
  end if;
end;
$$;
