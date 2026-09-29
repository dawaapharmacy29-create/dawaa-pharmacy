import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// STEP 3C-5 — Canonical Review Gate.
// Review storage (conversation_sales_reviews) and official eligibility
// (conversation_sales_reviews_official_v1, V52) are separate, like Sale Proof. The automatic review
// writer only writes (review + points) for a source the canonical operational owner admits, and
// only after the Customer Case V22 sync. V53 also prevents the points ledger from activating
// a review that the official owner excludes. Live behaviour is covered by the V52/V53 SQL tests.

const state = vi.hoisted(() => ({
  operational: new Set<string>(),
  ownerFails: false,
  tables: [] as string[],
  writes: [] as string[],
}));

vi.mock('@/lib/supabase', () => {
  const from = (table: string) => {
    state.tables.push(table);
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      in: (_column: string, ids: string[]) =>
        Promise.resolve(
          state.ownerFails
            ? { data: null, error: { message: 'owner down' } }
            : {
                data: ids
                  .filter((id) => state.operational.has(id))
                  .map((id) => ({ source_id: id })),
                error: null,
              }
        ),
      insert: () => {
        state.writes.push(table);
        return chain;
      },
    };
    return chain;
  };
  return { supabase: { from }, isSupabaseConfigured: true };
});
vi.mock('@/lib/staffIdentityMapping', () => ({ resolveStaffNameToStaffId: async () => null }));
vi.mock('@/lib/pointsPersistence', () => ({
  persistPointsTransaction: async () => {
    state.writes.push('points');
    return { error: null };
  },
}));

import { persistAutomaticWhatsAppReview } from '../whatsappAutomaticReviewPersistence';
import { persistCanonicalAutomaticReviews } from '../whatsappAutoIngestPipeline';
import { WHATSAPP_OPERATIONAL_SOURCE_OWNER } from '../whatsappOperationalSourceOwner';

const root = path.resolve(__dirname, '../../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

const context = (sourceId: string) =>
  ({
    sourceId,
    session: {
      id: 's',
      messages: [],
      outboundStaffNames: ['د. سارة'],
      startedAt: new Date(),
      endedAt: new Date(),
    },
    branch: 'فرع شكري',
    customerId: null,
    customerCode: null,
    customerName: null,
    customerPhone: null,
    staffName: 'د. سارة',
    reviewCycle: { label: '2026-09' },
  }) as any;

const emptyResult = (caseStatus: string) =>
  ({
    caseGraph: { journey: { status: 'synced', error: null }, customerCase: { status: caseStatus } },
    autoReviewsCreated: 0,
    autoReviewsSkipped: 0,
    autoReviewsSkippedNonCanonical: 0,
    autoReviewsPointsFailed: 0,
    errors: [] as string[],
  }) as any;

beforeEach(() => {
  state.operational = new Set();
  state.ownerFails = false;
  state.tables = [];
  state.writes = [];
});

describe('automatic review writer — canonical gate', () => {
  it('1. a canonical (owner-admitted) source passes the gate into scoring', async () => {
    state.operational.add('canonical-fine');
    const result = await persistAutomaticWhatsAppReview(context('canonical-fine'));
    expect(result.status).not.toBe('skipped_non_canonical_source');
    expect(result.status).toBe('skipped_no_staff'); // past the gate; staff resolution is next
    expect(state.tables).toContain(WHATSAPP_OPERATIONAL_SOURCE_OWNER);
  });

  it.each([
    ['3. zero-owner (historical, V22-less)', 'historical-source'],
    ['4. multi-owner ambiguous', 'ambiguous-source'],
    ['5. coarse / superseded', 'coarse-source'],
    ['6. archived', 'archived-source'],
  ])('%s source → no official review and no points', async (_label, sourceId) => {
    const result = await persistAutomaticWhatsAppReview(context(sourceId));
    expect(result.status).toBe('skipped_non_canonical_source');
    expect(state.writes).toEqual([]);
  });

  it('an unverifiable owner fails closed with no write', async () => {
    state.ownerFails = true;
    const result = await persistAutomaticWhatsAppReview(context('canonical-fine'));
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/canonical_ownership_unverified/);
    expect(state.writes).toEqual([]);
  });
});

