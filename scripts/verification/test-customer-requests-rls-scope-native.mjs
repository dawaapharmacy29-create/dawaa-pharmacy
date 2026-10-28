// Native PostgreSQL check for 20261027180000_customer_requests_rls_scope_once_v1.
// Uses the production bodies of dawaa_customer_request_permission_allowed,
// dawaa_can_access_customer_request_branch and dawaa_customer_request_branch_key,
// the production policies as "before", and compares the exact visible rows for every
// actor shape after the migration. Local network-isolated container; synthetic rows.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const container = process.env.DAWAA_NATIVE_PG_CONTAINER || 'dawaa-wa-0815-local';
const db = 'customer_requests_rls_scope';
const migration = readFileSync('supabase/migrations/20261027180000_customer_requests_rls_scope_once_v1.sql', 'utf8');

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
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
  end $$;
  grant usage on schema public to anon, authenticated;
  create table public.staff_accounts(id uuid primary key, role text, branch text, active boolean, can_login boolean, permissions jsonb);
  create table public.staff_permission_overrides(staff_account_id uuid, permission_key text, allowed boolean);
  create table public.customer_requests(id uuid primary key default gen_random_uuid(), branch text);
  create table public.customer_request_events(id uuid primary key default gen_random_uuid(), request_id uuid);
  alter table public.customer_requests enable row level security;
  alter table public.customer_request_events enable row level security;
  grant select on public.customer_requests, public.customer_request_events to anon, authenticated;

  -- Session identity is outside this change: the test sets the resolved actor directly.
  create function public.dawaa_current_staff_account_id_strict() returns uuid language sql stable security definer
    set search_path to 'public','pg_catalog' as $$ select nullif(current_setting('test.actor', true), '')::uuid $$;
  grant execute on function public.dawaa_current_staff_account_id_strict() to anon, authenticated;

  -- Production bodies (verbatim).
  CREATE OR REPLACE FUNCTION public.dawaa_customer_request_permission_allowed(p_actor_id uuid, p_permission text)
   RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
  AS $function$
  declare
    v_role text;
    v_account_permissions jsonb := '{}'::jsonb;
    v_override jsonb := '{}'::jsonb;
    v_role_allowed boolean := false;
  begin
    if p_actor_id is null or p_permission not in ('view_customer_requests','manage_customer_requests') then
      return false;
    end if;
    select lower(trim(coalesce(sa.role,''))), coalesce(sa.permissions,'{}'::jsonb)
      into v_role, v_account_permissions
    from public.staff_accounts sa
    where sa.id = p_actor_id and coalesce(sa.active,false) and coalesce(sa.can_login,false)
    limit 1;
    if not found then return false; end if;
    if p_permission = 'view_customer_requests' then
      v_role_allowed := v_role in ('general_manager','executive_manager','branches_manager','admin','branch_manager','customer_service_manager','shift_supervisor_morning','shift_supervisor_evening','pharmacist','customer_service');
    else
      v_role_allowed := v_role in ('general_manager','executive_manager','branches_manager','admin','branch_manager','customer_service_manager','shift_supervisor_morning','shift_supervisor_evening','pharmacist');
    end if;
    select coalesce(jsonb_object_agg(spo.permission_key, spo.allowed), '{}'::jsonb) into v_override
    from public.staff_permission_overrides spo
    where spo.staff_account_id = p_actor_id and spo.permission_key = p_permission;
    return v_role_allowed
      and coalesce(nullif(v_account_permissions->>p_permission,'')::boolean, true)
      and coalesce(nullif(v_override->>p_permission,'')::boolean, true);
  end;
  $function$;
  revoke all on function public.dawaa_customer_request_permission_allowed(uuid,text) from public, anon, authenticated;

  CREATE OR REPLACE FUNCTION public.dawaa_customer_request_branch_key(p_branch text)
   RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_catalog'
  AS $function$
    select case
      when lower(trim(coalesce(p_branch,''))) in ('فرع شكري','شكري','shokry','shoukry') then 'shokry'
      when lower(trim(coalesce(p_branch,''))) in ('فرع الشامي','الشامي','الشامى','elshamy','el-shamy','alshamy') then 'elshamy'
      when trim(coalesce(p_branch,'')) = '' then null
      else lower(trim(p_branch))
    end
  $function$;

  CREATE OR REPLACE FUNCTION public.dawaa_can_access_customer_request_branch(p_permission text, p_branch text)
   RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
  AS $function$
  declare
    v_actor_id uuid;
    v_role text;
    v_branch text;
  begin
    v_actor_id := public.dawaa_current_staff_account_id_strict();
    if v_actor_id is null then return false; end if;
    if not public.dawaa_customer_request_permission_allowed(v_actor_id, p_permission) then return false; end if;
    select lower(trim(coalesce(sa.role,''))), sa.branch into v_role, v_branch
    from public.staff_accounts sa
    where sa.id = v_actor_id and coalesce(sa.active,false) and coalesce(sa.can_login,false)
    limit 1;
    if not found then return false; end if;
    if v_role in ('general_manager','executive_manager','branches_manager','admin') then return true; end if;
    return public.dawaa_customer_request_branch_key(v_branch) is not null
      and public.dawaa_customer_request_branch_key(v_branch) = public.dawaa_customer_request_branch_key(p_branch);
  end;
  $function$;

  -- Production policies (before).
  create policy customer_requests_scoped_select on public.customer_requests for select to anon, authenticated
    using (dawaa_can_access_customer_request_branch('view_customer_requests'::text, branch));
  create policy customer_request_events_scoped_select on public.customer_request_events for select to anon, authenticated
    using (exists (select 1 from customer_requests cr where cr.id = customer_request_events.request_id
      and dawaa_can_access_customer_request_branch('view_customer_requests'::text, cr.branch)));

  -- Every branch spelling seen by the key function, plus empty/unknown values.
  insert into public.customer_requests(branch)
  select (array['فرع شكري','شكري',' Shokry ','shoukry','فرع الشامي','الشامى','elshamy','el-shamy',null,'','  ','مخزن د.وائل','فرع جديد'])[1 + g % 13]
  from generate_series(0, 1299) g;
  insert into public.customer_request_events(request_id) select id from public.customer_requests;
  insert into public.customer_request_events(request_id) select id from public.customer_requests where branch = 'فرع شكري';
