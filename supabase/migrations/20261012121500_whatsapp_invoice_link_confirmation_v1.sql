create or replace function public.dawaa_confirm_whatsapp_invoice_link_v1(
  p_source_id uuid,
  p_invoice_id text,
  p_invoice_number text,
  p_confirmation_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor_id uuid;
  v_actor public.staff_accounts%rowtype;
  v_source public.whatsapp_review_sources%rowtype;
  v_invoice public.sales_invoices%rowtype;
  v_invoice_number text;
  v_source_code text;
  v_invoice_code text;
  v_source_phone text;
  v_invoice_phone text;
  v_identity_matched boolean := false;
  v_in_scope boolean := false;
begin
  v_actor_id := public.dawaa_current_staff_account_id_strict();
  if v_actor_id is null then
    raise exception 'verified_staff_session_required' using errcode = '42501';
  end if;

  select *
  into v_actor
  from public.staff_accounts
  where id = v_actor_id
    and coalesce(active, false)
    and coalesce(can_login, false);
  if not found then
    raise exception 'verified_staff_account_inactive' using errcode = '42501';
  end if;
  if coalesce(
    nullif(btrim(v_actor.staff_name), ''),
    nullif(btrim(v_actor.display_name), ''),
    nullif(btrim(v_actor.name), '')
  ) is null then
    raise exception 'verified_staff_name_missing' using errcode = '42501';
  end if;

  if not public.dawaa_current_actor_can(array['edit_reviews','approve_reviews','manage_conversation_evaluations']) then
    raise exception 'invoice_link_confirmation_not_authorized' using errcode = '42501';
  end if;

  select *
  into v_source
  from public.whatsapp_review_sources
  where id = p_source_id
  for update;
  if not found then
    raise exception 'review_source_not_found' using errcode = 'P0002';
  end if;

  v_in_scope :=
    public.dawaa_actor_is_top_management_v1()
    or lower(trim(coalesce(v_actor.role, ''))) in ('team_dawaa_alpha', 'customer_service_manager')
    or v_actor.staff_id = v_source.staff_id::text
    or (
      lower(trim(coalesce(v_actor.role, ''))) in (
        'branch_manager',
        'customer_service',
        'shift_supervisor_morning',
        'shift_supervisor_evening'
      )
      and public.dawaa_customer_request_branch_key(v_actor.branch) is not null
      and public.dawaa_customer_request_branch_key(v_actor.branch)
        = public.dawaa_customer_request_branch_key(v_source.branch)
    );
  if v_in_scope is not true then
    raise exception 'review_source_out_of_scope' using errcode = '42501';
  end if;

  select *
  into v_invoice
  from public.sales_invoices
  where id = p_invoice_id
  for share;
  if not found then
    raise exception 'invoice_not_found' using errcode = 'P0002';
  end if;

  v_invoice_number := coalesce(nullif(btrim(v_invoice.invoice_number::text), ''), nullif(btrim(v_invoice.invoice_no::text), ''));
  if v_invoice_number is null or v_invoice_number <> nullif(btrim(p_invoice_number), '') then
    raise exception 'invoice_id_number_mismatch' using errcode = '22023';
  end if;

  if v_source.customer_id is not null
     and v_invoice.customer_id is not null
     and v_source.customer_id::text <> v_invoice.customer_id::text then
    raise exception 'invoice_customer_identity_conflict' using errcode = '22023';
  end if;

  v_source_code := public.normalize_customer_code_v2(v_source.customer_code);
  v_invoice_code := public.normalize_customer_code_v2(v_invoice.customer_code);
  if v_source_code is not null and v_invoice_code is not null then
    if v_source_code <> v_invoice_code then
      raise exception 'invoice_customer_identity_conflict' using errcode = '22023';
    end if;
    v_identity_matched := true;
  end if;

  v_source_phone := public.dawaa_normalize_egyptian_mobile_v1(v_source.customer_phone);
  v_invoice_phone := public.dawaa_normalize_egyptian_mobile_v1(
    coalesce(v_invoice.customer_phone, v_invoice.whatsapp_phone)
  );
  if nullif(v_source_phone, '') is not null and nullif(v_invoice_phone, '') is not null then
    if v_source_phone <> v_invoice_phone then
      raise exception 'invoice_customer_identity_conflict' using errcode = '22023';
    end if;
    v_identity_matched := true;
  end if;

  if v_source.customer_id is not null
     and v_invoice.customer_id is not null
     and v_source.customer_id::text = v_invoice.customer_id::text then
    v_identity_matched := true;
  end if;
  if not v_identity_matched then
    raise exception 'invoice_customer_identity_unverified' using errcode = '22023';
  end if;

  if v_source.matched_invoice_id is not null
     and v_source.matched_invoice_id::text <> p_invoice_id then
    raise exception 'matched_invoice_conflict' using errcode = '22023';
  end if;

  if coalesce(v_source.invoice_link_confirmed, false) then
    if v_source.invoice_link_confirmed_invoice_id = p_invoice_id
       and nullif(btrim(v_source.invoice_link_confirmed_invoice_number), '') = v_invoice_number then
      return jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'source_id', p_source_id,
        'invoice_id', p_invoice_id,
        'invoice_number', v_invoice_number
      );
    end if;
    raise exception 'different_invoice_already_confirmed' using errcode = '22023';
  end if;

  update public.whatsapp_review_sources
  set invoice_link_confirmed = true,
      invoice_link_confirmed_invoice_id = p_invoice_id,
      invoice_link_confirmed_invoice_number = v_invoice_number,
      invoice_link_confirmed_by = v_actor_id::text,
      invoice_link_confirmed_by_name = coalesce(
        nullif(btrim(v_actor.staff_name), ''),
        nullif(btrim(v_actor.display_name), ''),
        nullif(btrim(v_actor.name), '')
      ),
      invoice_link_confirmed_at = clock_timestamp(),
      invoice_link_confirmation_note = nullif(btrim(p_confirmation_note), '')
  where id = p_source_id;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'source_id', p_source_id,
    'invoice_id', p_invoice_id,
    'invoice_number', v_invoice_number
  );
end;
$function$;

revoke all on function public.dawaa_confirm_whatsapp_invoice_link_v1(uuid, text, text, text) from public;
grant execute on function public.dawaa_confirm_whatsapp_invoice_link_v1(uuid, text, text, text) to anon, authenticated;
