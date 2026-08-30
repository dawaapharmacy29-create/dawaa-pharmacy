-- Atomic next-payroll settlement: exactly-once application of post-paid adjustments.

create unique index if not exists staff_payroll_adjustment_applications_v1_adjustment_uidx
  on public.staff_payroll_adjustment_applications_v1(adjustment_id);

alter table public.staff_payroll_monthly_v13
  add column if not exists post_paid_adjustments_total numeric not null default 0;

create or replace function public.save_staff_payroll_monthly_v16(
  p_staff_username text,
  p_payroll_month date,
  p_worked_hours numeric default 0,
  p_overtime_hours numeric default 0,
  p_quarterly_bonus numeric default 0,
  p_incentives_total numeric default 0,
  p_deductions_total numeric default 0,
  p_manual_adjustment numeric default 0,
  p_notes text default null,
  p_status text default 'draft'
) returns public.staff_payroll_monthly_v13
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_status text := lower(trim(coalesce(p_status,'draft')));
  v_staff_id uuid;
  v_existing public.staff_payroll_monthly_v13%rowtype;
  v_saved public.staff_payroll_monthly_v13%rowtype;
  v_actor_id text := public.employee_operating_actor_id();
  v_actor_name text;
  v_settlement_total numeric := 0;
  v_effective_manual numeric := coalesce(p_manual_adjustment,0);
  v_adjustments jsonb := '[]'::jsonb;
  v_row record;
  v_application_id uuid;
begin
  if coalesce(trim(p_staff_username),'')='' or p_payroll_month is null then
    raise exception 'invalid_payroll_input' using errcode='22023';
  end if;

  select s.id
    into v_staff_id
  from public.staff_accounts sa
  join public.staff s on s.id::text=sa.staff_id::text
  where sa.username=p_staff_username
  order by coalesce(sa.active,true) desc,sa.created_at desc nulls last
  limit 1;
  if v_staff_id is null then
    raise exception 'payroll_staff_identity_missing' using errcode='22023';
  end if;

  if not public.dawaa_can_manage_payroll_staff_v1(p_staff_username) then
    raise exception 'not_authorized_for_payroll_staff' using errcode='42501';
  end if;

  select * into v_existing
  from public.staff_payroll_monthly_v13
  where staff_username=p_staff_username and payroll_month=p_payroll_month
  for update;

  -- Approved/Paid rows are frozen. Repeated calls never attach newly-created adjustments retroactively.
  if found and coalesce(v_existing.status,'draft') in ('approved','paid') then
    if v_status=coalesce(v_existing.status,'draft') then
      return v_existing;
    end if;
    if coalesce(v_existing.status,'draft')='approved' and v_status='paid' then
      return public.save_staff_payroll_monthly_v15(
        p_staff_username,p_payroll_month,p_worked_hours,p_overtime_hours,p_quarterly_bonus,p_incentives_total,
        p_deductions_total,p_manual_adjustment,p_notes,p_status
      );
    end if;
    raise exception 'frozen_payroll_cannot_be_reopened' using errcode='55000';
  end if;

  -- Only the approval transition consumes outstanding next_payroll adjustments.
  if v_status='approved' then
    for v_row in
      select a.id,a.amount,a.category,a.reason,a.reference_note,a.source_payroll_id,a.source_payroll_month,a.reversal_of,a.created_at
      from public.staff_payroll_adjustments_v1 a
      where a.staff_id=v_staff_id
        and a.apply_mode='next_payroll'
        and a.source_payroll_month < p_payroll_month
        and not exists (
          select 1 from public.staff_payroll_adjustment_applications_v1 ap
          where ap.adjustment_id=a.id
        )
      order by a.created_at,a.id
      for update
    loop
      v_settlement_total := v_settlement_total + coalesce(v_row.amount,0);
      v_adjustments := v_adjustments || jsonb_build_array(jsonb_build_object(
        'adjustment_id',v_row.id,
        'amount',v_row.amount,
        'category',v_row.category,
        'reason',v_row.reason,
        'reference_note',v_row.reference_note,
        'source_payroll_id',v_row.source_payroll_id,
        'source_payroll_month',v_row.source_payroll_month,
        'reversal_of',v_row.reversal_of,
        'created_at',v_row.created_at
      ));
    end loop;
    v_effective_manual := coalesce(p_manual_adjustment,0) + v_settlement_total;
  end if;

  v_saved := public.save_staff_payroll_monthly_v15(
    p_staff_username,p_payroll_month,p_worked_hours,p_overtime_hours,p_quarterly_bonus,p_incentives_total,
    p_deductions_total,v_effective_manual,p_notes,p_status
  );

  if v_status='approved' and v_saved.id is not null then
    select coalesce(sa.name,sa.staff_name,sa.username)
      into v_actor_name
    from public.staff_accounts sa
    where sa.id::text=v_actor_id
    limit 1;

    -- Insert exactly one immutable application row per consumed adjustment.
    for v_row in
      select x.*
      from jsonb_to_recordset(v_adjustments) as x(
        adjustment_id uuid,
        amount numeric,
        category text,
        reason text,
        reference_note text,
        source_payroll_id uuid,
        source_payroll_month date,
        reversal_of uuid,
        created_at timestamptz
      )
    loop
      insert into public.staff_payroll_adjustment_applications_v1(
        adjustment_id,target_payroll_id,amount,applied_by,applied_by_name,applied_at,metadata
      ) values (
        v_row.adjustment_id,v_saved.id,v_row.amount,coalesce(v_actor_id,'system'),v_actor_name,now(),
        jsonb_build_object('engine_version',16,'mode','next_payroll_atomic','target_payroll_month',p_payroll_month)
      )
      returning id into v_application_id;
    end loop;

    update public.staff_payroll_monthly_v13
    set post_paid_adjustments_total=v_settlement_total,
        approval_snapshot=coalesce(approval_snapshot,'{}'::jsonb)||jsonb_build_object(
          'engine_version',16,
          'manual_adjustment_input',coalesce(p_manual_adjustment,0),
          'post_paid_adjustments_total',v_settlement_total,
          'effective_manual_adjustment',v_effective_manual,
          'post_paid_adjustments',v_adjustments,
          'settlement_mode','next_payroll_atomic_v1'
        ),
        freeze_version=16,
        updated_at=now()
    where id=v_saved.id and status='approved'
    returning * into v_saved;
  end if;

  return v_saved;
