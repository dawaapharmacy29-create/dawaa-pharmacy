-- Dawaa Alpha rotates operationally between both pharmacy branches.
-- Align database RLS with the app's cross-branch review scope for this role.
create or replace function public.dawaa_can_read_conversation_review_row_v2(
  p_actor_id uuid,
  p_staff_id uuid,
  p_doctor_id uuid,
  p_branch text,
  p_reviewer_id uuid
)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  with me as (
    select sa.*
    from public.staff_accounts sa
    where sa.id = p_actor_id
      and coalesce(sa.active, false)
      and coalesce(sa.can_login, false)
    limit 1
  )
  select exists (
    select 1
    from me
    where
      lower(trim(coalesce(me.role, ''))) in (
        'general_manager', 'executive_manager', 'branches_manager', 'admin',
        'team_dawaa_alpha'
      )
      or me.id = p_reviewer_id
      or me.staff_id = p_staff_id::text
      or me.staff_id = p_doctor_id::text
      or (
        lower(trim(coalesce(me.role, ''))) in (
          'branch_manager', 'customer_service_manager', 'customer_service',
          'shift_supervisor_morning', 'shift_supervisor_evening'
        )
        and public.dawaa_customer_request_branch_key(me.branch) is not null
        and public.dawaa_customer_request_branch_key(me.branch) = public.dawaa_customer_request_branch_key(p_branch)
      )
  )
$function$;

revoke all on function public.dawaa_can_read_conversation_review_row_v2(uuid,uuid,uuid,text,uuid) from public;
grant execute on function public.dawaa_can_read_conversation_review_row_v2(uuid,uuid,uuid,text,uuid) to anon, authenticated;
