#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const failures = [];

const required = {
  foundationCore: 'supabase/migrations/20261008201358_attendance_dirty_queue_and_stale_auto_reconcile_v1.sql',
  foundationTrigger: 'supabase/migrations/20261008201852_attendance_dirty_queue_trigger_v1.sql',
  foundationFlexible: 'supabase/migrations/20261008205324_attendance_dirty_queue_flexible_v3_route.sql',
  foundationSources: 'supabase/migrations/20261008205748_attendance_dirty_queue_schedule_timeoff_sources_v1.sql',
  foundationCron: 'supabase/migrations/20261008205956_attendance_dirty_worker_cron_cutover_stage1.sql',
  foundationFairness: 'supabase/migrations/20261008210056_attendance_dirty_worker_fairness_v1.sql',
  routeAwareSafetyRange: 'supabase/migrations/20261009041958_attendance_route_aware_safety_range_v1.sql',
  routeAwareSafety: 'supabase/migrations/20261009042104_attendance_route_aware_fast_safety_materializer_v1.sql',
  routeAwareSafetyCron: 'supabase/migrations/20261009042130_attendance_route_aware_safety_cron_v1.sql',
  flexibleSupersede: 'supabase/migrations/20261009042421_attendance_flexible_v3_supersede_old_classification_v1.sql',
  retryByShiftEnd: 'supabase/migrations/20261009042703_attendance_dirty_retry_schedule_by_shift_end_v1.sql',
  canonical: 'supabase/migrations/20261009052303_attendance_canonical_architecture_v1.sql',
  historicalScope: 'supabase/migrations/20261009052352_attendance_route_historical_scope_v1.sql',
  healthScope: 'supabase/migrations/20261009052539_attendance_health_staff_scope_v1.sql',
  runtime: 'supabase/migrations/20261009052715_attendance_runtime_canonical_router_v1.sql',
  commandCenter: 'supabase/migrations/20261009053101_attendance_command_center_canonical_v1.sql',
  compatibility: 'supabase/migrations/20261009053258_attendance_canonical_compatibility_cutover_v1.sql',
  healthLanes: 'supabase/migrations/20261009053710_attendance_health_review_lanes_v2.sql',
  commandCenterBundle: 'supabase/migrations/20261009054248_attendance_command_center_bundle_v1.sql',
  queueScope: 'supabase/migrations/20261009060429_attendance_queue_v4_staff_scope_v1.sql',
  healthSources: 'supabase/migrations/20261009060732_attendance_health_dirty_source_triggers_v1.sql',
  service: 'src/lib/attendance/attendanceResolutionService.ts',
  center: 'src/components/attendance/AttendanceResolutionCenter.tsx',
};

const legacyDuplicateVersionPaths = [
  'supabase/migrations/20261008_attendance_dirty_queue_core_v1.sql',
  'supabase/migrations/20261008_attendance_dirty_queue_trigger_v1.sql',
  'supabase/migrations/20261008_attendance_dirty_queue_flexible_v3_route.sql',
  'supabase/migrations/20261008_attendance_dirty_queue_schedule_timeoff_sources_v1.sql',
  'supabase/migrations/20261008_attendance_dirty_worker_cron_cutover_stage1.sql',
  'supabase/migrations/20261008_attendance_dirty_worker_fairness_v1.sql',
];

