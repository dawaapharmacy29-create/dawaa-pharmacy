create or replace function public.get_user_permissions(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_staff_account_id uuid;
  v_role text;
  v_allowed_pages text[];
  v_account_permissions jsonb := '{}'::jsonb;
  v_role_json jsonb := '{}'::jsonb;
  v_pages_json jsonb := '{}'::jsonb;
  v_override_json jsonb := '{}'::jsonb;
  v_effective jsonb := '{}'::jsonb;
  v_role_key text;
  v_can_view_reviews boolean := false;
  v_can_add_reviews boolean := false;
  v_can_edit_reviews boolean := false;
  v_can_approve_reviews boolean := false;
  v_can_delete_reviews boolean := false;
  v_can_view_shift_performance boolean := false;
  v_can_create_shift_evaluation boolean := false;
  v_can_edit_shift_evaluation boolean := false;
  v_can_approve_shift_evaluation boolean := false;
  v_can_delete_shift_evaluation boolean := false;
  v_can_view_points boolean := false;
  v_can_manage_points boolean := false;
  v_can_approve_points boolean := false;
  v_can_create_reward boolean := false;
  v_can_create_deduction boolean := false;
  v_can_edit_points_transaction boolean := false;
  v_can_export_points_report boolean := false;
begin
  select id, role, allowed_pages, coalesce(permissions, '{}'::jsonb)
  into v_staff_account_id, v_role, v_allowed_pages, v_account_permissions
  from public.staff_accounts
  where (id = p_user_id or auth_user_id = p_user_id)
    and coalesce(active, false)
    and coalesce(can_login, false)
  order by case when id = p_user_id then 0 else 1 end, updated_at desc nulls last
  limit 1;

  if v_staff_account_id is null then
    return '{}'::jsonb;
  end if;

  select coalesce(jsonb_object_agg(permission_key, allowed), '{}'::jsonb)
  into v_role_json
  from public.app_role_section_permissions
  where role_key = v_role;

  select coalesce(jsonb_object_agg(x, true), '{}'::jsonb)
  into v_pages_json
  from unnest(coalesce(v_allowed_pages, '{}'::text[])) as x;

  select coalesce(jsonb_object_agg(permission_key, allowed), '{}'::jsonb)
  into v_override_json
  from public.staff_permission_overrides
  where staff_account_id = v_staff_account_id;

  v_effective := v_role_json || v_pages_json || v_account_permissions || v_override_json;
  v_role_key := lower(trim(coalesce(v_role, '')));

  if v_role_key in ('general_manager','executive_manager','branches_manager','admin') then
    v_can_view_reviews := true;
    v_can_add_reviews := true;
    v_can_edit_reviews := true;
    v_can_approve_reviews := true;
    v_can_delete_reviews := true;
  elsif v_role_key in ('branch_manager','customer_service_manager') then
    v_can_view_reviews := true;
    v_can_add_reviews := true;
    v_can_edit_reviews := true;
    v_can_approve_reviews := true;
  elsif v_role_key in ('shift_supervisor_morning','shift_supervisor_evening','customer_service') then
    v_can_view_reviews := true;
    v_can_add_reviews := true;
  elsif v_role_key = 'pharmacist' then
    v_can_view_reviews := true;
  end if;

  v_effective := jsonb_set(v_effective, '{view_reviews}', to_jsonb(v_can_view_reviews and coalesce(nullif(v_account_permissions->>'view_reviews','')::boolean, true) and coalesce(nullif(v_override_json->>'view_reviews','')::boolean, true)), true);
  v_effective := jsonb_set(v_effective, '{add_reviews}', to_jsonb(v_can_add_reviews and coalesce(nullif(v_account_permissions->>'add_reviews','')::boolean, true) and coalesce(nullif(v_override_json->>'add_reviews','')::boolean, true)), true);
  v_effective := jsonb_set(v_effective, '{edit_reviews}', to_jsonb(v_can_edit_reviews and coalesce(nullif(v_account_permissions->>'edit_reviews','')::boolean, true) and coalesce(nullif(v_override_json->>'edit_reviews','')::boolean, true)), true);
  v_effective := jsonb_set(v_effective, '{approve_reviews}', to_jsonb(v_can_approve_reviews and coalesce(nullif(v_account_permissions->>'approve_reviews','')::boolean, true) and coalesce(nullif(v_override_json->>'approve_reviews','')::boolean, true)), true);
  v_effective := jsonb_set(v_effective, '{delete_reviews}', to_jsonb(v_can_delete_reviews and coalesce(nullif(v_account_permissions->>'delete_reviews','')::boolean, true) and coalesce(nullif(v_override_json->>'delete_reviews','')::boolean, true)), true);

  if v_role_key in ('general_manager','executive_manager','branches_manager','admin') then
    v_can_view_shift_performance := true;
    v_can_create_shift_evaluation := true;
    v_can_edit_shift_evaluation := true;
    v_can_approve_shift_evaluation := true;
    v_can_delete_shift_evaluation := true;
  elsif v_role_key = 'branch_manager' then
    v_can_view_shift_performance := true;
    v_can_create_shift_evaluation := true;
    v_can_edit_shift_evaluation := true;
    v_can_approve_shift_evaluation := true;
  elsif v_role_key in ('shift_supervisor_morning','shift_supervisor_evening') then
    v_can_view_shift_performance := true;
    v_can_create_shift_evaluation := true;
    v_can_edit_shift_evaluation := true;
  end if;

  v_effective := jsonb_set(v_effective, '{view_shift_performance}', to_jsonb(v_can_view_shift_performance and coalesce(nullif(v_account_permissions->>'view_shift_performance','')::boolean, true) and coalesce(nullif(v_override_json->>'view_shift_performance','')::boolean, true)), true);
  v_effective := jsonb_set(v_effective, '{create_shift_evaluation}', to_jsonb(v_can_create_shift_evaluation and coalesce(nullif(v_account_permissions->>'create_shift_evaluation','')::boolean, true) and coalesce(nullif(v_override_json->>'create_shift_evaluation','')::boolean, true)), true);
  v_effective := jsonb_set(v_effective, '{edit_shift_evaluation}', to_jsonb(v_can_edit_shift_evaluation and coalesce(nullif(v_account_permissions->>'edit_shift_evaluation','')::boolean, true) and coalesce(nullif(v_override_json->>'edit_shift_evaluation','')::boolean, true)), true);
  v_effective := jsonb_set(v_effective, '{approve_shift_evaluation}', to_jsonb(v_can_approve_shift_evaluation and coalesce(nullif(v_account_permissions->>'approve_shift_evaluation','')::boolean, true) and coalesce(nullif(v_override_json->>'approve_shift_evaluation','')::boolean, true)), true);
  v_effective := jsonb_set(v_effective, '{delete_shift_evaluation}', to_jsonb(v_can_delete_shift_evaluation and coalesce(nullif(v_account_permissions->>'delete_shift_evaluation','')::boolean, true) and coalesce(nullif(v_override_json->>'delete_shift_evaluation','')::boolean, true)), true);

  if v_role_key in ('general_manager','executive_manager','branches_manager','admin','branch_manager') then
    v_can_view_points := true;
    v_can_manage_points := true;
    v_can_approve_points := true;
    v_can_create_reward := true;
    v_can_create_deduction := true;
    v_can_edit_points_transaction := true;
    v_can_export_points_report := true;
  elsif v_role_key in ('shift_supervisor_morning','shift_supervisor_evening') then
    v_can_view_points := true;
    v_can_create_reward := true;
    v_can_create_deduction := true;
  elsif v_role_key in ('customer_service_manager','customer_service','pharmacist') then
    v_can_view_points := true;
  end if;

  v_effective := jsonb_set(v_effective, '{view_points}', to_jsonb(v_can_view_points and coalesce(nullif(v_account_permissions->>'view_points','')::boolean, true) and coalesce(nullif(v_override_json->>'view_points','')::boolean, true)), true);
  v_effective := jsonb_set(v_effective, '{manage_points}', to_jsonb(v_can_manage_points and coalesce(nullif(v_account_permissions->>'manage_points','')::boolean, true) and coalesce(nullif(v_override_json->>'manage_points','')::boolean, true)), true);
  v_effective := jsonb_set(v_effective, '{approve_points}', to_jsonb(v_can_approve_points and coalesce(nullif(v_account_permissions->>'approve_points','')::boolean, true) and coalesce(nullif(v_override_json->>'approve_points','')::boolean, true)), true);
  v_effective := jsonb_set(v_effective, '{create_reward}', to_jsonb(v_can_create_reward and coalesce(nullif(v_account_permissions->>'create_reward','')::boolean, true) and coalesce(nullif(v_override_json->>'create_reward','')::boolean, true)), true);
  v_effective := jsonb_set(v_effective, '{create_deduction}', to_jsonb(v_can_create_deduction and coalesce(nullif(v_account_permissions->>'create_deduction','')::boolean, true) and coalesce(nullif(v_override_json->>'create_deduction','')::boolean, true)), true);
  v_effective := jsonb_set(v_effective, '{edit_points_transaction}', to_jsonb(v_can_edit_points_transaction and coalesce(nullif(v_account_permissions->>'edit_points_transaction','')::boolean, true) and coalesce(nullif(v_override_json->>'edit_points_transaction','')::boolean, true)), true);
  v_effective := jsonb_set(v_effective, '{export_points_report}', to_jsonb(v_can_export_points_report and coalesce(nullif(v_account_permissions->>'export_points_report','')::boolean, true) and coalesce(nullif(v_override_json->>'export_points_report','')::boolean, true)), true);

  return v_effective;
end;
$function$;

create or replace function public.dawaa_can_shift_performance(p_branch text, p_action text, p_status text default null)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_account_id uuid;
  v_role text;
  v_branch text;
  v_permissions jsonb;
  v_permission_key text;
begin
  v_account_id := public.dawaa_current_staff_account_id_strict();
  if v_account_id is null then return false; end if;

  select lower(trim(sa.role)), trim(coalesce(sa.branch,''))
    into v_role, v_branch
  from public.staff_accounts sa
  where sa.id=v_account_id and sa.active=true and sa.can_login=true;
  if v_role is null then return false; end if;

  v_permissions := public.get_user_permissions(v_account_id);
  v_permission_key := case lower(trim(coalesce(p_action,'')))
    when 'view' then 'view_shift_performance'
    when 'create' then 'create_shift_evaluation'
    when 'edit' then 'edit_shift_evaluation'
    when 'approve' then 'approve_shift_evaluation'
    when 'delete' then 'delete_shift_evaluation'
    else null
  end;
  if v_permission_key is null then return false; end if;
  if coalesce((v_permissions->>v_permission_key)::boolean,false) is not true then return false; end if;

  if lower(trim(coalesce(p_status,'')))='approved' and lower(trim(coalesce(p_action,''))) in ('create','edit') then
    if coalesce((v_permissions->>'approve_shift_evaluation')::boolean,false) is not true then return false; end if;
  end if;

  if v_role in ('general_manager','executive_manager','branches_manager','admin') then return true; end if;
  if v_role in ('branch_manager','shift_supervisor_morning','shift_supervisor_evening') then
    return nullif(v_branch,'') is not null and trim(coalesce(p_branch,''))=v_branch;
  end if;
  return false;
end;
$function$;

create or replace function public.dawaa_can_shift_performance_member(p_review_id uuid, p_action text)
returns boolean
language sql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
  select exists (
    select 1
    from public.shift_performance_reviews r
    where r.id=p_review_id
      and public.dawaa_can_shift_performance(r.branch_name,p_action,r.status)
  );
$function$;

drop policy if exists "Allow anon insert shift performance reviews" on public.shift_performance_reviews;
drop policy if exists "Allow anon read shift performance reviews" on public.shift_performance_reviews;
drop policy if exists "Allow anon update shift performance reviews" on public.shift_performance_reviews;
drop policy if exists "Allow anon insert shift performance members" on public.shift_performance_review_members;
drop policy if exists "Allow anon read shift performance members" on public.shift_performance_review_members;
drop policy if exists "Allow anon update shift performance members" on public.shift_performance_review_members;

drop policy if exists shift_performance_reviews_select_scoped on public.shift_performance_reviews;
drop policy if exists shift_performance_reviews_insert_authorized on public.shift_performance_reviews;
drop policy if exists shift_performance_reviews_update_authorized on public.shift_performance_reviews;
drop policy if exists shift_performance_reviews_delete_authorized on public.shift_performance_reviews;
drop policy if exists shift_performance_members_select_scoped on public.shift_performance_review_members;
drop policy if exists shift_performance_members_insert_authorized on public.shift_performance_review_members;
drop policy if exists shift_performance_members_update_authorized on public.shift_performance_review_members;
drop policy if exists shift_performance_members_delete_authorized on public.shift_performance_review_members;

create policy shift_performance_reviews_select_scoped on public.shift_performance_reviews for select to public using (public.dawaa_can_shift_performance(branch_name,'view',status));
create policy shift_performance_reviews_insert_authorized on public.shift_performance_reviews for insert to public with check (
  public.dawaa_can_shift_performance(branch_name,'create',status)
  and reviewed_by = public.dawaa_current_staff_account_id_strict()
  and (approved_by is null or approved_by = public.dawaa_current_staff_account_id_strict())
);
create policy shift_performance_reviews_update_authorized on public.shift_performance_reviews for update to public
  using (public.dawaa_can_shift_performance(branch_name,'edit',status))
  with check (
    public.dawaa_can_shift_performance(branch_name,'edit',status)
    and (reviewed_by is null or reviewed_by = public.dawaa_current_staff_account_id_strict() or public.dawaa_can_shift_performance(branch_name,'approve',status))
    and (approved_by is null or approved_by = public.dawaa_current_staff_account_id_strict())
  );
create policy shift_performance_reviews_delete_authorized on public.shift_performance_reviews for delete to public using (public.dawaa_can_shift_performance(branch_name,'delete',status));

create policy shift_performance_members_select_scoped on public.shift_performance_review_members for select to public using (public.dawaa_can_shift_performance_member(review_id,'view'));
create policy shift_performance_members_insert_authorized on public.shift_performance_review_members for insert to public with check (public.dawaa_can_shift_performance_member(review_id,'create'));
create policy shift_performance_members_update_authorized on public.shift_performance_review_members for update to public
  using (public.dawaa_can_shift_performance_member(review_id,'edit'))
  with check (public.dawaa_can_shift_performance_member(review_id,'edit'));
create policy shift_performance_members_delete_authorized on public.shift_performance_review_members for delete to public using (public.dawaa_can_shift_performance_member(review_id,'delete'));
