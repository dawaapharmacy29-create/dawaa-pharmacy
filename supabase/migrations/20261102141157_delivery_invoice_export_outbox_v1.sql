-- Commit-coupled, retryable export of canonical invoices. No invoice/accounting writes.
create table public.delivery_invoice_export_jobs (
 period_start date primary key, revision bigint not null default 1, processed_revision bigint not null default 0,
 changed_at timestamptz not null default now(), due_at timestamptz not null default now()+interval '45 seconds',
 lease_id uuid, lease_until timestamptz, last_success_at timestamptz, last_error text, last_result jsonb,
 check (extract(day from period_start)=26)
);
alter table public.delivery_invoice_export_jobs enable row level security;
revoke all on public.delivery_invoice_export_jobs from public,anon,authenticated;

create or replace function public.delivery_invoice_open_cycle_v1() returns date
language sql stable set search_path='' as $$
 select case when extract(day from (now() at time zone 'Africa/Cairo'))>=26
 then (date_trunc('month',now() at time zone 'Africa/Cairo')+interval '25 days')::date
 else (date_trunc('month',now() at time zone 'Africa/Cairo')-interval '1 month'+interval '25 days')::date end;
$$;
revoke all on function public.delivery_invoice_open_cycle_v1() from public,anon,authenticated;
grant execute on function public.delivery_invoice_open_cycle_v1() to service_role;

create or replace function public.queue_delivery_invoice_export_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_start date := public.delivery_invoice_open_cycle_v1(); v_dirty boolean;
begin
 if TG_OP='INSERT' then
  select exists(select 1 from new_invoices where sale_date>=v_start and sale_date<(v_start+interval '1 month')::date) into v_dirty;
 elsif TG_OP='DELETE' then
  select exists(select 1 from old_invoices where sale_date>=v_start and sale_date<(v_start+interval '1 month')::date) into v_dirty;
 else
  select exists(select 1 from new_invoices where sale_date>=v_start and sale_date<(v_start+interval '1 month')::date)
   or exists(select 1 from old_invoices where sale_date>=v_start and sale_date<(v_start+interval '1 month')::date) into v_dirty;
 end if;
 if v_dirty then
  insert into public.delivery_invoice_export_jobs(period_start) values(v_start)
  on conflict(period_start) do update set revision=delivery_invoice_export_jobs.revision+1,
   changed_at=now(),due_at=now()+interval '45 seconds';
 end if;
 return null;
end; $$;
revoke all on function public.queue_delivery_invoice_export_v1() from public,anon,authenticated;
create trigger delivery_invoice_export_insert after insert on public.sales_invoices referencing new table as new_invoices for each statement execute function public.queue_delivery_invoice_export_v1();
create trigger delivery_invoice_export_update after update on public.sales_invoices referencing old table as old_invoices new table as new_invoices for each statement execute function public.queue_delivery_invoice_export_v1();
create trigger delivery_invoice_export_delete after delete on public.sales_invoices referencing old table as old_invoices for each statement execute function public.queue_delivery_invoice_export_v1();

create or replace function public.claim_delivery_invoice_export_v1() returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.delivery_invoice_export_jobs; rows jsonb; v_lease uuid := gen_random_uuid();
begin
 select * into j from public.delivery_invoice_export_jobs
 where period_start=public.delivery_invoice_open_cycle_v1() and due_at<=now()
 and (lease_until is null or lease_until<now())
 and (revision>processed_revision or last_success_at<now()-interval '5 minutes')
 order by due_at limit 1 for update skip locked;
 if not found then return null; end if;
 if (select count(*) from public.sales_invoices where sale_date>=j.period_start and sale_date<(j.period_start+interval '1 month')::date)>30000 then
  raise exception 'delivery_export_cycle_too_large'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
 'source_id',s.id,'invoice_number',coalesce(nullif(s.invoice_number,''),s.invoice_no),
 'branch_name',coalesce(nullif(s.branch_name,''),s.branch),'invoice_date',s.sale_date,
 'invoice_type',s.invoice_type,'customer_code',s.customer_code,'customer_name',s.customer_name,
 'customer_phone',s.customer_phone,'net_total',coalesce(s.net_total,s.net_amount,s.amount),
 'gross_total',coalesce(s.gross_total,s.gross_amount,s.amount),'delivery_address',s.delivery_address,
 'system_user_name',s.seller_name) order by s.id),'[]') into rows
 from public.sales_invoices s where s.sale_date>=j.period_start and s.sale_date<(j.period_start+interval '1 month')::date
 and s.import_validation_status='valid' and s.save_status='تم حفظها';
 update public.delivery_invoice_export_jobs set lease_id=v_lease,lease_until=now()+interval '5 minutes' where period_start=j.period_start;
 return jsonb_build_object('period_start',j.period_start,'period_end',(j.period_start+interval '1 month'-interval '1 day')::date,
 'revision',j.revision,'lease_id',v_lease,'rows',rows);
end; $$;
revoke all on function public.claim_delivery_invoice_export_v1() from public,anon,authenticated;
grant execute on function public.claim_delivery_invoice_export_v1() to service_role;

create or replace function public.finish_delivery_invoice_export_v1(p_start date,p_revision bigint,p_lease uuid,p_result jsonb,p_error text default null) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 update public.delivery_invoice_export_jobs set
 processed_revision=case when p_error is null then greatest(processed_revision,p_revision) else processed_revision end,
 last_success_at=case when p_error is null then now() else last_success_at end,
 last_result=case when p_error is null then p_result else last_result end,last_error=left(p_error,500),
 due_at=case when p_error is null and revision=p_revision then now()+interval '5 minutes' else now()+interval '1 minute' end,
 lease_id=null,lease_until=null where period_start=p_start and lease_id=p_lease;
 return found;
end; $$;
revoke all on function public.finish_delivery_invoice_export_v1(date,bigint,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.finish_delivery_invoice_export_v1(date,bigint,uuid,jsonb,text) to service_role;

create or replace function public.delivery_invoice_bridge_config_v1() returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_object_agg(name,decrypted_secret) from vault.decrypted_secrets
 where name in ('delivery_invoice_bridge_key','delivery_invoice_publishable_key');
$$;
revoke all on function public.delivery_invoice_bridge_config_v1() from public,anon,authenticated;
grant execute on function public.delivery_invoice_bridge_config_v1() to service_role;

create or replace function public.get_delivery_invoice_sync_status_v1() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform public.gm_daily_review_actor_v1();
 return (select jsonb_build_object('period_start',period_start,'revision',revision,'processed_revision',processed_revision,
 'last_success_at',last_success_at,'last_error',last_error,'result',last_result) from public.delivery_invoice_export_jobs
 where period_start=public.delivery_invoice_open_cycle_v1());
end; $$;
revoke all on function public.get_delivery_invoice_sync_status_v1() from public;
grant execute on function public.get_delivery_invoice_sync_status_v1() to anon,authenticated;
