-- Harden staff coaching/development notes before production data accumulates.

create or replace function public.dawaa_current_staff_subject_uuid_v1()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_account_id uuid;
  v_staff_id text;
begin
  v_account_id := public.dawaa_current_staff_account_id_strict();
  if v_account_id is null then return null; end if;

  select nullif(trim(sa.staff_id), '')
    into v_staff_id
  from public.staff_accounts sa
  where sa.id = v_account_id
    and sa.active = true
    and sa.can_login = true;

  if v_staff_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return v_staff_id::uuid;
  end if;

  return v_account_id;
end;
$$;

create or replace function public.dawaa_can_read_staff_coaching_note(
  p_to_staff_id uuid,
  p_branch text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_account_id uuid;
  v_subject_id uuid;
  v_role text;
  v_branch text;
begin
  v_account_id := public.dawaa_current_staff_account_id_strict();
  if v_account_id is null then return false; end if;

  select lower(trim(sa.role)), trim(coalesce(sa.branch, ''))
    into v_role, v_branch
  from public.staff_accounts sa
  where sa.id = v_account_id
    and sa.active = true
    and sa.can_login = true;

  if v_role is null then return false; end if;
  v_subject_id := public.dawaa_current_staff_subject_uuid_v1();

  if p_to_staff_id is not null and v_subject_id is not null and p_to_staff_id = v_subject_id then
    return true;
  end if;

  if v_role in ('general_manager','executive_manager','branches_manager','admin') then
    return public.dawaa_current_actor_can(array['view_reviews']);
  end if;

  if v_role in ('branch_manager','customer_service_manager','shift_supervisor_morning','shift_supervisor_evening') then
    return public.dawaa_current_actor_can(array['view_reviews'])
      and nullif(v_branch, '') is not null
      and trim(coalesce(p_branch, '')) = v_branch;
  end if;

  return false;
end;
$$;

alter table public.staff_coaching_notes enable row level security;

drop policy if exists "staff_coaching_notes_anon_all" on public.staff_coaching_notes;
drop policy if exists "staff_coaching_notes_insert_authorized" on public.staff_coaching_notes;
drop policy if exists "staff_coaching_notes_select_scoped" on public.staff_coaching_notes;

create policy "staff_coaching_notes_insert_authorized"
on public.staff_coaching_notes
for insert
to public
with check (
  public.dawaa_current_staff_account_id_strict() is not null
  and public.dawaa_current_actor_can(array['add_reviews','edit_reviews','approve_reviews'])
  and to_staff_id is not null
);

create policy "staff_coaching_notes_select_scoped"
on public.staff_coaching_notes
for select
to public
using (
  public.dawaa_can_read_staff_coaching_note(to_staff_id, branch)
);

-- No direct UPDATE/DELETE client policies. Acknowledgement/edit workflows should use
-- explicit RPCs with their own authorization when introduced.
