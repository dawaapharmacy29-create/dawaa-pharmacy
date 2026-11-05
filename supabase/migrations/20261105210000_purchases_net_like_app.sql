-- GM purchases net computed exactly like the «دواء وائل» purchases app (owner request 2026-11-05):
--   net = saved external purchases − returns on each invoice (returned_value)
--         − invoices excluded one by one (net_purchase_mode = 'exclude')
--         − suppliers excluded from net purchases (unless the invoice says 'include').
-- The app's own fields are synced (they were not before), and deleted invoices are checked every hour.

alter table public.base44_purchase_invoice_sync
  add column if not exists returned_value numeric,
  add column if not exists net_purchase_mode text,
  add column if not exists exclusion_reason text;

-- Supplier flags as the purchases app has them, refreshed by every sync run.
create table if not exists public.base44_purchase_supplier_flags (
  base44_supplier_id text primary key,
  name text,
  exclude_from_net_purchases boolean not null default false,
  synced_at timestamptz not null default now()
);
alter table public.base44_purchase_supplier_flags enable row level security;
revoke all on public.base44_purchase_supplier_flags from anon, authenticated;

create or replace function public.import_base44_purchase_suppliers_v1(p_records jsonb)
returns int
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_count int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  insert into public.base44_purchase_supplier_flags (base44_supplier_id, name, exclude_from_net_purchases, synced_at)
  select r ->> 'id', nullif(r ->> 'name', ''), coalesce((r ->> 'exclude_from_net_purchases')::boolean, false), now()
  from jsonb_array_elements(coalesce(p_records, '[]'::jsonb)) r
  where nullif(r ->> 'id', '') is not null
  on conflict (base44_supplier_id) do update set
    name = excluded.name,
    exclude_from_net_purchases = excluded.exclude_from_net_purchases,
    synced_at = excluded.synced_at;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;
revoke all on function public.import_base44_purchase_suppliers_v1(jsonb) from public, anon, authenticated;
grant execute on function public.import_base44_purchase_suppliers_v1(jsonb) to service_role;

create or replace function public.import_base44_purchase_invoices_v1(p_records jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
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
      payment_type, notes, transfer_authorization_number,
      returned_value, net_purchase_mode, exclusion_reason
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
      nullif(v_record ->> 'transfer_authorization_number', ''),
      nullif(v_record ->> 'returned_value', '')::numeric,
      nullif(v_record ->> 'net_purchase_mode', ''),
      nullif(v_record ->> 'exclusion_reason', '')
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
      returned_value = excluded.returned_value,
      net_purchase_mode = excluded.net_purchase_mode,
      exclusion_reason = excluded.exclusion_reason,
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

-- Read straight from the synced purchases-app rows (the app is the source of truth), with the app's rules.
create or replace function public.get_gm_purchases_summary_v1(p_from date default null::date, p_to date default null::date)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_from date;
  v_to date;
  v_rows jsonb;
begin
  perform public.gm_daily_review_actor_v1();
  v_from := coalesce(p_from, case when extract(day from v_today) >= 26
    then make_date(extract(year from v_today)::int, extract(month from v_today)::int, 26)
    else (date_trunc('month', v_today) - interval '1 month')::date + 25 end);
  v_to := coalesce(p_to, v_today);
  if v_to < v_from or v_to - v_from > 400 then
    raise exception 'invalid_period' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'branch', b.name, 'invoices', coalesce(x.invoices, 0), 'gross', coalesce(x.gross, 0),
      'transfers', coalesce(x.transfers, 0), 'returns', coalesce(x.returns, 0),
      'excluded', coalesce(x.excluded, 0), 'net', coalesce(x.net, 0),
      'pending_invoices', coalesce(pend.invoices, 0), 'pending_value', coalesce(pend.value, 0))
    order by b.name), '[]'::jsonb)
    into v_rows
  from (values ('فرع الشامي'), ('فرع شكري')) b(name)
  left join lateral (
    select count(*) filter (where not t.transfer and not t.excl)::int invoices,
      round(sum(t.total), 2) gross,
      round(coalesce(sum(t.total) filter (where t.transfer), 0), 2) transfers,
      round(coalesce(sum(t.ret) filter (where not t.transfer and not t.excl), 0), 2) returns,
      round(coalesce(sum(t.total - t.ret) filter (where not t.transfer and t.excl), 0), 2) excluded,
      round(coalesce(sum(t.total - t.ret) filter (where not t.transfer and not t.excl), 0), 2) net
    from (
      select coalesce(sy.total_value, 0) total, coalesce(sy.returned_value, 0) ret,
        coalesce(sy.transaction_type, '') = 'internal_transfer' transfer,
        (coalesce(sy.net_purchase_mode, '') = 'exclude'
          or (coalesce(sy.net_purchase_mode, 'inherit') <> 'include' and coalesce(f.exclude_from_net_purchases, false))) excl
      from public.base44_purchase_invoice_sync sy
      left join public.base44_purchase_supplier_flags f on f.base44_supplier_id = sy.base44_supplier_id
      where sy.branch = b.name and sy.invoice_date between v_from and v_to
        and sy.base44_missing_at is null
        and sy.base44_status = 'يتم الحفظ'
    ) t
  ) x on true
  left join lateral (
    -- Still waiting for review in the purchases app: shown apart, never in the net.
    select count(*)::int invoices, round(coalesce(sum(sy.total_value - coalesce(sy.returned_value, 0)), 0), 2) value
    from public.base44_purchase_invoice_sync sy
    where sy.branch = b.name and sy.invoice_date between v_from and v_to
      and sy.base44_missing_at is null and sy.base44_status = 'انتظار المراجعة'
      and coalesce(sy.transaction_type, '') <> 'internal_transfer'
  ) pend on true;

  return jsonb_build_object('from', v_from, 'to', v_to, 'branches', v_rows,
    'excluded_suppliers', (select coalesce(jsonb_agg(f.name order by f.name), '[]'::jsonb)
                           from public.base44_purchase_supplier_flags f where f.exclude_from_net_purchases),
    'synced_at', (select max(bs.synced_at) from public.base44_purchase_invoice_sync bs));
end;
$function$;

-- An invoice deleted in the purchases app leaves the totals within the hour (was once a night).
select cron.schedule('dawaa-base44-purchase-invoice-full-sync', '41 * * * *', $cron$
  select net.http_post(
    url := 'https://jkjqeqkshllustwlzzbf.supabase.co/functions/v1/base44-purchase-invoice-sync',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"full": true}'::jsonb
  );
$cron$);
