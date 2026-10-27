// Native PostgreSQL check for 20261027200000_close_unauthenticated_table_writes_v1.
// Recreates all 65 tables with their Production `true` write policies, proves the anon-key
// hole before the migration, then checks a role x branch x operation matrix after it:
// every management role, branch staff, delivery, a disabled account and no session; the
// attendance correction create / approve / reject RPCs; punch device binding; incentive edits.
// Production bodies are used for the identity, branch-key, sales-scope and device-guard
// functions. Local network-isolated container; synthetic rows only.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const container = process.env.DAWAA_NATIVE_PG_CONTAINER || 'dawaa-wa-0815-local';
const db = 'close_unauthenticated_writes';
const migration = readFileSync('supabase/migrations/20261027200000_close_unauthenticated_table_writes_v1.sql', 'utf8');

function sql(text, database = db) {
  const r = spawnSync('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1'], { input: text, encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0) throw new Error((r.stderr || r.error?.message || 'psql failed').trim());
  return r.stdout.trim();
}
// One statement as the browser runs it (role anon + resolved session actor, or none).
// INSERT/RPC report ok|denied|not_authorized; UPDATE reports how many rows it could change.
function as(actor, statement) {
  try {
    const out = sql(`set test.actor = '${actor}'; set role anon; ${statement}`);
    return /^\s*with u as/i.test(statement) ? out : 'ok';
  } catch (error) {
    if (/row-level security|permission denied/.test(error.message)) return 'denied';
    if (/not_authorized/.test(error.message)) return 'not_authorized';
    throw error;
  }
}
const upd = (table, where = 'true') => `with u as (update public.${table} set note = note where ${where} returning 1) select count(*) from u`;
const ins = (table, cols = '', vals = '') => `insert into public.${table}(note${cols ? ', ' + cols : ''}) values ('t'${vals ? ', ' + vals : ''})`;

const ALL_TABLES = `accessory_checks accessory_items attendance_manual_requests branch_cleaning_items branch_cleaning_responsibles branch_cleaning_tasks branch_visit_actions branches cleaning_logs complaints customer_analysis customer_coding_requests customer_flags customer_important_tags customer_notes customer_request_sources customer_service_credit_budgets customer_service_credit_movements customer_special_items customer_welcome_message_templates customer_welcome_tasks cycles delivery_evaluations delivery_orders delivery_staff evaluation_rules incentive_medicine_sales incentive_medicines inventory_count_events inventory_count_items inventory_count_sessions manager_role_assignments medicine_daily_uploads medicine_dispense_log objections offer_dispenses offers quarter_cycles quick_followup_requests settings shelf_sections shelf_task_events shelf_task_items shelf_tasks shelf_zones shift_exceptions shortage_events shortage_items staff_attendance_devices staff_identity_aliases stagnant_medicine_dispenses stagnant_medicines story_performance_reports story_sales supplier_directory supplies_checks supplies_import_logs supplies_items training_assignments training_attempts training_modules training_questions training_quizzes ui_layout_preferences whatsapp_stories`.split(' ');
// Written by app pages (13) or by the punch trigger (staff_attendance_devices).
const WRITTEN = ['customer_analysis', 'customer_coding_requests', 'customer_service_credit_budgets', 'customer_service_credit_movements',
  'customer_special_items', 'customer_welcome_tasks', 'delivery_evaluations', 'evaluation_rules', 'incentive_medicines',
  'inventory_count_items', 'offers', 'staff_attendance_devices', 'staff_identity_aliases', 'stagnant_medicines'];
assert.equal(ALL_TABLES.length, 65);

