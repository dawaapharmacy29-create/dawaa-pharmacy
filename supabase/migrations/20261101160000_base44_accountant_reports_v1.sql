-- «التقارير المجمعة»: the three treasuries of the accountant book in the Dawaa Bills app (Base44
-- AccountantVault + AccountantTransaction), copied every 15 minutes and read by top management only.
--
-- A treasury's balance = its opening balance + incoming − outgoing (voided and sample rows left out),
-- the same figure the Bills app shows. Each sync is a full snapshot: rows deleted there go here too.

create table if not exists public.accountant_vaults (
  code text primary key,
  base44_id text not null unique,
  name text not null,
  opening_balance numeric not null default 0,
  opening_date date,
  is_active boolean not null default true,
  synced_at timestamptz not null default now()
);

create table if not exists public.accountant_transactions (
  base44_id text primary key,
  vault_code text not null,
  tx_date date not null,
  direction text not null check (direction in ('in', 'out')),
  amount numeric not null,
  category_name text,
  category_group text,
  classification text not null,
  description text,
  created_by_name text,
  is_offset_pair boolean not null default false,
  base44_created_at timestamptz,
  base44_updated_at timestamptz,
  synced_at timestamptz not null default now()
);
create index if not exists idx_accountant_transactions_vault_date on public.accountant_transactions (vault_code, tx_date desc);
create index if not exists idx_accountant_transactions_date on public.accountant_transactions (tx_date desc);

-- Read only through get_accountant_report_v1; nothing for the browser roles.
alter table public.accountant_vaults enable row level security;
alter table public.accountant_transactions enable row level security;
revoke all on public.accountant_vaults, public.accountant_transactions from anon, authenticated;

-- Import (service role only): the whole book each time.
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

  return jsonb_build_object('vaults', v_vaults, 'transactions', v_tx, 'removed', v_removed,
    'total', jsonb_array_length(p_transactions));
end;
$function$;
revoke all on function public.import_base44_accountant_v1(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.import_base44_accountant_v1(jsonb, jsonb) to service_role;

-- The report: balances of each treasury and, for one month, every movement and its category.
create or replace function public.get_accountant_report_v1(p_month text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_month date;
begin
  perform public.gm_daily_review_actor_v1();
  if p_month is not null and p_month !~ '^[0-9]{4}-[0-9]{2}$' then raise exception 'invalid_month'; end if;
  v_month := coalesce((p_month || '-01')::date,
    (select date_trunc('month', max(tx_date))::date from public.accountant_transactions),
    date_trunc('month', (now() at time zone 'Africa/Cairo'))::date);

  return jsonb_build_object(
    'synced_at', (select max(l.ran_at) from public.base44_sync_run_log l where l.source = 'accountant' and l.status = 'success'),
    'last_error', (select l.error_message from public.base44_sync_run_log l where l.source = 'accountant'
                    order by l.ran_at desc limit 1),
    'month', to_char(v_month, 'YYYY-MM'),
    'months', (select coalesce(jsonb_agg(m order by m desc), '[]'::jsonb)
               from (select distinct to_char(tx_date, 'YYYY-MM') m from public.accountant_transactions) x),
    'vaults', (select coalesce(jsonb_agg(jsonb_build_object('code', v.code, 'name', v.name,
                 'opening_balance', v.opening_balance, 'opening_date', v.opening_date,
                 'incoming', coalesce(t.incoming, 0), 'outgoing', coalesce(t.outgoing, 0),
                 'balance', v.opening_balance + coalesce(t.incoming, 0) - coalesce(t.outgoing, 0),
                 'last_date', t.last_date) order by v.name), '[]'::jsonb)
               from public.accountant_vaults v
               left join lateral (
                 select sum(amount) filter (where direction = 'in') incoming,
                        sum(amount) filter (where direction = 'out') outgoing, max(tx_date) last_date
                 from public.accountant_transactions where vault_code = v.code
               ) t on true
               where v.is_active),
    'transactions', (select coalesce(jsonb_agg(jsonb_build_object('id', t.base44_id, 'vault_code', t.vault_code,
                       'date', t.tx_date, 'direction', t.direction, 'amount', t.amount,
                       'classification', t.classification, 'category_name', t.category_name,
                       'description', t.description, 'created_by_name', t.created_by_name)
                       order by t.tx_date desc, t.base44_created_at desc), '[]'::jsonb)
                     from public.accountant_transactions t
                     where t.tx_date >= v_month and t.tx_date < (v_month + interval '1 month')::date)
  );
end;
$function$;
revoke all on function public.get_accountant_report_v1(text) from public, anon;
grant execute on function public.get_accountant_report_v1(text) to authenticated;
