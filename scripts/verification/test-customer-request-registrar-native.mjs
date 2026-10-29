// Native PostgreSQL check for 20261029090000_customer_request_registrar_from_source_recorder_v1.
// Production resolver body as "before": a synced request (only source_recorded_staff_id) resolves
// to nobody; after the migration it resolves to the recorder, while doctor_id / created_by keep
// their priority and unknown ids stay unresolved. Local network-isolated container; synthetic rows.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const container = process.env.DAWAA_NATIVE_PG_CONTAINER || 'dawaa-wa-0815-local';
const db = 'customer_request_registrar';
const migration = readFileSync('supabase/migrations/20261029090000_customer_request_registrar_from_source_recorder_v1.sql', 'utf8');

function sql(text, database = db) {
  const r = spawnSync('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1'], { input: text, encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0) throw new Error((r.stderr || r.error?.message || 'psql failed').trim());
  return r.stdout.trim();
}

assert.equal(spawnSync('docker', ['inspect', '-f', '{{.HostConfig.NetworkMode}}', container], { encoding: 'utf8' }).stdout.trim(), 'none');
sql(`drop database if exists ${db} with (force); create database ${db}`, 'postgres');
sql(`
  create table public.staff(id uuid primary key, name text);
  create table public.staff_accounts(id uuid primary key, staff_id uuid);
  create table public.customer_requests(id uuid primary key, doctor_id uuid, created_by text, source_recorded_staff_id uuid);
  insert into public.staff values
    ('aaaaaaaa-0000-4000-8000-000000000001', 'recorder'),
    ('aaaaaaaa-0000-4000-8000-000000000002', 'doctor'),
    ('aaaaaaaa-0000-4000-8000-000000000003', 'creator');
  insert into public.staff_accounts values ('bbbbbbbb-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000003');

  -- Production body (before).
  CREATE OR REPLACE FUNCTION public.resolve_customer_request_registrar_staff_id(p_request customer_requests)
   RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $function$ declare v_staff_id uuid; v_created_uuid uuid; begin if p_request.doctor_id is not null and exists(select 1 from public.staff s where s.id=p_request.doctor_id) then return p_request.doctor_id; end if; begin v_created_uuid:=nullif(trim(coalesce(p_request.created_by,'')),'')::uuid; exception when others then v_created_uuid:=null; end; if v_created_uuid is not null then select s.id into v_staff_id from public.staff s where s.id=v_created_uuid limit 1; if v_staff_id is not null then return v_staff_id; end if; select sa.staff_id into v_staff_id from public.staff_accounts sa where sa.id=v_created_uuid and sa.staff_id is not null limit 1; if v_staff_id is not null then return v_staff_id; end if; end if; return null; end $function$;

  insert into public.customer_requests values
    ('cccccccc-0000-4000-8000-000000000001', null, null, 'aaaaaaaa-0000-4000-8000-000000000001'),          -- synced
    ('cccccccc-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000002', null, 'aaaaaaaa-0000-4000-8000-000000000001'), -- doctor_id wins
    ('cccccccc-0000-4000-8000-000000000003', null, 'bbbbbbbb-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001'), -- account creator wins
    ('cccccccc-0000-4000-8000-000000000004', null, 'د/ ندي', 'aaaaaaaa-0000-4000-8000-000000000001'),       -- text created_by falls through
    ('cccccccc-0000-4000-8000-000000000005', null, null, 'dddddddd-0000-4000-8000-000000000009'),          -- unknown recorder
    ('cccccccc-0000-4000-8000-000000000006', null, null, null);
`);

const resolved = () => sql(`select string_agg(coalesce(public.resolve_customer_request_registrar_staff_id(r)::text, '-'), ',' order by r.id) from public.customer_requests r`).split(',');
const before = resolved();
assert.deepEqual(before, ['-', 'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000003', '-', '-', '-']);
sql(migration);
sql(migration);
const after = resolved();
assert.deepEqual(after, [
  'aaaaaaaa-0000-4000-8000-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000002',
  'aaaaaaaa-0000-4000-8000-000000000003',
  'aaaaaaaa-0000-4000-8000-000000000001',
  '-',
  '-',
]);
console.log('PASS synced requests resolve to the recording employee; doctor_id and account creator keep priority; unknown ids stay unresolved');
sql(`drop database ${db} with (force)`, 'postgres');
