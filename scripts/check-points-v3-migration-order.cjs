#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations');
const prerequisite = '20260826140900_points_actor_context_prerequisite_v1.sql';
const cleaning = '20260826141000_points_architecture_v3_cleaning_daily_ratings.sql';
const failures = [];

const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();

if (!files.includes(prerequisite)) failures.push(`Missing replay prerequisite: ${prerequisite}`);
if (!files.includes(cleaning)) failures.push(`Missing cleaning migration: ${cleaning}`);
if (files.includes(prerequisite) && files.includes(cleaning) && files.indexOf(prerequisite) >= files.indexOf(cleaning)) {
  failures.push(`Replay prerequisite must sort before ${cleaning}`);
}

if (files.includes(prerequisite)) {
  const sql = fs.readFileSync(path.join(migrationsDir, prerequisite), 'utf8').toLowerCase();
  for (const signature of [
    'create or replace function public.employee_operating_actor_id()',
    'create or replace function public.employee_operating_actor_role()',
    'create or replace function public.employee_operating_actor_branch()',
    'create or replace function public.dawaa_current_staff_id_v1()',
    'create or replace function public.dawaa_current_points_cycle_label_v1()',
  ]) {
    if (!sql.includes(signature)) failures.push(`Replay prerequisite missing ${signature}`);
  }
  if (!sql.includes("time zone 'africa/cairo'")) {
    failures.push('Current points-cycle helper must remain Cairo-time based.');
  }
}

if (files.includes(cleaning)) {
  const sql = fs.readFileSync(path.join(migrationsDir, cleaning), 'utf8').toLowerCase();
  for (const dependency of [
    'employee_operating_actor_id()',
    'employee_operating_actor_role()',
    'employee_operating_actor_branch()',
    'dawaa_current_staff_id_v1()',
    'dawaa_current_points_cycle_label_v1()',
  ]) {
    if (!sql.includes(dependency)) failures.push(`Expected cleaning dependency not found: ${dependency}`);
  }
}

if (failures.length) {
  console.error('[points-v3-migration-order] FAIL');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[points-v3-migration-order] PASS: identity/cycle prerequisites exist before Points V3 cleaning replay.');
