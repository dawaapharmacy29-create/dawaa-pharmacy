// Monthly evaluation safety: automatic analysis vs official human review vs payable points, Cairo cycle dates,
// 0..100 scale, and null-not-zero. SQL parity runs in isolated PGlite only.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  averageOfficialConversationScore,
  classifyConversationReview,
  conversationReviewOperationalDay,
  conversationReviewScore100,
  evaluationCycleOfDay,
  isOfficialConversationReview,
  isPayableConversationReview,
  selectOfficialConversationReviews,
} from '@/lib/evaluations/officialConversationReview';

const STAFF = '44444444-4444-4444-8444-444444444444';

type Review = Record<string, unknown>;
function review(id: string, overrides: Review = {}): Review {
  return {
    id, staff_id: STAFF, doctor_id: null, is_current: true, superseded_at: null, impact_status: 'approved',
    evaluation_kind: 'واتساب', automatic_evaluation_version: null, manager_reviewed_at: null, manager_reviewed_by: null,
    conversation_date: '2026-10-05T10:00:00.000Z', final_score: 90, total_score: 90, ...overrides,
  };
}

const FIXTURE: Review[] = [
  review('10000000-0000-4000-8000-000000000001'), // human reviewer, approved -> official
  review('10000000-0000-4000-8000-000000000002', { impact_status: 'pending', final_score: 40, total_score: 40 }), // human review, deduction awaiting approval
  review('10000000-0000-4000-8000-000000000003', { evaluation_kind: 'automatic', automatic_evaluation_version: 'auto-v1', final_score: 10, total_score: 10 }), // automatic 'approved' with zero points
  review('10000000-0000-4000-8000-000000000004', {
    evaluation_kind: 'automatic', automatic_evaluation_version: 'auto-v1', final_score: 70, total_score: 70,
    manager_reviewed_at: '2026-10-06T10:00:00.000Z', manager_reviewed_by: 'manager-1',
  }), // automatic, explicitly approved by a manager -> official
  review('10000000-0000-4000-8000-000000000005', { is_current: false, superseded_at: '2026-10-07T00:00:00Z', final_score: 0, total_score: 0 }),
  // 22:30 UTC on the 25th is 01:30 on the 26th in Cairo: it belongs to the cycle that starts on the 26th.
  review('10000000-0000-4000-8000-000000000006', { conversation_date: '2026-09-25T22:30:00.000Z', final_score: 80, total_score: 80 }),
  review('10000000-0000-4000-8000-000000000007', { conversation_date: '2026-09-25T20:00:00.000Z', final_score: 20, total_score: 20 }), // 23:00 Cairo, 25th: previous cycle
];

describe('official conversation review contract', () => {
  it('separates automatic analysis, official human review and payable points', () => {
    expect(FIXTURE.map(classifyConversationReview)).toEqual([
      'official', 'official', 'automatic_unapproved', 'official', 'superseded', 'official', 'official',
    ]);
    // A valid human review counts without a general-manager review, even while its penalty is pending...
    expect(isOfficialConversationReview(FIXTURE[1])).toBe(true);
    // ...but its points are not payable until the points effect is approved.
    expect(isPayableConversationReview(FIXTURE[1])).toBe(false);
    expect(isPayableConversationReview(FIXTURE[0])).toBe(true);
    expect(isPayableConversationReview(FIXTURE[2])).toBe(false);
    expect(isPayableConversationReview(FIXTURE[3])).toBe(true);
  });

  it('keeping reviews with pending penalties avoids an upward bias in the average', () => {
    const window = { startDay: '2026-10-01', endDayExclusive: '2026-10-26' };
    const withPenalty = selectOfficialConversationReviews([FIXTURE[0], FIXTURE[1]], window).rows;
    expect(averageOfficialConversationScore(withPenalty)).toBe(65);
  });

  it('places conversations by the Cairo operational day in the 26 -> 25 cycle', () => {
    expect(conversationReviewOperationalDay(FIXTURE[5])).toBe('2026-09-26');
    expect(conversationReviewOperationalDay(FIXTURE[6])).toBe('2026-09-25');
    expect(evaluationCycleOfDay('2026-09-26')).toEqual({ cycleStart: '2026-09-26', cycleEndExclusive: '2026-10-26' });
    expect(evaluationCycleOfDay('2026-09-25')).toEqual({ cycleStart: '2026-08-26', cycleEndExclusive: '2026-09-26' });
    expect(evaluationCycleOfDay('2026-01-10')).toEqual({ cycleStart: '2025-12-26', cycleEndExclusive: '2026-01-26' });
  });

  it('averages only official, in-cycle rows and reports what it left out', () => {
    const selection = selectOfficialConversationReviews(FIXTURE, { startDay: '2026-09-26', endDayExclusive: '2026-10-26' });
    expect(selection.rows.map((row) => row.id)).toEqual([FIXTURE[0].id, FIXTURE[1].id, FIXTURE[3].id, FIXTURE[5].id]);
    expect(selection).toMatchObject({ pointsPendingApproval: 1, automaticUnapproved: 1, superseded: 1, outsideCycle: 1 });
    expect(averageOfficialConversationScore(selection.rows)).toBe(70);
  });

  it('shows null ("under review"), never 0, when nothing is approved or scoreable', () => {
    expect(averageOfficialConversationScore([])).toBeNull();
    expect(averageOfficialConversationScore([FIXTURE[2], FIXTURE[4]])).toBeNull();
    expect(conversationReviewScore100({ final_score: 140 })).toBeNull();
    expect(conversationReviewScore100({ final_score: null, total_score: null })).toBeNull();
    expect(conversationReviewScore100({ final_score: 0 })).toBe(0);
  });

  it('an automatic impact_status=approved is not a staff-points approval', () => {
    expect(isOfficialConversationReview(FIXTURE[2])).toBe(false);
  });
});

