-- STAGING BOOTSTRAP 30 — staff-session helpers (classification: function, reduced).
-- Production resolves the staff account from Supabase Auth, user_profiles and the x-dawaa-user-id
-- request header (20260823184500_canonicalize_current_staff_account_resolution_v1.sql). Staging runs
-- on native PostgreSQL without Supabase Auth, so these keep only the header path, exactly as the
-- live-mirrored regression fixtures do. Permission semantics: get_user_permissions returns
-- staff_accounts.permissions (Production composes role/page/override grants).
create or replace function public.dawaa_jsonb_has_true_any(p_permissions jsonb, p_keys text[]) returns boolean language sql immutable as $$
  select coalesce(bool_or(coalesce((p_permissions ->> k)::boolean, false)), false)
  from unnest(coalesce(p_keys, '{}'::text[])) as k where p_permissions ? k;
$$;
create or replace function public.get_user_permissions(p_user_id uuid) returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce((select permissions from public.staff_accounts where id = p_user_id and coalesce(active, false) and coalesce(can_login, false)), '{}'::jsonb);
$$;
create or replace function public.dawaa_current_staff_account_id_strict() returns uuid language sql stable security definer set search_path to 'public' as $$
  select a.id from public.staff_accounts a
  where coalesce(a.active, false) and coalesce(a.can_login, false)
    and a.id::text = nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-dawaa-user-id'
  limit 1
$$;
create or replace function public.dawaa_current_actor_can(required_permissions text[]) returns boolean language plpgsql stable security definer set search_path to 'public' as $$
declare v_role text; v_permissions jsonb;
begin
  select sa.role, public.get_user_permissions(sa.id) into v_role, v_permissions
  from public.staff_accounts sa where sa.id = public.dawaa_current_staff_account_id_strict();
  if not found then return false; end if;
  if lower(trim(coalesce(v_role, ''))) in ('general_manager', 'admin') then return true; end if;
  return public.dawaa_jsonb_has_true_any(coalesce(v_permissions, '{}'::jsonb), required_permissions);
end $$;
create or replace function public.dawaa_actor_is_top_management_v1() returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.staff_accounts sa where sa.id = public.dawaa_current_staff_account_id_strict()
    and lower(trim(coalesce(sa.role, ''))) in ('general_manager', 'executive_manager', 'branches_manager', 'admin'));
$$;
create or replace function public.dawaa_can_read_conversation_review_row_v2(p_actor_id uuid, p_staff_id uuid, p_doctor_id uuid, p_branch text, p_reviewer_id uuid)
returns boolean language sql stable security definer set search_path to 'public', 'pg_catalog' as $$
  with me as (select sa.* from public.staff_accounts sa where sa.id = p_actor_id and coalesce(sa.active, false) and coalesce(sa.can_login, false) limit 1)
  select exists (
    select 1 from me
    where lower(trim(coalesce(me.role, ''))) in ('general_manager', 'executive_manager', 'branches_manager', 'admin', 'team_dawaa_alpha')
      or me.id = p_reviewer_id or me.staff_id = p_staff_id::text or me.staff_id = p_doctor_id::text
      or (lower(trim(coalesce(me.role, ''))) in ('branch_manager', 'customer_service_manager', 'customer_service', 'shift_supervisor_morning', 'shift_supervisor_evening')
          and public.dawaa_customer_request_branch_key(me.branch) is not null
          and public.dawaa_customer_request_branch_key(me.branch) = public.dawaa_customer_request_branch_key(p_branch)))
$$;
