-- No historical repair: index creation aborts atomically if existing active names collide.
begin;

-- Parity with normalizeStaffName in staffDuplicateAudit.ts (including its legacy prefix rules).
create or replace function public.dawaa_normalize_staff_alias_v1(value text)
returns text language sql immutable strict parallel safe
set search_path = pg_catalog
as $$
  select lower(translate(regexp_replace(translate(btrim(regexp_replace(value,
    -- JS alternation selects the first single-letter alternative; POSIX selects longest.
    -- Preserve the existing JS identity key exactly rather than silently repairing prefixes.
    '^[دأم]', '', 'i')),
    'أإآةي', 'اااهى'), '[.,،\-_]', '', 'g'),
    -- Exact ECMAScript whitespace, including BOM; PostgreSQL \s differs.
    chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||
    chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||
    chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||
    chr(8287)||chr(12288)||chr(65279), ''));
$$;

-- A migration must not silently repair historical labels or leave readers using stale keys.
do $$
begin
  if exists (select 1 from public.staff_identity_aliases
    where coalesce(active, true) and (
      staff_id is null or public.dawaa_normalize_staff_alias_v1(alias_name) is null
      or public.dawaa_normalize_staff_alias_v1(alias_name) = ''
      or normalized_alias is distinct from public.dawaa_normalize_staff_alias_v1(alias_name))) then
    raise exception 'Active alias metadata needs explicit identity review before migration' using errcode = '23514';
  end if;
end $$;

-- Expression index protects against forged/stale normalized_alias values and concurrent writers.
create unique index staff_alias_active_name_owner_v1
on public.staff_identity_aliases (public.dawaa_normalize_staff_alias_v1(alias_name))
where coalesce(active, true);

create table public.staff_alias_audit_v1 (
  id bigint generated always as identity primary key,
  alias_id uuid not null,
  actor_id text,
  changed_at timestamptz not null default clock_timestamp(),
  operation text not null,
  old_record jsonb,
  new_record jsonb
);
alter table public.staff_alias_audit_v1 enable row level security;
revoke all on public.staff_alias_audit_v1 from public, anon, authenticated, service_role;

-- Row RLS is bypassed by SECURITY DEFINER/server roles; audit history still cannot
-- be changed or truncated through a privileged RPC. Alias trigger owns appends.
create or replace function public.dawaa_protect_staff_alias_audit_v1()
returns trigger language plpgsql
set search_path = pg_catalog
as $$ begin
  raise exception 'Staff alias audit is append-only' using errcode = '42501';
end $$;
revoke all on function public.dawaa_protect_staff_alias_audit_v1() from public, anon, authenticated, service_role;
create trigger staff_alias_audit_immutable_v1 before update or delete
on public.staff_alias_audit_v1 for each row execute function public.dawaa_protect_staff_alias_audit_v1();
create trigger staff_alias_audit_no_truncate_v1 before truncate
on public.staff_alias_audit_v1 for each statement execute function public.dawaa_protect_staff_alias_audit_v1();

create or replace function public.dawaa_guard_staff_alias_v1()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  actor text := public.dawaa_current_staff_account_id_strict()::text;
begin
  -- Application clients, including privileged RPC callers, must have verified authorization.
  if current_setting('role', true) in ('anon', 'authenticated')
     or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '')
       in ('anon', 'authenticated') then
    -- Legacy strict identity also has Supabase-auth compatibility paths. Sensitive
    -- alias writes require the opaque, nonrevoked staff session to prove that actor.
    if actor is null or public.dawaa_session_account_id_v1()::text is distinct from actor
       or not coalesce(public.dawaa_current_actor_can(array['manage_staff_accounts']), false) then
      raise exception 'Staff identity management permission required' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Retire aliases with active=false; deletion is forbidden' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.staff_id is distinct from old.staff_id
      or new.alias_name is distinct from old.alias_name
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at) then
    raise exception 'Alias identity is immutable; reassignment requires a reviewed atomic command' using errcode = '23514';
  end if;
  new.normalized_alias := public.dawaa_normalize_staff_alias_v1(new.alias_name);
  if new.normalized_alias is null or new.normalized_alias = '' or new.staff_id is null then
    raise exception 'Alias requires a canonical staff id and nonempty normalized name' using errcode = '23514';
  end if;
  -- Row lock serializes alias activation with staff archival/deletion. Retired metadata
  -- may belong to archived staff, but never to a nonexistent canonical employee.
  perform 1 from public.staff where id = new.staff_id
    and (not coalesce(new.active, true) or (active = true and is_active = true)) for share;
  if not found then
    raise exception 'Alias requires canonical staff, active for new live attribution' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and actor is not null then new.created_by := actor; end if;
  return new;
