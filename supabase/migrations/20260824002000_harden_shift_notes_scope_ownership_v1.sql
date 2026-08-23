create or replace function public.dawaa_shift_note_can_read_v1(
  p_branch text,
  p_author_id text,
  p_assigned_to_id text,
  p_received_by_id text
)
returns boolean
language plpgsql
stable security definer
set search_path to 'public','auth','pg_catalog'
as $function$
declare
  v_account_id uuid;
  v_subject_id uuid;
  v_role text;
  v_branch text;
  v_permissions jsonb := '{}'::jsonb;
begin
  v_account_id := public.dawaa_current_staff_account_id_strict();
  if v_account_id is null then return false; end if;
  v_subject_id := public.dawaa_current_staff_subject_uuid_v1();

  select lower(trim(coalesce(sa.role,''))), trim(coalesce(sa.branch,'')), public.get_user_permissions(sa.id)
    into v_role, v_branch, v_permissions
  from public.staff_accounts sa
  where sa.id = v_account_id
    and coalesce(sa.active,false)
    and coalesce(sa.can_login,false)
  limit 1;

  if not found then return false; end if;
  if v_role in ('general_manager','executive_manager','branches_manager','admin') then return true; end if;
  if not public.dawaa_jsonb_has_true_any(coalesce(v_permissions,'{}'::jsonb), array['view_schedule','view_shift_performance']) then return false; end if;

  return lower(trim(coalesce(p_branch,''))) = lower(trim(v_branch))
    or nullif(trim(coalesce(p_author_id,'')),'') = v_account_id::text
    or nullif(trim(coalesce(p_assigned_to_id,'')),'') in (v_account_id::text, coalesce(v_subject_id::text,''))
    or nullif(trim(coalesce(p_received_by_id,'')),'') = v_account_id::text;
end;
$function$;

create or replace function public.dawaa_shift_note_is_admin_v1(p_branch text)
returns boolean
language plpgsql
stable security definer
set search_path to 'public','auth','pg_catalog'
as $function$
declare
  v_account_id uuid;
  v_role text;
  v_branch text;
  v_permissions jsonb := '{}'::jsonb;
begin
  v_account_id := public.dawaa_current_staff_account_id_strict();
  if v_account_id is null then return false; end if;

  select lower(trim(coalesce(sa.role,''))), trim(coalesce(sa.branch,'')), public.get_user_permissions(sa.id)
    into v_role, v_branch, v_permissions
  from public.staff_accounts sa
  where sa.id = v_account_id
    and coalesce(sa.active,false)
    and coalesce(sa.can_login,false)
  limit 1;

  if not found then return false; end if;
  if v_role in ('general_manager','executive_manager','branches_manager','admin') then return true; end if;

  return coalesce((v_permissions->>'edit_shift_evaluation')::boolean,false)
    and lower(trim(coalesce(p_branch,''))) = lower(trim(v_branch));
end;
$function$;

create or replace function public.dawaa_shift_note_can_update_v1(
  p_branch text,
  p_author_id text,
  p_assigned_to_id text,
  p_received_by_id text
)
returns boolean
language plpgsql
stable security definer
set search_path to 'public','auth','pg_catalog'
as $function$
declare
  v_account_id uuid;
  v_subject_id uuid;
begin
  v_account_id := public.dawaa_current_staff_account_id_strict();
  if v_account_id is null then return false; end if;
  v_subject_id := public.dawaa_current_staff_subject_uuid_v1();
  if public.dawaa_shift_note_is_admin_v1(p_branch) then return true; end if;
  return nullif(trim(coalesce(p_author_id,'')),'') = v_account_id::text
    or nullif(trim(coalesce(p_assigned_to_id,'')),'') in (v_account_id::text, coalesce(v_subject_id::text,''))
    or nullif(trim(coalesce(p_received_by_id,'')),'') = v_account_id::text;
end;
$function$;

create or replace function public.dawaa_enforce_shift_note_write_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','auth','pg_catalog'
as $function$
declare
  v_account_id uuid;
  v_subject_id uuid;
  v_actor_name text;
  v_role text;
  v_actor_branch text;
  v_is_admin boolean := false;
  v_is_author boolean := false;
  v_is_assignee boolean := false;
  v_old_fixed jsonb;
  v_new_fixed jsonb;
