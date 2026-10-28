// Native PostgreSQL check for 20261028180000_points_edit_and_whatsapp_tools_audit_v1.
//  - get_user_permissions: only branch_manager loses edit_points_transaction, every other key/role unchanged.
//  - transition RPC and direct updates: branch manager decides pending rows only; branches manager can
//    change decided rows; branch scope unchanged.
//  - WhatsApp tool tables: a person's insert/update/delete lands in activity_log without copying
//    conversation text; system writes (no session) are not logged.
// Production bodies for the RPC, the write-policy helper and the ledger payload guard; repo body of
// get_user_permissions (the migration patches the live body in place). Local isolated container.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const container = process.env.DAWAA_NATIVE_PG_CONTAINER || 'dawaa-wa-0815-local';
const db = 'points_edit_whatsapp_audit';
const migration = readFileSync('supabase/migrations/20261028180000_points_edit_and_whatsapp_tools_audit_v1.sql', 'utf8');
const permissionsSource = readFileSync('supabase/migrations/20260824010000_align_incentive_governance_permission_contract_v1.sql', 'utf8');
const getUserPermissions = [...permissionsSource.matchAll(/create or replace function public\.get_user_permissions[\s\S]*?\n\$(\w*)\$;/gi)].pop()[0];

function sql(text, database = db) {
  const r = spawnSync('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1'], { input: text, encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0) throw new Error((r.stderr || r.error?.message || 'psql failed').trim());
  return r.stdout.trim();
}
const fails = (text) => { try { sql(text); return 'ok'; } catch (e) { return /points_decision_change_requires_branches_manager/.test(e.message) ? 'denied' : /branch_scope_denied/.test(e.message) ? 'branch_denied' : e.message; } };

