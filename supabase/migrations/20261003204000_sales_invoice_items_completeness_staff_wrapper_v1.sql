-- Staff-session guarded wrapper for the aggregate completeness gate.
-- Browser transport may be anon, but execution requires a live opaque staff session and an authorized management role.
create or replace function public.sales_invoice_items_completeness_staff_v1(p_session_token text,p_start_at timestamptz,p_end_at timestamptz)
returns table(branch text,sales_date date,header_invoices bigint,item_invoices bigint,missing_item_invoices bigint,coverage_pct numeric,completeness_status text)
language plpgsql security definer set search_path='public','extensions' as $$
declare v_role text;
begin
 if p_end_at is null or p_start_at is null or p_end_at < p_start_at or p_end_at-p_start_at > interval '90 days' then raise exception 'invalid evidence window'; end if;
 select a.role into v_role from public.staff_login_sessions s join public.staff_accounts a on a.id=s.staff_account_id
 where s.token_hash=encode(extensions.digest(btrim(coalesce(p_session_token,'')),'sha256'),'hex') and s.revoked_at is null and s.expires_at>now()
 and coalesce(a.active,true)=true and coalesce(a.is_active,true)=true and coalesce(a.can_login,true)=true and coalesce(a.status,'active')='active' limit 1;
 if v_role is null or v_role not in ('general_manager','executive_manager','branches_manager') then raise exception 'not authorized'; end if;
 return query select * from public.sales_invoice_items_completeness_v1(p_start_at,p_end_at);
end $$;
revoke all on function public.sales_invoice_items_completeness_staff_v1(text,timestamptz,timestamptz) from public;
grant execute on function public.sales_invoice_items_completeness_staff_v1(text,timestamptz,timestamptz) to anon,authenticated;
