-- Close the production exposure found during the final security review.
-- Keep operational data intact, remove browser access to internal tables, and
-- move the staff checklist write lifecycle behind canonical actor commands.

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'app_refresh_flags',
    'daily_checklist_task_responsibility',
    'doctor_voucher_allocations',
    'pillar_competition_bonuses',
    'sales_invoices_cycle_backup_20260825_final',
    'sales_invoices_reconcile_stage_20260825_final',
    'staff_daily_checklist_items',
    'staff_daily_checklist_submissions'
  ]
  loop
    if to_regclass('public.' || v_table) is not null then
      execute format('alter table public.%I enable row level security', v_table);
      execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
    end if;
  end loop;
end
$$;

create or replace function public.dawaa_can_read_staff_checklist_v1(
  p_staff_id uuid,
  p_branch text
) returns boolean
language plpgsql
stable
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  v_account_id uuid;
  v_subject_id uuid;
  v_role text;
  v_branch text;
begin
  v_account_id := public.dawaa_current_staff_account_id_strict();
  v_subject_id := public.dawaa_current_staff_subject_uuid_v1();
  if v_account_id is null or v_subject_id is null then return false; end if;

  select lower(trim(coalesce(role,''))), trim(coalesce(branch,''))
    into v_role, v_branch
  from public.staff_accounts
  where id = v_account_id and coalesce(active,false) and coalesce(can_login,false);
  if not found then return false; end if;

  if p_staff_id = v_subject_id then return true; end if;
  if not public.user_has_permission(v_account_id, 'view_team') then return false; end if;
  if v_role in ('general_manager','executive_manager','branches_manager','admin') then return true; end if;
  return public.dawaa_review_coverage_branch_key_v1(v_branch)
       = public.dawaa_review_coverage_branch_key_v1(p_branch);
end;
$$;

create or replace function public.submit_my_staff_daily_checklist_v1(
  p_item_id uuid,
  p_photo_url text default null,
  p_staff_note text default null
) returns public.staff_daily_checklist_submissions
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  v_account public.staff_accounts%rowtype;
  v_subject_id uuid;
  v_item public.staff_daily_checklist_items%rowtype;
  v_today date := (timezone('Africa/Cairo', now()))::date;
  v_row public.staff_daily_checklist_submissions%rowtype;
begin
  select * into v_account
  from public.staff_accounts
  where id = public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false) and coalesce(can_login,false);
  if not found then raise exception using errcode='42501', message='active staff actor required'; end if;

  v_subject_id := public.dawaa_current_staff_subject_uuid_v1();
  if v_subject_id is null then raise exception using errcode='42501', message='canonical staff identity required'; end if;

  select * into v_item from public.staff_daily_checklist_items
  where id = p_item_id and active = true;
  if not found then raise exception using errcode='22023', message='active checklist item required'; end if;
  if v_item.requires_photo and nullif(trim(coalesce(p_photo_url,'')),'') is null then
    raise exception using errcode='22023', message='checklist evidence photo required';
  end if;

  insert into public.staff_daily_checklist_submissions(
    staff_id,item_id,submission_date,branch,completed,photo_url,staff_note,
    submitted_at,review_status,reviewed_by,reviewed_by_name,reviewer_note,reviewed_at
  ) values (
    v_subject_id,p_item_id,v_today,trim(coalesce(v_account.branch,'')),true,
    nullif(trim(coalesce(p_photo_url,'')),''),nullif(trim(coalesce(p_staff_note,'')),''),
    now(),'pending',null,null,null,null
  )
  on conflict (staff_id,item_id,submission_date) do update set
    branch=excluded.branch,
    completed=true,
    photo_url=excluded.photo_url,
    staff_note=excluded.staff_note,
    submitted_at=excluded.submitted_at,
    review_status='pending',
    reviewed_by=null,
    reviewed_by_name=null,
    reviewer_note=null,
    reviewed_at=null,
    updated_at=now()
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.review_staff_daily_checklist_v1(
  p_submission_id uuid,
  p_status text,
  p_reviewer_note text default null
) returns public.staff_daily_checklist_submissions
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  v_account public.staff_accounts%rowtype;
  v_target public.staff_daily_checklist_submissions%rowtype;
  v_row public.staff_daily_checklist_submissions%rowtype;
  v_role text;
