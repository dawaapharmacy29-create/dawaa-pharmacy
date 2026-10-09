#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const failures = [];

const required = {
  canonical: 'supabase/migrations/20261009083500_attendance_canonical_architecture_v1.sql',
  historicalScope: 'supabase/migrations/20261009085000_attendance_route_historical_scope_v1.sql',
  healthScope: 'supabase/migrations/20261009090500_attendance_health_staff_scope_v1.sql',
  runtime: 'supabase/migrations/20261009092500_attendance_runtime_canonical_router_v1.sql',
  commandCenter: 'supabase/migrations/20261009095500_attendance_command_center_canonical_v1.sql',
  compatibility: 'supabase/migrations/20261009101500_attendance_canonical_compatibility_cutover_v1.sql',
  healthLanes: 'supabase/migrations/20261009104000_attendance_health_review_lanes_v2.sql',
  commandCenterBundle: 'supabase/migrations/20261009110500_attendance_command_center_bundle_v1.sql',
  service: 'src/lib/attendance/attendanceResolutionService.ts',
  center: 'src/components/attendance/AttendanceResolutionCenter.tsx',
};

for (const [name, rel] of Object.entries(required)) {
  if (!fs.existsSync(path.join(ROOT, rel))) failures.push(`Missing ${name}: ${rel}`);
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}
function mustContain(label, text, tokens) {
  for (const token of tokens) {
    if (!text.includes(token)) failures.push(`${label} missing ${token}`);
  }
}
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