begin
  v_account_id := public.dawaa_current_staff_account_id_strict();
  if v_account_id is null then raise exception 'active staff account required' using errcode='42501'; end if;
  v_subject_id := public.dawaa_current_staff_subject_uuid_v1();

  select sa.name, lower(trim(coalesce(sa.role,''))), trim(coalesce(sa.branch,''))
    into v_actor_name, v_role, v_actor_branch
  from public.staff_accounts sa
  where sa.id = v_account_id and coalesce(sa.active,false) and coalesce(sa.can_login,false)
  limit 1;
  if not found then raise exception 'active staff account required' using errcode='42501'; end if;

  if tg_op = 'INSERT' then
    if not public.dawaa_shift_note_can_read_v1(new.branch, v_account_id::text, new.assigned_to_id, null) then
      raise exception 'shift note branch is outside current actor scope' using errcode='42501';
    end if;
    if v_role not in ('general_manager','executive_manager','branches_manager','admin')
       and lower(trim(coalesce(new.branch,''))) <> lower(trim(v_actor_branch)) then
      raise exception 'shift note must be created inside current branch' using errcode='42501';
    end if;
    new.author_id := v_account_id::text;
    new.author_name := coalesce(nullif(trim(v_actor_name),''), new.author_name);
    new.updated_at := coalesce(new.updated_at, now());
    return new;
  end if;

  v_is_admin := public.dawaa_shift_note_is_admin_v1(old.branch);
  v_is_author := nullif(trim(coalesce(old.author_id,'')),'') = v_account_id::text;
  v_is_assignee := nullif(trim(coalesce(old.assigned_to_id,'')),'') in (v_account_id::text, coalesce(v_subject_id::text,''))
    or nullif(trim(coalesce(old.received_by_id,'')),'') = v_account_id::text;

  if not (v_is_admin or v_is_author or v_is_assignee) then
    raise exception 'shift note update denied' using errcode='42501';
  end if;

  new.author_id := old.author_id;
  new.author_name := old.author_name;

  if not v_is_admin and lower(trim(coalesce(new.branch,''))) <> lower(trim(coalesce(old.branch,''))) then
    raise exception 'only shift managers can move notes between branches' using errcode='42501';
  end if;

  if v_is_assignee and not v_is_admin and not v_is_author then
    v_old_fixed := to_jsonb(old) - array[
      'status','received_by_id','received_by_name','received_at','due_at','postponed_until','postponement_reason',
      'closed_at','closed_by_id','closed_by_name','closure_reason','completed_at','completed_by_name',
      'cancelled_at','cancelled_by_name','updated_at'
    ];
    v_new_fixed := to_jsonb(new) - array[
      'status','received_by_id','received_by_name','received_at','due_at','postponed_until','postponement_reason',
      'closed_at','closed_by_id','closed_by_name','closure_reason','completed_at','completed_by_name',
      'cancelled_at','cancelled_by_name','updated_at'
    ];
    if v_old_fixed is distinct from v_new_fixed then
      raise exception 'assigned staff may update execution fields only' using errcode='42501';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists daw_shift_note_write_guard_v1 on public.shift_notes;
create trigger daw_shift_note_write_guard_v1
before insert or update on public.shift_notes
for each row execute function public.dawaa_enforce_shift_note_write_v1();

drop policy if exists shift_notes_insert_active_actor on public.shift_notes;
drop policy if exists shift_notes_select_active_actor on public.shift_notes;
drop policy if exists shift_notes_update_active_actor on public.shift_notes;
create policy shift_notes_select_scoped_v3 on public.shift_notes for select to anon,authenticated
using (public.dawaa_shift_note_can_read_v1(branch,author_id,assigned_to_id,received_by_id));
create policy shift_notes_insert_scoped_v3 on public.shift_notes for insert to anon,authenticated
with check (public.dawaa_current_staff_account_id_strict() is not null and author_id = public.dawaa_current_staff_account_id_strict()::text);
create policy shift_notes_update_scoped_v3 on public.shift_notes for update to anon,authenticated
using (public.dawaa_shift_note_can_update_v1(branch,author_id,assigned_to_id,received_by_id))
with check (public.dawaa_shift_note_can_update_v1(branch,author_id,assigned_to_id,received_by_id));

