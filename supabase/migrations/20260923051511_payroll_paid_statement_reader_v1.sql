-- A distributable statement can only come from a paid, frozen payroll row.
create function public.get_paid_payroll_statement_v1(p_staff_id uuid,p_month_cycle text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_catalog as $$
declare v_actor public.staff_accounts%rowtype; v_row public.staff_payroll_monthly_v13%rowtype;
 v_snapshot jsonb; v_self boolean;
begin
 if p_staff_id is null or p_month_cycle !~ '^\d{4}-(0[1-9]|1[0-2])$' then
  raise exception 'invalid_statement_input' using errcode='22023'; end if;
 select * into v_actor from public.staff_accounts where id=public.dawaa_current_staff_account_id_strict()
  and coalesce(active,false) and coalesce(can_login,false);
 if not found then raise exception 'active_staff_account_required' using errcode='42501'; end if;
 v_self:=v_actor.staff_id=p_staff_id::text;
 if not v_self and (not public.dawaa_current_actor_can(array['manage_payroll'])
   or not exists(select 1 from public.staff_accounts sa where sa.staff_id=p_staff_id::text
     and public.dawaa_can_manage_payroll_staff_v1(sa.username))) then
  raise exception 'statement_not_authorized' using errcode='42501'; end if;
 select * into v_row from public.staff_payroll_monthly_v13
 where staff_id=p_staff_id and payroll_month=to_date(p_month_cycle||'-01','YYYY-MM-DD')
  and status='paid' and paid_at is not null;
 if not found then raise exception 'paid_statement_unavailable' using errcode='22023'; end if;
 v_snapshot:=v_row.approval_snapshot;
 if coalesce(v_row.freeze_version,0)<17 or v_snapshot is null
   or not (v_snapshot ? 'payroll_components') or not (v_snapshot ? 'automated_incentives')
   or (v_snapshot->>'staff_id')::uuid is distinct from p_staff_id
   or (v_snapshot->>'net_salary')::numeric is distinct from v_row.net_salary
   or v_row.cycle_start is null or v_row.cycle_end is null then
   raise exception 'paid_statement_snapshot_incomplete' using errcode='22023'; end if;
 return jsonb_build_object('id',v_row.id,'staff_id',p_staff_id,'staff_name',v_snapshot->>'staff_name',
  'branch',v_snapshot->>'branch','month_cycle',p_month_cycle,
  'cycle_start',v_row.cycle_start,'cycle_end',v_row.cycle_end,
  'approved_at',v_row.approved_at,'paid_at',v_row.paid_at,
  'freeze_version',v_row.freeze_version,'worked_hours',v_snapshot->'hours'->'worked_hours',
  'overtime_hours',v_snapshot->'hours'->'overtime_hours',
  'net_salary',v_row.net_salary,'snapshot',v_snapshot);
end $$;
revoke execute on function public.get_paid_payroll_statement_v1(uuid,text) from public;
grant execute on function public.get_paid_payroll_statement_v1(uuid,text) to anon,authenticated,service_role;