describe('auto-ingest — reviews only after the V22 sync', () => {
  it('2. a failed Customer Case V22 sync writes no official review', async () => {
    state.operational.add('canonical-fine');
    const result = emptyResult('failed');
    await persistCanonicalAutomaticReviews([context('canonical-fine')], result);
    expect(result.autoReviewsSkippedNonCanonical).toBe(1);
    expect(state.tables).toEqual([]);
    expect(state.writes).toEqual([]);
  });

  it('a partial sync still checks every source; non-owned ones are skipped', async () => {
    state.operational.add('owned');
    const result = emptyResult('partial');
    await persistCanonicalAutomaticReviews([context('owned'), context('not-owned')], result);
    expect(result.autoReviewsSkippedNonCanonical).toBe(1);
    expect(result.autoReviewsSkipped).toBe(1); // owned source passed the gate (no staff here)
  });

  it('the pipeline defers automatic reviews until after syncCanonicalCaseGraphForFile', () => {
    const code = read('src/lib/whatsappAutoIngestPipeline.ts');
    const graph = code.indexOf('result.caseGraph = await syncCanonicalCaseGraphForFile(');
    const gate = code.indexOf(
      'await persistCanonicalAutomaticReviews(pendingAutomaticReviews, result)'
    );
    expect(graph).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(graph);
    expect(code.match(/persistAutomaticWhatsAppReview\(/g)?.length).toBe(1); // only inside the gate helper
  });

  it('12. the gate uses the source id owner only — no filename, legacy code, summary or order', () => {
    const writer = read('src/lib/whatsappAutomaticReviewPersistence.ts');
    const gate = writer.slice(
      writer.indexOf('Canonical Review Gate'),
      writer.indexOf('const introducedStaffNames')
    );
    expect(gate).toMatch(/loadOperationalSourceIds\(supabase, \[ctx\.sourceId\]\)/);
    expect(gate).not.toMatch(
      /source_filename|sourceFileName|fileName|customerCode|analysis_json|summary/
    );
  });
});

describe('official review eligibility — one owner, readers routed', () => {
  const v52 = read(
    'supabase/migrations/20260929165059_conversation_review_official_eligibility_v52.sql'
  );

  it('the owner view keeps storage separate and reuses the canonical operational owner', () => {
    const owner = v52.slice(
      v52.indexOf('create or replace view public.conversation_sales_reviews_official_v1'),
      v52.indexOf('comment on view public.conversation_sales_reviews_official_v1')
    );
    expect(owner).toMatch(/from public\.conversation_sales_reviews r/);
    expect(owner).toMatch(/r\.whatsapp_review_source_id is null/);
    expect(owner).toMatch(/public\.whatsapp_operational_canonical_sources_v1/);
    expect(v52).not.toMatch(/^\s*(update|delete)\s/im);
  });

  it('8-10. KPI, incentive and doctor quality readers are switched to the owner', () => {
    for (const reader of [
      'get_doctor_incentive_breakdown',
      'get_doctor_conversation_quality_summary',
      'get_doctor_competition_support_v1',
      'get_cs_manager_supporting_metrics_v1',
      'calculate_weekly_manager_metrics_v2',
    ]) {
      expect(v52).toContain(`'${reader}'`);
    }
    expect(v52).toMatch(/create or replace view public\.employee_kpi_30d_summary/);
    expect(v52).toMatch(/v52_reader_still_reads_storage/);
  });

  it('storage-level readers stay untouched by V52; points eligibility is hardened separately by V53', () => {
    for (const untouched of [
      'record_employee_points_transaction_v3',
      'dawaa_can_write_employee_transaction',
      'get_doctor_conversation_reviews_list',
    ]) {
      expect(v52).not.toContain(`'${untouched}'`);
    }
  });

  it('V53 blocks any live points effect for a non-official review', () => {
    const v53 = read(
      'supabase/migrations/20260929171000_conversation_review_points_canonical_gate_v53.sql'
    );
    expect(v53).toMatch(/trg_conversation_review_points_official_v53/);
    expect(v53).toMatch(/conversation_sales_reviews_official_v1/);
    expect(v53).toMatch(/conversation_review_points_require_official_review/);
    expect(v53).toMatch(/status\s*=\s*'cancelled'/);
    expect(v53).not.toMatch(/delete\s+from\s+public\.employee_transactions/i);

    const liveAudit = read('scripts/check-whatsapp-canonical-review-points-v53.cjs');
    expect(liveAudit).toMatch(/live_nonofficial_review_points_detected/);
    expect(liveAudit).toMatch(/conversation_sales_reviews_official_v1/);
  });

  it('frontend official KPI readers use the owner; storage screens keep the table', () => {
    expect(read('src/lib/dataSources.ts')).toMatch(
      /officialConversationReviews: 'conversation_sales_reviews_official_v1'/
    );
    for (const file of [
      'src/lib/doctorCompetitionMetrics.ts',
      'src/pages/DoctorCompetition.tsx',
      'src/lib/staff/staffPerformanceProfileService.ts',
      'src/lib/staff/employeeMonthlyEvidenceService.ts',
      'src/lib/reports/monthlyPerformance360Service.ts',
      'src/pages/StaffMonthlyEvaluationGeneral.tsx',
      'src/pages/CustomerServiceDoctorEvaluation.tsx',
      'src/pages/DoctorDashboardStable.tsx',
      'src/components/reviews/ReviewsInsightsHub.tsx',
      'src/pages/ReportsCenter.tsx',
    ]) {
      const code = read(file);
      expect(code, file).toContain('ANALYTICS_DATA_SOURCES.officialConversationReviews');
      expect(code, file).not.toMatch(/(from|safeSelect)\('conversation_sales_reviews'\)/);
    }
    // History / edit screens still read storage.
    expect(read('src/pages/Reviews.tsx')).toMatch(/from\('conversation_sales_reviews'\)/);
  });

  it('7, 11. the live SQL test covers storage, exclusion and counting once', () => {
    const sql = read('supabase/tests/canonical_review_gate_v52.test.sql');
    for (const label of [
      'T7 legacy review stored',
      'T8 excluded from official',
      'T11 canonical counted once',
      'T9 incentive reader gated',
      'T10 quality reader gated',
    ]) {
      expect(sql).toContain(label);
    }
  });
});
