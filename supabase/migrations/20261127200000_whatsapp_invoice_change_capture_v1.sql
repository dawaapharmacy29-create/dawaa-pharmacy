-- Install capture disabled. Enable the six named triggers only after staging rehearsal.
create table public.whatsapp_invoice_change_events_v1 (
  event_id bigint generated always as identity primary key,
  evidence_kind text not null check (evidence_kind in ('header', 'item')),
  operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  before_identity jsonb,
  after_identity jsonb,
  created_at timestamptz not null default now(),
  due_at timestamptz not null default now(),
  attempts integer not null default 0,
  lease_id uuid,
  lease_until timestamptz,
  completed_at timestamptz,
  needs_review_at timestamptz,
  last_error_code text,
  check (before_identity is not null or after_identity is not null)
);

alter table public.whatsapp_invoice_change_events_v1 enable row level security;
revoke all on public.whatsapp_invoice_change_events_v1 from public, anon, authenticated, service_role;
create index whatsapp_invoice_change_events_ready_v1
  on public.whatsapp_invoice_change_events_v1 (due_at, event_id)
  where completed_at is null and needs_review_at is null;

-- Compare only the evidence consumed by invoice attribution, plus import validity.
create function public.whatsapp_invoice_change_fields_v1(p_row jsonb, p_kind text)
returns jsonb
language sql immutable strict set search_path = ''
as $$
  select (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    from jsonb_each(p_row) e
    where e.key = any(case when p_kind = 'header' then array[
    'id','invoice_number','invoice_no','invoice_date','invoice_datetime','close_datetime','sale_date',
    'branch','branch_name','customer_id','customer_code','customer_phone','whatsapp_phone','customer_name',
    'net_amount','net_total','total_amount','amount','gross_amount','discounted_amount','discount_amount',
    'invoice_type','save_status','import_validation_status','line_items_count',
    'staff_id','seller_name','normalized_seller_name','staff_name','delivery_staff'
  ] else array[
    'invoice_id','invoice_number','invoice_date','branch','product_id','product_code',
    'product_name','quantity','unit_price','line_total'
  ] end))
  || case when p_kind = 'item' then jsonb_build_object(
    'commercial', p_row #> '{raw_data,__dawaa_commercial}',
    'compact', (select coalesce(jsonb_object_agg(raw.key, raw.value), '{}'::jsonb)
      from jsonb_each(case when jsonb_typeof(p_row->'raw_data') = 'object' then p_row->'raw_data' else '{}'::jsonb end) raw
      where raw.key in ('gross_line','line_discount','line_discount_pct','returned','invoice_net','unit','expiry'))
  ) else '{}'::jsonb end
$$;

-- Persist only invoice identity. The canonical engine reads current line evidence itself.
create function public.whatsapp_invoice_change_identity_v1(p_row jsonb, p_kind text, p_header jsonb)
returns jsonb
language sql immutable set search_path = ''
as $$
  select case when p_row is null then null else jsonb_strip_nulls(jsonb_build_object(
    'invoiceId', case when p_kind = 'header' then p_row->>'id' else p_row->>'invoice_id' end,
    'invoiceNumber', coalesce(nullif(p_row->>'invoice_number',''), nullif(p_row->>'invoice_no',''), p_header->>'invoice_number', p_header->>'invoice_no'),
    'branch', coalesce(nullif(p_row->>'branch_name',''), nullif(p_row->>'branch',''), p_header->>'branch_name', p_header->>'branch'),
    'invoiceAt', coalesce(p_row->>'invoice_datetime', p_row->>'invoice_date', p_row->>'sale_date', p_header->>'invoice_datetime', p_header->>'invoice_date', p_header->>'sale_date'),
    'customerId', coalesce(p_row->>'customer_id', p_header->>'customer_id'),
    'customerCode', coalesce(p_row->>'customer_code', p_header->>'customer_code'),
    'customerPhone', coalesce(p_row->>'customer_phone', p_header->>'customer_phone'),
    'whatsappPhone', coalesce(p_row->>'whatsapp_phone', p_header->>'whatsapp_phone')
  )) end
$$;

create function public.capture_whatsapp_invoice_change_v1()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_kind text := TG_ARGV[0];
  v_rows text;
