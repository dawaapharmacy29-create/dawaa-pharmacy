-- اعتماد آخر رصيد (صاحب الصيدلية 2026-11-27): طول ما مفيش ملف رصيد جديد اترفع، رصيد الأصناف الموجود هو المعتمد لكل يوم.
-- قبل كده inventory_stock_daily كان فيه صف بس في يوم رفع الملف، فالأيام اللي مااترفعش فيها ملف كانت بتطلع فاضية في
-- «يوم بيوم». دلوقتي كل يوم من غير ملف بياخد صفوف آخر ملف قبله، ومتعلّم بـ carried_from (يوم الملف الأصلي).
-- أول ما ملف حقيقي يترفع ليوم، dawaa_inventory_upload_finish_v1 بيمسح صفوف اليوم ده ويحط الحقيقي مكانها (زي ما هو).

alter table public.inventory_stock_daily add column if not exists carried_from date;

-- بيبني الأيام المعتمدة من جديد لآخر ١٢٠ يوم: كل يوم مالوش ملف حقيقي ← صفوف آخر يوم حقيقي قبله. صفوف قليلة (مخزن لكل يوم).
create or replace function public.dawaa_inventory_carry_forward_v1()
returns int language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_from date := v_today - 120;
  v_n int;
begin
  delete from public.inventory_stock_daily where carried_from is not null and snapshot_day >= v_from;
  insert into public.inventory_stock_daily
    (snapshot_day, store, branch, store_kind, items, qty, cost_value, sale_value, near_expiry_value, expired_value, upload_id, carried_from)
  select d.day, s.store, s.branch, s.store_kind, s.items, s.qty, s.cost_value, s.sale_value, s.near_expiry_value,
         s.expired_value, s.upload_id, s.snapshot_day
  from (select g::date as day,
               (select max(r.snapshot_day) from public.inventory_stock_daily r
                 where r.carried_from is null and r.snapshot_day < g::date) as src
        from generate_series(v_from, v_today, interval '1 day') g
        where not exists (select 1 from public.inventory_stock_daily r
                          where r.carried_from is null and r.snapshot_day = g::date)) d
  join public.inventory_stock_daily s on s.snapshot_day = d.src and s.carried_from is null
  where d.src is not null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.dawaa_inventory_carry_forward_v1() from public, anon, authenticated;

-- بعد كل رفع: الأيام اللي بعده تتعتمد على الملف الجديد.
do $do$
declare
  d text := pg_get_functiondef('public.dawaa_inventory_upload_finish_v1(uuid)'::regprocedure);
  anchor text := E'  update public.inventory_stock_uploads set status = ''ready'', finished_at = now() where id = p_upload;';
begin
  if position('dawaa_inventory_carry_forward_v1' in d) > 0 then return; end if;
  if position(anchor in d) = 0 then raise exception 'finish anchor not found'; end if;
  d := replace(d, anchor, anchor || E'\n  perform public.dawaa_inventory_carry_forward_v1();');
  execute d;
end;
$do$;

-- «تحرير المخزون»: الرواكد والبطيء بيتسجلوا للنهارده (على الرصيد المعتمد)، مش ليوم الملف بس.
do $do$
declare
  d text := pg_get_functiondef('public.dawaa_stock_liberation_v1(text)'::regprocedure);
  old_sel text := E'    select u.snapshot_day, x->>''branch'', coalesce((x->>''value'')::numeric, 0)';
begin
  if position(old_sel in d) = 0 then
    if position(E'    select v_today, x->>''branch''' in d) > 0 then return; end if;
    raise exception 'liberation insert not found';
  end if;
  d := replace(d, old_sel, E'    select v_today, x->>''branch'', coalesce((x->>''value'')::numeric, 0)');
  execute d;
end;
$do$;

grant execute on function public.dawaa_inventory_upload_finish_v1(uuid) to anon, authenticated;
grant execute on function public.dawaa_stock_liberation_v1(text) to anon, authenticated;

-- كل ساعة (بعد نص الليل بيعتمد اليوم الجديد على طول).
select cron.unschedule(jobid) from cron.job where jobname = 'dawaa_inventory_carry_forward';
select cron.schedule('dawaa_inventory_carry_forward', '3 * * * *', $c$select public.dawaa_inventory_carry_forward_v1()$c$);

select public.dawaa_inventory_carry_forward_v1();
