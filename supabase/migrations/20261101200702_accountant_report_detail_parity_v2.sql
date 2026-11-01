-- Preserve source provenance and resolved directory labels in the existing projection.
alter table public.accountant_vaults add column if not exists source_details jsonb not null default '{}';
alter table public.accountant_transactions add column if not exists source_details jsonb not null default '{}';
create or replace function public.import_base44_accountant_v1(p_vaults jsonb, p_transactions jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_vaults integer;
  v_tx integer;
  v_removed integer;
begin
  if jsonb_typeof(p_vaults) is distinct from 'array' or jsonb_typeof(p_transactions) is distinct from 'array' then
    raise exception 'records_must_be_array';
  end if;
  -- An empty answer never wipes the book.
  if jsonb_array_length(p_vaults) = 0 or jsonb_array_length(p_transactions) = 0 then raise exception 'empty_snapshot'; end if;

  insert into public.accountant_vaults as v (code, base44_id, name, opening_balance, opening_date, is_active, synced_at)
  select r->>'code', r->>'id', coalesce(r->>'name', r->>'code'), coalesce((r->>'opening_balance')::numeric, 0),
         nullif(r->>'opening_date', '')::date, coalesce((r->>'is_active')::boolean, true), now()
  from jsonb_array_elements(p_vaults) r
  where r->>'code' is not null and r->>'id' is not null and not coalesce((r->>'is_sample')::boolean, false)
  on conflict (code) do update set base44_id = excluded.base44_id, name = excluded.name,
    opening_balance = excluded.opening_balance, opening_date = excluded.opening_date,
    is_active = excluded.is_active, synced_at = now();
  get diagnostics v_vaults = row_count;
  delete from public.accountant_vaults v
   where not exists (select 1 from jsonb_array_elements(p_vaults) r
                      where r->>'code' = v.code and not coalesce((r->>'is_sample')::boolean, false));

  drop table if exists _accountant_tx;
  create temporary table _accountant_tx on commit drop as
  select r->>'id' as base44_id, r->>'vault_code' as vault_code, (r->>'date')::date as tx_date,
         r->>'direction' as direction, (r->>'amount')::numeric as amount,
         nullif(btrim(r->>'category_name'), '') as category_name, nullif(btrim(r->>'category_group'), '') as category_group,
         coalesce(nullif(btrim(r->>'classification_override'), ''), nullif(btrim(r->>'category_group'), ''), 'غير مصنف') as classification,
         nullif(btrim(r->>'description'), '') as description, nullif(btrim(r->>'created_by_name'), '') as created_by_name,
         coalesce((r->>'is_offset_pair')::boolean, false) as is_offset_pair,
         ((r->>'created_date') || 'Z')::timestamptz as base44_created_at, ((r->>'updated_date') || 'Z')::timestamptz as base44_updated_at
  from jsonb_array_elements(p_transactions) r
  where r->>'id' is not null and r->>'vault_code' is not null and r->>'direction' in ('in', 'out')
    and r->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and (r->>'amount') is not null
    and not coalesce((r->>'voided')::boolean, false) and not coalesce((r->>'is_sample')::boolean, false);

  insert into public.accountant_transactions as t (base44_id, vault_code, tx_date, direction, amount, category_name,
    category_group, classification, description, created_by_name, is_offset_pair, base44_created_at, base44_updated_at, synced_at)
  select x.*, now() from _accountant_tx x
  on conflict (base44_id) do update set vault_code = excluded.vault_code, tx_date = excluded.tx_date,
    direction = excluded.direction, amount = excluded.amount, category_name = excluded.category_name,
    category_group = excluded.category_group, classification = excluded.classification,
    description = excluded.description, created_by_name = excluded.created_by_name,
    is_offset_pair = excluded.is_offset_pair, base44_created_at = excluded.base44_created_at,
    base44_updated_at = excluded.base44_updated_at, synced_at = now();
  get diagnostics v_tx = row_count;
  -- Deleted, voided or turned into samples there: gone here.
  delete from public.accountant_transactions t where not exists (select 1 from _accountant_tx x where x.base44_id = t.base44_id);
  get diagnostics v_removed = row_count;

  update public.accountant_vaults v set source_details = r - 'opening_balance'
    from jsonb_array_elements(p_vaults) r where v.code = r->>'code';
  update public.accountant_transactions t set source_details = r - 'amount'
    from jsonb_array_elements(p_transactions) r where t.base44_id = r->>'id';
  return jsonb_build_object('vaults', v_vaults, 'transactions', v_tx, 'removed', v_removed,
    'total', jsonb_array_length(p_transactions));
end;
$function$;
revoke all on function public.import_base44_accountant_v1(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.import_base44_accountant_v1(jsonb, jsonb) to service_role;

-- The report: balances of each treasury and, for one month, every movement and its category.
create or replace function public.get_accountant_report_v1(p_month text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_catalog'
as $function$
declare v_month date; v_today date := (now() at time zone 'Africa/Cairo')::date;
begin
 perform public.gm_daily_review_actor_v1();
 if p_month is not null and p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid_month'; end if;
 v_month := coalesce((p_month || '-01')::date,date_trunc('month',v_today)::date);
 if (select count(*) from accountant_transactions where tx_date >= v_month and tx_date < v_month + interval '1 month') > 20000 then
   raise exception 'report_month_too_large';
 end if;
 return (
 with active as materialized (
   select t.* from accountant_transactions t join accountant_vaults v on v.code=t.vault_code
   where v.is_active and (v.opening_date is null or t.tx_date >= v.opening_date)
 ), vault_data as (
   select v.*,coalesce(s.inc,0) incoming,coalesce(s.out,0) outgoing,s.last_date,
     v.opening_balance+coalesce(s.inc,0)-coalesce(s.out,0) balance,
     case when v.opening_date is not null and v.opening_date <= v_month then v.opening_balance+coalesce(s.before_amount,0) end period_opening,
     coalesce(s.period_in,0) period_incoming,coalesce(s.period_out,0) period_outgoing
   from accountant_vaults v left join lateral (
     select sum(amount) filter(where direction='in') inc,sum(amount) filter(where direction='out') out,max(tx_date) last_date,
       sum(case when direction='in' then amount else -amount end) filter(where tx_date<v_month) before_amount,
       sum(amount) filter(where direction='in' and tx_date>=v_month and tx_date<v_month+interval '1 month') period_in,
       sum(amount) filter(where direction='out' and tx_date>=v_month and tx_date<v_month+interval '1 month') period_out
     from active t where t.vault_code=v.code
   ) s on true where v.is_active
 ), ledger as (
   select t.*, v.opening_balance + sum(case when t.direction='in' then t.amount else -t.amount end)
   over(partition by t.vault_code order by t.tx_date,
     coalesce(nullif(t.source_details->>'source_row','')::integer,2147483647),
     case when t.source_details->>'source_part'='in' then 0 else 1 end,
     t.base44_created_at nulls first,t.base44_id rows unbounded preceding) running_balance
   from active t join accountant_vaults v on v.code=t.vault_code
 ), monthly as (
   select to_char(m,'YYYY-MM') as month,v.code vault_code,
     case when v.opening_date is not null and v.opening_date <= m::date then
       v.opening_balance+coalesce(sum(case when t.direction='in' then t.amount else -t.amount end) filter(where t.tx_date<m::date),0) end opening,
     coalesce(sum(t.amount) filter(where t.direction='in' and t.tx_date>=m::date and t.tx_date<(m+interval '1 month')::date and t.tx_date<=v_today),0) incoming,
     coalesce(sum(t.amount) filter(where t.direction='out' and t.tx_date>=m::date and t.tx_date<(m+interval '1 month')::date and t.tx_date<=v_today),0) outgoing,
     count(t.base44_id) filter(where t.tx_date>=m::date and t.tx_date<(m+interval '1 month')::date and t.tx_date<=v_today) count
   from generate_series(v_month-interval '5 months',v_month,interval '1 month') m
   cross join accountant_vaults v left join active t on t.vault_code=v.code
   where v.is_active group by m,v.code,v.opening_date,v.opening_balance
 )
 select jsonb_build_object(
   'synced_at',(select max(ran_at) from base44_sync_run_log where source='accountant' and status='success'),
   'last_error',(select error_message from base44_sync_run_log where source='accountant' order by ran_at desc limit 1),
   'month',to_char(v_month,'YYYY-MM'),'today',v_today,
   'months',(select jsonb_agg(m order by m desc) from (select distinct to_char(tx_date,'YYYY-MM') m from accountant_transactions union select to_char(v_today,'YYYY-MM')) x),
   'vaults',coalesce((select jsonb_agg(to_jsonb(v)-'base44_id'-'synced_at' order by v.name) from vault_data v),'[]'::jsonb),
   'history',coalesce((select jsonb_agg(to_jsonb(h) order by h.month,h.vault_code) from monthly h),'[]'::jsonb),
   'transactions',coalesce((select jsonb_agg(jsonb_build_object('id',t.base44_id,'vault_code',t.vault_code,'date',t.tx_date,
     'direction',t.direction,'amount',t.amount,'classification',t.classification,'category_name',t.category_name,
     'description',t.description,'created_by_name',t.created_by_name,'running_balance',t.running_balance,
     'source_details',t.source_details,'is_offset_pair',t.is_offset_pair)
     order by t.tx_date desc,coalesce(nullif(t.source_details->>'source_row','')::integer,2147483647) desc,
       case when t.source_details->>'source_part'='in' then 0 else 1 end desc,t.base44_created_at desc nulls last,t.base44_id desc)
     from ledger t where t.tx_date>=v_month and t.tx_date<v_month+interval '1 month'),'[]'::jsonb)
 )
 );
end;
$function$;
revoke all on function public.get_accountant_report_v1(text) from public;
grant execute on function public.get_accountant_report_v1(text) to anon,authenticated;