`);

const actors = [];
let n = 0;
const actor = (role, branch, opts = {}) => {
  n += 1;
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  actors.push({ id, label: `${role}|${branch}|${JSON.stringify(opts)}` });
  const lit = (v) => (v === null || v === undefined ? 'null' : `'${v}'`);
  sql(`insert into public.staff_accounts values ('${id}', ${lit(role)}, ${lit(branch)}, ${opts.active ?? true}, ${opts.canLogin ?? true}, ${lit(opts.permissions ? JSON.stringify(opts.permissions) : null)}::jsonb);`);
  if (opts.override !== undefined) sql(`insert into public.staff_permission_overrides values ('${id}', 'view_customer_requests', ${opts.override});`);
};
for (const role of ['general_manager', 'executive_manager', 'branches_manager', 'admin', 'branch_manager', 'customer_service_manager',
  'shift_supervisor_morning', 'shift_supervisor_evening', 'pharmacist', 'customer_service', 'delivery', 'assistant', '', ' Branch_Manager ']) {
  for (const branch of ['فرع شكري', 'الشامي', null, '', 'مخزن د.وائل']) actor(role, branch);
}
actor('general_manager', null, { active: false });
actor('branch_manager', 'فرع شكري', { canLogin: false });
actor('branch_manager', 'فرع شكري', { permissions: { view_customer_requests: false } });
actor('general_manager', null, { permissions: { view_customer_requests: false } });
actor('pharmacist', 'الشامي', { override: false });
actor('pharmacist', 'الشامي', { override: true });
actor('customer_service', 'شكري', { permissions: { view_customer_requests: true }, override: false });
actors.push({ id: '', label: 'no actor' });
actors.push({ id: '00000000-0000-4000-8000-999999999999', label: 'unknown actor' });

const visible = (id) => sql(`
  set test.actor = '${id}';
  set role anon;
  select (select count(*) || ':' || coalesce(md5(string_agg(id::text, ',' order by id)), '-') from public.customer_requests)
    || '|' || (select count(*) || ':' || coalesce(md5(string_agg(id::text, ',' order by id)), '-') from public.customer_request_events);`);

// Executor time for a general manager reading every request/event through RLS.
const gmActor = actors.find((a) => a.label.startsWith('general_manager|null|{}')).id;
const execMs = (table) => Number(
  sql(`set test.actor='${gmActor}'; set role anon; explain (analyze, timing off, summary on) select count(*) from public.${table};`)
    .split('\n').find((line) => line.includes('Execution Time')).match(/([\d.]+) ms/)[1]
);
const timing = (label) => `${label}: requests ${execMs('customer_requests')} ms, events ${execMs('customer_request_events')} ms`;

const before = new Map(actors.map((a) => [a.label, visible(a.id)]));
const beforeTiming = timing('before');
sql(migration);
sql(migration);
console.log(`INFO ${beforeTiming} | ${timing('after')}`);
let compared = 0;
for (const a of actors) {
  assert.equal(visible(a.id), before.get(a.label), `visibility changed for ${a.label}`);
  compared += 1;
}
console.log(`PASS identical visible requests and events for ${compared} actor shapes (before vs after)`);

const counts = (id) => sql(`set test.actor='${id}'; set role anon; select count(*) from public.customer_requests`);
const gm = actors.find((a) => a.label.startsWith('general_manager|null|{}')).id;
const shokryManager = actors.find((a) => a.label === 'branch_manager|فرع شكري|{}').id;
const shamyPharmacist = actors.find((a) => a.label === 'pharmacist|الشامي|{}').id;
assert.equal(counts(gm), '1300');
assert.equal(counts(shokryManager), '400');
assert.equal(counts(shamyPharmacist), '400');
assert.equal(sql(`set test.actor='${shokryManager}'; set role anon; select count(*) from public.customer_requests where public.dawaa_customer_request_branch_key(branch) is distinct from 'shokry'`), '0');
assert.equal(sql(`set test.actor='${shamyPharmacist}'; set role anon; select count(*) from public.customer_requests where public.dawaa_customer_request_branch_key(branch) is distinct from 'elshamy'`), '0');
assert.equal(counts(actors.find((a) => a.label === 'delivery|فرع شكري|{}').id), '0');
assert.equal(counts(''), '0');
console.log('PASS branch isolation: Shokry manager sees only Shokry, Al-Shami pharmacist only Al-Shami, GM all, no-permission/no-actor none');

assert.equal(sql(`select has_function_privilege('anon','public.dawaa_customer_request_permission_allowed(uuid,text)','execute')::text`), 'false');
assert.equal(sql(`select count(*) from pg_policy where polrelid in ('public.customer_requests'::regclass,'public.customer_request_events'::regclass) and polcmd='r'`), '2');
console.log('PASS permission helper still private; exactly one select policy per table after re-apply');

sql(`drop database ${db} with (force)`, 'postgres');
