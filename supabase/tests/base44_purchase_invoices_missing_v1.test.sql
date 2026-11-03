-- Invoices deleted in DawaaWael leave the general manager's review; the ones that come back count again.
insert into public.base44_sync_run_log(source, status) values ('purchase_invoices', 'success');

do $$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_branch jsonb;
begin
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000001', true);
  -- p-1 .. p-4 and ten older invoices came back in the full sync that started now; p-gone did not.
  insert into public.base44_purchase_invoice_sync(base44_id, branch, invoice_date, total_value, base44_status)
  select 'old-' || g, 'فرع الشامي', v_today - 90, 100, 'معتمدة' from generate_series(1, 10) g;
  update public.base44_purchase_invoice_sync set synced_at = now() + interval '1 minute';
  insert into public.base44_purchase_invoice_sync(base44_id, branch, invoice_date, total_value, base44_status, synced_at)
  values ('p-gone', 'فرع شكري', v_today - 2, 4000, 'انتظار المراجعة', now() - interval '1 day');

  begin
    perform public.mark_base44_purchase_invoices_missing_v1(now(), 7);
    raise exception 'a short read marked invoices';
  exception when invalid_parameter_value then null;
  end;
  if (select count(*) from public.base44_purchase_invoice_sync where base44_missing_at is not null) <> 0 then
    raise exception 'a short read must mark nothing';
  end if;

  if public.mark_base44_purchase_invoices_missing_v1(now(), 14) <> 1 then
    raise exception 'only p-gone is missing';
  end if;
  if public.mark_base44_purchase_invoices_missing_v1(now(), 14) <> 0 then
    raise exception 'a missing invoice is marked once';
  end if;

  select b into v_branch from jsonb_array_elements(
    (select i->'detail'->'branches' from jsonb_array_elements(public.get_gm_daily_review_v1()->'items') i
      where i->>'key' = 'purchases_handover')) b where b->>'branch' = 'shokry';
  if (v_branch->>'pending')::int <> 1 or (v_branch->>'value')::numeric <> 1500 then
    raise exception 'the deleted invoice still counts: %', v_branch;
  end if;

  -- Back in DawaaWael: synced after the mark, it counts again.
  update public.base44_purchase_invoice_sync set synced_at = now() + interval '2 minutes' where base44_id = 'p-gone';
  select b into v_branch from jsonb_array_elements(
    (select i->'detail'->'branches' from jsonb_array_elements(public.get_gm_daily_review_v1()->'items') i
      where i->>'key' = 'purchases_handover')) b where b->>'branch' = 'shokry';
  if (v_branch->>'pending')::int <> 2 then
    raise exception 'an invoice back in DawaaWael must count: %', v_branch;
  end if;
end $$;

-- The browser roles cannot mark invoices.
set role anon;
do $$
begin
  perform public.mark_base44_purchase_invoices_missing_v1(now(), 100);
  raise exception 'anon marked invoices';
exception when insufficient_privilege then null;
end $$;
reset role;