assert.equal(spawnSync('docker', ['inspect', '-f', '{{.HostConfig.NetworkMode}}', container], { encoding: 'utf8' }).stdout.trim(), 'none');
sql(`drop database if exists ${db} with (force); create database ${db}`, 'postgres');
sql(`
  set check_function_bodies = off;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  end $$;
  grant usage on schema public to anon;
  create table public.staff_accounts(id uuid primary key, name text, staff_name text, username text, role text, branch text,
    active boolean default true, can_login boolean default true, permissions jsonb default '{}', allowed_pages text[],
    auth_user_id uuid, updated_at timestamptz default now());
  create table public.staff(id uuid primary key, branch text);
  create table public.app_role_section_permissions(role_key text, permission_key text, allowed boolean);
  create table public.staff_permission_overrides(staff_account_id uuid, permission_key text, allowed boolean);
  create table public.employee_transactions(id uuid primary key default gen_random_uuid(), staff_id uuid, employee_id uuid, employee_name text,
    type text, title text, reason text, description text, amount numeric, points numeric, points_delta numeric, base_points numeric,
    final_points numeric, repeat_count int, source text, source_id text, transaction_date date, month_cycle text, branch text,
    category text, metadata jsonb, status text, updated_at timestamptz default now());
  create table public.activity_log(id text primary key default gen_random_uuid()::text, action text, description text, user_name text,
    branch text, created_at timestamptz default now(), user_id text, user_role text, operation text, module text, entity_type text,
    entity_id text, before_data jsonb, after_data jsonb);
  create table public.whatsapp_review_sources(id uuid primary key default gen_random_uuid(), branch text, raw_text text, review_status text, staff_name text, updated_at timestamptz);
  alter table public.employee_transactions enable row level security;
  alter table public.whatsapp_review_sources enable row level security;
  grant select, insert, update, delete on public.employee_transactions, public.whatsapp_review_sources to anon;
  create policy wrs_all on public.whatsapp_review_sources for all to anon using (true) with check (true);

  create function public.dawaa_current_staff_account_id_strict() returns uuid language sql stable security definer
    set search_path to 'public','pg_catalog' as $$ select nullif(current_setting('test.actor', true), '')::uuid $$;
  create function public.employee_operating_actor_id() returns text language sql stable security definer
    set search_path to 'public','pg_catalog' as $$ select nullif(current_setting('test.actor', true), '') $$;
  create function public.employee_operating_actor_role() returns text language sql stable security definer set search_path to 'public','pg_catalog' as $$
    select lower(trim(coalesce(sa.role, ''))) from public.staff_accounts sa where sa.id::text = public.employee_operating_actor_id() limit 1 $$;
  create function public.employee_operating_actor_branch() returns text language sql stable security definer set search_path to 'public','pg_catalog' as $$
    select nullif(trim(coalesce(sa.branch, '')), '') from public.staff_accounts sa where sa.id::text = public.employee_operating_actor_id() limit 1 $$;
  create function public.employee_operating_can_manage() returns boolean language sql stable security definer set search_path to 'public','pg_catalog' as $$
    select coalesce(public.employee_operating_actor_role(), '') = any(array['general_manager','admin','executive_manager','branches_manager','branch_manager','customer_service_manager']) $$;
  create function public.dawaa_current_actor_can(required_permissions text[]) returns boolean language sql stable security definer set search_path to 'public' as $$
    select coalesce((select lower(a.role) in ('general_manager','admin') or exists (select 1 from jsonb_each_text(public.get_user_permissions(a.id)) p
      where p.key = any(required_permissions) and p.value = 'true') from public.staff_accounts a where a.id = public.dawaa_current_staff_account_id_strict()), false) $$;
  -- Production: write-policy helper (manual sources) and the ledger payload guard.
  create function public.dawaa_can_write_employee_transaction(p_source text, p_type text, p_is_update boolean default false) returns boolean
    language plpgsql security definer set search_path to 'public' as $$
  begin
    if public.dawaa_current_staff_account_id_strict() is null then return false; end if;
    if lower(trim(coalesce(p_source, ''))) in ('manual_admin','manual','penalty_incentive','penalty_management') then
      if p_is_update then return public.dawaa_current_actor_can(array['approve_points','edit_points_transaction','manage_points']); end if;
      return public.dawaa_current_actor_can(array['create_reward','manage_points']);
    end if;
    return false;
  end $$;
  create function public.protect_employee_transaction_ledger_payload_v2() returns trigger language plpgsql set search_path to 'public','pg_catalog' as $$
  begin
    if current_user in ('postgres', 'service_role', 'supabase_admin') then return new; end if;
    new.points := old.points; new.points_delta := old.points_delta; new.reason := old.reason; new.description := old.description;
    new.staff_id := old.staff_id; new.source := old.source; new.branch := old.branch;
    return new;
  end $$;
  create trigger protect_employee_transaction_ledger_payload_v2 before update on public.employee_transactions
    for each row execute function public.protect_employee_transaction_ledger_payload_v2();
  create policy et_update on public.employee_transactions for update to anon
    using (dawaa_can_write_employee_transaction(source, type, true)) with check (dawaa_can_write_employee_transaction(source, type, true));
  create policy et_select on public.employee_transactions for select to anon using (true);
`);
sql(getUserPermissions);
// Production transition RPC body (before) = the migration's body without the decided-rows check.
const rpc = migration.match(/create or replace function public\.transition_employee_points_transaction_v4[\s\S]*?\n\$function\$;/)[0]
  .replace(/\n  if not v_global and not \(lower[\s\S]*?end if;\n/, '\n');
assert.ok(!rpc.includes('points_decision_change_requires_branches_manager'));
sql(rpc);
sql(`grant execute on all functions in schema public to anon;`);

const ids = {};
const people = [['gm', 'general_manager', null], ['exec', 'executive_manager', null], ['bsm', 'branches_manager', null],
  ['bm_shokry', 'branch_manager', 'فرع شكري'], ['bm_shamy', 'branch_manager', 'فرع الشامي'],
  ['csm', 'customer_service_manager', null], ['cs', 'customer_service', 'فرع شكري'], ['pharmacist', 'pharmacist', 'فرع شكري']];
people.forEach(([label, role, branch], i) => {
  ids[label] = `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
  sql(`insert into public.staff_accounts(id, name, role, branch) values ('${ids[label]}', '${label}', '${role}', ${branch ? `'${branch}'` : 'null'})`);
});
const staffShokry = 'aaaaaaaa-0000-4000-8000-000000000001';
sql(`insert into public.staff values ('${staffShokry}', 'فرع شكري')`);

const permsOf = () => Object.fromEntries(people.map(([label]) => [label, JSON.parse(sql(`select public.get_user_permissions('${ids[label]}')::text`))]));
const newTxn = (status) => sql(`insert into public.employee_transactions(staff_id, source, type, status, points, branch, description)
  values ('${staffShokry}', 'manual_admin', 'reward', '${status}', 10, 'فرع شكري', 'orig') returning id`).split('\n')[0];
const viaRpc = (actor, id, status) => fails(`set test.actor='${actor}'; set role anon; select public.transition_employee_points_transaction_v4('${id}', '${status}', 'note')`);
const direct = (actor, id, status) => fails(`set test.actor='${actor}'; set role anon; update public.employee_transactions set status='${status}' where id='${id}'`);
const statusOf = (id) => sql(`select status from public.employee_transactions where id='${id}'`);

// Before: the branch manager can cancel an already-approved record (RPC and direct update).
const before = permsOf();
let t = newTxn('active');
assert.equal(viaRpc(ids.bm_shokry, t, 'cancelled'), 'ok');
assert.equal(statusOf(t), 'cancelled');
t = newTxn('active');
assert.equal(direct(ids.bm_shokry, t, 'cancelled'), 'ok');
assert.equal(statusOf(t), 'cancelled');

sql(migration);
sql(migration);

// 1. Permissions: only branch_manager.edit_points_transaction changed.
const after = permsOf();
for (const [label] of people) {
  const keys = new Set([...Object.keys(before[label]), ...Object.keys(after[label])]);
  for (const key of keys) {
    const expected = (label.startsWith('bm_') && key === 'edit_points_transaction') ? false : before[label][key];
    assert.deepEqual({ label, key, value: after[label][key] }, { label, key, value: expected });
  }
}
assert.equal(before.bm_shokry.edit_points_transaction, true);
assert.equal(after.bsm.edit_points_transaction, true);
assert.equal(after.bm_shokry.approve_points, true);
console.log('PASS get_user_permissions: only branch_manager loses edit_points_transaction; all other keys and roles unchanged');

// 2. Decisions.
t = newTxn('pending'); assert.equal(viaRpc(ids.bm_shokry, t, 'active'), 'ok'); assert.equal(statusOf(t), 'active');
assert.equal(viaRpc(ids.bm_shokry, t, 'cancelled'), 'denied'); assert.equal(statusOf(t), 'active');
assert.equal(viaRpc(ids.bm_shokry, t, 'pending'), 'denied');
assert.equal(viaRpc(ids.bsm, t, 'cancelled'), 'ok'); assert.equal(statusOf(t), 'cancelled');
assert.equal(viaRpc(ids.gm, t, 'active'), 'ok');
assert.equal(viaRpc(ids.exec, t, 'pending'), 'ok');
t = newTxn('pending'); assert.equal(viaRpc(ids.bm_shokry, t, 'cancelled'), 'ok');
t = newTxn('pending'); assert.equal(viaRpc(ids.bm_shamy, t, 'active'), 'branch_denied');
t = newTxn('pending'); assert.equal(direct(ids.bm_shokry, t, 'active'), 'ok'); assert.equal(statusOf(t), 'active');
assert.equal(direct(ids.bm_shokry, t, 'cancelled'), 'denied'); assert.equal(statusOf(t), 'active');
assert.equal(direct(ids.bsm, t, 'cancelled'), 'ok'); assert.equal(statusOf(t), 'cancelled');
sql(`update public.employee_transactions set status='active' where id='${t}'`); // system job (no API role) unaffected
assert.equal(statusOf(t), 'active');
console.log('PASS points: branch manager decides pending records only; branches manager/GM/executive change decided ones; branch scope kept');

// 3. Audit of WhatsApp tool tables.
const audits = () => Number(sql(`select count(*) from public.activity_log where module='whatsapp_tools'`));
const big = 'x'.repeat(5000);
sql(`set test.actor='${ids.cs}'; set role anon; insert into public.whatsapp_review_sources(id, branch, raw_text, review_status, staff_name)
  values ('bbbbbbbb-0000-4000-8000-000000000001', 'فرع شكري', '${big}', 'new', 'د/ عمر')`);
sql(`set test.actor='${ids.bm_shokry}'; set role anon; update public.whatsapp_review_sources set review_status='reviewed', raw_text='${big}y'
  where id='bbbbbbbb-0000-4000-8000-000000000001'`);
sql(`set test.actor='${ids.bm_shokry}'; set role anon; update public.whatsapp_review_sources set review_status='reviewed' where id='bbbbbbbb-0000-4000-8000-000000000001'`);
sql(`set test.actor='${ids.gm}'; set role anon; delete from public.whatsapp_review_sources where id='bbbbbbbb-0000-4000-8000-000000000001'`);
sql(`insert into public.whatsapp_review_sources(branch, raw_text) values ('فرع شكري', 'system import')`);
const rows = sql(`select operation || '|' || user_role || '|' || coalesce(before_data::text,'-') || '|' || coalesce(after_data::text,'-')
  from public.activity_log where module='whatsapp_tools' order by created_at, operation`).split('\n');
assert.equal(audits(), 3, rows.join('\n'));
assert.match(rows[0], /^insert\|customer_service\|-\|/);
assert.ok(!rows[0].includes('xxxx'), 'insert must not copy conversation text');
assert.match(rows[1], /^update\|branch_manager\|/);
assert.match(rows[1], /"review_status": "new"/);
assert.match(rows[1], /"raw_text": "\[5002 chars\]"/);
assert.match(rows[2], /^delete\|general_manager\|/);
assert.equal(sql(`select count(*) from public.activity_log where user_id is null or user_name is null`), '0');
console.log('PASS WhatsApp tools: person inserts/updates/deletes are audited with actor, role and changed fields; no conversation text; system writes and no-op updates skipped');
sql(`drop database ${db} with (force)`, 'postgres');
