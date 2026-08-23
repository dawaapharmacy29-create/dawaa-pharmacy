create or replace function public.dawaa_can_write_employee_transaction(p_source text, p_type text, p_is_update boolean default false)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source text := lower(trim(coalesce(p_source, '')));
  v_type text := lower(trim(coalesce(p_type, '')));
begin
  if public.dawaa_current_staff_account_id_strict() is null then
    return false;
  end if;

  if v_source in ('conversation_evaluation','conversation_review','conversation_sales_reviews') then
    if p_is_update then
      return public.dawaa_current_actor_can(array['add_reviews','edit_reviews','approve_reviews']);
    end if;
    return public.dawaa_current_actor_can(array['add_reviews']);
  end if;

  if v_source = 'branch_visit' then
    return public.dawaa_can_branch_inspection(true);
  end if;

  if v_source = 'shift_review' then
    if p_is_update then
      return public.dawaa_current_actor_can(array['edit_shift_evaluation','approve_shift_evaluation']);
    end if;
    return public.dawaa_current_actor_can(array['create_shift_evaluation']);
  end if;

  if v_source = 'time_off' then
    return public.dawaa_current_actor_can(array['approve_leave_request','manage_time_off']);
  end if;

  if v_source in ('manual_admin','manual') then
    if p_is_update then
      return public.dawaa_current_actor_can(array['approve_points','edit_points_transaction','manage_points']);
    end if;
    if v_type = 'penalty' then
      return public.dawaa_current_actor_can(array['create_deduction','manage_points']);
    end if;
    return public.dawaa_current_actor_can(array['create_reward','manage_points']);
  end if;

  if v_source = 'stagnant_medicine_dispense' then
    return public.dawaa_current_actor_can(array['view_stagnant_medicines']);
  end if;

  if v_source = 'incentive_medicines' then
    return public.dawaa_current_actor_can(array['view_incentive_medicines']);
  end if;

  -- Remaining transitional/automated sources that are still present in active data flows.
  if v_source in (
    'followup_activity_pillar', 'followup_expire_auto',
    'invoice_quality_vs_branch_baseline',
    'assistant_checklist_settlement', 'target_achievement_settlement'
  ) then
    return true;
  end if;

  return false;
end;
$$;

grant execute on function public.dawaa_can_write_employee_transaction(text,text,boolean) to anon, authenticated;
