// Contract A: one open follow-up per customer + branch, whatever its request_type.
// Behavior (including concurrency) is proven on native PostgreSQL by
// scripts/test-followup-contract-a-db.mjs; these checks keep the wiring from regressing.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FOLLOWUP_OPEN_CASE_EXISTS_MESSAGE,
  followupWriteErrorMessage,
} from '@/lib/api/followupWriteErrors';

const read = (file: string) => readFileSync(file, 'utf8');
const migration = read(
  'supabase/migrations/20261009180000_customer_followup_one_open_case_contract_a_v1.sql'
);

function body(signature: string) {
  const start = migration.search(
    new RegExp(`create or replace function public\\.${signature}\\(`, 'i')
  );
  expect(start).toBeGreaterThanOrEqual(0);
  const end = migration.indexOf('$function$;', migration.indexOf('$function$', start) + 10);
  return migration.slice(start, end);
}

describe('contract A migration', () => {
  it('looks up and locks the open case by customer + branch only', () => {
    const core = body('find_or_create_open_customer_followup');
    expect(core).toContain("'followup-open-case:' || v_identity || '|' || v_branch, 0");
    expect(core).not.toMatch(/request_type\), ''\), 'general'\) = v_case_type/);
    expect(core).toMatch(/'request_type',\s*v_case_type,\s*'case_request_type'/);
    const exceptional = body('dawaa_create_exceptional_followup_v2');
    expect(exceptional).toContain("'followup-open-case:'||v_identity||'|'||v_branch,0");
    expect(exceptional).toContain("'request_linked'");
    expect(body('list_open_followup_duplicate_groups_v1')).toMatch(
      /partition by d\.identity_key, coalesce\(d\.branch, ''\)\s/
    );
  });

  it('turns a unique_violation into a link or a named error, never a raw error', () => {
    for (const fn of [
      'find_or_create_open_customer_followup',
      'dawaa_create_exceptional_followup_v2',
    ]) {
      const text = body(fn);
      expect(text).toMatch(/when unique_violation then/);
      expect(text).toContain('followup_open_case_conflict');
      expect(text).not.toMatch(/^\s*raise;\s*$/m);
    }
  });

  it('does not touch the Production index or any data', () => {
    expect(migration).toMatch(/NOT APPLIED/);
    const ddl = migration.replace(/create or replace function[\s\S]*?\$function\$;/gi, '');
    expect(ddl).not.toMatch(/\b(create|drop|alter)\s+(unique\s+)?index\b/i);
    expect(ddl).not.toMatch(/^\s*(update|delete|insert)\s/im);
  });
});

describe('follow-up write errors shown to users', () => {
  it('never shows a raw unique-violation message', () => {
    const raw = {
      code: '23505',
      message:
        'duplicate key value violates unique constraint "daily_followups_one_open_case_per_customer_branch_uidx"',
    };
    expect(followupWriteErrorMessage(raw)).toBe(FOLLOWUP_OPEN_CASE_EXISTS_MESSAGE);
    expect(
      followupWriteErrorMessage({ message: 'duplicate key value violates unique constraint "x"' })
    ).toBe(FOLLOWUP_OPEN_CASE_EXISTS_MESSAGE);
    expect(followupWriteErrorMessage({ message: 'followup_open_case_conflict' })).not.toContain(
      'followup_open_case_conflict'
    );
    expect(
      followupWriteErrorMessage({ message: 'followup_client_request_scope_conflict' })
    ).not.toContain('scope_conflict');
    expect(followupWriteErrorMessage({ message: 'اسم العميل مطلوب' })).toBe('اسم العميل مطلوب');
    expect(followupWriteErrorMessage(null, 'fallback')).toBe('fallback');
  });

  it('every follow-up creation caller maps its error', () => {
    expect(read('src/lib/api/findOrCreateCustomerFollowup.ts')).toContain(
      'throw new Error(followupWriteErrorMessage(error));'
    );
    expect(read('src/lib/api/dailyFollowups.ts')).toContain(
      'throw new Error(followupWriteErrorMessage(error));'
    );
    for (const file of [
      'src/lib/api/customerServiceCommandCenter.ts',
      'src/lib/api/customerServiceSecureActions.ts',
    ]) {
      expect(read(file)).toContain(
        "throw new Error(followupWriteErrorMessage(error, 'تعذر إنشاء المتابعة الاستثنائية'));"
      );
    }
  });
});
