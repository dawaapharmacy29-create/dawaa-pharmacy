// Historical one-time DML is retained here as audit metadata only. It is not present in any
// executable migration and must never be replayed on staging or Production.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { splitStatements, statementKind } from './sql-statements.mjs';

export const HISTORICAL_DML = [
  {
    migration: '20261005133100_monthly_evidence_canonical_reads_v2.sql',
    historicalMigration: '20261005133000_monthly_evidence_canonical_reads_v2.sql',
    reason: 'one-time reconciliation: marks superseded conversation_sales_reviews rows is_current=false',
    statements: {
      'update public.conversation_sales_reviews legacy': '8e46292dc7b2d801041c10e8ab1fd43c394a6a68b453242bfa684eea799a477f',
      'update public.conversation_sales_reviews r': '3e13656bc142de8c6f950a6c31a72d7549cbb7c9e009581cf33d44fbba02cb10',
    },
  },
  {
    migration: '20261005141100_whatsapp_action_truth_guard_v2.sql',
    historicalMigration: '20261005141000_whatsapp_action_truth_guard_v2.sql',
    reason: 'one-time demotion of browser-ready customer_request actions to proposed',
    statements: {
      "update public.whatsapp_conversation_actions\nset status='proposed'": '22951ca9ef920f532fd548a827883b1f1efd5936106b8e217a5bc24c3db08b4b',
    },
  },
];

// The replacement migration is rejected if any top-level DML is reintroduced.
export function extractDdl(root, migration) {
  const entry = HISTORICAL_DML.find((item) => item.migration === migration);
  const sql = readFileSync(path.join(root, 'supabase/migrations', migration), 'utf8');
  if (entry) {
    const replayableDml = splitStatements(sql).filter((statement) => statementKind(statement.text) === 'dml');
    if (replayableDml.length) throw new Error(`${migration}: replay path must remain DDL-only; historical DML is archived, not filtered`);
  }
  return { sql };
}
