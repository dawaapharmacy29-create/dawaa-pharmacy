#!/usr/bin/env node
// Deterministic local SQL behavior test. No remote DB, credentials or production writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migrations = [
  '20261026090000_whatsapp_action_materialization_lifecycle_v1.sql',
  '20261026091000_monthly_official_conversation_reviews_v1.sql',
  '20261026092000_customer_followup_obligations_v1.sql',
  '20261026093000_conversation_review_points_follow_approval_v1.sql',
  '20261026094000_conversation_reviews_official_view_truth_v1.sql',
];
const staffId = '44444444-4444-4444-8444-444444444444';
const db = new PGlite();

async function review(id, impactStatus, pointsImpact) {
  await db.query(`insert into public.conversation_sales_reviews
    (id,staff_id,conversation_date,final_score,total_score,impact_status,point_impact,
     doctor_points_impact,reviewer_id,reviewer_role,evaluation_kind)
    values ($1,$2,'2026-10-05T10:00:00Z',90,90,$3,$4,$4,'reviewer','team_dawaa_alpha','واتساب')`,
  [id, staffId, impactStatus, pointsImpact]);
}

async function points(reviewId, status, delta, source = 'conversation_evaluation') {
  await db.query(`insert into public.employee_transactions
    (staff_id,type,points,points_delta,source,source_id,status,month_cycle)
    values ($1,$2,$3,$4,$5,$6,$7,'2026-10')`,
  [staffId, delta < 0 ? 'penalty' : 'reward', Math.abs(delta), delta, source, reviewId, status]);
}

async function statuses(reviewId, source = 'conversation_evaluation') {
  const result = await db.query(`select status,points_delta from public.employee_transactions
    where source=$2 and source_id=$1 order by created_at,id`, [reviewId, source]);
  return result.rows.map(({ status, points_delta }) => ({ status, delta: Number(points_delta) }));
}

async function rejects(operation, expected) {
  await assert.rejects(operation, (error) => {
    assert.match(String(error?.message), expected);
    return true;
  });
}

try {
  // PGlite exposes PostgreSQL built-in gen_random_uuid but not the optional pgcrypto extension.
  const fixture = readFileSync('scripts/verification/fixtures/master-brain-native.sql', 'utf8')
    .replace('create extension if not exists pgcrypto;', '');
  await db.exec(fixture);
  for (const filename of migrations) {
    await db.exec(readFileSync(`supabase/migrations/${filename}`, 'utf8'));
  }

  const staleReward = '10000000-0000-4000-8000-000000000092';
  await review(staleReward, 'pending', -20);
  await points(staleReward, 'pending', 6);
  await db.query('update public.conversation_sales_reviews set impact_status=$1 where id=$2', ['approved', staleReward]);
  assert.deepEqual(await statuses(staleReward), [{ status: 'pending', delta: 6 }]);
  await rejects(points(staleReward, 'approved', 6), /conversation_review_points_delta_mismatch/);
  await points(staleReward, 'approved', -20);
  assert.deepEqual(await statuses(staleReward), [
    { status: 'pending', delta: 6 },
    { status: 'approved', delta: -20 },
  ]);

  const revisedReview = '10000000-0000-4000-8000-000000000093';
  await review(revisedReview, 'approved', 5);
  await points(revisedReview, 'approved', 5);
  await db.query('update public.conversation_sales_reviews set point_impact=-3,doctor_points_impact=-3 where id=$1', [revisedReview]);
  assert.deepEqual(await statuses(revisedReview), [{ status: 'pending', delta: 5 }]);
  await rejects(points(revisedReview, 'active', 5), /conversation_review_points_delta_mismatch/);
  await points(revisedReview, 'approved', -3);

  // Every review source listed by the official guard must obey the same
  // approval, signed-delta and revocation lifecycle. Older source names must
  // never become a financial bypass around conversation_evaluation.
  for (const [i, source] of [
    'whatsapp_automatic_review', 'conversation_review', 'conversation_sales_reviews',
  ].entries()) {
    const sourceReview = `10000000-0000-4000-8000-${String(95 + i).padStart(12, '0')}`;
    await review(sourceReview, 'pending', -3);
    await points(sourceReview, 'pending', -3, source);
    await rejects(points(sourceReview, 'approved', -3, source), /conversation_review_points_require_approved_review/);
    await db.query('update public.conversation_sales_reviews set impact_status=$1 where id=$2', ['approved', sourceReview]);
    assert.deepEqual(await statuses(sourceReview, source), [{ status: 'approved', delta: -3 }]);
    await rejects(points(sourceReview, 'approved', 4, source), /conversation_review_points_delta_mismatch/);
    await db.query('update public.conversation_sales_reviews set impact_status=$1 where id=$2', ['pending', sourceReview]);
    assert.deepEqual(await statuses(sourceReview, source), [{ status: 'pending', delta: -3 }]);
  }
  await rejects(points(null, 'approved', 3, 'conversation_review'), /conversation_review_points_require_source_id/);
  await rejects(points(null, 'pending', 3, 'whatsapp_automatic_review'), /conversation_review_points_require_source_id/);

  const revokedReview = '10000000-0000-4000-8000-000000000094';
  await review(revokedReview, 'approved', -4);
  await points(revokedReview, 'approved', -4);
  await db.query('update public.conversation_sales_reviews set impact_status=$1 where id=$2', ['pending', revokedReview]);
  assert.deepEqual(await statuses(revokedReview), [{ status: 'pending', delta: -4 }]);
  await rejects(points(revokedReview, 'approved', -4), /conversation_review_points_require_approved_review/);
  await db.query('update public.conversation_sales_reviews set impact_status=$1 where id=$2', ['approved', revokedReview]);
  assert.deepEqual(await statuses(revokedReview), [{ status: 'approved', delta: -4 }]);

  // Exercise the real central freeze trigger together with the new approval sync.
  // A review edit must never rewrite points already included in finalized payroll.
  await db.exec(`create table public.payroll_finalized_snapshots_v2 (staff_id uuid, month_cycle text);`);
  await db.exec(readFileSync('supabase/migrations/20261005134000_points_payroll_freeze_boundary_v5.sql', 'utf8'));
  await db.query('insert into public.payroll_finalized_snapshots_v2 values ($1,$2)', [staffId, '2026-10']);
  await rejects(
    db.query('update public.conversation_sales_reviews set impact_status=$1 where id=$2', ['pending', revokedReview]),
    /finalized_payroll_cycle_is_immutable/
  );
  assert.deepEqual(await statuses(revokedReview), [{ status: 'approved', delta: -4 }]);
  const frozenReview = await db.query('select impact_status from public.conversation_sales_reviews where id=$1', [revokedReview]);
  assert.equal(frozenReview.rows[0].impact_status, 'approved');
  await rejects(points(revokedReview, 'approved', -4), /finalized_payroll_cycle_is_immutable/);

  console.log('[whatsapp-review-points] PASS: mismatched rewards, corrected impacts, revocation, reapproval and finalized payroll immutability; no production writes');
} catch (error) {
  console.error('[whatsapp-review-points] FAIL:', error);
  process.exitCode = 1;
} finally {
  await db.close();
}
