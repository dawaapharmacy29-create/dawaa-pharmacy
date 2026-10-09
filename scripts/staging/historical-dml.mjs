// Historical one-time DML inside migrations that must NEVER run again (not on staging, not on a
// Production replay). Each entry pins the exact statement text by sha256, so an edit to the
// migration is detected instead of silently changing what is excluded.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { splitStatements, statementKind } from './sql-statements.mjs';

export const HISTORICAL_DML = [
  {
    migration: '20261005133000_monthly_evidence_canonical_reads_v2.sql',
    reason: 'one-time reconciliation: marks superseded conversation_sales_reviews rows is_current=false',
    statements: {
      'update public.conversation_sales_reviews legacy': '8e46292dc7b2d801041c10e8ab1fd43c394a6a68b453242bfa684eea799a477f',
      'update public.conversation_sales_reviews r': '3e13656bc142de8c6f950a6c31a72d7549cbb7c9e009581cf33d44fbba02cb10',
    },
  },
  {
    migration: '20261005141000_whatsapp_action_truth_guard_v2.sql',
    reason: 'one-time demotion of browser-ready customer_request actions to proposed',
    statements: {
      "update public.whatsapp_conversation_actions\nset status='proposed'": '22951ca9ef920f532fd548a827883b1f1efd5936106b8e217a5bc24c3db08b4b',
    },
  },
];

const sha = (text) => createHash('sha256').update(text.trim()).digest('hex');

// Returns the migration with its historical DML statements replaced by a marker comment.
// Throws when an expected statement is missing, ambiguous, or any other top-level DML remains.
export function extractDdl(root, migration) {
  const entry = HISTORICAL_DML.find((item) => item.migration === migration);
  const sql = readFileSync(path.join(root, 'supabase/migrations', migration), 'utf8');
  if (!entry) return { sql, excluded: [] };
  const statements = splitStatements(sql);
  const excluded = [];
  let out = '';
  let cursor = 0;
  for (const statement of statements) {
    const text = statement.text.replace(/^(\s*--[^\n]*\n|\s+)*/, '');
    const match = Object.keys(entry.statements).filter((prefix) => text.startsWith(prefix));
    if (match.length > 1) throw new Error(`${migration}: ambiguous historical DML anchor`);
    if (match.length === 1) {
      if (sha(text) !== entry.statements[match[0]]) throw new Error(`${migration}: historical DML changed since it was pinned: ${match[0]}`);
      out += sql.slice(cursor, statement.start) + `\n-- [staging bootstrap] historical DML excluded (sha256 ${sha(text)}): ${entry.reason}\n`;
      cursor = statement.end;
      excluded.push({ anchor: match[0], sha256: sha(text) });
    }
  }
  out += sql.slice(cursor);
  for (const prefix of Object.keys(entry.statements)) {
    if (!excluded.some((item) => item.anchor === prefix)) throw new Error(`${migration}: historical DML not found: ${prefix}`);
  }
  const leftover = splitStatements(out).filter((s) => statementKind(s.text) === 'dml');
  if (leftover.length) throw new Error(`${migration}: top-level DML remains after extraction`);
  return { sql: out, excluded };
}