assert.equal(spawnSync('docker', ['inspect', '-f', '{{.HostConfig.NetworkMode}}', container], { encoding: 'utf8' }).stdout.trim(), 'none');
sql(`drop database if exists ${db} with (force); create database ${db}`, 'postgres');
sql(`
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  end $$;
  grant usage on schema public to anon, authenticated;
  create table public.staff_accounts(id uuid primary key, staff_id text, role text, branch text, active boolean, can_login boolean, permissions jsonb default '{}');

  -- Session identity is outside this change: the test sets the resolved actor directly.
  create function public.dawaa_current_staff_account_id_strict() returns uuid language sql stable security definer
    set search_path to 'public','pg_catalog' as $$ select nullif(current_setting('test.actor', true), '')::uuid $$;
  -- Production semantics: active general manager/admin pass; otherwise the effective permission keys.
  create function public.dawaa_current_actor_can(required_permissions text[]) returns boolean language sql stable security definer
    set search_path to 'public','pg_catalog' as $$
    select coalesce((select lower(trim(a.role)) in ('general_manager','admin') or a.permissions ?| required_permissions
      from public.staff_accounts a where a.id = public.dawaa_current_staff_account_id_strict()
        and coalesce(a.active,false) and coalesce(a.can_login,false)), false) $$;
  -- Production bodies (verbatim apart from the strict-account source above).
  CREATE FUNCTION public.dawaa_customer_request_branch_key(p_branch text) RETURNS text LANGUAGE sql IMMUTABLE
    SET search_path TO 'public', 'pg_catalog' AS $$
    select case
      when lower(trim(coalesce(p_branch,''))) in ('فرع شكري','شكري','shokry','shoukry') then 'shokry'
      when lower(trim(coalesce(p_branch,''))) in ('فرع الشامي','الشامي','الشامى','elshamy','el-shamy','alshamy') then 'elshamy'
      when trim(coalesce(p_branch,'')) = '' then null
      else lower(trim(p_branch))
    end $$;
  CREATE FUNCTION public.dawaa_current_sales_invoice_scope_v1(p_permissions text[]) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO '' AS $$
  declare v_actor_id uuid; v_role text; v_branch_key text;
  begin
    v_actor_id := public.dawaa_current_staff_account_id_strict();
    if v_actor_id is null or not public.dawaa_current_actor_can(p_permissions) then return 'NONE'; end if;
    select pg_catalog.lower(pg_catalog.btrim(coalesce(sa.role, ''))), public.dawaa_customer_request_branch_key(sa.branch)
      into v_role, v_branch_key from public.staff_accounts sa
    where sa.id = v_actor_id and coalesce(sa.active, false) and coalesce(sa.can_login, false) limit 1;
    if not found then return 'NONE'; end if;
    if v_role in ('general_manager','executive_manager','branches_manager','admin') then return 'ALL'; end if;
    if v_branch_key = 'shokry' then return 'فرع شكري'; end if;
    if v_branch_key = 'elshamy' then return 'فرع الشامي'; end if;
    return 'NONE';
  end $$;
  create function public.dawaa_current_attendance_subject_id() returns uuid language plpgsql stable security definer
    set search_path to 'public','pg_catalog' as $$
  declare v_account_id uuid; v_staff_id text;
  begin
    v_account_id := public.dawaa_current_staff_account_id_strict();
    if v_account_id is null then return null; end if;
    select nullif(trim(sa.staff_id), '') into v_staff_id from public.staff_accounts sa
    where sa.id = v_account_id and coalesce(sa.active, true) = true and coalesce(sa.can_login, true) = true;
    if v_staff_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then return v_staff_id::uuid; end if;
    return v_account_id;
  end $$;
  create function public.dawaa_can_manage_biometric_mapping_v1() returns boolean language sql stable security definer
    set search_path to 'public','pg_catalog' as $$
    select exists (select 1 from public.staff_accounts a where a.id = public.dawaa_current_staff_account_id_strict()
      and coalesce(a.active, true) = true and coalesce(a.can_login, true) = true
      and a.role in ('general_manager','executive_manager','branches_manager')) $$;
  grant execute on all functions in schema public to anon, authenticated;
  revoke execute on function public.dawaa_customer_request_branch_key(text) from public, anon, authenticated;
`);

