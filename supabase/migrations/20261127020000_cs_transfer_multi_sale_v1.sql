-- شراء واحد قصاد كذا فاتورة بيع (صاحب الصيدلية 2026-11-26): عكس الحالة اللي اتصلحت قبل كده. الفرع التاني ساعات بيبيع
-- التحويل على فاتورتين (مثال: بيع شكري 84335 OCTOZAC + 84386 KERELLA) والفرع اللي استلم بيسجلهم شراء واحد (الشامي
-- مسلسل 13148). فاتورة الشراء بتتسجل على أول فاتورة بيع، والباقي في extra_sales.

alter table public.cs_transfer_checks add column if not exists extra_sales text[] not null default '{}';

-- التسجيل العادي (شراء على بيع واحد) بيفضّي الفواتير الزيادة.
do $$
declare
  src text := pg_get_functiondef('public.dawaa_cs_transfer_check_save_v1(text, text, text, text, text[], text, text, date)'::regprocedure);
  old text := 'set sale_invoice = excluded.sale_invoice, status = excluded.status,';
  fixed text;
begin
  if position('extra_sales' in src) > 0 then return; end if;
  fixed := replace(src, old, 'set sale_invoice = excluded.sale_invoice, extra_sales = ''{}'', status = excluded.status,');
  if fixed = src then raise exception 'check_save: pattern not found'; end if;
  execute fixed;
end $$;

-- اليوم وتقرير الفترة: الشراء بيرجع extra_sales، وفاتورة البيع الزيادة بتبان إنها متسجلة على الشراء ده.
do $$
declare
  fn text;
  src text;
  fixed text;
begin
  foreach fn in array array['public.dawaa_cs_transfer_day_v1', 'public.dawaa_cs_transfer_period_v1'] loop
    src := pg_get_functiondef(fn::regproc);
    if position('extra_sales' in src) > 0 then continue; end if;
    fixed := replace(src,
      '''sale_invoice'', c.sale_invoice, ''note'', c.note,',
      '''sale_invoice'', c.sale_invoice, ''extra_sales'', to_jsonb(c.extra_sales), ''note'', c.note,');
    fixed := replace(fixed,
      'where c.sale_branch = v_sale_branch and c.sale_invoice = s.invoice_number',
      'where c.sale_branch = v_sale_branch and (c.sale_invoice = s.invoice_number or s.invoice_number = any (c.extra_sales))');
    if fixed = src or position('to_jsonb(c.extra_sales)' in fixed) = 0 then
      raise exception '%: pattern not found', fn;
    end if;
    execute fixed;
  end loop;
end $$;

create or replace function public.dawaa_cs_transfer_multi_sale_save_v1(
  p_purchase_store text, p_purchase_serial text, p_sales text[], p_status text default 'ok',
  p_problems text[] default '{}', p_note text default null)
returns jsonb language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_sales text[] := array(
    select x from (select distinct on (btrim(s)) btrim(s) x, n from unnest(p_sales) with ordinality u(s, n)
                   where nullif(btrim(s), '') is not null order by btrim(s), n) d order by n);
  v_more text[];
  v_sale_branch text;
  v text;
begin
  if coalesce(cardinality(v_sales), 0) < 2 or cardinality(v_sales) > 4 then raise exception 'pair_required'; end if;
  v_more := v_sales[2:];
  -- الصلاحية والفرع والسجل وأخطاء الدكاترة: نفس تسجيل الشراء على أول فاتورة بيع.
  perform public.dawaa_cs_transfer_check_save_v1(p_purchase_store, p_purchase_serial, v_sales[1], p_status,
    coalesce(p_problems, '{}'), p_note, null, null);
  select c.sale_branch into v_sale_branch from public.cs_transfer_checks c
  where c.purchase_store = p_purchase_store and c.purchase_serial = p_purchase_serial;
  foreach v in array v_more loop
    if not exists (select 1 from public.sales_invoices where branch = v_sale_branch and invoice_number = v) then
      raise exception 'unknown_sale';
    end if;
  end loop;
  -- الفواتير دي كانت متسجلة لوحدها أو على شراء تاني: تتفك من هناك.
  delete from public.cs_transfer_checks
  where sale_branch = v_sale_branch and purchase_serial is null and sale_invoice = any (v_more);
  update public.cs_transfer_checks
  set extra_sales = array(select e from unnest(extra_sales) e where e <> all (v_sales))
  where sale_branch = v_sale_branch and extra_sales && v_sales
    and not (purchase_store = p_purchase_store and purchase_serial = p_purchase_serial);
  update public.cs_transfer_checks set extra_sales = v_more
  where purchase_store = p_purchase_store and purchase_serial = p_purchase_serial;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.dawaa_cs_transfer_multi_sale_save_v1(text, text, text[], text, text[], text) from public;
grant execute on function public.dawaa_cs_transfer_multi_sale_save_v1(text, text, text[], text, text[], text) to anon, authenticated;
