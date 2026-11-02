-- Enabling this scheduler is the final rollout step, after receiver/key/worker verification.
create or replace function public.dispatch_delivery_invoice_sync_v1() returns bigint
language plpgsql security definer set search_path='' as $$
declare v_key text; request_id bigint;
begin
 select decrypted_secret into v_key from vault.decrypted_secrets where name='delivery_invoice_bridge_key';
 if v_key is null then raise exception 'delivery_bridge_not_configured'; end if;
 select net.http_post(url:='https://jkjqeqkshllustwlzzbf.supabase.co/functions/v1/delivery-invoice-sync',
 headers:=jsonb_build_object('Content-Type','application/json','x-dawaa-integration-key',v_key),
 body:='{}'::jsonb,timeout_milliseconds:=120000) into request_id;
 return request_id;
end; $$;
revoke all on function public.dispatch_delivery_invoice_sync_v1() from public,anon,authenticated;
grant execute on function public.dispatch_delivery_invoice_sync_v1() to service_role;
select cron.schedule('delivery-invoice-auto-match-minute','* * * * *','select public.dispatch_delivery_invoice_sync_v1();');
-- Initial reconciliation is restricted to the current open cycle; historical financial cycles stay untouched.
insert into public.delivery_invoice_export_jobs(period_start) values(public.delivery_invoice_open_cycle_v1()) on conflict do nothing;