begin
  if p_status not in ('approved','rejected') then
    raise exception using errcode='22023', message='invalid checklist review status';
  end if;

  select * into v_account
  from public.staff_accounts
  where id = public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false) and coalesce(can_login,false);
  if not found then raise exception using errcode='42501', message='active staff actor required'; end if;

  select * into v_target from public.staff_daily_checklist_submissions
  where id = p_submission_id for update;
  if not found then raise exception using errcode='22023', message='checklist submission not found'; end if;

  v_role := lower(trim(coalesce(v_account.role,'')));
  if not public.user_has_permission(v_account.id,'view_team') then
    raise exception using errcode='42501', message='checklist review permission required';
  end if;
  if v_role not in ('general_manager','executive_manager','branches_manager','admin')
     and public.dawaa_review_coverage_branch_key_v1(v_account.branch)
         <> public.dawaa_review_coverage_branch_key_v1(v_target.branch) then
    raise exception using errcode='42501', message='checklist review branch scope denied';
  end if;

  update public.staff_daily_checklist_submissions set
    review_status=p_status,
    reviewed_by=v_account.id,
    reviewed_by_name=coalesce(nullif(trim(v_account.staff_name),''),nullif(trim(v_account.name),''),v_account.username),
    reviewer_note=case when p_status='rejected' then nullif(trim(coalesce(p_reviewer_note,'')),'') else null end,
    reviewed_at=now(),
    updated_at=now()
  where id=p_submission_id
  returning * into v_row;
  return v_row;
end;
$$;

drop policy if exists staff_daily_checklist_items_scoped_select_v1 on public.staff_daily_checklist_items;
create policy staff_daily_checklist_items_scoped_select_v1
on public.staff_daily_checklist_items for select to anon,authenticated
using (active and public.dawaa_current_staff_account_id_strict() is not null);

drop policy if exists staff_daily_checklist_submissions_scoped_select_v1 on public.staff_daily_checklist_submissions;
create policy staff_daily_checklist_submissions_scoped_select_v1
on public.staff_daily_checklist_submissions for select to anon,authenticated
using (public.dawaa_can_read_staff_checklist_v1(staff_id,branch));

drop policy if exists doctor_voucher_allocations_self_select_v1 on public.doctor_voucher_allocations;
create policy doctor_voucher_allocations_self_select_v1
on public.doctor_voucher_allocations for select to anon,authenticated
using (doctor_id = public.dawaa_current_staff_subject_uuid_v1());

grant select on public.staff_daily_checklist_items to anon,authenticated;
grant select on public.staff_daily_checklist_submissions to anon,authenticated;
grant select on public.doctor_voucher_allocations to anon,authenticated;

create or replace function public.redeem_doctor_voucher(
  p_voucher_id uuid,
  p_customer_id text,
  p_customer_code text,
  p_customer_name text,
  p_invoice_number text default null,
  p_used_by uuid default null
) returns table(success boolean,message text,movement_id uuid)
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  v_actor_id uuid;
  v_subject_id uuid;
  v_voucher public.doctor_voucher_allocations%rowtype;
  v_budget_id uuid;
  v_movement_id uuid;
