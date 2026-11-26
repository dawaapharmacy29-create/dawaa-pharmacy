-- «مراجعتي اليومية» (صاحب الصيدلية 2026-11-26): كارت المشتريات بيقرا من مراجعة فواتير امبارح اللي فريق خدمة العملاء
-- بيعملها (من ٩ الصبح امبارح لـ ٩ الصبح النهارده)، للفرعين: كام فاتورة، كام اتراجعت (مطابقة / اتعدلت / فيها مشكلة)،
-- والمسلسل على الورق، والتحويلات بين الفرعين.

create or replace function public.dawaa_gm_purchase_day_v1(p_day date default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare
  v_actor uuid := public.purchase_review_actor_v1();
  v_day date := coalesce(p_day, (now() at time zone 'Africa/Cairo')::date);
  v_from timestamp := (v_day - 1) + time '09:00';
  v_to timestamp := v_day + time '09:00';
begin
  return jsonb_build_object(
    'day', v_day, 'from', v_from, 'to', v_to,
    'branches', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'branch', b.branch,
               'invoices', coalesce(x.invoices, 0), 'net', coalesce(x.net, 0),
               'ok', coalesce(x.ok, 0), 'fixed', coalesce(x.fixed, 0), 'problem', coalesce(x.problem, 0),
               'pending', coalesce(x.pending, 0), 'paper_no', coalesce(x.paper_no, 0),
               'paper_unset', coalesce(x.paper_unset, 0),
               'problems', coalesce(x.problems, '[]'::jsonb),
               'transfers', coalesce(t.n, 0), 'transfers_checked', coalesce(t.checked, 0),
               'transfer_problems', coalesce(t.problem, 0),
               'last_upload', (select max(u.uploaded_at) from public.purchase_review_uploads u where u.branch = b.branch))
             order by b.branch), '[]'::jsonb)
      from (values ('فرع شكري'), ('فرع الشامي')) b(branch)
      left join lateral (
        select count(*) invoices, round(sum(i.net)) net,
               count(*) filter (where c.status = 'ok') ok,
               count(*) filter (where c.status = 'fixed') fixed,
               count(*) filter (where c.status = 'problem') problem,
               count(*) filter (where c.status is null) pending,
               count(*) filter (where m.paper_serial = 'no') paper_no,
               count(*) filter (where m.paper_serial is null) paper_unset,
               (select coalesce(jsonb_agg(p), '[]'::jsonb) from (
                  select jsonb_build_object('serial', i2.serial, 'supplier', i2.supplier_name, 'net', round(i2.net),
                           'problems', to_jsonb(c2.problems), 'by', i2.entered_by) p
                  from public.purchase_review_invoices i2
                  join public.cs_purchase_checks c2 on c2.store = i2.store and c2.serial = i2.serial and c2.status = 'problem'
                  where i2.branch = b.branch and i2.invoice_at >= v_from and i2.invoice_at < v_to
                  order by i2.net desc limit 5) z) problems
        from public.purchase_review_invoices i
        left join public.cs_purchase_checks c on c.store = i.store and c.serial = i.serial
        left join public.cs_purchase_marks m on m.store = i.store and m.serial = i.serial
        where i.branch = b.branch and i.invoice_at >= v_from and i.invoice_at < v_to
          and not public.dawaa_cs_is_transfer_supplier_v1(i.branch, i.supplier_code, i.supplier_name)) x on true
      left join lateral (
        select count(*) n,
               count(*) filter (where c.purchase_serial is not null) checked,
               count(*) filter (where c.status = 'problem') problem
        from public.purchase_review_invoices i
        left join public.cs_transfer_checks c on c.purchase_store = i.store and c.purchase_serial = i.serial
        where i.branch = b.branch and i.invoice_at >= v_from and i.invoice_at < v_to
          and public.dawaa_cs_is_transfer_supplier_v1(i.branch, i.supplier_code, i.supplier_name)) t on true)
  );
end;
$$;
revoke all on function public.dawaa_gm_purchase_day_v1(date) from public;
grant execute on function public.dawaa_gm_purchase_day_v1(date) to anon, authenticated;