if (!failures.length) {
  const canonical = read(required.canonical);
  const historical = read(required.historicalScope);
  const health = read(required.healthScope);
  const runtime = read(required.runtime);
  const commandCenter = read(required.commandCenter);
  const compatibility = read(required.compatibility);
  const healthLanes = read(required.healthLanes);
  const commandCenterBundle = read(required.commandCenterBundle);
  const service = read(required.service);
  const center = read(required.center);

  mustContain('Canonical attendance migration', canonical, [
    'dawaa_attendance_engine_route_v1',
    'dawaa_build_attendance_day_resolution_current_v1',
    'dawaa_materialize_attendance_day_current_v1',
    'dawaa_reconcile_attendance_dirty_day_current_v1',
    'get_attendance_resolution_queue_v4',
    'get_attendance_system_health_v1',
    "'flexible_v3'",
    "'standard_v2'",
  ]);

  for (const fn of [
    'dawaa_attendance_engine_route_v1(uuid)',
    'dawaa_build_attendance_day_resolution_current_v1(uuid,date)',
    'dawaa_materialize_attendance_day_current_v1(uuid,date)',
    'dawaa_reconcile_attendance_dirty_day_current_v1(uuid,date)',
  ]) {
    const revoke = `revoke all on function public.${fn} from public,anon,authenticated`;
    const grant = `grant execute on function public.${fn} to service_role`;
    if (!canonical.toLowerCase().includes(revoke.toLowerCase())) failures.push(`Internal RPC ${fn} must revoke browser roles.`);
    if (!canonical.toLowerCase().includes(grant.toLowerCase())) failures.push(`Internal RPC ${fn} must grant service_role only.`);
  }

  mustContain('Historical routing migration', historical, [
    'operational_active',
    "v_branch not in ('فرع الشامي','فرع شكري')",
    'dawaa_staff_flexible_attendance_v1',
  ]);

  mustContain('Health scope migration', health, [
    "'flexible_system_v2_rows'",
    "'duplicate_classified_resolutions'",
    "'financial_functions_reading_raw_attendance'",
    "s.branch in ('فرع الشامي','فرع شكري')",
  ]);

  mustContain('Runtime canonical migration', runtime, [
    'dawaa_process_attendance_dirty_queue_v1',
    'dawaa_reconcile_attendance_dirty_day_current_v1',
    'dawaa_materialize_attendance_day_current_v1',
    'dawaa_build_attendance_day_resolution_current_v1',
    'dawaa_reconcile_attendance_system_review_backlog_v1',
    "'attendance-system-review-backlog-v1'",
  ]);

  if (/if\s+public\.dawaa_staff_flexible_attendance_v1\(v_q\.staff_id\)/i.test(runtime)) {
    failures.push('Dirty worker must not duplicate V2/V3 routing; use the canonical current reconciler.');
  }

  mustContain('Command-center canonical migration', commandCenter, [
    'get_attendance_exception_inbox_v3',
    'attendance_diagnostic_summary_v2',
    'attendance_case_diagnostic_v2',
    'dawaa_build_attendance_day_resolution_current_v1',
    'system_resolvable',
    'system_repair',
  ]);

  mustContain('Compatibility cutover', compatibility, [
    'attendance_case_diagnostic_legacy_v1',
    'select public.attendance_case_diagnostic_v2',
    'from public.get_attendance_exception_inbox_v3',
    'select public.attendance_diagnostic_summary_v2',
    'select public.dawaa_materialize_attendance_range_route_aware_v1',
  ]);

  if (/create or replace function public\.materialize_attendance_range_v2[\s\S]*dawaa_materialize_attendance_day_internal_v2/i.test(compatibility)) {
    failures.push('Legacy materialize_attendance_range_v2 must never materialize V2 directly.');
  }

  mustContain('Health lane migration', healthLanes, [
    "'attendance_review_lanes_v2'",
    "'auto_resolvable'",
    "'manager_required'",
    "'manager_required_active_staff'",
    "'manager_required_former_staff'",
    "'system_repair'",
    "'waiting'",
    "'system_review_backlog'",
  ]);

  mustContain('Command-center bundle migration', commandCenterBundle, [
    'get_attendance_command_center_bundle_v1',
    'with base as materialized',
    'classified as materialized',
    'dawaa_build_attendance_day_resolution_current_v1',
    "'rows'",
    "'summary'",
    "'manager_required_active_staff'",
    "'manager_required_former_staff'",
    "'system_repair_cases'",
    "'waiting_cases'",
  ]);

  mustContain('Attendance service bundle wiring', service, [
    'AttendanceCommandCenterBundleV1',
    'attendanceCommandCenterInFlight',
    'getAttendanceCommandCenterBundleV1',
    "supabase.rpc('get_attendance_command_center_bundle_v1'",
    "supabase.rpc('get_attendance_resolution_queue_v4'",
    'const bundle = await getAttendanceCommandCenterBundleV1(args)',
    'return bundle.summary',
  ]);
  if (service.includes("supabase.rpc('get_attendance_resolution_queue_v3'")) {
    failures.push('Attendance service must not call legacy resolution queue V3; use canonical V4.');
  }
  if (service.includes("supabase.rpc('get_attendance_exception_inbox_v2'")) {
    failures.push('Attendance service must not issue a separate inbox RPC; use the single-pass command-center bundle.');
  }
  if (service.includes("supabase.rpc('attendance_diagnostic_summary_v1'")) {
    failures.push('Attendance service must not issue a separate summary RPC; use the single-pass command-center bundle.');
  }

  // The browser command center must stay behind RPC/service boundaries.
  if (/\.from\(['"]attendance_daily_summary['"]\)|\.from\(['"]attendance_impact_ledger['"]\)/.test(center)) {
    failures.push('AttendanceResolutionCenter must not read attendance truth/ledger tables directly.');
  }
  if (!center.includes("@/lib/attendance/attendanceResolutionService")) {
    failures.push('AttendanceResolutionCenter must use attendanceResolutionService.');
  }
  if (/\.from\(['"](?:attendance_daily_summary|attendance_impact_ledger)['"]\)/.test(service)) {
    failures.push('attendanceResolutionService must use guarded RPCs, not direct truth-table reads.');
  }

  // Financial/payroll frontend modules may consume canonical RPC/read models, never raw attendance tables.
  const srcFiles = walk(path.join(ROOT, 'src')).filter((file) => /\.(ts|tsx|js|jsx)$/.test(file));
  for (const file of srcFiles) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    if (!/(payroll|financial|statement)/i.test(rel)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (/\.from\(['"](?:staff_attendance_logs|biometric_attendance_logs)['"]\)/.test(text)) {
      failures.push(`Financial/payroll frontend must not read raw attendance tables directly: ${rel}`);
    }
  }

  // New canonical migrations use full timestamps and are dependency ordered.
  const ordered = [
    required.canonical,
    required.historicalScope,
    required.healthScope,
    required.runtime,
    required.commandCenter,
    required.compatibility,
    required.healthLanes,
    required.commandCenterBundle,
  ];
  for (const rel of ordered) {
    const base = path.basename(rel);
    if (!/^\d{14}_/.test(base)) failures.push(`Canonical migration must use 14-digit timestamp: ${base}`);
  }
  const sorted = [...ordered].sort();
  if (ordered.join('\n') !== sorted.join('\n')) failures.push('Canonical attendance migrations are not lexicographically dependency ordered.');
}

if (failures.length) {
  console.error('\nCanonical Attendance Architecture check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[attendance-canonical] PASS: one routing contract, route-safe materialization, canonical review triage, guarded compatibility entrypoints, accurate review lanes, single-pass command-center read model, bundled service reads, V4-only frontend queue routing, and no raw attendance reads in financial/payroll frontend modules.');
