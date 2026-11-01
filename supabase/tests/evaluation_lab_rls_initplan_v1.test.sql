-- The policies keep the same visibility after the functions are wrapped in sub-selects.
set role anon;
do $$
declare v int;
begin
  -- Top management sees every purchase invoice; a purchasing viewer too.
  perform set_config('test.top', 'yes', true);
  select count(*) into v from public.purchase_invoices;
  if v <> 3 then raise exception 'top_sees_%', v; end if;
  perform set_config('test.top', '', true);
  perform set_config('test.can', 'view_purchases', true);
  select count(*) into v from public.purchase_invoices;
  if v <> 3 then raise exception 'viewer_sees_%', v; end if;
  perform set_config('test.can', '', true);

  -- Shokry's manager: own branch only; plus what they entered in another branch.
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000002', true);
  select count(*) into v from public.purchase_invoices;
  if v <> 1 then raise exception 'branch_sees_%', v; end if;
  perform set_config('test.subject', '00000000-0000-4000-8000-0000000000aa', true);
  select count(*) into v from public.purchase_invoices;
  if v <> 2 then raise exception 'own_entry_sees_%', v; end if;
  perform set_config('test.actor', '', true);
  perform set_config('test.subject', '', true);
  select count(*) into v from public.purchase_invoices;
  if v <> 0 then raise exception 'nobody_sees_%', v; end if;

  -- Invoice items: ALL, one branch, none.
  perform set_config('test.scope', 'ALL', true);
  select count(*) into v from public.sales_invoice_items_v21;
  if v <> 2 then raise exception 'items_all_%', v; end if;
  perform set_config('test.scope', 'فرع شكري', true);
  select count(*) into v from public.sales_invoice_items_v21 where branch = 'فرع شكري';
  if v <> 1 or exists (select 1 from public.sales_invoice_items_v21 where branch <> 'فرع شكري') then raise exception 'items_branch_wrong'; end if;
  perform set_config('test.scope', '', true);
  select count(*) into v from public.sales_invoice_items_v21;
  if v <> 0 then raise exception 'items_none_%', v; end if;
end;
$$;
reset role;

-- Each function now sits in a sub-select (evaluated once per query).
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'purchase_invoices_select' and qual ilike '%SELECT dawaa_actor_is_top_management_v1()%')
     or not exists (select 1 from pg_policies where policyname = 'sales_invoice_items_v21_select' and qual ilike '%SELECT dawaa_current_sales_invoice_scope_v1%') then
    raise exception 'policies_not_wrapped';
  end if;
end;
$$;
