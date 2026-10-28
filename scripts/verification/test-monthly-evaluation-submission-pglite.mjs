import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';

const db = new PGlite();
await db.exec(`
  create schema if not exists public;
  create table public.staff_monthly_manager_evaluations (
    id integer generated always as identity primary key,
    status text not null default 'draft',
    sections jsonb not null,
    evaluator_id uuid not null,
    evaluator_role text not null,
    metrics_snapshot jsonb not null default '{}'::jsonb
  );
  create role anon;
  create role authenticated;
`);

const migration = readFileSync(new URL('../../supabase/migrations/20261028053227_monthly_evaluation_submission_autosave_v1.sql', import.meta.url), 'utf8');
await db.exec(migration);

const actor = '11111111-1111-4111-8111-111111111111';
const sections = JSON.stringify([{ key: 'inventory', score: 4, weight: 100, notes: 'تمت مراجعة الجرد والنتائج بالتفصيل' }]);
await db.query('insert into public.staff_monthly_manager_evaluations (sections,evaluator_id,evaluator_role) values ($1,$2,$3)', [sections, actor, 'branch_manager']);

async function update(role, state, status = 'draft', reason = '') {
  return db.query(`update public.staff_monthly_manager_evaluations
    set evaluator_role=$1, status=$2,
      metrics_snapshot=jsonb_build_object('review_workflow',jsonb_build_object('state',$3::text,'return_reason',$4::text))
    where id=1 returning metrics_snapshot`, [role, status, state, reason]);
}

async function expectBlocked(run, expected) {
  await assert.rejects(run, (error) => String(error.message).includes(expected));
}

await expectBlocked(() => update('branch_manager', 'editing', 'sent'), 'monthly_evaluation_requires_branches_manager_approval');
await db.query("update public.staff_monthly_manager_evaluations set sections='[{\"key\":\"inventory\",\"score\":0,\"notes\":\"\"}]'::jsonb where id=1");
await expectBlocked(() => update('branch_manager', 'submitted'), 'monthly_evaluation_submit_requires_all_scores');
await db.query("update public.staff_monthly_manager_evaluations set sections='[{\"key\":\"inventory\",\"score\":4,\"notes\":\"short\"}]'::jsonb where id=1");
await expectBlocked(() => update('branch_manager', 'submitted'), 'monthly_evaluation_inventory_submit_requires_rationale');
await db.query('update public.staff_monthly_manager_evaluations set sections=$1 where id=1', [sections]);
const submitted = await update('branch_manager', 'submitted');
assert.equal(submitted.rows[0].metrics_snapshot.review_workflow.state, 'submitted');
assert.equal(submitted.rows[0].metrics_snapshot.review_workflow.submitted_by, actor);
await expectBlocked(() => update('branch_manager', 'editing'), 'monthly_evaluation_submitted_locked_for_branch_manager');
await expectBlocked(() => update('branches_manager', 'returned', 'draft', 'short'), 'monthly_evaluation_return_reason_required');
await update('branches_manager', 'returned', 'draft', 'مطلوب إعادة مراجعة اختلافات الجرد بالتفصيل');
await update('branch_manager', 'editing');
await update('branch_manager', 'submitted');
await update('branches_manager', 'submitted', 'sent');
const final = await db.query('select status from public.staff_monthly_manager_evaluations where id=1');
assert.equal(final.rows[0].status, 'sent');
await db.close();
console.log('PASS: draft -> submit -> branch locked -> return -> resubmit -> branches approval');
