// Native PostgreSQL check for 20261028140000_attendance_daily_summary_rls_scope_once_v1.
// Uses the production bodies of dawaa_actor_is_top_management_v1 and
// dawaa_current_staff_subject_uuid_v1 and the production policy as "before", then compares the
// exact visible rows for every actor shape after the migration, and the per-statement cost.
// Local network-isolated container; synthetic rows.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const container = process.env.DAWAA_NATIVE_PG_CONTAINER || 'dawaa-wa-0815-local';
const db = 'attendance_summary_rls_scope';
const migration = readFileSync('supabase/migrations/20261028140000_attendance_daily_summary_rls_scope_once_v1.sql', 'utf8');

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
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  end $$;
  grant usage on schema public to anon, authenticated;
  create table public.staff_accounts(id uuid primary key, staff_id text, role text, active boolean, can_login boolean, permissions jsonb default '{}');
  create table public.attendance_daily_summary(id uuid primary key default gen_random_uuid(), staff_id uuid, attendance_date date, late_minutes int);
  alter table public.attendance_daily_summary enable row level security;
  grant select on public.attendance_daily_summary to anon, authenticated;

  -- Session identity is outside this change: the test sets the resolved actor directly.
  create function public.dawaa_current_staff_account_id_strict() returns uuid language sql stable security definer
    set search_path to 'public','pg_catalog' as $$ select nullif(current_setting('test.actor', true), '')::uuid $$;
  -- Same semantics as production for these keys: general manager/admin pass, else explicit permission.
  create function public.dawaa_current_actor_can(required_permissions text[]) returns boolean language sql stable security definer
    set search_path to 'public','pg_catalog' as $$
    select coalesce((select lower(trim(a.role)) in ('general_manager','admin')
      or exists (select 1 from jsonb_each_text(a.permissions) p where p.key = any(required_permissions) and p.value = 'true')
      from public.staff_accounts a where a.id = public.dawaa_current_staff_account_id_strict()
        and coalesce(a.active,false) and coalesce(a.can_login,false)), false) $$;

  -- Production bodies (verbatim).
  CREATE OR REPLACE FUNCTION public.dawaa_actor_is_top_management_v1() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public' AS $function$
    select exists (
      select 1 from public.staff_accounts sa
      where sa.id = public.dawaa_current_staff_account_id_strict()
        and lower(trim(coalesce(sa.role, ''))) in ('general_manager', 'executive_manager', 'branches_manager', 'admin')
    );
  $function$;
  CREATE OR REPLACE FUNCTION public.dawaa_current_staff_subject_uuid_v1() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog' AS $function$
  declare v_account_id uuid; v_staff_id text;
  begin
    v_account_id := public.dawaa_current_staff_account_id_strict();
    if v_account_id is null then return null; end if;
    select nullif(trim(sa.staff_id), '') into v_staff_id from public.staff_accounts sa
    where sa.id = v_account_id and sa.active = true and sa.can_login = true;
    if v_staff_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then return v_staff_id::uuid; end if;
    return v_account_id;
  end;
  $function$;
  grant execute on all functions in schema public to anon, authenticated;

  -- Production policy (before).
  create policy attendance_daily_summary_select on public.attendance_daily_summary for select to public
    using (dawaa_actor_is_top_management_v1() OR dawaa_current_actor_can(ARRAY['manage_attendance'::text, 'manage_payroll'::text])
      OR (staff_id = dawaa_current_staff_subject_uuid_v1()));

  -- 40 employees x 120 days, plus rows keyed by an account id (staff_id-less accounts) and NULL staff.
  insert into public.attendance_daily_summary(staff_id, attendance_date, late_minutes)
  select ('aaaaaaaa-0000-4000-8000-' || lpad(s::text, 12, '0'))::uuid, date '2026-06-01' + d, (s * d) % 70
  from generate_series(1, 40) s, generate_series(0, 119) d;
  insert into public.attendance_daily_summary(staff_id, attendance_date) select '00000000-0000-4000-8000-000000000012'::uuid, date '2026-06-01' + d from generate_series(0, 9) d;
  insert into public.attendance_daily_summary(staff_id, attendance_date) select null, date '2026-06-01' + d from generate_series(0, 4) d;
