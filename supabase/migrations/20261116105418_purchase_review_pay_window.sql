-- «مراجعة المشتريات»: a supplier is paid within a window, not on one day. pay_after_days is when the
-- window opens (the bill shows up to pay) and pay_until_days the last day before it counts as late
-- (null = the same day). Days are counted from the day after the bill closes.

alter table public.purchase_review_supplier_terms
  add column if not exists pay_until_days integer;
alter table public.purchase_review_supplier_terms
  drop constraint if exists purchase_review_supplier_terms_pay_until_check;
alter table public.purchase_review_supplier_terms
  add constraint purchase_review_supplier_terms_pay_until_check
  check (pay_until_days is null or (pay_until_days between pay_after_days and 120));

create or replace function public.save_purchase_supplier_terms_v2(
  p_code text,
  p_month_start_day integer,
  p_pay_after_days integer,
  p_pay_until_days integer,
  p_excluded boolean,
  p_note text
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.purchase_review_actor_v1();
begin
  update public.purchase_review_supplier_terms set
    month_start_day = p_month_start_day,
    pay_after_days = p_pay_after_days,
    pay_until_days = case when p_pay_until_days is null or p_pay_until_days <= p_pay_after_days
                          then null else p_pay_until_days end,
    excluded = coalesce(p_excluded, false),
    note = nullif(btrim(coalesce(p_note, '')), ''),
    updated_by = v_actor,
    updated_at = now()
  where supplier_code = p_code;
  if not found then
    raise exception 'unknown_supplier' using errcode = '22023';
  end if;
end;
$function$;
revoke all on function public.save_purchase_supplier_terms_v2(text, integer, integer, integer, boolean, text) from public;
grant execute on function public.save_purchase_supplier_terms_v2(text, integer, integer, integer, boolean, text) to anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_purchase_review_v1(p_from date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_track date := coalesce((select s.track_from from public.purchase_review_settings s where s.id), date_trunc('month', v_today)::date);
  v_from date := least(
    coalesce(p_from, (date_trunc('month', v_today) - interval '5 months')::date),
    v_track - 160);
begin
  perform public.purchase_review_actor_v1();
  return jsonb_build_object(
    'today', v_today,
    'from', v_from,
    'track_from', v_track,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object('day', g.invoice_day, 'branch', g.branch, 'store', g.store,
               'payment', g.payment, 'supplier_code', g.supplier_code, 'excluded', g.excluded,
               'invoices', g.n, 'net', g.net)
             order by g.invoice_day, g.store, g.supplier_code)
      from (select i.invoice_day, i.branch, i.store, i.payment, i.supplier_code,
                   coalesce(f.excluded, false) excluded, count(*) n, sum(i.net) net
            from public.purchase_review_invoices i
            left join public.purchase_review_invoice_flags f on f.store = i.store and f.serial = i.serial
            where i.invoice_day >= v_from
            group by 1, 2, 3, 4, 5, 6) g), '[]'::jsonb),
    'suppliers', coalesce((
      select jsonb_agg(jsonb_build_object('code', t.supplier_code, 'name', t.supplier_name,
               'month_start_day', t.month_start_day, 'pay_after_days', t.pay_after_days,
               'pay_until_days', t.pay_until_days,
               'excluded', t.excluded, 'note', t.note) order by t.supplier_name)
      from public.purchase_review_supplier_terms t), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'supplier_code', p.supplier_code, 'branch', p.branch,
               'amount', p.amount, 'paid_on', p.paid_on, 'note', p.note,
               'by', coalesce(sa.name, sa.username)) order by p.paid_on, p.created_at)
      from public.purchase_review_payments p
      left join public.staff_accounts sa on sa.id = p.created_by), '[]'::jsonb),
    'treasury', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.base44_id,
               'branch', case t.vault_code when 'shokry' then 'فرع شكري' else 'فرع الشامي' end,
               'category', btrim(t.category_name), 'amount', t.amount, 'day', t.tx_date,
               'description', t.description, 'by', t.created_by_name) order by t.tx_date, t.base44_id)
      from public.accountant_transactions t
      where t.vault_code in ('shokry', 'shamy') and t.direction = 'out'
        and t.classification in ('شركات', 'مخازن') and coalesce(t.is_offset_pair, false) = false
        and coalesce(btrim(t.category_name), '') <> '' and t.tx_date >= v_from), '[]'::jsonb),
    'links', coalesce((
      select jsonb_agg(jsonb_build_object('category', l.category_name, 'supplier_code', l.supplier_code,
               'ignored', l.ignored))
      from public.purchase_review_treasury_links l), '[]'::jsonb),
    'uploads', coalesce((
      select jsonb_agg(u order by u.uploaded_at desc) from (
        select distinct on (x.store) x.store, x.branch, x.file_name, x.first_day, x.last_day, x.invoices,
               x.net, x.report_net, x.uploaded_at, coalesce(sa.name, sa.username) uploaded_by
        from public.purchase_review_uploads x
        left join public.staff_accounts sa on sa.id = x.uploaded_by
        order by x.store, x.uploaded_at desc) u), '[]'::jsonb)
  );
end;
$function$;
