begin;

alter table if exists public.dawaa_customer_intelligence_cache_v1 enable row level security;
alter table if exists public.product_movement_evidence enable row level security;
alter table if exists public.sales_invoices_reconcile_backup_20260817 enable row level security;
alter table if exists public.sales_invoices_reconcile_stage_20260817 enable row level security;

revoke all on table public.dawaa_customer_intelligence_cache_v1 from anon, authenticated;
revoke all on table public.product_movement_evidence from anon, authenticated;
revoke all on table public.sales_invoices_reconcile_backup_20260817 from anon, authenticated;
revoke all on table public.sales_invoices_reconcile_stage_20260817 from anon, authenticated;

revoke execute on function public.dawaa_cleanup_customer_intelligence_cache() from public, anon, authenticated;

create or replace function public.import_product_movement_evidence_v1(
  p_rows jsonb,
  p_source text default 'movement_import'::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  r jsonb;
  p record;
  v_imported int := 0;
  v_rejected int := 0;
  v_actor uuid;
begin
  v_actor := public.dawaa_current_staff_account_id_strict();

  if v_actor is null or not exists (
    select 1
    from public.staff_accounts a
    where a.id = v_actor
      and coalesce(a.active, false)
      and coalesce(a.can_login, false)
      and lower(coalesce(a.role, '')) in (
        'admin','owner','general_manager','executive_manager','branches_manager','manager','branch_manager'
      )
  ) then
    raise exception 'not authorized to import product movement evidence';
  end if;

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows_must_be_array';
  end if;

  for r in select value from jsonb_array_elements(p_rows)
  loop
    select * into p
    from public.products
    where product_code = trim(coalesce(r->>'product_code', r->>'code', ''))
    limit 1;

    if not found then
      v_rejected := v_rejected + 1;
      continue;
    end if;

    insert into public.product_movement_evidence(
      product_id, product_code, branch, movement_date, quantity,
      movement_type, source, source_ref
    )
    values(
      p.id,
      p.product_code,
      nullif(trim(r->>'branch'), ''),
      coalesce(nullif(r->>'movement_date', '')::date, current_date),
      coalesce(nullif(r->>'quantity', '')::numeric, 0),
      coalesce(nullif(trim(r->>'movement_type'), ''), 'sale'),
      coalesce(nullif(trim(p_source), ''), 'movement_import'),
      nullif(trim(r->>'source_ref'), '')
    );
    v_imported := v_imported + 1;
  end loop;

  return jsonb_build_object('imported', v_imported, 'rejected', v_rejected);
end;
$function$;

revoke execute on function public.import_product_movement_evidence_v1(jsonb,text) from public, anon;
grant execute on function public.import_product_movement_evidence_v1(jsonb,text) to authenticated;

delete from public.app_data_health_cache where cache_key = 'main';

commit;