end;
$$;
revoke all on function public.dawaa_guard_staff_alias_v1() from public, anon, authenticated;
-- Run after the catalog-confirmed trg_staff_identity_aliases_fill_defaults trigger.
create trigger zz_staff_alias_guard_v1 before insert or update or delete
on public.staff_identity_aliases for each row execute function public.dawaa_guard_staff_alias_v1();

-- AFTER avoids audit ghosts when a legacy caller uses ON CONFLICT DO NOTHING.
create or replace function public.dawaa_audit_staff_alias_v1()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$ begin
  insert into public.staff_alias_audit_v1(alias_id, actor_id, operation, old_record, new_record)
  values (new.id, public.dawaa_current_staff_account_id_strict()::text, tg_op,
    case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new));
  return new;
end $$;
revoke all on function public.dawaa_audit_staff_alias_v1() from public, anon, authenticated, service_role;
create trigger staff_alias_audit_after_v1 after insert or update
on public.staff_identity_aliases for each row execute function public.dawaa_audit_staff_alias_v1();

-- Compatibility signature now creates metadata only. A name-wide UPDATE must
-- never reassign historical purchase rows; their separate per-record command remains.
create or replace function public.resolve_base44_entered_by_alias_v1(p_raw_name text, p_staff_id uuid)
returns integer language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := public.dawaa_current_staff_account_id_strict();
  alias_key text := public.dawaa_normalize_staff_alias_v1(p_raw_name);
begin
  if actor is null or public.dawaa_session_account_id_v1() is distinct from actor
    or not coalesce(public.dawaa_current_actor_can(array['manage_staff_accounts']), false) then
    raise exception 'Staff identity management permission required' using errcode = '42501';
  end if;
  if alias_key is null or alias_key='' then
    raise exception 'Nonempty alias required' using errcode = '23514';
  end if;
  insert into public.staff_identity_aliases(staff_id,alias_name,normalized_alias,source,confidence,active,created_by)
  values(p_staff_id,p_raw_name,alias_key,'base44_purchase_invoice',1,true,actor::text)
  on conflict do nothing;
  if not exists (select 1 from public.staff_identity_aliases
    where public.dawaa_normalize_staff_alias_v1(alias_name)=alias_key
      and coalesce(active,true) and staff_id=p_staff_id) then
    raise exception 'Alias is owned by a different or retired identity' using errcode='23505';
  end if;
  return 0;
end $$;
revoke all on function public.resolve_base44_entered_by_alias_v1(text,uuid) from public,anon,authenticated;
grant execute on function public.resolve_base44_entered_by_alias_v1(text,uuid) to anon,authenticated;

alter table public.staff_identity_aliases enable row level security;
-- RLS does not protect TRUNCATE. Remove legacy ALL grants; no physical deletion API.
revoke all on public.staff_identity_aliases from public, anon, authenticated;
grant select, insert, update on public.staff_identity_aliases to anon, authenticated;
create policy staff_alias_session_read_v1 on public.staff_identity_aliases
for select to anon, authenticated
using (public.dawaa_current_staff_account_id_strict() is not null);
create policy staff_alias_manager_insert_v1 on public.staff_identity_aliases
for insert to anon, authenticated
with check (public.dawaa_current_staff_account_id_strict() is not null
  and public.dawaa_current_actor_can(array['manage_staff_accounts']));
create policy staff_alias_manager_update_v1 on public.staff_identity_aliases
for update to anon, authenticated
using (public.dawaa_current_staff_account_id_strict() is not null
  and public.dawaa_current_actor_can(array['manage_staff_accounts']))
with check (public.dawaa_current_staff_account_id_strict() is not null
  and public.dawaa_current_actor_can(array['manage_staff_accounts']));
-- Restrictive policies also constrain any older permissive policy still present.
create policy staff_alias_write_guard_v1 on public.staff_identity_aliases as restrictive
for all to anon, authenticated
using (public.dawaa_current_staff_account_id_strict() is not null)
with check (public.dawaa_current_actor_can(array['manage_staff_accounts']));
commit;
