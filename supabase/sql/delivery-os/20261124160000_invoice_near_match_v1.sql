-- Delivery OS (qlugjplnnkjzxcbhwopg). Owner review 2026-11-24 of the orders that stayed "pending reconciliation":
-- the invoice sync matches only on number + branch + the exact delivery date. 176 of 340 such orders had an invoice
-- with the same number AND the same customer code, but the invoice was issued 1-2 days before the delivery, or by the
-- other branch. They are the same invoice. This rule matches them; anything with a different customer code, no
-- invoice at all, or an invoice already used by another order stays for manual review.
-- The sync does not undo it: it only writes an order when it finds its own exact match.
-- Runs before the release (dawaa_release_invoice_matched_orders_v1), open cycle only.
-- Applied live 2026-11-24 (owner approval): 169 orders matched, 117 of them released by the next release run.

create or replace function public.dawaa_match_near_invoices_v1(p_limit integer default 1000)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare v_n integer := 0; v_today date := (now() at time zone 'Africa/Cairo')::date; v_cycle_start date;
begin
  v_cycle_start := case when extract(day from v_today) >= 26 then make_date(extract(year from v_today)::int, extract(month from v_today)::int, 26)
                        else (make_date(extract(year from v_today)::int, extract(month from v_today)::int, 26) - interval '1 month')::date end;
  with p as (
    select o.id, o.delivery_date, coalesce(o.order_multiplier, 1) >= 1.5 as is_x15,
      public.normalize_delivery_reconciliation_invoice(coalesce(nullif(o.invoice_number, ''), o.invoice_no)) inv,
      public.normalize_delivery_reconciliation_branch(coalesce(nullif(o.branch_name, ''), nullif(o.branch, ''), b.name)) br,
      btrim(coalesce(nullif(o.customer_code_snapshot, ''), o.customer_code)) cc
    from public.delivery_orders o left join public.branches b on b.id = o.branch_id
    where o.delivery_date >= v_cycle_start and o.deleted_at is null and coalesce(o.is_deleted, false) = false
      and o.reconciliation_status = 'pending_reconciliation' and o.bconnect_invoice_id is null
      and lower(coalesce(o.status, '')) not in ('failed', 'cancelled', 'canceled', 'returned')
      and coalesce(o.is_duplicate_invoice, false) = false and coalesce(o.duplicate_warning, false) = false
      and o.original_order_id is null and o.settlement_batch_id is null and o.rider_id is not null
      and coalesce(o.not_countable, false) = false and coalesce(o.excluded_from_incentive, false) = false
      and coalesce(o.bconnect_match_status, 'pending') = 'pending'
  ), c as (
    select p.*, e.id evidence_id, e.net_total, (e.normalized_branch_name = p.br) same_branch,
      count(*) over (partition by p.id) n_for_order,
      count(*) over (partition by e.id) n_for_invoice
    from p join public.monthly_system_invoices e
      on e.period_start = v_cycle_start and e.invoice_number = p.inv
     and nullif(p.cc, '') is not null and btrim(e.customer_code) = p.cc
     and e.invoice_date_text::date between p.delivery_date - 2 and p.delivery_date
    where not exists (select 1 from public.delivery_orders x where x.bconnect_invoice_id = e.id and x.deleted_at is null)
  ), pick as (
    select o.id from public.delivery_orders o join c on c.id = o.id
    where c.n_for_order = 1 and c.n_for_invoice = 1
    order by o.delivery_date limit p_limit
    for update of o skip locked
  ), upd as (
    update public.delivery_orders o set
      bconnect_invoice_id = c.evidence_id,
      bconnect_match_status = case when c.same_branch then 'matched' else 'cross_branch_matched' end,
      matched_at = now(), matched_amount = c.net_total, is_countable = true,
      final_count_status = case when c.is_x15 then 'counted_multiplier_pending_value_review'
                                when c.same_branch then 'counted' else 'counted_cross_branch_approved' end,
      reconciliation_status = 'matched',
      reconciliation_notes = case when c.same_branch then 'مطابقة: نفس رقم الفاتورة وكود العميل، والفاتورة قبل التوصيل بيوم أو اتنين'
                                  else 'مطابقة: نفس رقم الفاتورة وكود العميل، والفاتورة من الفرع التاني' end,
      updated_at = now()
    from c join pick on pick.id = c.id
    where o.id = c.id
    returning o.id, o.invoice_number, o.rider_id, o.delivery_date, c.same_branch
  ), audited as (
    insert into public.delivery_order_audit_log (delivery_order_id, action_type, action_reason, old_rider_id, new_rider_id, performed_by_name, payload)
    select u.id::uuid, 'invoice_near_match_v1',
      'Same invoice number and customer code; invoice dated up to 2 days before delivery or issued by the other branch',
      u.rider_id, u.rider_id, 'DAWAA invoice match',
      jsonb_build_object('invoice_number', u.invoice_number, 'delivery_date', u.delivery_date, 'same_branch', u.same_branch)
    from upd u returning 1
  )
  select count(*) into v_n from audited;
  return v_n;
end;
$function$;
revoke all on function public.dawaa_match_near_invoices_v1(integer) from public, anon, authenticated;

select cron.unschedule('dawaa-release-invoice-matched-orders-v1');
select cron.schedule('dawaa-release-invoice-matched-orders-v1', '*/5 * * * *',
  'select public.dawaa_match_near_invoices_v1(1000); select public.dawaa_release_invoice_matched_orders_v1(1000);');
