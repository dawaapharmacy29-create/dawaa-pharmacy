#!/usr/bin/env node
'use strict';
// Narrow closure check for the captured canonical SI functions/views and their two internal helpers.
// PL/pgSQL relation dependencies are not all recorded in pg_depend: check source references too.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const capture = '20261009200000_capture_production_canonical_si_writers_v1.sql';
const helpers = '20261009210000_close_internal_story_sync_dependencies_v16.sql';
const strip = sql => sql.replace(/--[^\n]*/g, '');
function checkCanonicalSiDependencies(base = root) {
  const files = ['supabase/migrations', 'supabase/staging'].flatMap(dir =>
    fs.readdirSync(path.join(base, dir)).filter(f => f.endsWith('.sql')).map(f => ({
      file: `${dir}/${f}`, sql: strip(fs.readFileSync(path.join(base, dir, f), 'utf8')),
    })));
  const definitions = new Map();
  for (const { file, sql } of files) for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?(?:table|view|function)\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z_0-9]*)"?/gi)) {
    if (!definitions.has(m[1])) definitions.set(m[1], []);
    definitions.get(m[1]).push(file);
  }
  const source = [capture, helpers].map(f => files.find(x => x.file === `supabase/migrations/${f}`)?.sql).join('\n');
  const refs = new Set([...source.matchAll(/public\."?([a-z_][a-z_0-9]*)"?/gi)].map(m => m[1]));
  // Captured view has unqualified relation names and name-normalization helper.
  for (const m of source.matchAll(/\b(?:from|join)\s+\(*(sales_intelligence_[a-z_0-9]+|sales_invoices|sales_invoice_items_v21|staff)\b/gi)) refs.add(m[1]);
  if (/\bdawaa_normalize_staff_name_v1\s*\(/.test(source)) refs.add('dawaa_normalize_staff_name_v1');
  const missing = [...refs].filter(name => !definitions.has(name));
  return { missing, dependencies: [...refs].sort(), definitions };
}
module.exports = { checkCanonicalSiDependencies };
if (require.main === module) {
  const result = checkCanonicalSiDependencies();
  if (result.missing.length) {
    console.error(`[canonical-si-dependencies] MISSING ${result.missing.join(', ')}`); process.exitCode = 1;
  } else console.log(`[canonical-si-dependencies] PASS (${result.dependencies.length} source-controlled objects; zero missing dependencies)`);
}
