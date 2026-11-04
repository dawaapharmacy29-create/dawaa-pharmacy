-- «المشتريات» page: DawaaWael purchase invoices (synced into base44_purchase_invoice_sync) instead of the old
-- internal purchase_invoices table, which stopped in August 2026. One call returns the review queue per branch,
-- yesterday / this month totals, and the invoice list for the chosen filters.
-- Access: the purchase invoice reviewers (branch_manager sees only their branch).
create or replace function public.get_dawaawael_purchases_v1(
  p_branch text default null,
  p_status text default 'pending',
  p_from date default null,
  p_to date default null,
  p_search text default null,
  p_limit integer default 200
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_account public.staff_accounts%rowtype;
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_month_start date := date_trunc('month', (now() at time zone 'Africa/Cairo'))::date;
  v_branch text;
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  select sa.* into v_account from public.staff_accounts sa
  where sa.id = public.dawaa_current_staff_account_id_strict() and coalesce(sa.active, false) and coalesce(sa.can_login, false);
  if not found or not public.dawaa_is_purchase_invoice_reviewer_v1(v_account.role) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  v_branch := case when lower(btrim(coalesce(v_account.role, ''))) = 'branch_manager' then v_account.branch else p_branch end;

  return (
    with live as (
      select p.*, s.name supplier_name
      from public.base44_purchase_invoice_sync p
      left join public.purchase_suppliers s on s.base44_id = p.base44_supplier_id
      where (p.base44_missing_at is null or p.synced_at > p.base44_missing_at)
        and p.invoice_date is not null and p.invoice_date >= v_today - 120
        and (v_branch is null or p.branch = v_branch)
    )
    select jsonb_build_object(
      'synced_at', (select max(l.ran_at) from public.base44_sync_run_log l
                    where coalesce(l.source, 'purchase_invoices') = 'purchase_invoices' and l.status = 'success'),
      'scoped_branch', case when v_branch is distinct from p_branch then v_branch end,
      'branches', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'branch', b.branch,
                 'pending', b.pending, 'pending_value', b.pending_value, 'oldest_pending', b.oldest_pending,
                 'yesterday', b.yesterday, 'yesterday_value', b.yesterday_value,
                 'month', b.month_count, 'month_value', b.month_value) order by b.branch), '[]'::jsonb)
        from (
          select l.branch,
                 count(*) filter (where l.base44_status = 'انتظار المراجعة') pending,
                 coalesce(sum(l.total_value) filter (where l.base44_status = 'انتظار المراجعة'), 0) pending_value,
                 min(l.invoice_date) filter (where l.base44_status = 'انتظار المراجعة') oldest_pending,
                 count(*) filter (where l.invoice_date = v_today - 1) yesterday,
                 coalesce(sum(l.total_value) filter (where l.invoice_date = v_today - 1), 0) yesterday_value,
                 count(*) filter (where l.invoice_date >= v_month_start) month_count,
                 coalesce(sum(l.total_value) filter (where l.invoice_date >= v_month_start), 0) month_value
          from live l where l.branch in ('فرع شكري', 'فرع الشامي')
          group by l.branch
        ) b),
      'rows', (
        select coalesce(jsonb_agg(r order by r->>'invoice_date' desc, r->>'number' desc), '[]'::jsonb)
        from (
          select jsonb_build_object(
                   'id', l.id, 'number', l.system_invoice_number, 'supplier_number', l.supplier_invoice_number,
                   'supplier', l.supplier_name, 'branch', l.branch, 'invoice_date', l.invoice_date,
                   'value', l.total_value, 'payment', l.payment_type, 'category', l.purchase_category,
                   'type', l.transaction_type, 'entered_by', l.entered_by_raw, 'status', l.base44_status,
                   'notes', l.notes) r
          from live l
          where (coalesce(p_status, 'pending') <> 'pending' or l.base44_status = 'انتظار المراجعة')
            and (p_from is null or l.invoice_date >= p_from)
            and (p_to is null or l.invoice_date <= p_to)
            and (v_search is null
                 or l.system_invoice_number ilike '%' || v_search || '%'
                 or l.supplier_invoice_number ilike '%' || v_search || '%'
                 or l.supplier_name ilike '%' || v_search || '%'
                 or l.entered_by_raw ilike '%' || v_search || '%')
          order by l.invoice_date desc, l.system_invoice_number desc
          limit least(greatest(coalesce(p_limit, 200), 1), 500)
        ) x)
    )
  );
end;
$function$;

revoke all on function public.get_dawaawael_purchases_v1(text, text, date, date, text, integer) from public, anon;
grant execute on function public.get_dawaawael_purchases_v1(text, text, date, date, text, integer) to authenticated;
