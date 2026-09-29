import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveCanonicalAnalyticalSources,
  type CanonicalGateSourceRow,
} from '../salesIntelligence/persistence/canonicalSourceGate';
import {
  loadOperationalSourceIds,
  WHATSAPP_OPERATIONAL_SOURCE_OWNER,
} from '../whatsappOperationalSourceOwner';

// STEP 3C-3 — one owner for "is this WhatsApp source operationally canonical now?".
// DB owner: whatsapp_operational_canonical_sources_v1 (V51). TS owner: the Canonical Source Gate.
// The SQL integration test (supabase/tests/operational_canonical_source_gate_v51.test.sql) runs these
// same fixtures against the live view; its expected verdict map must equal the TS verdicts here.

const root = path.resolve(__dirname, '../../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const sqlTest = read('supabase/tests/operational_canonical_source_gate_v51.test.sql');
const sqlExpected = JSON.parse(sqlTest.match(/-- expected-verdicts: (\{.*\})/)![1]) as Record<
  string,
  boolean
>;

const T0 = Date.parse('2026-01-10T10:00:00Z');
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();
const row = (
  id: string,
  file: string,
  status: string,
  raw: string,
  start: number,
  end: number
): CanonicalGateSourceRow => ({
  id,
  source_filename: file,
  review_status: status,
  raw_text: raw,
  conversation_started_at: at(start),
  conversation_ended_at: at(end),
});

const fixtures: CanonicalGateSourceRow[] = [
  row('fx51-fine-a', 'fx51-a.zip', 'ready_detailed', 'A1: hello\nA2: order', 0, 5),
  row('fx51-fine-b', 'fx51-a.zip', 'ready_detailed', 'B1: evening', 480, 485),
  row(
    'fx51-exact-coarse',
    'fx51-a.zip',
    'ready_detailed',
    'A1: hello\nA2: order\nB1: evening',
    0,
    485
  ),
  row(
    'fx51-partial-coarse',
    'fx51-a.zip',
    'ready_detailed',
    'A1: hello\nA2: order\nYou: extra outbound',
    0,
    30
  ),
  row('fx51-historical', 'fx51-b.zip', 'needs_context', 'H1: old context', 0, 5),
  row('fx51-archived', 'fx51-b.zip', 'archived', 'R1: archived copy', 100, 105),
  row('fx51-ambiguous', 'fx51-b.zip', 'ready_detailed', 'M1: two owners', 200, 205),
  row('fx51-fine-c', 'fx51-c.zip', 'ready_detailed', 'C1: fine inside', 10, 15),
  row('fx51-owned-coarse', 'fx51-c.zip', 'ready_detailed', 'C0: before\nC1: fine inside', 0, 20),
];
const ownership = new Map<string, string[]>([
  ['fx51-fine-a', ['case-fine-a']],
  ['fx51-fine-b', ['case-fine-b']],
  ['fx51-archived', ['case-archived']],
  ['fx51-ambiguous', ['case-ambiguous', 'case-ambiguous-2']],
  ['fx51-fine-c', ['case-fine-c']],
  ['fx51-owned-coarse', ['case-owned-coarse']],
]);

const { canonicalIds, decisions } = resolveCanonicalAnalyticalSources(fixtures, ownership);
const verdict = (id: string) => canonicalIds.has(id);
const reason = (id: string) => {
  const decision = decisions.get(id);
  return decision && 'reason' in decision ? decision.reason : null;
};

describe('Canonical Operational Source Gate — one owner, TS and DB agree', () => {
  it('1. exact coarse source → not operational', () => {
    expect(verdict('fx51-exact-coarse')).toBe(false);
    expect(reason('fx51-exact-coarse')).toBe('superseded_by_finer_canonical_sources');
  });

  it('2. partial coarse source → not operational', () => {
    expect(verdict('fx51-partial-coarse')).toBe(false);
    expect(reason('fx51-partial-coarse')).toBe('superseded_by_finer_canonical_sources');
  });

  it('3. historical pre-V22 source → not operational', () => {
    expect(verdict('fx51-historical')).toBe(false);
    expect(reason('fx51-historical')).toBe('no_customer_case_v22');
  });

  it('4. canonical fine sources → operational', () => {
    expect(['fx51-fine-a', 'fx51-fine-b', 'fx51-fine-c'].every(verdict)).toBe(true);
  });

  it('5. archived source → not operational, even with a V22 case', () => {
    expect(verdict('fx51-archived')).toBe(false);
    expect(reason('fx51-archived')).toBe('source_archived');
  });

  it('6. ambiguous ownership → fail closed', () => {
    expect(verdict('fx51-ambiguous')).toBe(false);
    expect(reason('fx51-ambiguous')).toBe('multiple_customer_cases_v22');
    expect(verdict('fx51-owned-coarse')).toBe(false);
  });

  it('the TS gate verdicts equal the DB owner verdicts asserted by the live SQL test', () => {
    expect(Object.fromEntries(fixtures.map((item) => [item.id, verdict(item.id)]))).toEqual(
      sqlExpected
    );
  });

  it('the SQL test covers raw history, story history, current story, recovery, doctor evidence and lifecycle', () => {
    for (const label of [
      'T7 raw history',
      'T8 story history',
      'T9 current story',
      'T10 recovery queue',
      'T11 doctor product evidence',
      'T12 lifecycle',
    ]) {
      expect(sqlTest).toContain(label);
    }
    expect(sqlTest).toMatch(/raise exception 'V51_TEST_RESULT %'/);
  });
});

describe('the DB owner mirrors the Canonical Source Gate rule', () => {
  const v51 = read(
    'supabase/migrations/20260929161040_whatsapp_operational_canonical_source_gate_v51.sql'
  );
  const owner = v51.slice(
    v51.indexOf('create or replace view public.whatsapp_operational_canonical_sources_v1'),
    v51.indexOf('comment on view public.whatsapp_operational_canonical_sources_v1')
  );

  it('not archived, exactly one V22 owner, not superseded by a V22-owned contained sibling', () => {
    expect(owner).toMatch(/coalesce\(s\.review_status, ''\) <> 'archived'/);
    expect(owner).toMatch(/o\.owner_count = 1/);
    expect(owner).toMatch(/position\(f\.raw_text in s\.raw_text\) > 0/);
    expect(owner).toMatch(/exists \(select 1 from owners o2 where o2\.source_id = f\.id\)/);
    expect(owner).not.toMatch(/invoice_match_status|message_count|created_at/);
  });

  it('every operational reader view is routed through the owner', () => {
    for (const view of [
      'whatsapp_recovery_work_queue_v1',
      'whatsapp_product_journey_detail_v1',
      'whatsapp_product_demand_unresolved_detail_v22',
      'whatsapp_order_lifecycle_v19',
      'whatsapp_source_evaluation_coverage_v17',
      'whatsapp_customer_story_360_v1',
    ]) {
      const start = v51.indexOf(`create or replace view public.${view}`);
      const next = v51.indexOf('create or replace view', start + 10);
      const body = v51.slice(start, next === -1 ? undefined : next);
      expect(start, view).toBeGreaterThan(-1);
      expect(body, view).toContain('whatsapp_operational_canonical_sources_v1');
    }
  });

  it('the parity audit runs in the Sales Intelligence gate', () => {
    expect(read('.github/workflows/sales-intelligence-final-readonly-gate.yml')).toContain(
      'scripts/check-whatsapp-operational-source-owner-parity.ts'
    );
    expect(read('scripts/check-whatsapp-operational-source-owner-parity.ts')).toMatch(
      /loadCanonicalAnalyticalSources\(client, rows\)/
    );
  });
});

describe('frontend readers ask the owner and fail closed', () => {
  it('the client helper reads only the owner and throws on failure', async () => {
    const calls: string[] = [];
    const client = {
      from: (table: string) => {
        calls.push(table);
        const chain: any = {
          select: () => chain,
          in: () => Promise.resolve({ data: null, error: { message: 'down' } }),
        };
        return chain;
      },
    };
    await expect(loadOperationalSourceIds(client, ['a'])).rejects.toThrow(
      'operational_source_owner_lookup_failed'
    );
    expect(calls).toEqual([WHATSAPP_OPERATIONAL_SOURCE_OWNER]);
  });

  it('Doctor Cycle has no staff fallback and uses only owner-admitted sources', () => {
    const code = read('src/components/reviews/WhatsAppDoctorCycleIntelligenceV8.tsx');
    expect(code).toMatch(/loadOperationalSourceIds\(supabase, ownedSourceIds\)/);
    expect(code).not.toMatch(
      /eq\('staff_id', row\.owner_account_id\)|eq\('staff_name', row\.owner_name/
    );
  });

  it('Story 360 separates current canonical sessions from historical evidence', () => {
    const code = read('src/components/reviews/WhatsAppCustomerStory360V16.tsx');
    expect(code).toMatch(/loadOperationalSourceIds\(supabase/);
    expect(code).toMatch(/const currentSessions = sessions\.filter\(\(row\) => row\.operational\)/);
    expect(code).toMatch(/دليل تاريخي/);
  });

  it('Review Queue pending work is canonical-only and fails closed', () => {
    const code = read('src/pages/WhatsAppReviewQueueV4.tsx');
    expect(code).toMatch(/loadOperationalSourceIds\(supabase/);
    expect(code).toMatch(/status === 'pending' && \(!row\.operational/);
  });
});
