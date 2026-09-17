-- Persist human-confirmed invoice evidence for WhatsApp follow-up conversions.
-- Branch-only until the WhatsApp review system is approved for release.

alter table public.whatsapp_auto_followup_requests
  add column if not exists matched_invoice_id uuid,
  add column if not exists matched_invoice_number text,
  add column if not exists matched_invoice_date date,
  add column if not exists matched_invoice_value numeric,
  add column if not exists sale_verification_confidence numeric,
  add column if not exists sale_verified_at timestamptz,
  add column if not exists sale_verified_by text;

create index if not exists whatsapp_auto_followup_requests_matched_invoice_id_idx
  on public.whatsapp_auto_followup_requests(matched_invoice_id)
  where matched_invoice_id is not null;

create index if not exists whatsapp_auto_followup_requests_sale_verified_at_idx
  on public.whatsapp_auto_followup_requests(sale_verified_at desc)
  where sale_verified_at is not null;

create or replace function public.whatsapp_auto_followup_confirm_sale_v1(
  p_id uuid,
  p_invoice_id uuid,
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
  v_expected_phone text;
  v_actual_phone text;
  v_expected_branch text;
  v_actual_branch text;
begin
  if not public.dawaa_can_manage_whatsapp_followups_v1() then
    raise exception using errcode = '42501', message = 'صلاحية متابعة محادثات واتساب مطلوبة';
  end if;

  if p_invoice_id is null then
    raise exception using errcode = '22023', message = 'الفاتورة مطلوبة لاعتماد البيع';
  end if;

  if p_confidence is null or p_confidence < 0.75 or p_confidence > 1 then
    raise exception using errcode = '22023', message = 'درجة مطابقة الفاتورة غير كافية لاعتماد البيع';
  end if;

  select * into v_row
  from public.whatsapp_auto_followup_requests r
  where r.id = p_id;
  if v_row.id is null then
    raise exception using errcode = 'P0002', message = 'طلب المتابعة غير موجود';
  end if;

  select * into v_invoice
  from public.sales_invoices i
  where i.id = p_invoice_id;
  if v_invoice.id is null then
    raise exception using errcode = 'P0002', message = 'الفاتورة غير موجودة';
  end if;

  if p_invoice_date is null or p_invoice_date < coalesce(v_row.evidence_timestamp::date, v_row.created_at::date)
     or p_invoice_date > coalesce(v_row.evidence_timestamp::date, v_row.created_at::date) + 14 then
    raise exception using errcode = '22023', message = 'الفاتورة خارج نافذة التحقق المسموحة';
  end if;

  v_expected_phone := regexp_replace(coalesce(v_row.customer_phone, ''), '[^0-9]', '', 'g');
  v_actual_phone := regexp_replace(coalesce(v_invoice.customer_phone, ''), '[^0-9]', '', 'g');
  if length(v_expected_phone) >= 8 and length(v_actual_phone) >= 8
     and right(v_expected_phone, 8) <> right(v_actual_phone, 8) then
    raise exception using errcode = '22023', message = 'الفاتورة لا تخص نفس رقم العميل';
  end if;

  v_expected_branch := lower(trim(regexp_replace(coalesce(v_row.branch, ''), '^(فرع|دواء|صيدليات دواء)\s*', '', 'i')));
  v_actual_branch := lower(trim(regexp_replace(coalesce(v_invoice.branch_name, v_invoice.branch, ''), '^(فرع|دواء|صيدليات دواء)\s*', '', 'i')));
  if v_expected_branch <> '' and v_actual_branch <> '' and v_expected_branch <> v_actual_branch then
    raise exception using errcode = '22023', message = 'الفاتورة من فرع مختلف عن طلب المتابعة';
  end if;

  select * into v_actor
  from public.staff_accounts a
  where a.id = public.dawaa_current_staff_account_id_strict()
  limit 1;

  update public.whatsapp_auto_followup_requests r
  set
    status = 'تم البيع',
    matched_invoice_id = v_invoice.id,
    matched_invoice_number = coalesce(nullif(trim(p_invoice_number), ''), nullif(trim(v_invoice.invoice_number), ''), nullif(trim(v_invoice.invoice_no), '')),
    matched_invoice_date = coalesce(p_invoice_date, v_invoice.invoice_date::date, v_invoice.sale_date::date),
    matched_invoice_value = coalesce(p_invoice_value, v_invoice.net_amount, v_invoice.amount, v_invoice.gross_amount),
    sale_verification_confidence = p_confidence,
    sale_verified_at = now(),
    sale_verified_by = coalesce(v_actor.staff_name, v_actor.name, v_actor.username),
    followup_notes = case when nullif(trim(coalesce(p_notes, '')), '') is null then r.followup_notes else trim(p_notes) end,
    resolved_at = now(),
    resolved_by = coalesce(v_actor.staff_name, v_actor.name, v_actor.username),
    updated_at = now()
  where r.id = p_id
  returning r.* into v_row;

  return v_row;
end;
$$;

revoke all on function public.whatsapp_auto_followup_confirm_sale_v1(uuid, uuid, text, date, numeric, numeric, text) from public, anon;
grant execute on function public.whatsapp_auto_followup_confirm_sale_v1(uuid, uuid, text, date, numeric, numeric, text) to authenticated, service_role;

comment on function public.whatsapp_auto_followup_confirm_sale_v1(uuid, uuid, text, date, numeric, numeric, text) is
  'Human confirmation endpoint for WhatsApp follow-up conversion, storing verified invoice evidence and re-checking identity, branch and 14-day timing.';
