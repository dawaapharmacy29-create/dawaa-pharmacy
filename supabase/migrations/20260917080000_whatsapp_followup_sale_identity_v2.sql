-- Strengthen sale evidence after canonical follow-up customer identity becomes available.
-- Matching priority: customer_id -> customer_code -> phone -> exact normalized name.

alter table public.whatsapp_auto_followup_requests
  add column if not exists sale_identity_match_method text;

create or replace function public.whatsapp_auto_followup_confirm_sale_v1(
  p_id uuid,
  p_invoice_id text,
  p_invoice_number text,
  p_invoice_date date,
  p_invoice_value numeric,
  p_confidence numeric,
  p_notes text default null
)
returns public.whatsapp_auto_followup_requests
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_row public.whatsapp_auto_followup_requests%rowtype;
  v_actor public.staff_accounts%rowtype;
  v_invoice public.sales_invoices%rowtype;
  v_signal_date date;
  v_invoice_date date;
  v_expected_phone text;
  v_actual_phone text;
  v_expected_name text;
  v_actual_name text;
  v_expected_branch text;
  v_actual_branch text;
  v_actor_name text;
  v_identity_method text;
begin
  if not public.dawaa_can_manage_whatsapp_followups_v1() then
    raise exception using errcode = '42501', message = 'صلاحية متابعة محادثات واتساب مطلوبة';
  end if;

  if nullif(trim(coalesce(p_invoice_id, '')), '') is null then
    raise exception using errcode = '22023', message = 'الفاتورة مطلوبة لاعتماد البيع';
  end if;
  if p_confidence is null or p_confidence < 0.75 or p_confidence > 1 then
    raise exception using errcode = '22023', message = 'درجة مطابقة الفاتورة غير كافية لاعتماد البيع';
  end if;

  select * into v_row from public.whatsapp_auto_followup_requests where id = p_id;
  if v_row.id is null then raise exception using errcode = 'P0002', message = 'طلب المتابعة غير موجود'; end if;

  select * into v_invoice from public.sales_invoices where id = trim(p_invoice_id);
  if v_invoice.id is null then raise exception using errcode = 'P0002', message = 'الفاتورة غير موجودة'; end if;

  v_signal_date := coalesce(
    (v_row.evidence_timestamp at time zone 'Africa/Cairo')::date,
    (v_row.created_at at time zone 'Africa/Cairo')::date
  );
  v_invoice_date := coalesce(
    (v_invoice.invoice_date at time zone 'Africa/Cairo')::date,
    v_invoice.sale_date::date
  );
  if v_invoice_date is null or v_invoice_date < v_signal_date or v_invoice_date > v_signal_date + 14 then
    raise exception using errcode = '22023', message = 'الفاتورة خارج نافذة التحقق المسموحة';
  end if;

  if v_row.customer_id is not null and v_invoice.customer_id is not null then
    if v_row.customer_id <> v_invoice.customer_id then
      raise exception using errcode = '22023', message = 'الفاتورة لا تخص نفس العميل المسجل';
    end if;
    v_identity_method := 'customer_id';
  elsif nullif(trim(coalesce(v_row.customer_code, '')), '') is not null
     and nullif(trim(coalesce(v_invoice.customer_code, '')), '') is not null then
    if trim(v_row.customer_code) <> trim(v_invoice.customer_code) then
      raise exception using errcode = '22023', message = 'كود العميل في الفاتورة مختلف عن طلب المتابعة';
    end if;
    v_identity_method := 'customer_code';
  else
    v_expected_phone := regexp_replace(coalesce(v_row.customer_phone, ''), '[^0-9]', '', 'g');
    v_actual_phone := regexp_replace(coalesce(v_invoice.customer_phone, ''), '[^0-9]', '', 'g');
    if v_expected_phone like '0020%' then v_expected_phone := '0' || substring(v_expected_phone from 5); end if;
    if v_actual_phone like '0020%' then v_actual_phone := '0' || substring(v_actual_phone from 5); end if;
    if v_expected_phone ~ '^201[0-9]{9}$' then v_expected_phone := '0' || substring(v_expected_phone from 3); end if;
    if v_actual_phone ~ '^201[0-9]{9}$' then v_actual_phone := '0' || substring(v_actual_phone from 3); end if;

    if length(v_expected_phone) >= 8 and length(v_actual_phone) >= 8 then
      if right(v_expected_phone, 8) <> right(v_actual_phone, 8) then
        raise exception using errcode = '22023', message = 'الفاتورة لا تخص نفس رقم العميل';
      end if;
      v_identity_method := 'phone';
    else
      v_expected_name := lower(trim(regexp_replace(coalesce(v_row.customer_name, ''), '[[:space:]]+', ' ', 'g')));
      v_actual_name := lower(trim(regexp_replace(coalesce(v_invoice.customer_name, ''), '[[:space:]]+', ' ', 'g')));
      if v_expected_name = '' or v_actual_name = '' or v_expected_name <> v_actual_name then
        raise exception using errcode = '22023', message = 'تعذر إثبات أن الفاتورة تخص نفس العميل';
      end if;
      v_identity_method := 'name_exact';
    end if;
  end if;

  v_expected_branch := lower(trim(regexp_replace(coalesce(v_row.branch, ''), '^(فرع|دواء|صيدليات دواء)[[:space:]]*', '', 'i')));
  v_actual_branch := lower(trim(regexp_replace(coalesce(v_invoice.branch_name, v_invoice.branch, ''), '^(فرع|دواء|صيدليات دواء)[[:space:]]*', '', 'i')));
  if v_expected_branch <> '' and v_actual_branch <> '' and v_expected_branch <> v_actual_branch then
    raise exception using errcode = '22023', message = 'الفاتورة من فرع مختلف عن طلب المتابعة';
  end if;

  -- Preview values sent by the browser are intentionally ignored.
  -- Canonical number/date/value are read from sales_invoices.
  perform p_invoice_number, p_invoice_date, p_invoice_value;

  select * into v_actor from public.staff_accounts where id = public.dawaa_current_staff_account_id_strict() limit 1;
  v_actor_name := coalesce(v_actor.staff_name, v_actor.name, v_actor.username, 'غير معروف');

  update public.whatsapp_auto_followup_requests r
  set
    status = 'تم البيع',
    matched_invoice_id = v_invoice.id,
    matched_invoice_number = coalesce(nullif(trim(v_invoice.invoice_number), ''), nullif(trim(v_invoice.invoice_no), '')),
    matched_invoice_date = v_invoice_date,
    matched_invoice_value = coalesce(v_invoice.net_amount, v_invoice.amount, v_invoice.gross_amount),
    sale_verification_confidence = p_confidence,
    sale_identity_match_method = v_identity_method,
    sale_verified_at = now(),
    sale_verified_by = v_actor_name,
    followup_notes = case when nullif(trim(coalesce(p_notes, '')), '') is null then r.followup_notes else trim(p_notes) end,
    resolved_at = now(),
    resolved_by = v_actor_name,
    updated_at = now()
  where r.id = p_id
  returning r.* into v_row;

  insert into public.whatsapp_auto_followup_audit(followup_id, action, actor_id, actor_name, details)
  values(
    p_id,
    'sale_confirmed',
    v_actor.id,
    v_actor_name,
    jsonb_build_object(
      'invoice_id', v_row.matched_invoice_id,
      'invoice_number', v_row.matched_invoice_number,
      'invoice_date', v_row.matched_invoice_date,
      'invoice_value', v_row.matched_invoice_value,
      'confidence', v_row.sale_verification_confidence,
      'identity_match_method', v_identity_method
    )
  );

  return v_row;
end;
$$;

revoke all on function public.whatsapp_auto_followup_confirm_sale_v1(uuid, text, text, date, numeric, numeric, text) from public, anon;
grant execute on function public.whatsapp_auto_followup_confirm_sale_v1(uuid, text, text, date, numeric, numeric, text) to authenticated, service_role;

comment on column public.whatsapp_auto_followup_requests.sale_identity_match_method is
  'Identity evidence used by the server when approving a linked sale: customer_id, customer_code, phone, or name_exact.';
