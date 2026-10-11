import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  'supabase/migrations/20261005133100_monthly_evidence_canonical_reads_v2.sql',
  'utf8'
);

describe('monthly evidence canonical reads V2', () => {
  it('reads canonical reviews rather than the raw review table', () => {
    expect(source).toContain('from public.conversation_sales_reviews_canonical_v2 r');
    expect(source).toContain("'read_model','canonical_v2'");
  });

  it('does not include the former one-time review reconciliation in the replayable migration', () => {
    expect(source).not.toMatch(/^\s*update\s+public\.conversation_sales_reviews\b/im);
  });

  it('counts only visible operational follow-ups in the monthly server snapshot', () => {
    expect(source).toContain('from public.customer_followup_operations_v2 f');
    expect(source).toContain('coalesce(f.is_hidden,false)=false');
    expect(source).toContain('f.archived_at is null');
    expect(source).toContain("f.handled_by_staff_id,''" );
  });
});