drop policy if exists shift_note_logs_insert_active_actor on public.shift_note_logs;
drop policy if exists shift_note_logs_select_active_actor on public.shift_note_logs;
drop policy if exists shift_note_logs_update_active_actor on public.shift_note_logs;
create policy shift_note_logs_select_scoped_v3 on public.shift_note_logs for select to anon,authenticated
using (exists (select 1 from public.shift_notes n where n.id=shift_note_logs.note_id and public.dawaa_shift_note_can_read_v1(n.branch,n.author_id,n.assigned_to_id,n.received_by_id)));
create policy shift_note_logs_insert_scoped_v3 on public.shift_note_logs for insert to anon,authenticated
with check (
  actor_id = public.dawaa_current_staff_account_id_strict()::text
  and exists (select 1 from public.shift_notes n where n.id=shift_note_logs.note_id and public.dawaa_shift_note_can_update_v1(n.branch,n.author_id,n.assigned_to_id,n.received_by_id))
);

drop policy if exists shift_note_occurrences_insert_active_actor on public.shift_note_occurrences;
drop policy if exists shift_note_occurrences_select_active_actor on public.shift_note_occurrences;
drop policy if exists shift_note_occurrences_update_active_actor on public.shift_note_occurrences;
create policy shift_note_occurrences_select_scoped_v3 on public.shift_note_occurrences for select to anon,authenticated
using (exists (select 1 from public.shift_notes n where n.id=shift_note_occurrences.note_id and public.dawaa_shift_note_can_read_v1(n.branch,n.author_id,n.assigned_to_id,n.received_by_id)));
create policy shift_note_occurrences_insert_scoped_v3 on public.shift_note_occurrences for insert to anon,authenticated
with check (exists (select 1 from public.shift_notes n where n.id=shift_note_occurrences.note_id and public.dawaa_shift_note_can_update_v1(n.branch,n.author_id,n.assigned_to_id,n.received_by_id)));
create policy shift_note_occurrences_update_scoped_v3 on public.shift_note_occurrences for update to anon,authenticated
using (exists (select 1 from public.shift_notes n where n.id=shift_note_occurrences.note_id and public.dawaa_shift_note_can_update_v1(n.branch,n.author_id,n.assigned_to_id,n.received_by_id)))
with check (exists (select 1 from public.shift_notes n where n.id=shift_note_occurrences.note_id and public.dawaa_shift_note_can_update_v1(n.branch,n.author_id,n.assigned_to_id,n.received_by_id)));

create or replace function public.handover_open_shift_notes_v1(
  p_user_id text,
  p_user_name text,
  p_note text default null
)
returns integer
language plpgsql
set search_path to 'public'
as $function$
declare
  v_count integer := 0;
  v_account_id uuid;
  v_actor_name text;
  v_role text;
  v_branch text;
  v_permissions jsonb := '{}'::jsonb;
begin
  v_account_id := public.dawaa_current_staff_account_id_strict();
  if v_account_id is null then raise exception 'active staff account required' using errcode='42501'; end if;

  select sa.name, lower(trim(coalesce(sa.role,''))), trim(coalesce(sa.branch,'')), public.get_user_permissions(sa.id)
    into v_actor_name, v_role, v_branch, v_permissions
  from public.staff_accounts sa
  where sa.id = v_account_id and coalesce(sa.active,false) and coalesce(sa.can_login,false)
  limit 1;
  if not found then raise exception 'active staff account required' using errcode='42501'; end if;

  if v_role not in ('general_manager','executive_manager','branches_manager','admin')
     and coalesce((v_permissions->>'edit_shift_evaluation')::boolean,false) is not true then
    raise exception 'shift note handover requires shift management permission' using errcode='42501';
  end if;

  with updated as (
    update public.shift_notes n
       set handed_over=true,
           handed_over_at=now(),
           handed_over_by_id=v_account_id::text,
           handed_over_by_name=coalesce(nullif(trim(v_actor_name),''),'النظام'),
           handover_note=nullif(trim(coalesce(p_note,'')),''),
           updated_at=now()
     where n.deleted_at is null
       and coalesce(n.status,'') not in ('completed','cancelled')
       and (v_role in ('general_manager','executive_manager','branches_manager','admin') or lower(trim(coalesce(n.branch,'')))=lower(trim(v_branch)))
     returning n.id
  ), logged as (
    insert into public.shift_note_logs(note_id,action,actor_id,actor_name,details)
    select u.id,'handover',v_account_id::text,coalesce(nullif(trim(v_actor_name),''),'النظام'),
      case when nullif(trim(coalesce(p_note,'')),'') is null then 'تم تسليم الملحوظة للشيفت التالي'
           else 'تم تسليم الملحوظة للشيفت التالي: ' || trim(p_note) end
    from updated u
    returning 1
  )
  select count(*) into v_count from logged;
  return v_count;
end;
$function$;