begin
  v_actor_id := public.dawaa_current_staff_account_id_strict();
  v_subject_id := public.dawaa_current_staff_subject_uuid_v1();
  if v_actor_id is null or v_subject_id is null then
    raise exception using errcode='42501', message='active staff actor required';
  end if;

  select * into v_voucher from public.doctor_voucher_allocations
  where id=p_voucher_id and doctor_id=v_subject_id for update;
  if not found then return query select false,'الفاوتشر غير موجود أو لا يخص حسابك',null::uuid; return; end if;
  if v_voucher.status='used' then return query select false,'الفاوتشر ده اتصرف قبل كده',null::uuid; return; end if;
  if nullif(trim(coalesce(p_customer_code,'')),'') is null then
    return query select false,'كود العميل مطلوب لصرف الفاوتشر',null::uuid; return;
  end if;
  if exists(select 1 from public.doctor_voucher_allocations
            where month_cycle=v_voucher.month_cycle and customer_code=trim(p_customer_code) and status='used') then
    return query select false,'العميل ده أخد فاوتشر تاني في نفس الشهر بالفعل',null::uuid; return;
  end if;

  v_budget_id := public.ensure_branch_voucher_budget(v_voucher.branch);
  insert into public.customer_service_credit_movements(
    budget_id,responsible_id,responsible_name,branch,customer_id,customer_code,customer_name,
    invoice_number,amount,reason,status,created_by,approved_at
  ) values (
    v_budget_id,v_voucher.doctor_id,v_voucher.doctor_name,v_voucher.branch,
    nullif(trim(coalesce(p_customer_id,'')),'')::uuid,trim(p_customer_code),nullif(trim(coalesce(p_customer_name,'')),''),
    nullif(trim(coalesce(p_invoice_number,'')),''),v_voucher.tier_value,
    format('فاوتشر دكتور %s - %s ج',v_voucher.doctor_name,v_voucher.tier_value),
    'approved',v_actor_id,now()
  ) returning id into v_movement_id;

  update public.doctor_voucher_allocations set
    status='used',customer_id=nullif(trim(coalesce(p_customer_id,'')),''),customer_code=trim(p_customer_code),
    customer_name=nullif(trim(coalesce(p_customer_name,'')),''),used_at=now(),credit_movement_id=v_movement_id,
    used_by=v_actor_id,updated_at=now()
  where id=p_voucher_id;
  return query select true,'تم صرف الفاوتشر بنجاح',v_movement_id;
end;
$$;

-- Internal settlement and refresh helpers are not browser APIs.
revoke all on function public.ensure_branch_voucher_budget(text,date) from public,anon,authenticated;
revoke all on function public.ensure_doctor_vouchers_for_month(text) from public,anon,authenticated;
revoke all on function public.refresh_pillar_competitions(text) from public,anon,authenticated;
revoke all on function public.check_and_run_pending_monthly_refresh() from public,anon,authenticated;
revoke all on function public.settle_checklist_review(uuid) from public,anon,authenticated;
revoke all on function public.settle_checklist_weekly_excellence() from public,anon,authenticated;
revoke all on function public.trg_checklist_review_settlement() from public,anon,authenticated;

revoke all on function public.dawaa_can_read_staff_checklist_v1(uuid,text) from public;
revoke all on function public.submit_my_staff_daily_checklist_v1(uuid,text,text) from public;
revoke all on function public.review_staff_daily_checklist_v1(uuid,text,text) from public;
revoke all on function public.redeem_doctor_voucher(uuid,text,text,text,text,uuid) from public;
grant execute on function public.dawaa_can_read_staff_checklist_v1(uuid,text) to anon,authenticated;
grant execute on function public.submit_my_staff_daily_checklist_v1(uuid,text,text) to anon,authenticated;
grant execute on function public.review_staff_daily_checklist_v1(uuid,text,text) to anon,authenticated;
grant execute on function public.redeem_doctor_voucher(uuid,text,text,text,text,uuid) to anon,authenticated;

grant execute on function public.ensure_branch_voucher_budget(text,date) to service_role;
grant execute on function public.ensure_doctor_vouchers_for_month(text) to service_role;
grant execute on function public.refresh_pillar_competitions(text) to service_role;
grant execute on function public.check_and_run_pending_monthly_refresh() to service_role;
grant execute on function public.settle_checklist_review(uuid) to service_role;
grant execute on function public.settle_checklist_weekly_excellence() to service_role;

notify pgrst, 'reload schema';
