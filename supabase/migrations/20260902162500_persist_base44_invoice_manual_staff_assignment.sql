create or replace function public.assign_base44_invoice_entered_by_v1(
  p_sync_id uuid,
  p_staff_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_account public.staff_accounts%rowtype;
  v_sync public.base44_purchase_invoice_sync%rowtype;
  v_staff_branch text;
begin
  select sa.* into v_account
  from public.staff_accounts sa
  where sa.id = public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active, false)
    and coalesce(sa.can_login, false);

  if not found then
    raise exception using errcode = '42501', message = 'active staff actor required';
  end if;

  if not public.dawaa_is_customer_service_evaluator_v1(
    public.dawaa_current_staff_subject_uuid_v1(),
    lower(trim(coalesce(v_account.role, '')))
  ) then
    raise exception using errcode = '42501', message = 'purchase invoice review permission required';
  end if;

  select b.* into v_sync
  from public.base44_purchase_invoice_sync b
  where b.id = p_sync_id
    and b.review_id is null;

  if not found then
    raise exception using errcode = '22023', message = 'pending synced invoice not found';
  end if;

  select s.branch into v_staff_branch
  from public.staff s
  where s.id = p_staff_id
    and coalesce(s.active, false);

  if not found then
    raise exception using errcode = '22023', message = 'target staff member not found or inactive';
  end if;

  if nullif(trim(coalesce(v_sync.branch, '')), '') is not null
     and nullif(trim(coalesce(v_staff_branch, '')), '') is not null
     and trim(v_sync.branch) <> trim(v_staff_branch) then
    raise exception using errcode = '22023', message = 'staff branch does not match invoice branch';
  end if;

  update public.base44_purchase_invoice_sync
  set entered_by_staff_id = p_staff_id,
      match_status = 'matched'
  where id = p_sync_id;

  return true;
end;
$$;

revoke all on function public.assign_base44_invoice_entered_by_v1(uuid, uuid) from public, anon, authenticated;
grant execute on function public.assign_base44_invoice_entered_by_v1(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
