-- Keep the existing verified actor, permission, scope, customer and immutable
-- confirmation checks. Only an unconfirmed legacy suggestion may differ from
-- the invoice selected by a current published canonical case of this source.
-- No invoice, item, employee point, payroll or old confirmation is rewritten.
do $migration$
declare
  v_definition text;
  v_old text := $old$  if v_source.matched_invoice_id is not null
     and v_source.matched_invoice_id::text <> p_invoice_id then
    raise exception 'matched_invoice_conflict' using errcode = '22023';
  end if;$old$;
  v_new text := $new$  if v_source.matched_invoice_id is not null
     and v_source.matched_invoice_id::text <> p_invoice_id then
    -- canonical_invoice_confirmation_parity_v1: never trust an arbitrary UI id.
    -- Parent/source and selected published rows are locked for the decision.
    if coalesce(v_source.invoice_link_confirmed, false) is false then
      perform 1
      from public.sales_intelligence_cases c
      join public.sales_intelligence_case_analyses a
        on a.analysis_id = c.published_analysis_id and a.case_id = c.case_id
      join public.sales_intelligence_attributions t
        on t.analysis_id = a.analysis_id and t.case_id = c.case_id
      where c.conversation_id = p_source_id
        and c.is_active and c.deleted_at is null and a.is_current
        and t.is_current_evaluation
        and t.selected_invoice_id = p_invoice_id
        and t.selected_invoice_number = v_invoice_number
        and t.identity_conflict = 'none' and t.branch_conflict is false
        and v_source.customer_id is not null
        and v_source.customer_id = v_invoice.customer_id
        and a.identity_customer_id = v_invoice.customer_id
        and coalesce(to_jsonb(v_source)->>'deleted_at', '') = ''
      for share of c, a, t;
      if not found then
        raise exception 'matched_invoice_conflict' using errcode = '22023';
      end if;
      p_confirmation_note := concat_ws(E'\n', nullif(btrim(p_confirmation_note), ''),
        format('canonical_candidate_selected_over_unconfirmed_legacy: %s -> %s',
          v_source.matched_invoice_id, p_invoice_id));
    elsif v_source.invoice_link_confirmed_invoice_id is distinct from p_invoice_id
       or nullif(btrim(v_source.invoice_link_confirmed_invoice_number), '') is distinct from v_invoice_number then
      raise exception 'different_invoice_already_confirmed' using errcode = '22023';
    end if;
  end if;$new$;
begin
  select pg_get_functiondef('public.dawaa_confirm_whatsapp_invoice_link_v1(uuid,text,text,text)'::regprocedure)
    into v_definition;
  if position('canonical_invoice_confirmation_parity_v1' in v_definition) = 0 then
    if position(v_old in v_definition) = 0 then
      raise exception 'invoice_confirmation_guard_contract_changed';
    end if;
    execute replace(v_definition, v_old, v_new);
  end if;
end;
$migration$;

notify pgrst, 'reload schema';
