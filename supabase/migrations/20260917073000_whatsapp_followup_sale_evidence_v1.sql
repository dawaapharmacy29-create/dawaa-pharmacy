-- Persist human-confirmed invoice evidence for WhatsApp follow-up conversions.
-- Branch-only until the WhatsApp review system is approved for release.

alter table public.whatsapp_auto_followup_requests
  add column if not exists matched_invoice_id text,
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

create table if not exists public.whatsapp_auto_followup_audit (
  id uuid primary key default gen_random_uuid(),
  followup_id uuid not null,
  action text not null,
  actor_id uuid,
  actor_name text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.whatsapp_auto_followup_audit enable row level security;
revoke all on table public.whatsapp_auto_followup_audit from public, anon, authenticated;
grant all on table public.whatsapp_auto_followup_audit to service_role;

create index if not exists whatsapp_auto_followup_audit_followup_created_idx
  on public.whatsapp_auto_followup_audit(followup_id, created_at desc);

drop function if exists public.whatsapp_auto_followup_confirm_sale_v1(uuid, text, text, date, numeric, numeric, text);

create or replace function public.whatsapp_auto_followup_confirm_sale_v1(
  p_id uuid,
  p_invoice_id text,
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

  select * into v_row
  from public.whatsapp_auto_followup_requests r
  where r.id = p_id;
  if v_row.id is null then
    raise exception using errcode = 'P0002', message = 'طلب المتابعة غير موجود';
  end if;

  select * into v_invoice
  from public.sales_invoices i
  where i.id = trim(p_invoice_id);
  if v_invoice.id is null then
    raise exception using errcode = 'P0002', message = 'الفاتورة غير موجودة';
  end if;

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

  v_expected_phone := regexp_replace(coalesce(v_row.customer_phone, ''), '[^0-9]', '', 'g');
  v_actual_phone := regexp_replace(coalesce(v_invoice.customer_phone, ''), '[^0-9]', '', 'g');
  v_expected_name := lower(trim(regexp_replace(coalesce(v_row.customer_name, ''), '[[:space:]]+', ' ', 'g')));
  v_actual_name := lower(trim(regexp_replace(coalesce(v_invoice.customer_name, ''), '[[:space:]]+', ' ', 'g')));

  if length(v_expected_phone) >= 8 and length(v_actual_phone) >= 8 then
    if right(v_expected_phone, 8) <> right(v_actual_phone, 8) then
      raise exception using errcode = '22023', message = 'الفاتورة لا تخص نفس رقم العميل';
    end if;
  elsif v_expected_name = '' or v_actual_name = '' or v_expected_name <> v_actual_name then
    raise exception using errcode = '22023', message = 'تعذر إثبات أن الفاتورة تخص نفس العميل';
  end if;

  v_expected_branch := lower(trim(regexp_replace(coalesce(v_row.branch, ''), '^(فرع|دواء|صيدليات دواء)[[:space:]]*', '', 'i')));
  v_actual_branch := lower(trim(regexp_replace(coalesce(v_invoice.branch_name, v_invoice.branch, ''), '^(فرع|دواء|صيدليات دواء)[[:space:]]*', '', 'i')));
  if v_expected_branch <> '' and v_actual_branch <> '' and v_expected_branch <> v_actual_branch then
    raise exception using errcode = '22023', message = 'الفاتورة من فرع مختلف عن طلب المتابعة';
  end if;

  select * into v_actor
  from public.staff_accounts a
  where a.id = public.dawaa_current_staff_account_id_strict()
  limit 1;
  v_actor_name := coalesce(v_actor.staff_name, v_actor.name, v_actor.username, 'غير معروف');

  update public.whatsapp_auto_followup_requests r
  set
    status = 'تم البيع',
    matched_invoice_id = v_invoice.id,
    matched_invoice_number = coalesce(nullif(trim(v_invoice.invoice_number), ''), nullif(trim(v_invoice.invoice_no), '')),
    matched_invoice_date = v_invoice_date,
    matched_invoice_value = coalesce(v_invoice.net_amount, v_invoice.amount, v_invoice.gross_amount),
    sale_verification_confidence = p_confidence,
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
      'confidence', v_row.sale_verification_confidence
    )
  );

  return v_row;
end;
$$;

revoke all on function public.whatsapp_auto_followup_confirm_sale_v1(uuid, text, numeric, text) from public, anon;
grant execute on function public.whatsapp_auto_followup_confirm_sale_v1(uuid, text, numeric, text) to authenticated, service_role;

create or replace function public.whatsapp_auto_followup_revoke_sale_v1(
  p_id uuid,
  p_reason text
)
returns public.whatsapp_auto_followup_requests
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_row public.whatsapp_auto_followup_requests%rowtype;
  v_actor public.staff_accounts%rowtype;
  v_actor_name text;
  v_before jsonb;
begin
  if not public.dawaa_can_manage_whatsapp_followups_v1() then
    raise exception using errcode = '42501', message = 'صلاحية متابعة محادثات واتساب مطلوبة';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception using errcode = '22023', message = 'سبب إلغاء ربط البيع مطلوب';
  end if;

  select * into v_row from public.whatsapp_auto_followup_requests where id = p_id;
  if v_row.id is null then raise exception using errcode = 'P0002', message = 'طلب المتابعة غير موجود'; end if;
  if v_row.matched_invoice_id is null then raise exception using errcode = '22023', message = 'لا يوجد بيع موثق لإلغاء ربطه'; end if;

  v_before := jsonb_build_object(
    'invoice_id', v_row.matched_invoice_id,
    'invoice_number', v_row.matched_invoice_number,
    'invoice_date', v_row.matched_invoice_date,
    'invoice_value', v_row.matched_invoice_value,
    'confidence', v_row.sale_verification_confidence,
    'verified_at', v_row.sale_verified_at,
    'verified_by', v_row.sale_verified_by
  );

  select * into v_actor from public.staff_accounts where id = public.dawaa_current_staff_account_id_strict() limit 1;
  v_actor_name := coalesce(v_actor.staff_name, v_actor.name, v_actor.username, 'غير معروف');

  update public.whatsapp_auto_followup_requests r
  set
    status = 'قيد المتابعة',
    matched_invoice_id = null,
    matched_invoice_number = null,
    matched_invoice_date = null,
    matched_invoice_value = null,
    sale_verification_confidence = null,
    sale_verified_at = null,
    sale_verified_by = null,
    resolved_at = null,
    resolved_by = null,
    followup_notes = concat_ws(E'\n', nullif(trim(coalesce(r.followup_notes, '')), ''), 'إلغاء ربط البيع: ' || trim(p_reason)),
    updated_at = now()
  where r.id = p_id
  returning r.* into v_row;

  insert into public.whatsapp_auto_followup_audit(followup_id, action, actor_id, actor_name, details)
  values(p_id, 'sale_revoked', v_actor.id, v_actor_name, v_before || jsonb_build_object('reason', trim(p_reason)));

  return v_row;
end;
$$;

revoke all on function public.whatsapp_auto_followup_revoke_sale_v1(uuid, text) from public, anon;
grant execute on function public.whatsapp_auto_followup_revoke_sale_v1(uuid, text) to authenticated, service_role;

comment on function public.whatsapp_auto_followup_confirm_sale_v1(uuid, text, numeric, text) is
  'Human confirmation endpoint for WhatsApp follow-up conversion. Invoice facts are re-read server-side and identity, branch and 14-day timing are independently validated.';
comment on function public.whatsapp_auto_followup_revoke_sale_v1(uuid, text) is
  'Explicit audited correction path for removing an incorrectly linked WhatsApp follow-up sale.';