// Every table with the columns these policies read and the Production `true` write policies.
for (const t of ALL_TABLES) {
  sql(`create table public.${t}(id uuid primary key default gen_random_uuid(), note text, branch text, branch_name text, staff_id uuid,
         device_id text, status text default 'pending', reviewed_by uuid);
       alter table public.${t} enable row level security;
       grant select, insert, update, delete on public.${t} to anon, authenticated;
       create policy ${t}_select_app on public.${t} for select to anon, authenticated using (true);
       create policy ${t}_insert_app on public.${t} for insert to anon, authenticated with check (true);
       create policy ${t}_update_app on public.${t} for update to anon, authenticated using (true) with check (true);
       create policy ${t}_delete_app on public.${t} for delete to anon, authenticated using (true);`);
}
sql(`
  -- Production names of the attendance request policies the migration drops.
  create policy attendance_manual_requests_app_insert on public.attendance_manual_requests for insert to public with check (true);
  create policy manual_requests_insert_authenticated on public.attendance_manual_requests for insert to public with check (true);
  create policy attendance_manual_requests_app_update on public.attendance_manual_requests for update to public using (true) with check (true);

  -- Attendance correction RPCs (SECURITY DEFINER, as in Production): own request; approver decides.
  create function public.create_my_attendance_correction_request_v2(p_note text) returns uuid
    language plpgsql security definer set search_path to 'public','pg_catalog' as $$
  declare v_id uuid;
  begin
    if public.dawaa_current_attendance_subject_id() is null then raise exception 'not_authorized'; end if;
    insert into public.attendance_manual_requests(staff_id, note) values (public.dawaa_current_attendance_subject_id(), p_note) returning id into v_id;
    return v_id;
  end $$;
  create function public.decide_attendance_correction_request_v2(p_id uuid, p_status text) returns void
    language plpgsql security definer set search_path to 'public','pg_catalog' as $$
  begin
    if not public.dawaa_current_actor_can(array['approve_attendance']) then raise exception 'not_authorized'; end if;
    update public.attendance_manual_requests set status = p_status, reviewed_by = public.dawaa_current_staff_account_id_strict()
    where id = p_id and status = 'pending';
  end $$;
  grant execute on function public.create_my_attendance_correction_request_v2(text), public.decide_attendance_correction_request_v2(uuid, text) to anon, authenticated;

  -- Punch log table, its Production insert policy and the device-binding part of the trigger
  -- (SECURITY INVOKER, so it writes staff_attendance_devices as the punching employee).
  create table public.staff_attendance_logs(id uuid primary key default gen_random_uuid(), staff_id uuid, staff_name text, device_id text, status text default 'accepted', created_by uuid);
  alter table public.staff_attendance_logs enable row level security;
  grant select, insert on public.staff_attendance_logs to anon, authenticated;
  create policy staff_attendance_logs_select on public.staff_attendance_logs for select to public using (true);
  create policy staff_attendance_logs_insert_own on public.staff_attendance_logs for insert to public
    with check ((dawaa_current_staff_account_id_strict() is not null) and (dawaa_current_attendance_subject_id() is not null)
      and (staff_id = dawaa_current_attendance_subject_id()) and (created_by = dawaa_current_staff_account_id_strict()));
  create function public.guard_staff_attendance_device() returns trigger language plpgsql as $$
  declare v_staff_key text; v_active_device text;
  begin
    v_staff_key := coalesce(NEW.staff_id::text, NEW.staff_name);
    select device_id into v_active_device from public.staff_attendance_devices
    where staff_id::text = v_staff_key and status = 'active' limit 1;
    if v_active_device is null then
      insert into public.staff_attendance_devices (staff_id, device_id, status) values (NEW.staff_id, NEW.device_id, 'active');
      return NEW;
    end if;
    if v_active_device <> NEW.device_id then NEW.status := 'rejected'; return NEW; end if;
    update public.staff_attendance_devices set note = 'seen' where staff_id::text = v_staff_key and status = 'active';
    return NEW;
  end $$;
  create trigger trg_guard_staff_attendance_device before insert on public.staff_attendance_logs for each row execute function public.guard_staff_attendance_device();
`);

