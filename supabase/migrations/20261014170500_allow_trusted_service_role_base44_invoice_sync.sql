create or replace function public.import_base44_purchase_invoices_v1(p_records jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_account public.staff_accounts%rowtype;
  v_record jsonb;
  v_match record;
  v_matched int := 0;
  v_ambiguous int := 0;
  v_unmatched int := 0;
  v_empty int := 0;
  v_total int := 0;
  v_service_role boolean := coalesce(auth.role(), '') = 'service_role';
begin
  if not v_service_role then
    select * into v_account
    from public.staff_accounts
    where id = public.dawaa_current_staff_account_id_strict()
      and coalesce(active, false) and coalesce(can_login, false);
    if not found then raise exception using errcode = '42501', message = 'active staff actor required'; end if;

    if not public.dawaa_is_customer_service_evaluator_v1(public.dawaa_current_staff_subject_uuid_v1(), lower(trim(coalesce(v_account.role, '')))) then
      raise exception using errcode = '42501', message = 'purchase invoice sync permission required';
    end if;
  end if;

  for v_record in select * from jsonb_array_elements(coalesce(p_records, '[]'::jsonb))
  loop
    v_total := v_total + 1;
    select * into v_match from public.match_base44_entered_by_v1(nullif(trim(v_record ->> 'entered_by'), ''));

    insert into public.base44_purchase_invoice_sync (
      base44_id, system_invoice_number, supplier_invoice_number, branch, transaction_type,
      entered_by_raw, entered_by_staff_id, match_status, invoice_date, total_value, base44_status,
      base44_supplier_id, purchase_category, source_branch, destination_branch, cash_amount,
      payment_type, notes, transfer_authorization_number
    ) values (
      v_record ->> 'id',
      nullif(v_record ->> 'system_invoice_number', ''),
      nullif(v_record ->> 'supplier_invoice_number', ''),
      public.dawaa_map_base44_branch_v1(v_record ->> 'branch'),
      nullif(v_record ->> 'transaction_type', ''),
      nullif(trim(v_record ->> 'entered_by'), ''),
      v_match.staff_id,
      v_match.match_status,
      nullif(v_record ->> 'invoice_date', '')::date,
      nullif(v_record ->> 'total_value', '')::numeric,
      nullif(v_record ->> 'status', ''),
      nullif(v_record ->> 'supplier_id', ''),
      nullif(v_record ->> 'purchase_category', ''),
      public.dawaa_map_base44_branch_v1(v_record ->> 'source_branch'),
      public.dawaa_map_base44_branch_v1(v_record ->> 'destination_branch'),
      nullif(v_record ->> 'cash_amount', '')::numeric,
      nullif(v_record ->> 'payment_type', ''),
      nullif(v_record ->> 'notes', ''),
      nullif(v_record ->> 'transfer_authorization_number', '')
    )
    on conflict (base44_id) do update set
      system_invoice_number = excluded.system_invoice_number,
      supplier_invoice_number = excluded.supplier_invoice_number,
      branch = excluded.branch,
      transaction_type = excluded.transaction_type,
      entered_by_raw = excluded.entered_by_raw,
      entered_by_staff_id = case when public.base44_purchase_invoice_sync.review_id is null then excluded.entered_by_staff_id else public.base44_purchase_invoice_sync.entered_by_staff_id end,
      match_status = case when public.base44_purchase_invoice_sync.review_id is null then excluded.match_status else public.base44_purchase_invoice_sync.match_status end,
      invoice_date = excluded.invoice_date,
      total_value = excluded.total_value,
      base44_status = excluded.base44_status,
      base44_supplier_id = excluded.base44_supplier_id,
      purchase_category = excluded.purchase_category,
      source_branch = excluded.source_branch,
      destination_branch = excluded.destination_branch,
      cash_amount = excluded.cash_amount,
      payment_type = excluded.payment_type,
      notes = excluded.notes,
      transfer_authorization_number = excluded.transfer_authorization_number,
      synced_at = now();

    case v_match.match_status
      when 'matched' then v_matched := v_matched + 1;
      when 'ambiguous' then v_ambiguous := v_ambiguous + 1;
      when 'unmatched' then v_unmatched := v_unmatched + 1;
      else v_empty := v_empty + 1;
    end case;
  end loop;

  return jsonb_build_object(
    'total', v_total, 'matched', v_matched, 'ambiguous', v_ambiguous,
    'unmatched', v_unmatched, 'empty', v_empty
  );
end;
$function$;
