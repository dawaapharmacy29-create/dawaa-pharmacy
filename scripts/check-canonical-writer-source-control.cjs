#!/usr/bin/env node
'use strict';
// Source-control gate for Sale Truth / SI persistence / KPI writers.
// Reads docs/si-operational-audit-20261009/canonical-writer-inventory.json and the migrations only
// (never a live database). Fails when:
//   - an entry marked source_controlled has no CREATE in supabase/migrations;
//   - an entry marked as a Production-only gap actually has a CREATE (inventory is stale);
//   - one truth target has more than one canonical writer.
// Production-only canonical writers are printed as RELEASE BLOCKERS; `--strict` also fails on them.
const fs = require('fs');
const path = require('path');

function evaluateCanonicalWriterInventory(root = path.resolve(__dirname, '..')) {
  const inventory = JSON.parse(fs.readFileSync(path.join(root, 'docs/si-operational-audit-20261009/canonical-writer-inventory.json'), 'utf8'));
  const migrationsDir = path.join(root, 'supabase/migrations');
  const migrations = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).map((f) => ({ file: f, sql: fs.readFileSync(path.join(migrationsDir, f), 'utf8') }));
  const definedIn = (entry) => {
    const kind = entry.kind === 'view' ? '(?:materialized\\s+)?view' : 'function';
    const re = new RegExp(`create\\s+(?:or\\s+replace\\s+)?${kind}\\s+(?:public\\.)?"?${entry.name}"?\\s*[\\s(]`, 'i');
    return migrations.filter((m) => re.test(m.sql)).map((m) => m.file);
  };
  const errors = [];
  const blockers = [];
  const writerByTruth = new Map();
  for (const entry of inventory.functions) {
    const files = definedIn(entry);
    if (entry.status === 'source_controlled' && files.length === 0) errors.push(`${entry.name}: marked source_controlled but no CREATE exists in supabase/migrations`);
    if (entry.status.startsWith('PRODUCTION_ONLY') && files.length > 0) errors.push(`${entry.name}: marked ${entry.status} but defined in ${files.join(', ')}; update the inventory`);
    if (entry.status === 'PRODUCTION_ONLY_CANONICAL_GAP') blockers.push(entry.name);
    if (entry.role === 'canonical_writer' && entry.truth) {
      const previous = writerByTruth.get(entry.truth);
      if (previous) errors.push(`duplicate canonical writer for ${entry.truth}: ${previous} and ${entry.name}`);
      else writerByTruth.set(entry.truth, entry.name);
    }
  }
  return { errors, blockers, checked: inventory.functions.length };
}

module.exports = { evaluateCanonicalWriterInventory };

if (require.main === module) {
  const result = evaluateCanonicalWriterInventory();
  for (const error of result.errors) console.error(`[canonical-writers] ERROR ${error}`);
  for (const name of result.blockers) console.error(`[canonical-writers] RELEASE BLOCKER PRODUCTION_ONLY_CANONICAL_GAP: ${name}`);
  if (result.errors.length || (process.argv.includes('--strict') && result.blockers.length)) process.exit(1);
  console.log(`[canonical-writers] inventory consistent (${result.checked} entries, ${result.blockers.length} Production-only canonical gaps).`);
}
