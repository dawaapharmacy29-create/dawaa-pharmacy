-- Atomic, audited staff alias ownership keyed by the single identity key.
-- Derived alias keys are recomputed with audit evidence; ownership is never chosen:
-- the migration aborts while any key is claimed by two employees.
begin;

-- Parity with staffIdentityKey (src/lib/staff/staffIdentityKey.ts) = normalizeArabicName with
-- whitespace removed. Titles are stripped only with an explicit separator, so no first letter
-- of a name is ever dropped (محمد and أحمد stay distinct; دنيا keeps its د).
-- ECMAScript whitespace is mapped to a plain space first and literal spaces are used after,
-- because PostgreSQL \s differs from JavaScript \s (for example U+0085).
create or replace function public.dawaa_normalize_staff_alias_v1(value text)
returns text language sql immutable strict parallel safe
set search_path = pg_catalog
as $$
  select replace(lower(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          translate(translate(translate(
            regexp_replace(translate(value, chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279), repeat(' ', 24)), '[\u064B-\u065F\u0640]', '', 'g'),
            'أإآ', 'ااا'), 'ى', 'ي'), 'ة', 'ه'),
          -- "[/.]" not "[./]": "[." opens a POSIX collating element.
          '^(?: *(?:الدكتور|دكتور(?:ه)?)(?= |[/.]|$)[/.]? *| *د(?:[/.] *| +))+', ''),
        '[]،.,;:(){}_/\\|[-]+', ' ', 'g'),
      ' +', ' ', 'g')), ' ', '');
$$;

-- Ownership is never selected here: missing owners, empty keys and keys claimed by two
-- employees need an explicit, evidence-backed identity decision first.
do $$
declare v_conflicts text;
begin
  if exists (select 1 from public.staff_identity_aliases
    where coalesce(active, true) and (staff_id is null
      or coalesce(public.dawaa_normalize_staff_alias_v1(alias_name), '') = '')) then
    raise exception 'Active alias without owner or name needs explicit identity review before migration' using errcode = '23514';
  end if;
  select string_agg(k, ', ' order by k) into v_conflicts from (
    select public.dawaa_normalize_staff_alias_v1(alias_name) k
    from public.staff_identity_aliases where coalesce(active, true)
    group by 1 having count(distinct staff_id) > 1) c;
  if v_conflicts is not null then
    raise exception 'Alias keys claimed by more than one employee need an identity decision: %', v_conflicts using errcode = '23505';
  end if;
end $$;

-- One owner per key; one employee may hold several spellings of the same key. The primary key
-- arbitrates concurrent claims. Ownership is sticky: retiring an alias does not free its name
-- for another employee (a retired claim still blocks name-only resolution).
create table public.staff_alias_key_owner_v1 (
  alias_key text primary key,
  staff_id uuid not null,
  claimed_at timestamptz not null default clock_timestamp()
);
alter table public.staff_alias_key_owner_v1 enable row level security;
revoke all on public.staff_alias_key_owner_v1 from public, anon, authenticated, service_role;
insert into public.staff_alias_key_owner_v1(alias_key, staff_id)
select distinct public.dawaa_normalize_staff_alias_v1(alias_name), staff_id
from public.staff_identity_aliases where coalesce(active, true);

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

-- Recompute stale derived keys (alias_name, owner and provenance unchanged). Each change is
-- appended to staff_alias_audit_v1 with the previous key as evidence.
update public.staff_identity_aliases
set normalized_alias = public.dawaa_normalize_staff_alias_v1(alias_name)
where normalized_alias is distinct from public.dawaa_normalize_staff_alias_v1(alias_name);

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
  -- Claim the key for this employee (or confirm the existing claim) whenever the alias is live.
  if coalesce(new.active, true) then
    insert into public.staff_alias_key_owner_v1(alias_key, staff_id)
    values (new.normalized_alias, new.staff_id) on conflict (alias_key) do nothing;
    if not exists (select 1 from public.staff_alias_key_owner_v1
      where alias_key = new.normalized_alias and staff_id = new.staff_id) then
      raise exception 'Alias key is owned by a different or retired identity' using errcode = '23505';
    end if;
  end if;
  if tg_op = 'INSERT' and actor is not null then new.created_by := actor; end if;
  return new;
end;
$$;
revoke all on function public.dawaa_guard_staff_alias_v1() from public, anon, authenticated;
-- Run after the catalog-confirmed trg_staff_identity_aliases_fill_defaults trigger.
create trigger zz_staff_alias_guard_v1 before insert or update or delete
on public.staff_identity_aliases for each row execute function public.dawaa_guard_staff_alias_v1();

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
  if exists (select 1 from public.staff_alias_key_owner_v1 o
    where o.alias_key = public.dawaa_normalize_staff_alias_v1(p_raw_name) and o.staff_id is distinct from p_staff_id) then
    raise exception 'Alias key is owned by a different or retired identity' using errcode='23505';
  end if;
  -- Idempotent for the owner: an existing live (staff_id, alias_name) row is left as it is.
  if not exists (select 1 from public.staff_identity_aliases a
    where a.staff_id = p_staff_id and a.alias_name = p_raw_name and coalesce(a.active, true)) then
    insert into public.staff_identity_aliases(staff_id,alias_name,normalized_alias,source,confidence,active,created_by)
    values(p_staff_id,p_raw_name,alias_key,'base44_purchase_invoice',1,true,actor::text)
    on conflict do nothing;
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
