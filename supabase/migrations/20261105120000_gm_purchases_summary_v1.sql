-- «المشتريات والخزنة» at the top of the general manager's dashboard.
-- get_gm_purchases_summary_v1(from, to): purchases of the «دواء وائل» purchases app (purchase_invoices, mirrored from
-- Base44) per branch for any period. Net = gross − transfers between the two branches − suppliers flagged
-- «exclude_from_net_purchases» (the agreed codes, e.g. «مورد جرد *تعديلات ارصده*») − invoices excluded one by one.
-- Invoices deleted in Base44 (base44_missing_at) are left out. Same viewers as «مراجعتي اليومية».

create or replace function public.get_gm_purchases_summary_v1(p_from date default null, p_to date default null)
returns jsonb
language plpgsql
stable
security definer
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
      'transfers', coalesce(x.transfers, 0), 'excluded', coalesce(x.excluded, 0), 'net', coalesce(x.net, 0))
    order by b.name), '[]'::jsonb)
    into v_rows
  from (values ('فرع الشامي'), ('فرع شكري')) b(name)
  left join lateral (
    select count(*)::int invoices,
      round(sum(pi.total_value), 2) gross,
      round(coalesce(sum(pi.total_value) filter (where pi.transaction_type = 'internal_transfer'), 0), 2) transfers,
      round(coalesce(sum(pi.total_value) filter (where coalesce(pi.transaction_type, '') <> 'internal_transfer'
        and (coalesce(s.exclude_from_net_purchases, false) or pi.exclusion_reason is not null
             or pi.net_purchase_mode = 'exclude')), 0), 2) excluded,
      round(coalesce(sum(pi.total_value) filter (where coalesce(pi.transaction_type, '') <> 'internal_transfer'
        and not coalesce(s.exclude_from_net_purchases, false) and pi.exclusion_reason is null
        and coalesce(pi.net_purchase_mode, 'inherit') <> 'exclude'), 0), 2) net
    from public.purchase_invoices pi
    left join public.purchase_suppliers s on s.id = pi.supplier_id
    where pi.branch = b.name and pi.invoice_date between v_from and v_to
      and not exists (select 1 from public.base44_purchase_invoice_sync bs
                      where bs.base44_id = pi.base44_id and bs.base44_missing_at is not null)
  ) x on true;

  return jsonb_build_object('from', v_from, 'to', v_to, 'branches', v_rows,
    'excluded_suppliers', (select coalesce(jsonb_agg(s.name order by s.name), '[]'::jsonb)
                           from public.purchase_suppliers s where s.exclude_from_net_purchases),
    'synced_at', (select max(bs.synced_at) from public.base44_purchase_invoice_sync bs));
end;
$function$;

revoke all on function public.get_gm_purchases_summary_v1(date, date) from public;
grant execute on function public.get_gm_purchases_summary_v1(date, date) to anon, authenticated;
