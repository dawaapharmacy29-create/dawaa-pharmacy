create function public.list_my_paid_payroll_statements_v1()
returns jsonb language plpgsql stable security definer set search_path=public,pg_catalog as $$
declare v_actor public.staff_accounts%rowtype; v_rows jsonb;
begin
 select * into v_actor from public.staff_accounts where id=public.dawaa_current_staff_account_id_strict()
   and coalesce(active,false) and coalesce(can_login,false);
 if not found or v_actor.staff_id is null then
   raise exception 'staff_account_required' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.payroll_month desc),'[]'::jsonb) into v_rows
 from (select to_char(payroll_month,'YYYY-MM') month_cycle,payroll_month,cycle_start,cycle_end,net_salary,paid_at
   from public.staff_payroll_monthly_v13
   where staff_id::text=v_actor.staff_id and status='paid' and paid_at is not null
     and freeze_version>=17 and approval_snapshot ? 'payroll_components'
   order by payroll_month desc limit 12) r;
 return v_rows;
end $$;
revoke execute on function public.list_my_paid_payroll_statements_v1() from public;
grant execute on function public.list_my_paid_payroll_statements_v1() to anon,authenticated,service_role;
