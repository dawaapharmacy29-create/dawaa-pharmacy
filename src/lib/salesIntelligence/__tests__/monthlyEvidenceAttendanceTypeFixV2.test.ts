import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  'supabase/migrations/20261005150000_monthly_evidence_attendance_type_fix_v2.sql',
  'utf8'
);

describe('Monthly Evaluation attendance identity compatibility V2', () => {
  it('compares the legacy attendance text staff id to the canonical uuid as text', () => {
    expect(source).toContain("nullif(trim(coalesce(a.staff_id,'')),'')=p_staff_id::text");
  });

  it('keeps modern attendance on the native uuid identity', () => {
    expect(source).toContain('l.staff_id=p_staff_id');
  });

  it('keeps monthly evidence on canonical review and operational followup read models', () => {
    expect(source).toContain('conversation_sales_reviews_canonical_v2');
    expect(source).toContain('customer_followup_operations_v2');
  });
});