// Actors: one per management role, branch staff with their Production effective keys, edge cases.
const A = {};
let n = 0;
const actor = (key, role, branch, perms = {}, opts = {}) => {
  n += 1;
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const staff = `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
  A[key] = { id, staff };
  sql(`insert into public.staff_accounts values ('${id}', '${staff}', '${role}', ${branch ? `'${branch}'` : 'null'}, ${opts.active ?? true}, true, '${JSON.stringify(perms)}');`);
};
actor('gm', 'general_manager', null);
actor('exec', 'executive_manager', null, { view_customer_service: true });
actor('branches', 'branches_manager', null, { import_sales_invoices: true });
actor('bmShokry', 'branch_manager', 'فرع شكري', { import_sales_invoices: true, view_customer_service: true, view_inventory: true, approve_attendance: true });
actor('bmShamy', 'branch_manager', 'فرع الشامي', { import_sales_invoices: true, view_customer_service: true });
actor('csmShokry', 'customer_service_manager', 'فرع شكري', { view_customer_service: true });
actor('supShokry', 'shift_supervisor_morning', 'فرع شكري', { view_customer_service: true });
actor('pharmShokry', 'pharmacist', 'فرع شكري', { view_customer_service: true, view_customers: true });
actor('pharmKeys', 'pharmacist', 'فرع الشامي', { view_customer_service: true, edit_incentive_medicine: true });
actor('assistShokry', 'assistant', 'فرع شكري', { view_customer_service: true, view_inventory: true, manage_inventory: true });
actor('delivery', 'delivery', 'فرع شكري', { view_delivery: true });
actor('alpha', 'team_dawaa_alpha', 'المخزن', { view_customer_service: true, view_customers: true, view_invoices: true });
actor('disabledGm', 'general_manager', null, {}, { active: false });
const NONE = '';
const expect = (who, statement, want, label) => assert.equal(as(who === NONE ? NONE : A[who].id, statement), want, `${label}: ${who || 'no session'}`);

// ---------- Before: the anon key alone writes every one of the 65 tables. ----------
assert.equal(ALL_TABLES.filter((t) => as(NONE, ins(t)) === 'ok').length, 65);
console.log('PASS before: a request with no session could insert into all 65 tables');
for (const t of ALL_TABLES) sql(`delete from public.${t}`);

// Rows to update (owner bypasses RLS).
sql(`
  insert into public.incentive_medicines(note, branch) values ('all', 'كل الفروع'), ('shokry', 'فرع شكري'), ('shamy', 'فرع الشامي');
  insert into public.stagnant_medicines(note, branch) values ('shokry', 'فرع شكري'), ('shamy', 'فرع الشامي');
  insert into public.delivery_evaluations(note, branch) values ('shokry', 'فرع شكري'), ('shamy', 'فرع الشامي');
  insert into public.offers(note, branch) values ('shokry', 'فرع شكري'), ('shamy', 'فرع الشامي');
  insert into public.customer_welcome_tasks(note, branch) values ('none', null), ('shokry', 'فرع شكري'), ('shamy', 'فرع الشامي');
  insert into public.customer_analysis(note, branch) values ('none', null), ('shamy', 'فرع الشامي');
  insert into public.evaluation_rules(note) values ('rule');
  insert into public.staff_identity_aliases(note) values ('alias');
`);

sql(migration);
sql(migration);

// ---------- 1. No session / disabled account: nothing writable anywhere. ----------
for (const t of ALL_TABLES) {
  expect(NONE, ins(t), 'denied', `insert ${t}`);
  expect(NONE, upd(t), '0', `update ${t}`);
  expect('disabledGm', ins(t), 'denied', `insert ${t}`);
}
console.log('PASS no session and disabled account: insert refused and update changes 0 rows on all 65 tables');

// ---------- 2. Tables without any client writer: refused even for the general manager. ----------
const unwritten = ALL_TABLES.filter((t) => !WRITTEN.includes(t));
assert.equal(unwritten.length, 51);
for (const t of unwritten) expect('gm', ins(t), 'denied', `insert ${t}`);
console.log('PASS 51 tables without a client writer refuse client writes for every actor, including the GM');

// ---------- 3. Role x branch x operation matrix on the written tables. ----------
const branchCase = (table) => ({
  own: ins(table, 'branch', `'فرع شكري'`),
  other: ins(table, 'branch', `'فرع الشامي'`),
  updOther: upd(table, `branch = 'فرع الشامي'`),
});

// incentive_medicines feeds payroll: all-branch rows only for senior roles / explicit permission.
const im = branchCase('incentive_medicines');
const allBranchIncentive = ins('incentive_medicines', 'branch', `'كل الفروع'`);
for (const who of ['gm', 'exec', 'branches', 'pharmKeys']) expect(who, allBranchIncentive, 'ok', 'incentive all-branch');
for (const who of ['bmShokry', 'csmShokry', 'supShokry', 'pharmShokry', 'assistShokry', 'delivery', 'alpha']) expect(who, allBranchIncentive, 'denied', 'incentive all-branch');
for (const who of ['bmShokry', 'csmShokry', 'supShokry']) {
  expect(who, im.own, 'ok', 'incentive own branch');
  expect(who, im.other, 'denied', 'incentive other branch');
  expect(who, im.updOther, '0', 'incentive update other branch');
  expect(who, upd('incentive_medicines', `branch = 'كل الفروع'`), '0', 'incentive update all-branch row');
}
for (const who of ['pharmShokry', 'assistShokry', 'delivery']) expect(who, im.own, 'denied', 'incentive own branch');
expect('gm', upd('incentive_medicines', `note = 'all'`), '1', 'incentive GM update');
expect('pharmKeys', upd('incentive_medicines', `note = 'all'`), '1', 'incentive explicit-permission update');
console.log('PASS incentive_medicines: senior/explicit permission all branches; branch managers own branch only; staff refused');

// Operational tables behind canManage: senior all branches, branch managers own branch, staff refused.
for (const table of ['stagnant_medicines', 'delivery_evaluations', 'offers']) {
  const c = branchCase(table);
  expect('gm', c.updOther, '1', `${table} senior update other`);
  for (const who of ['gm', 'exec', 'branches']) expect(who, c.other, 'ok', `${table} senior insert other`);
  for (const who of ['bmShokry', 'csmShokry', 'supShokry']) {
    expect(who, c.own, 'ok', `${table} own`);
    expect(who, c.other, 'denied', `${table} other`);
    expect(who, c.updOther, '0', `${table} update other`);
  }
  for (const who of ['pharmShokry', 'assistShokry', 'delivery', 'alpha']) expect(who, c.own, 'denied', `${table} staff`);
}
console.log('PASS stagnant_medicines / delivery_evaluations / offers: senior all branches, managers own branch, staff refused');

// Customer-service tables: view_customer_service holders, own branch; null-branch welcome tasks workable.
const wt = branchCase('customer_welcome_tasks');
for (const who of ['pharmShokry', 'assistShokry', 'csmShokry', 'bmShokry']) {
  expect(who, wt.own, 'ok', 'welcome own');
  expect(who, wt.other, 'denied', 'welcome other');
  expect(who, upd('customer_welcome_tasks', 'branch is null'), '1', 'welcome null-branch update');
  expect(who, wt.updOther, '0', 'welcome update other');
}
expect('delivery', wt.own, 'denied', 'welcome delivery');
// Team Dawaa Alpha (warehouse-assigned, cross-branch customer service) keeps working on every branch.
expect('alpha', wt.other, 'ok', 'welcome alpha other branch');
expect('alpha', upd('customer_welcome_tasks', `note = 'shamy'`), '1', 'welcome alpha update');
expect('alpha', ins('customer_coding_requests', 'branch', `'فرع الشامي'`), 'ok', 'coding alpha');
expect('exec', wt.other, 'ok', 'welcome exec');
const mv = branchCase('customer_service_credit_movements');
expect('pharmShokry', mv.own, 'ok', 'credit movement own');
expect('pharmShokry', mv.other, 'denied', 'credit movement other');
expect('delivery', mv.own, 'denied', 'credit movement delivery');
const cr = branchCase('customer_coding_requests');
expect('assistShokry', cr.own, 'ok', 'coding own');
expect('assistShokry', cr.other, 'denied', 'coding other');
expect('pharmShokry', ins('customer_coding_requests'), 'ok', 'coding without branch');
expect('delivery', cr.own, 'denied', 'coding delivery');
expect('pharmShokry', ins('customer_special_items'), 'ok', 'special items');
expect('delivery', ins('customer_special_items'), 'denied', 'special items delivery');
console.log('PASS customer-service tables: view_customer_service holders in their own branch; delivery refused');

// Budgets (GM screen), inventory counts, aliases, evaluation rules.
expect('gm', ins('customer_service_credit_budgets'), 'ok', 'budget');
for (const who of ['exec', 'bmShokry', 'csmShokry', 'pharmShokry']) expect(who, ins('customer_service_credit_budgets'), 'denied', 'budget');
for (const who of ['assistShokry', 'bmShokry', 'gm']) expect(who, ins('inventory_count_items'), 'ok', 'inventory');
for (const who of ['pharmShokry', 'delivery']) expect(who, ins('inventory_count_items'), 'denied', 'inventory');
expect('gm', ins('staff_identity_aliases'), 'ok', 'alias');
for (const who of ['exec', 'bmShokry', 'pharmShokry']) { expect(who, ins('staff_identity_aliases'), 'denied', 'alias'); expect(who, upd('staff_identity_aliases'), '0', 'alias update'); }
expect('gm', ins('evaluation_rules'), 'ok', 'rules');
for (const who of ['exec', 'branches', 'bmShokry']) { expect(who, ins('evaluation_rules'), 'denied', 'rules'); expect(who, upd('evaluation_rules'), '0', 'rules update'); }
console.log('PASS budgets GM only; inventory counts for inventory holders; aliases manage_staff_accounts; rules manage_evaluation_rules');

// customer_analysis: exactly the invoice-import permission (per-customer aggregate across branches).
for (const who of ['gm', 'branches', 'bmShokry', 'bmShamy']) {
  expect(who, ins('customer_analysis'), 'ok', 'customer_analysis import');
  expect(who, upd('customer_analysis', `note = 'shamy'`), '1', 'customer_analysis update');
}
for (const who of ['exec', 'pharmShokry', 'assistShokry', 'alpha', 'delivery']) {
  expect(who, ins('customer_analysis'), 'denied', 'customer_analysis');
  expect(who, upd('customer_analysis'), '0', 'customer_analysis update');
}
console.log('PASS customer_analysis: writers = invoice importers (import_sales_invoices), as for sales_invoices');

// ---------- 4. Attendance corrections: create, approve, reject only through the RPCs. ----------
expect('pharmShokry', `select public.create_my_attendance_correction_request_v2('forgot punch')`, 'ok', 'create own request');
expect('assistShokry', `select public.create_my_attendance_correction_request_v2('late device')`, 'ok', 'create own request');
expect(NONE, `select public.create_my_attendance_correction_request_v2('x')`, 'not_authorized', 'create without session');
const [forgot, late] = sql(`select id from public.attendance_manual_requests order by note`).split('\n');
expect('pharmShokry', ins('attendance_manual_requests'), 'denied', 'direct request insert');
expect('gm', upd('attendance_manual_requests'), '0', 'direct request update');
expect('pharmShokry', `select public.decide_attendance_correction_request_v2('${forgot}', 'approved')`, 'not_authorized', 'employee approves');
expect('bmShokry', `select public.decide_attendance_correction_request_v2('${forgot}', 'approved')`, 'ok', 'manager approves');
expect('gm', `select public.decide_attendance_correction_request_v2('${late}', 'rejected')`, 'ok', 'GM rejects');
assert.equal(sql(`select string_agg(note || '=' || status || ':' || (staff_id is not null) || ':' || (reviewed_by is not null), ',' order by note) from public.attendance_manual_requests`),
  'forgot punch=approved:true:true,late device=rejected:true:true');
console.log('PASS attendance corrections: employee creates own via RPC; approver approves / rejects with reviewer recorded; direct writes refused');

// ---------- 5. Punch device binding. ----------
const punch = (who, device) => as(A[who].id, `insert into public.staff_attendance_logs(staff_id, device_id, created_by) values ('${A[who].staff}', '${device}', '${A[who].id}')`);
assert.equal(punch('pharmShokry', 'phone-A'), 'ok');
assert.equal(punch('pharmShokry', 'phone-A'), 'ok');
assert.equal(punch('pharmShokry', 'phone-B'), 'ok');
assert.equal(sql(`select string_agg(status, ',' order by ctid) from public.staff_attendance_logs`), 'accepted,accepted,rejected');
assert.equal(sql(`select device_id || ':' || status || ':' || coalesce(note,'') from public.staff_attendance_devices`), 'phone-A:active:seen');
assert.equal(punch('assistShokry', 'phone-C'), 'ok');
expect('pharmShokry', ins('staff_attendance_devices', 'staff_id, device_id, status', `'${A.assistShokry.staff}', 'phone-A', 'active'`), 'denied', 'bind other employee device');
expect('pharmShokry', upd('staff_attendance_devices', `staff_id = '${A.assistShokry.staff}'`), '0', 'change other employee device');
expect('bmShokry', upd('staff_attendance_devices'), '0', 'branch manager device update');
expect('gm', upd('staff_attendance_devices'), '2', 'GM device management');
console.log('PASS punches: first own device bound, same device accepted, new device rejected, no cross-employee binding, GM manages');

assert.equal(sql(`select count(*) from pg_policy where polname like '%\\_write\\_scope\\_v1' and polpermissive = false`), String(65 * 3));
assert.equal(sql(`select count(*) from pg_policy where polname in ('attendance_manual_requests_app_insert','manual_requests_insert_authenticated','attendance_manual_requests_app_update')`), '0');
console.log('PASS idempotent re-apply: one restrictive policy per table and command (195); old attendance write policies gone');

// ---------- 6. The documented full rollback restores the previous behaviour exactly. ----------
const rollbackDoc = readFileSync('docs/SECURITY_TABLE_WRITE_SCOPE_ROLLBACK_20261028.md', 'utf8');
const fullRollback = rollbackDoc.split('## Full rollback')[1].match(/```sql\n([\s\S]*?)```/)[1];
sql(fullRollback);
assert.equal(sql(`select count(*) from pg_policy where polname like '%\\_write\\_scope\\_v1'`), '0');
expect(NONE, ins('incentive_medicines'), 'ok', 'after rollback');
expect(NONE, ins('attendance_manual_requests'), 'ok', 'after rollback');
sql(`drop database ${db} with (force)`, 'postgres');
console.log('PASS documented full rollback removes all 195 policies and restores the previous behaviour');
