// Native PostgreSQL check for 20261028160000_branch_targets_top_management_only_v1.
// Production policies on branch_sales_targets; before the migration a branch manager can write any
// branch's target, after it only top management (or manage_settings) can. Reads are unchanged.
// Local network-isolated container; synthetic rows.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const container = process.env.DAWAA_NATIVE_PG_CONTAINER || 'dawaa-wa-0815-local';
const db = 'branch_targets_top_management';
const migration = readFileSync('supabase/migrations/20261028160000_branch_targets_top_management_only_v1.sql', 'utf8');

function sql(text, database = db) {
  const r = spawnSync('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1'], { input: text, encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0) throw new Error((r.stderr || r.error?.message || 'psql failed').trim());
  return r.stdout.trim();
}

assert.equal(spawnSync('docker', ['inspect', '-f', '{{.HostConfig.NetworkMode}}', container], { encoding: 'utf8' }).stdout.trim(), 'none');
sql(`drop database if exists ${db} with (force); create database ${db}`, 'postgres');
sql(`
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  end $$;
  create schema if not exists auth;
  grant usage on schema public to anon;
  create table public.staff_accounts(id uuid primary key, role text, active boolean, can_login boolean, permissions jsonb default '{}');
  create table public.branch_sales_targets(id uuid primary key default gen_random_uuid(), branch text, target numeric);
  alter table public.branch_sales_targets enable row level security;
  grant select, insert, update on public.branch_sales_targets to anon;
  insert into public.branch_sales_targets(branch, target) values ('فرع شكري', 1700000), ('فرع الشامي', 1300000);

  create function public.dawaa_request_staff_id() returns uuid language sql stable
    as $$ select nullif(current_setting('test.actor', true), '')::uuid $$;
  create function public.get_user_permissions(p_user_id uuid) returns jsonb language sql stable security definer
    as $$ select coalesce((select permissions from public.staff_accounts where id = p_user_id), '{}') $$;

  -- Production body (before).
  CREATE OR REPLACE FUNCTION public.dawaa_can_manage_branch_targets(p_actor_id uuid DEFAULT NULL::uuid)
   RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'auth', 'pg_temp'
  AS $function$
  declare v_id uuid := coalesce(p_actor_id, public.dawaa_request_staff_id()); v_role text; v_permissions jsonb;
  begin
    if v_id is null then return false; end if;
    select lower(trim(coalesce(sa.role,''))), public.get_user_permissions(sa.id) into v_role, v_permissions
    from public.staff_accounts sa where sa.id = v_id and coalesce(sa.active,false) = true and coalesce(sa.can_login,false) = true limit 1;
    if not found then return false; end if;
    if v_role in ('general_manager','executive_manager','branches_manager','branch_manager') then return true; end if;
    return coalesce((v_permissions ->> 'manage_settings')::boolean,false);
  end;
  $function$;
  grant execute on all functions in schema public to anon;

  -- Production policies.
  create policy branch_sales_targets_insert_admin on public.branch_sales_targets for insert to public
    with check (dawaa_can_manage_branch_targets(dawaa_request_staff_id()));
  create policy branch_sales_targets_select_authenticated on public.branch_sales_targets for select to public using (true);
  create policy branch_sales_targets_update_admin on public.branch_sales_targets for update to public
    using (dawaa_can_manage_branch_targets(dawaa_request_staff_id()))
    with check (dawaa_can_manage_branch_targets(dawaa_request_staff_id()));
`);

const actors = {
  general_manager: ['general_manager', {}],
  executive_manager: ['executive_manager', {}],
  branches_manager: ['branches_manager', {}],
  branch_manager: ['branch_manager', {}],
  'branch_manager+manage_settings': ['branch_manager', { manage_settings: true }],
  pharmacist: ['pharmacist', {}],
};
const ids = {};
Object.entries(actors).forEach(([label, [role, perms]], i) => {
  ids[label] = `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
  sql(`insert into public.staff_accounts values ('${ids[label]}', '${role}', true, true, '${JSON.stringify(perms)}')`);
});

// Updated rows, inserted (0/1) and visible rows, inside a rolled-back transaction.
const attempt = (label) => sql(`begin; set local test.actor = '${ids[label]}'; set local role anon;
  with u as (update public.branch_sales_targets set target = target + 1 where branch = 'فرع الشامي' returning 1)
  select (select count(*) from u); rollback;`).split('\n').pop()
  + '/' + (() => { try { sql(`begin; set local test.actor = '${ids[label]}'; set local role anon;
    insert into public.branch_sales_targets(branch, target) values ('فرع شكري', 1); rollback;`); return '1'; } catch { return '0'; } })()
  + '/' + sql(`set test.actor = '${ids[label]}'; set role anon; select count(*) from public.branch_sales_targets`);

assert.equal(attempt('branch_manager'), '1/1/2', 'before: branch manager could write any branch target');
sql(migration);
sql(migration);
const expected = {
  general_manager: '1/1/2', executive_manager: '1/1/2', branches_manager: '1/1/2',
  'branch_manager+manage_settings': '1/1/2', branch_manager: '0/0/2', pharmacist: '0/0/2',
};
for (const [label, want] of Object.entries(expected)) assert.equal(attempt(label), want, label);
console.log('PASS branch manager can no longer write branch targets; top management and manage_settings still can; everyone still reads');
sql(`drop database ${db} with (force)`, 'postgres');