`);

const actors = [];
let n = 0;
const actor = (label, role, staffId, opts = {}) => {
  n += 1;
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  actors.push({ id, label });
  const lit = (v) => (v === null || v === undefined ? 'null' : `'${v}'`);
  sql(`insert into public.staff_accounts values ('${id}', ${lit(staffId)}, ${lit(role)}, ${opts.active ?? true}, ${opts.canLogin ?? true}, '${JSON.stringify(opts.permissions || {})}');`);
};
const staff = (s) => `aaaaaaaa-0000-4000-8000-${String(s).padStart(12, '0')}`;
for (const role of ['general_manager', 'executive_manager', 'branches_manager', 'admin', ' Branch_Manager ']) actor(role, role, staff(1));
actor('branch_manager+manage_attendance', 'branch_manager', staff(2), { permissions: { manage_attendance: true } });
actor('cs_manager+manage_payroll', 'customer_service_manager', staff(3), { permissions: { manage_payroll: true } });
actor('pharmacist own', 'pharmacist', staff(4));
actor('assistant own', 'assistant', staff(5));
actor('delivery own', 'delivery', staff(6));
actor('pharmacist non-uuid staff id', 'pharmacist', 'legacy-7');
actor('account-keyed subject', 'pharmacist', null);
actor('pharmacist inactive', 'pharmacist', staff(8), { active: false });
actor('pharmacist cannot login', 'pharmacist', staff(9), { canLogin: false });
actor('gm inactive', 'general_manager', null, { active: false });
actor('explicit false permission', 'branch_manager', staff(10), { permissions: { manage_attendance: false } });
actors.push({ id: '', label: 'no actor' });
actors.push({ id: '00000000-0000-4000-8000-999999999999', label: 'unknown actor' });

const visible = (id) => sql(`set test.actor = '${id}'; set role anon;
  select count(*) || ':' || coalesce(md5(string_agg(id::text, ',' order by id)), '-') from public.attendance_daily_summary;`);
const gm = actors.find((a) => a.label === 'general_manager').id;
const execMs = () => Number(
  sql(`set test.actor='${gm}'; set role anon; explain (analyze, timing off, summary on) select count(*) from public.attendance_daily_summary;`)
    .split('\n').find((line) => line.includes('Execution Time')).match(/([\d.]+) ms/)[1]
);

const before = new Map(actors.map((a) => [a.label, visible(a.id)]));
const beforeMs = execMs();
sql(migration);
sql(migration);
const afterMs = execMs();
for (const a of actors) assert.equal(visible(a.id), before.get(a.label), `visibility changed for ${a.label}`);
console.log(`PASS identical visible rows for ${actors.length} actor shapes (before vs after)`);
console.log(`INFO general-manager full read: before ${beforeMs} ms, after ${afterMs} ms`);
assert.ok(afterMs < beforeMs, 'the policy must be cheaper after the change');

const count = (label) => before.get(label).split(':')[0];
assert.equal(count('general_manager'), String(40 * 120 + 10 + 5));
assert.equal(count('pharmacist own'), '120');
assert.equal(count('account-keyed subject'), '10');
assert.equal(count('pharmacist inactive'), '0');
assert.equal(count('no actor'), '0');
assert.equal(count('explicit false permission'), '120');
console.log('PASS scope: top management and attendance/payroll managers see all, staff see only their own, no session sees nothing');

const plan = sql(`set test.actor='${gm}'; set role anon; explain select count(*) from public.attendance_daily_summary;`);
assert.match(plan, /InitPlan/);
assert.equal(sql(`select count(*) from pg_policy where polrelid = 'public.attendance_daily_summary'::regclass`), '1');
console.log('PASS scope functions run as InitPlans; exactly one select policy after re-apply');
sql(`drop database ${db} with (force)`, 'postgres');
