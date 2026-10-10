// Execute the existing authorization/RLS suites on isolated local PostgreSQL/WASM databases.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { localSql } from './local-sql.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const runtime = await localSql(true);
const readSql = file => readFileSync(path.join(root, file), 'utf8').replace(/^\\ir ([^\n]+)$/gm,
  (_, relative) => readSql(path.normalize(path.join(path.dirname(file), relative.trim()))));
const suites = [
  ['customer_review_incubation_scope_v1', ['20261009193000_harden_customer_review_and_incubation_scope_v1.sql']],
  ['conversation_review_correction_session_v1', ['20261005124500_automatic_review_writer_guard_v2.sql', '20261005135500_automatic_review_guard_order_v2.sql', '20261008160000_conversation_review_manager_correction_versioning_v1.sql']],
  ['whatsapp_evidence_journey_link_session_v1', ['20261008104059_whatsapp_evidence_journey_link_staff_session_v1.sql']],
  ['whatsapp_customer_case_v22_envelope_rls_v1', ['20261010110000_whatsapp_customer_case_v22_envelope_rls_v1.sql']],
  ['whatsapp_customer_journey_v15_rls', ['../staging/35_whatsapp_customer_journey_v15_rls.sql'], true],
  ['whatsapp_customer_story_v16_rls', ['../staging/36_whatsapp_customer_story_v16_rls.sql'], true],
];
try {
  for (const [name, migrations, stagingPolicies = false] of suites) {
    const db = `sql_security_${name}`;
    await runtime.execute('postgres', `create database ${db};`);
    const policyFiles = migrations.map(m => stagingPolicies
      ? path.normalize(path.join('supabase/tests', m))
      : `supabase/migrations/${m}`);
    for (const file of [`supabase/tests/${name}.fixture.sql`, ...policyFiles, `supabase/tests/${name}.test.sql`]) {
      const result = await runtime.execute(db, readSql(file));
      if (result.code) throw new Error(`${file}: ${result.stderr}`);
    }
    console.log(`PASS ${name}: existing SQL authorization/RLS assertions`);
    await runtime.execute('postgres', `drop database ${db};`);
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await runtime.close(); }
