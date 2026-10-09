#!/usr/bin/env node
// Guards migration history against drifting from production again.
// 1. Every migration recorded in supabase/applied-migrations.lock.json (verified against production's
//    supabase_migrations.schema_migrations) must exist unchanged: applied migrations are immutable.
// 2. From the first locked version on, every migration file must use a unique 14-digit version, and
//    every unapplied migration must sort after the last applied one (so `supabase db push` never needs
//    out-of-order inserts).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = process.cwd();
const DIR = path.join(ROOT, 'supabase/migrations');
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'supabase/applied-migrations.lock.json'), 'utf8'));
const failures = [];

const applied = Object.keys(lock.applied).sort();
for (const file of applied) {
  const full = path.join(DIR, file);
  if (!fs.existsSync(full)) { failures.push(`Applied migration missing or renamed: ${file}`); continue; }
  const md5 = crypto.createHash('md5').update(fs.readFileSync(full)).digest('hex');
  if (md5 !== lock.applied[file]) failures.push(`Applied migration edited (md5 ${md5}, production ${lock.applied[file]}): ${file}. Fix forward with a new migration.`);
}

const firstLocked = applied[0].slice(0, 14);
const lastApplied = applied[applied.length - 1].slice(0, 14);
const seen = new Map();
for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) {
  if (file.slice(0, 8) < firstLocked.slice(0, 8)) continue;
  const m = /^(\d{14})_[a-z0-9_]+\.sql$/.exec(file);
  if (!m) { failures.push(`Migration name must be <14-digit version>_<snake_name>.sql: ${file}`); continue; }
  if (seen.has(m[1])) failures.push(`Duplicate migration version ${m[1]}: ${seen.get(m[1])} and ${file}`);
  seen.set(m[1], file);
  if (!lock.applied[file] && m[1] <= lastApplied) failures.push(`Unapplied migration ${file} sorts before the last applied version ${lastApplied}.`);
}

if (failures.length) {
  console.error('Applied-migration immutability check failed:');
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log(`[applied-migrations] PASS: ${applied.length} production migrations unchanged; history from ${firstLocked} unique, 14-digit and append-only.`);