for (const [name, rel] of Object.entries(required)) {
  if (!fs.existsSync(path.join(ROOT, rel))) failures.push(`Missing ${name}: ${rel}`);
}
for (const rel of legacyDuplicateVersionPaths) {
  if (fs.existsSync(path.join(ROOT, rel))) failures.push(`Legacy duplicate-version migration path must not exist: ${rel}`);
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
  const foundationCore = read(required.foundationCore);
  const foundationTrigger = read(required.foundationTrigger);
  const foundationFlexible = read(required.foundationFlexible);
  const foundationSources = read(required.foundationSources);
  const foundationCron = read(required.foundationCron);
  const foundationFairness = read(required.foundationFairness);
  // Production applied the route-aware safety layer as three migrations (range, fast materializer, cron).
  const routeAwareSafety = [required.routeAwareSafetyRange, required.routeAwareSafety, required.routeAwareSafetyCron].map(read).join('\n');
  const flexibleSupersede = read(required.flexibleSupersede);
  const retryByShiftEnd = read(required.retryByShiftEnd);
  const canonical = read(required.canonical);
  const historical = read(required.historicalScope);
  const health = read(required.healthScope);
  const runtime = read(required.runtime);
  const commandCenter = read(required.commandCenter);
  const compatibility = read(required.compatibility);
  const healthLanes = read(required.healthLanes);
  const commandCenterBundle = read(required.commandCenterBundle);
  const queueScope = read(required.queueScope);
  const healthSources = read(required.healthSources);
  const service = read(required.service);
  const center = read(required.center);

  mustContain('Dirty queue foundation core', foundationCore, [
    'attendance_materialization_dirty_queue_v1',
    'dawaa_reconcile_attendance_dirty_day_v1',
    'dawaa_process_attendance_dirty_queue_v1',
  ]);
  mustContain('Attendance-log dirty trigger foundation', foundationTrigger, [
    'dawaa_mark_attendance_dirty_from_log_v1',
    'trg_dawaa_mark_attendance_dirty_v1',
  ]);
  mustContain('Flexible V3 dirty route foundation', foundationFlexible, [
    'dawaa_reconcile_flexible_attendance_dirty_day_v1',
    'dawaa_materialize_attendance_day_internal_v3',
    "'system:auto-attendance-v3'",
  ]);
  mustContain('Schedule/time-off dirty source foundation', foundationSources, [
    'dawaa_mark_attendance_dirty_v1',
    'trg_dawaa_mark_attendance_dirty_schedule_v1',
    'trg_dawaa_mark_attendance_dirty_timeoff_v1',
  ]);
  mustContain('Dirty worker cron foundation', foundationCron, [
    "'attendance-dirty-queue-v1'",
    'dawaa_process_attendance_dirty_queue_v1(3)',
    "'44 * * * *'",
  ]);
  mustContain('Dirty worker fairness foundation', foundationFairness, [
    'dawaa_process_attendance_dirty_queue_v1',
    'case when q.attempts=0 then 0 else 1 end',
  ]);
  mustContain('Route-aware safety migration', routeAwareSafety, [
    'dawaa_reconcile_attendance_range_route_aware_v1',
    'dawaa_materialize_attendance_range_route_aware_v1',
    'dawaa_reconcile_flexible_attendance_dirty_day_v1',
    'dawaa_materialize_attendance_day_internal_v3',
  ]);
  mustContain('Flexible V3 supersede migration', flexibleSupersede, [
    'dawaa_reconcile_flexible_attendance_dirty_day_v1',
    'coalesce(v_saved.resolution_version,0)<>3',
    "impact_status='superseded'",
  ]);
  mustContain('Shift-end retry migration', retryByShiftEnd, [
    'dawaa_process_attendance_dirty_queue_v1',
    'v_scheduled_end',
    "v_scheduled_end+interval '10 minutes'",
  ]);

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

  // The browser-callable materializer rewrites attendance truth for every staff member: its final
  // definition (last migration that defines it) must authorize a verified top-management actor.
  const migrationsDir = path.join(ROOT, 'supabase/migrations');
  const lastMaterializer = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
    .filter((f) => /create\s+or\s+replace\s+function\s+public\.materialize_attendance_range_v2\s*\(/i.test(read(`supabase/migrations/${f}`)))
    .pop();
  if (!lastMaterializer) {
    failures.push('No migration defines materialize_attendance_range_v2.');
  } else {
    const def = read(`supabase/migrations/${lastMaterializer}`);
    for (const token of ['dawaa_current_staff_account_id_strict()', 'dawaa_actor_is_top_management_v1()', 'not_authorized_for_attendance_materialization', 'dawaa_materialize_attendance_range_route_aware_v1']) {
      if (!def.includes(token)) failures.push(`Final materialize_attendance_range_v2 (${lastMaterializer}) must guard with ${token}.`);
    }
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

  mustContain('Queue V4 staff-scope migration', queueScope, [
    'get_attendance_resolution_queue_v4',
    'join public.staff s on s.id=a.staff_id',
    "trim(s.branch)=trim(p_branch)",
    'dawaa_can_read_staff_attendance_log(a.staff_id,s.branch)',
    's.branch as staff_branch',
  ]);
  if (/or\s+a\.branch\s*=\s*p_branch/i.test(queueScope)) {
    failures.push('Canonical Queue V4 branch membership must come from staff.branch, not summary.branch.');
  }

  mustContain('Dirty-source health migration', healthSources, [
    'get_attendance_system_health_core_v1',
    'trg_dawaa_mark_attendance_dirty_v1',
    'trg_dawaa_mark_attendance_dirty_schedule_v1',
    'trg_dawaa_mark_attendance_dirty_timeoff_v1',
    "'dirty_source_triggers_present'",
    "'dirty_source_triggers_expected'",
    "'dirty_source_triggers_ok'",
    "'ingestion_sources'",
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

  // Fresh-rebuild chain: all migration versions must be full, unique, and dependency ordered.
  const ordered = [
    required.foundationCore,
    required.foundationTrigger,
    required.foundationFlexible,
    required.foundationSources,
    required.foundationCron,
    required.foundationFairness,
    required.routeAwareSafetyRange,
    required.routeAwareSafety,
    required.routeAwareSafetyCron,
    required.flexibleSupersede,
    required.retryByShiftEnd,
    required.canonical,
    required.historicalScope,
    required.healthScope,
    required.runtime,
    required.commandCenter,
    required.compatibility,
    required.healthLanes,
    required.commandCenterBundle,
    required.queueScope,
    required.healthSources,
  ];
  const versions = [];
  for (const rel of ordered) {
    const base = path.basename(rel);
    const match = base.match(/^(\d{14})_/);
    if (!match) {
      failures.push(`Attendance migration must use a 14-digit timestamp: ${base}`);
      continue;
    }
    versions.push(match[1]);
  }
  if (new Set(versions).size !== versions.length) {
    failures.push('Attendance fresh-rebuild migration versions must be unique.');
  }
  const sorted = [...ordered].sort();
  if (ordered.join('\n') !== sorted.join('\n')) {
    failures.push('Attendance migrations are not lexicographically dependency ordered.');
  }
}

if (failures.length) {
  console.error('\nCanonical Attendance Architecture check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[attendance-canonical] PASS: unique ordered fresh-rebuild foundation, one routing contract, route-safe materialization, canonical review triage, guarded compatibility entrypoints, accurate review lanes, single-pass command-center read model, staff-scoped V4 queue filtering, dirty-source trigger health, bundled service reads, V4-only frontend queue routing, and no raw attendance reads in financial/payroll frontend modules.');