async function evaluationDb() {
  const db = new PGlite();
  await db.exec(`
    set timezone = 'UTC';
    create role anon; create role authenticated; create role service_role;
    create table conversation_sales_reviews_canonical_v2(
      id uuid primary key, staff_id uuid, doctor_id uuid, branch text, conversation_date timestamptz, created_at timestamptz default now(),
      final_score numeric, total_score numeric, impact_status text, manager_reviewed_at timestamptz, manager_reviewed_by text,
      automatic_evaluation_version text, evaluation_kind text, is_current boolean, superseded_at timestamptz);
    create table customer_followup_operations_v2(id uuid, staff_id uuid, assigned_staff_id uuid, requested_by_staff_id text,
      assigned_to_staff_id text, handled_by_staff_id text, is_hidden boolean, archived_at timestamptz, created_at timestamptz);
    create table attendance(staff_id text, attendance_date date, date date);
    create table staff_attendance_logs(staff_id uuid, status text, shift_date date);
  `);
  await db.exec(readFileSync(resolve('supabase/migrations/20261026091000_monthly_official_conversation_reviews_v1.sql'), 'utf8'));
  for (const row of FIXTURE) {
    await db.query(
      `insert into conversation_sales_reviews_canonical_v2(id,staff_id,doctor_id,conversation_date,final_score,total_score,impact_status,
        manager_reviewed_at,manager_reviewed_by,automatic_evaluation_version,evaluation_kind,is_current,superseded_at)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [row.id, row.staff_id, row.doctor_id, row.conversation_date, row.final_score, row.total_score, row.impact_status,
        row.manager_reviewed_at, row.manager_reviewed_by, row.automatic_evaluation_version, row.evaluation_kind, row.is_current, row.superseded_at]);
  }
  return db;
}

describe('official conversation review SQL mirror (isolated PGlite)', () => {
  it('the monthly official view selects exactly the rows the TypeScript contract calls official', async () => {
    const db = await evaluationDb();
    try {
      const sql = await db.query<{ id: string; operational_day: string }>(
        `select id::text, operational_day::text from conversation_sales_reviews_monthly_official_v1 order by id`);
      const ts = FIXTURE.filter(isOfficialConversationReview).map((row) => String(row.id)).sort();
      expect(sql.rows.map((row) => row.id)).toEqual(ts);
      expect(sql.rows.find((row) => row.id === FIXTURE[5].id)?.operational_day).toBe('2026-09-26');
    } finally {
      await db.close();
    }
  });

  it('the server evidence RPC counts official reviews by Cairo day and exposes points-pending/automatic counts', async () => {
    const db = await evaluationDb();
    try {
      const result = await db.query<{ r: any }>(`select dawaa_monthly_evaluation_server_evidence_v5($1,'2026-10-01') r`, [STAFF]);
      const evidence = result.rows[0].r;
      expect(evidence.cycle_start).toBe('2026-09-26');
      expect(evidence.counts).toMatchObject({
        conversation_reviews: 4,
        conversation_reviews_points_pending_approval: 1,
        conversation_reviews_automatic_unapproved: 1,
      });
      const previous = await db.query<{ r: any }>(`select dawaa_monthly_evaluation_server_evidence_v5($1,'2026-09-01') r`, [STAFF]);
      expect(previous.rows[0].r.counts.conversation_reviews).toBe(1); // only the 23:00-Cairo row of the 25th
    } finally {
      await db.close();
    }
  });
});