begin
  if TG_OP = 'INSERT' then
    v_rows := 'select null::jsonb as before_row, to_jsonb(n) as after_row from new_rows n';
  elsif TG_OP = 'DELETE' then
    v_rows := 'select to_jsonb(o) as before_row, null::jsonb as after_row from old_rows o';
  else
    v_rows := 'select to_jsonb(o) as before_row, to_jsonb(n) as after_row
               from old_rows o full join new_rows n using (id)
               where public.whatsapp_invoice_change_fields_v1(to_jsonb(o), $1)
                 is distinct from public.whatsapp_invoice_change_fields_v1(to_jsonb(n), $1)';
  end if;

  execute 'insert into public.whatsapp_invoice_change_events_v1
              (evidence_kind, operation, before_identity, after_identity)
           select distinct $1, $2,
              public.whatsapp_invoice_change_identity_v1(changed.before_row, $1, to_jsonb(old_header)),
              public.whatsapp_invoice_change_identity_v1(changed.after_row, $1, to_jsonb(new_header))
           from (' || v_rows || ') changed
           left join public.sales_invoices old_header
             on $1 = ''item'' and old_header.id = changed.before_row->>''invoice_id''
           left join public.sales_invoices new_header
             on $1 = ''item'' and new_header.id = changed.after_row->>''invoice_id'''
    using v_kind, TG_OP;
  return null;
end;
$$;

revoke all on function public.whatsapp_invoice_change_fields_v1(jsonb,text) from public, anon, authenticated, service_role;
revoke all on function public.whatsapp_invoice_change_identity_v1(jsonb,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.capture_whatsapp_invoice_change_v1() from public, anon, authenticated, service_role;

create trigger whatsapp_invoice_capture_insert_v1 after insert on public.sales_invoices
  referencing new table as new_rows for each statement execute function public.capture_whatsapp_invoice_change_v1('header');
create trigger whatsapp_invoice_capture_update_v1 after update on public.sales_invoices
  referencing old table as old_rows new table as new_rows for each statement execute function public.capture_whatsapp_invoice_change_v1('header');
create trigger whatsapp_invoice_capture_delete_v1 after delete on public.sales_invoices
  referencing old table as old_rows for each statement execute function public.capture_whatsapp_invoice_change_v1('header');

create trigger whatsapp_invoice_items_capture_insert_v1 after insert on public.sales_invoice_items_v21
  referencing new table as new_rows for each statement execute function public.capture_whatsapp_invoice_change_v1('item');
create trigger whatsapp_invoice_items_capture_update_v1 after update on public.sales_invoice_items_v21
  referencing old table as old_rows new table as new_rows for each statement execute function public.capture_whatsapp_invoice_change_v1('item');
create trigger whatsapp_invoice_items_capture_delete_v1 after delete on public.sales_invoice_items_v21
  referencing old table as old_rows for each statement execute function public.capture_whatsapp_invoice_change_v1('item');

alter table public.sales_invoices disable trigger whatsapp_invoice_capture_insert_v1;
alter table public.sales_invoices disable trigger whatsapp_invoice_capture_update_v1;
alter table public.sales_invoices disable trigger whatsapp_invoice_capture_delete_v1;
alter table public.sales_invoice_items_v21 disable trigger whatsapp_invoice_items_capture_insert_v1;
alter table public.sales_invoice_items_v21 disable trigger whatsapp_invoice_items_capture_update_v1;
alter table public.sales_invoice_items_v21 disable trigger whatsapp_invoice_items_capture_delete_v1;

create function public.claim_whatsapp_invoice_changes_v1(p_limit integer default 10)
returns setof public.whatsapp_invoice_change_events_v1
language sql security definer set search_path = ''
as $$
  with exhausted as (
    select event_id from public.whatsapp_invoice_change_events_v1
    where completed_at is null and needs_review_at is null and attempts >= 8
      and lease_until <= now()
    order by due_at, event_id limit 25 for update skip locked
  ), flagged as (
    update public.whatsapp_invoice_change_events_v1 e
    set needs_review_at = now(), last_error_code = 'lease_expired',
        lease_id = null, lease_until = null
    from exhausted where e.event_id = exhausted.event_id
  ), ready as (
    select event_id from public.whatsapp_invoice_change_events_v1
    where completed_at is null and needs_review_at is null and due_at <= now() and attempts < 8
      and (lease_until is null or lease_until <= now())
    order by due_at, event_id
    limit least(25, greatest(1, coalesce(p_limit, 10)))
    for update skip locked
  )
  update public.whatsapp_invoice_change_events_v1 e
  set lease_id = gen_random_uuid(), lease_until = now() + interval '5 minutes', attempts = attempts + 1
  from ready where e.event_id = ready.event_id
  returning e.*
$$;

create function public.finish_whatsapp_invoice_change_v1(
  p_event_id bigint, p_lease_id uuid, p_error_code text default null, p_permanent boolean default false
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if p_error_code is not null and p_error_code !~ '^[a-z][a-z0-9_]{0,79}$' then
    raise exception 'invalid_invoice_change_error_code';
  end if;
  if p_permanent and p_error_code is null then
    raise exception 'invoice_change_error_code_required';
  end if;
  update public.whatsapp_invoice_change_events_v1
  set completed_at = case when p_error_code is null then now() end,
      needs_review_at = case when p_error_code is not null and (p_permanent or attempts >= 8) then now() end,
      last_error_code = p_error_code,
      due_at = now() + make_interval(secs => least(3600, 30 * power(2, least(attempts - 1, 7))::integer)),
      lease_id = null,
      lease_until = null
  where event_id = p_event_id and lease_id = p_lease_id and lease_until > now()
    and completed_at is null and needs_review_at is null;
  return found;
end;
$$;

revoke all on function public.claim_whatsapp_invoice_changes_v1(integer) from public, anon, authenticated;
revoke all on function public.finish_whatsapp_invoice_change_v1(bigint,uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.claim_whatsapp_invoice_changes_v1(integer) to service_role;
grant execute on function public.finish_whatsapp_invoice_change_v1(bigint,uuid,text,boolean) to service_role;
