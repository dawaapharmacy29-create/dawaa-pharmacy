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
  ['whatsapp_invoice_link_confirmation_v1', [
    '../migrations/20261012121500_whatsapp_invoice_link_confirmation_v1.sql',
  ]],
  ['customer_review_incubation_scope_v1', ['20261009193000_harden_customer_review_and_incubation_scope_v1.sql']],
  ['conversation_review_correction_session_v1', ['20261005124600_automatic_review_writer_guard_v2.sql', '20261005135500_automatic_review_guard_order_v2.sql', '20261008160000_conversation_review_manager_correction_versioning_v1.sql']],
  ['whatsapp_evidence_journey_link_session_v1', ['20261008104059_whatsapp_evidence_journey_link_staff_session_v1.sql']],
  ['whatsapp_customer_case_v22_envelope_rls_v1', ['20261010110000_whatsapp_customer_case_v22_envelope_rls_v1.sql']],
  ['whatsapp_customer_journey_v15_rls', ['../staging/35_whatsapp_customer_journey_v15_rls.sql'], true],
  ['whatsapp_customer_story_v16_rls', ['../staging/36_whatsapp_customer_story_v16_rls.sql'], true],
  ['whatsapp_sales_opportunities_v17_rls', ['../staging/38_whatsapp_sales_opportunities_v17_rls.sql'], true],
  ['production_read_contracts_v1', [
    '../migrations/20261011173000_notification_sla_anon_session_read_v1.sql',
    '../migrations/20261011173100_dashboard_staff_ops_summary_accounts_v1.sql',
  ]],
  ['notification_rls_latest_index_v1', [
    '../migrations/20261003114500_notification_inbox_latest_lookup_v5.sql',
    '../migrations/20261011190000_notifications_inbox_canonical_latest_tiebreak_v1.sql',
  ], false, 'notifications_inbox_canonical_latest_v5_idx'],
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
      if (file.endsWith('.test.sql') && name === 'notification_rls_latest_index_v1'
          && !result.stdout.includes('notifications_inbox_canonical_latest_v5_idx')) {
        throw new Error(`${name}: EXPLAIN did not use notifications_inbox_canonical_latest_v5_idx`);
      }
    }
    console.log(`PASS ${name}: existing SQL authorization/RLS assertions`);
    await runtime.execute('postgres', `drop database ${db};`);
  }
  const normalizerDb = 'sql_security_product_normalizer_v21';
  await runtime.execute('postgres', `create database ${normalizerDb};`);
  const truthBoundary = readSql('supabase/migrations/20261005123000_sales_intelligence_truth_boundary_v2.sql');
  const normalizerStart = truthBoundary.indexOf('create or replace function public.dawaa_normalize_product_match_v21(');
  const normalizerEnd = truthBoundary.indexOf('$function$;', normalizerStart);
  if (normalizerStart < 0 || normalizerEnd < 0) {
    throw new Error('product normalizer definition is missing from the canonical SI migration');
  }
  const definition = truthBoundary.slice(normalizerStart, normalizerEnd + '$function$;'.length);
  for (const sql of [definition, readSql('supabase/tests/product_normalizer_v21.test.sql')]) {
    const result = await runtime.execute(normalizerDb, sql);
    if (result.code) throw new Error(`product normalizer SQL contract: ${result.stderr}`);
  }
  console.log('PASS product_normalizer_v21: Production SQL signature, security and output parity');
  await runtime.execute('postgres', `drop database ${normalizerDb};`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await runtime.close(); }