end;
$$;

-- Keep existing UI/API name as the single compatibility facade; no bypass around v16.
create or replace function public.save_staff_payroll_monthly_v14(
  p_staff_username text,
  p_payroll_month date,
  p_worked_hours numeric default 0,
  p_overtime_hours numeric default 0,
  p_quarterly_bonus numeric default 0,
  p_incentives_total numeric default 0,
  p_deductions_total numeric default 0,
  p_manual_adjustment numeric default 0,
  p_notes text default null,
  p_status text default 'draft'
) returns public.staff_payroll_monthly_v13
language sql
security definer
set search_path = public, pg_catalog
as $$
  select public.save_staff_payroll_monthly_v16(
    p_staff_username,p_payroll_month,p_worked_hours,p_overtime_hours,p_quarterly_bonus,p_incentives_total,
    p_deductions_total,p_manual_adjustment,p_notes,p_status
  );
$$;

revoke all on function public.save_staff_payroll_monthly_v16(text,date,numeric,numeric,numeric,numeric,numeric,numeric,text,text) from public,anon,authenticated;
grant execute on function public.save_staff_payroll_monthly_v16(text,date,numeric,numeric,numeric,numeric,numeric,numeric,text,text) to service_role;

-- v15 becomes internal so callers cannot bypass settlement.
revoke all on function public.save_staff_payroll_monthly_v15(text,date,numeric,numeric,numeric,numeric,numeric,numeric,text,text) from public,anon,authenticated;
grant execute on function public.save_staff_payroll_monthly_v15(text,date,numeric,numeric,numeric,numeric,numeric,numeric,text,text) to service_role;

revoke all on function public.save_staff_payroll_monthly_v14(text,date,numeric,numeric,numeric,numeric,numeric,numeric,text,text) from public,anon,authenticated;
grant execute on function public.save_staff_payroll_monthly_v14(text,date,numeric,numeric,numeric,numeric,numeric,numeric,text,text) to anon,authenticated,service_role;
