// Branch provenance contract: a conversation's branch is decided once, when its source is first
// saved, and every follow-up that comes from that conversation keeps it. Behavior is proven on
// native PostgreSQL by scripts/test-followup-branch-provenance-db.mjs; these checks keep the
// repository wiring from regressing in the default test run.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(file, 'utf8');
const migration = read('supabase/migrations/20261009170000_followup_branch_provenance_guard_v1.sql');
const pipeline = read('src/lib/whatsappAutoIngestPipeline.ts');

function body(sql: string, signature: string) {
  const start = sql.indexOf(`create or replace function public.${signature}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf('$function$;', sql.indexOf('$function$', start) + 10);
  return sql.slice(start, end);
}

describe('auto-ingest keeps the stored source branch', () => {
  it('re-analysis fills a missing source branch but never replaces a stored one', () => {
    expect(pipeline).toContain("...(sourceRow?.branch == null && conversationBranch ? { branch: conversationBranch } : {})");
    expect(pipeline).not.toMatch(/\.update\(\{\s*branch:\s*conversationBranch/);
  });

  it('an existing source reports its stored branch and downstream writers use it', () => {
    expect(pipeline).toContain(".select('id,branch')");
    expect(pipeline).toContain('const sourceBranch = saved.branch ?? conversationBranch;');
    expect(pipeline).toMatch(/verifySessionSale\(session, saved\.sourceId, identity, sourceBranch\)/);
    expect(pipeline).toMatch(/syncWhatsAppOperationalActionsV6\(operational, \{\s*sourceId,\s*branch: sourceBranch,/);
    expect(pipeline).toMatch(/identity,\s*sourceBranch\s*\);\s*result\.followupsCreated/);
  });
});

describe('follow-up branch provenance guard migration', () => {
  it('is one rule, used by the backstop and by every writer it touches', () => {
    const guard = body(migration, 'dawaa_guard_followup_conversation_branch_v1');
    expect(guard).toContain('dawaa_followup_branch_change_allowed_v1(v_followup_id, new.branch)');
    for (const writer of [
      'transfer_customer_followup_branch_legacy_v1',
      'correct_customer_followup_data_legacy_v1',
      'repair_customer_followup_duplicates_and_branches',
      'merge_open_followup_duplicates_v1',
    ]) {
      expect(body(migration, writer)).toMatch(/dawaa_followup_(has_conversation_lineage|branch_change_allowed)_v1/);
    }
  });

  it('backstop triggers run last and cover follow-ups and their linked queue items', () => {
    expect(migration).toContain('create trigger zzz_daily_followups_conversation_branch_guard_v1');
    expect(migration).toContain("execute function public.dawaa_guard_followup_conversation_branch_v1('id')");
    expect(migration).toContain('create trigger zzz_queue_items_conversation_branch_guard_v1');
    expect(migration).toContain("execute function public.dawaa_guard_followup_conversation_branch_v1('linked_followup_id')");
  });

  it('has no dynamic SQL, fixed search_path on every function, and no client EXECUTE on helpers', () => {
    expect(migration).not.toMatch(/\bexecute\s+(format|'|\$|v_|p_)/i);
    const functions = migration.match(/create or replace function[\s\S]*?\$function\$;/g) || [];
    expect(functions.length).toBe(9);
    for (const fn of functions) expect(fn).toMatch(/set search_path to 'public', ?'pg_catalog'/);
    for (const helper of [
      'dawaa_followup_conversation_sources_v1(text)',
      'dawaa_followup_branch_change_allowed_v1(text, text)',
      'dawaa_guard_followup_conversation_branch_v1()',
    ]) {
      expect(migration).toContain(`revoke all on function public.${helper} from public, anon, authenticated;`);
    }
    expect(migration).toContain(
      'revoke all on function public.repair_customer_followup_duplicates_and_branches() from public, anon, authenticated;'
    );
  });

  it('is prepared only: no data rewrite runs as part of the migration', () => {
    expect(migration).toMatch(/NOT APPLIED/);
    expect(migration).not.toMatch(/select public\.repair_customer_followup_duplicates_and_branches\(\)/);
    expect(migration.replace(/create or replace function[\s\S]*?\$function\$;/g, '')).not.toMatch(/^\s*(update|delete|insert)\s/im);
  });
});

describe('release candidate reconciliation report', () => {
  const report = read('supabase/readonly/release_candidate_reconciliation_v1.sql');
  it('is read only: a READ ONLY transaction, no write or DDL statement, and a final rollback', () => {
    expect(report).toMatch(/^begin transaction isolation level repeatable read read only;$/m);
    expect(report.trim().endsWith('rollback;')).toBe(true);
    expect(report).not.toMatch(/^\s*(update|delete|insert|merge|create|alter|drop|truncate|grant|revoke)\b/im);
  });
});
