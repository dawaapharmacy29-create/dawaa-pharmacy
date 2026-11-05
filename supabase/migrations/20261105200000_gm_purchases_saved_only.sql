-- GM purchases card counts saved invoices only, like the «دواء وائل» purchases app (owner decision
-- 2026-11-05). Invoices still «انتظار المراجعة» in the app are returned apart (pending_*), not in the net.
-- Purchases without a base44 row (entered here) count as saved.

do $migration$
declare
  v_def text := pg_get_functiondef('public.get_gm_purchases_summary_v1(date, date)'::regprocedure);
  v_old_from text := $o$    from public.purchase_invoices pi
    left join public.purchase_suppliers s on s.id = pi.supplier_id
    where pi.branch = b.name and pi.invoice_date between v_from and v_to
      and not exists (select 1 from public.base44_purchase_invoice_sync bs
                      where bs.base44_id = pi.base44_id and bs.base44_missing_at is not null)$o$;
  v_new_from text := $n$    from public.purchase_invoices pi
    left join public.purchase_suppliers s on s.id = pi.supplier_id
    left join public.base44_purchase_invoice_sync sy on sy.base44_id = pi.base44_id
    where pi.branch = b.name and pi.invoice_date between v_from and v_to
      and sy.base44_missing_at is null
      and coalesce(sy.base44_status, 'يتم الحفظ') = 'يتم الحفظ'$n$;
  v_old_ret text := $o$'transfers', coalesce(x.transfers, 0), 'excluded', coalesce(x.excluded, 0), 'net', coalesce(x.net, 0))$o$;
  v_new_ret text := $n$'transfers', coalesce(x.transfers, 0), 'excluded', coalesce(x.excluded, 0), 'net', coalesce(x.net, 0),
      'pending_invoices', coalesce(pend.invoices, 0), 'pending_value', coalesce(pend.value, 0))$n$;
  v_old_join text := $o$  ) x on true;$o$;
  v_new_join text := $n$  ) x on true
  left join lateral (
    -- Still waiting for review in the purchases app: shown apart, never in the net.
    select count(*)::int invoices, round(coalesce(sum(sy.total_value), 0), 2) value
    from public.base44_purchase_invoice_sync sy
    where sy.branch = b.name and sy.invoice_date between v_from and v_to
      and sy.base44_missing_at is null and sy.base44_status = 'انتظار المراجعة'
      and coalesce(sy.transaction_type, '') <> 'internal_transfer'
  ) pend on true;$n$;
begin
  if (length(v_def) - length(replace(v_def, v_old_from, ''))) / length(v_old_from) <> 1
     or (length(v_def) - length(replace(v_def, v_old_ret, ''))) / length(v_old_ret) <> 1
     or (length(v_def) - length(replace(v_def, v_old_join, ''))) / length(v_old_join) <> 1 then
    raise exception 'patch_not_found';
  end if;
  v_def := replace(replace(replace(v_def, v_old_from, v_new_from), v_old_ret, v_new_ret), v_old_join, v_new_join);
  execute v_def;
end;
$migration$;
