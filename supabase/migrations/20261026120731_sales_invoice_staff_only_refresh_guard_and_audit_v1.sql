-- Production migration 20261026120731, mirrored from the verified apply.
-- Do not recompute customer or daily-followup metrics when only staff attribution changes.
create or replace function public.refresh_customer_metrics_after_sales_invoice_update_v1()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $function$
declare v_codes text[];
begin
  if not exists (
    select 1 from new_rows n full join old_rows o using (id)
    where n.id is null or o.id is null
       or (to_jsonb(n) - 'staff_id' - 'updated_at')
          is distinct from (to_jsonb(o) - 'staff_id' - 'updated_at')
  ) then return null; end if;
  select array_agg(distinct code) into v_codes from (
    select btrim(customer_code) code from new_rows where nullif(btrim(customer_code), '') is not null
    union select btrim(customer_code) code from old_rows where nullif(btrim(customer_code), '') is not null
  ) s;
  perform public.refresh_customer_metrics_for_codes_v1(v_codes);
  return null;
end;
$function$;

create or replace function public.refresh_followup_metrics_after_sales_invoice_update_v2()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $function$
declare v_codes text[];
begin
  if not exists (
    select 1 from new_rows n full join old_rows o using (id)
    where n.id is null or o.id is null
       or (to_jsonb(n) - 'staff_id' - 'updated_at')
          is distinct from (to_jsonb(o) - 'staff_id' - 'updated_at')
  ) then return null; end if;
  select array_agg(distinct code) into v_codes from (
    select btrim(customer_code) code from new_rows where nullif(btrim(customer_code), '') is not null
    union select btrim(customer_code) code from old_rows where nullif(btrim(customer_code), '') is not null
  ) s;
  perform public.refresh_daily_followup_customer_metrics_for_codes_v2(v_codes);
  return null;
end;
$function$;

create table if not exists public.sales_invoice_staff_identity_backfill_audit_v1 (
  id bigint generated always as identity primary key,
  batch_key text not null,
  invoice_id text not null,
  invoice_number text,
  invoice_date timestamptz not null,
  branch text not null,
  seller_name text not null,
  old_staff_id text,
  new_staff_id text not null,
  evidence text not null,
  created_at timestamptz not null default now(),
  unique (batch_key, invoice_id)
);
alter table public.sales_invoice_staff_identity_backfill_audit_v1 enable row level security;
revoke all on table public.sales_invoice_staff_identity_backfill_audit_v1 from public, anon, authenticated;
revoke all on sequence public.sales_invoice_staff_identity_backfill_audit_v1_id_seq from public, anon, authenticated;
