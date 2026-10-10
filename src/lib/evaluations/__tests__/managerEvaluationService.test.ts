import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { supabase } from '@/lib/supabase';
import {
  saveWeeklyEvaluation,
  type ManagerEvaluationHistoryRecord,
  type ManagerWeeklyEvaluation,
} from '@/lib/evaluations/managerEvaluationService';

const originalRpc = supabase.rpc;

function mockRpc(handler: (...args: unknown[]) => Promise<unknown>) {
  Object.defineProperty(supabase, 'rpc', {
    configurable: true,
    value: handler,
  });
}

afterEach(() => {
  Object.defineProperty(supabase, 'rpc', {
    configurable: true,
    value: originalRpc,
  });
});

function evaluation(status: ManagerWeeklyEvaluation['status']): ManagerWeeklyEvaluation {
  return {
    evaluation_type: 'branch_manager',
    subject_staff_id: 'subject-staff-id',
    subject_name: 'Untrusted client subject name',
    branch: 'Branch A',
    evaluator_staff_id: 'client-actor-id',
    evaluator_name: 'Untrusted client evaluator name',
    week_start: '2026-09-26',
    week_end: '2026-10-02',
    auto_metrics: {
      sales_total: 100,
      purchases_total: 0,
      purchases_count: 0,
      inventory_sessions_due: 0,
      inventory_closed_on_time: 0,
      inventory_overdue: 0,
      followups_total: 0,
      followups_expired: 0,
      followups_closed: 0,
      attendance_late_minutes: 0,
      attendance_missing_punch: 0,
      active_customers: 0,
      vip_customers: 0,
      vip_customers_still_active: 0,
      vip_retention_rate: null,
      conversation_reviews_count: 0,
      conversation_reviews_avg_score: null,
      points_transactions_total: 0,
      points_transactions_contacted: 0,
      new_customers_count: 0,
    },
    manual_scores: { leadership: 8 },
    manual_note: 'Manager observation',
    total_score: 91,
    status,
  };
}

describe('managerEvaluationService saveWeeklyEvaluation', () => {
  it('calls the canonical RPC with server-owned identity omitted and preserves submitted status', async () => {
    const savedRow: ManagerEvaluationHistoryRecord = {
      ...evaluation('submitted'),
      id: 'saved-evaluation-id',
      subject_name: 'Canonical subject',
      evaluator_staff_id: 'verified-evaluator-id',
      evaluator_name: 'Verified evaluator',
      submitted_at: '2026-10-10T10:00:00Z',
    };
    let rpcName: unknown;
    let rpcArgs: unknown;
    mockRpc(async (name, args) => {
      rpcName = name;
      rpcArgs = args;
      return { data: savedRow, error: null };
    });

    const result = await saveWeeklyEvaluation(evaluation('submitted'));

    expect(rpcName).toBe('save_manager_weekly_evaluation_v5');
    expect(rpcArgs).toEqual({
      p_payload: {
        evaluation_type: 'branch_manager',
        subject_staff_id: 'subject-staff-id',
        branch: 'Branch A',
        week_start: '2026-09-26',
        week_end: '2026-10-02',
        manual_scores: { leadership: 8 },
        manual_note: 'Manager observation',
        status: 'submitted',
      },
    });
    expect(result).toEqual(savedRow);
  });

  it('propagates canonical RPC errors without attempting a direct-write fallback', async () => {
    let calls = 0;
    mockRpc(async () => {
      calls += 1;
      return { data: null, error: { message: 'manager evaluation RPC unavailable' } };
    });

    let caught: unknown;
    try {
      await saveWeeklyEvaluation(evaluation('draft'));
    } catch (error) {
      caught = error;
    }

    expect(calls).toBe(1);
    expect(caught instanceof Error).toBe(true);
    expect((caught as Error).message).toBe('manager evaluation RPC unavailable');
  });

  it('has no direct manager evaluation upsert in the save path', () => {
    const service = readFileSync(resolve(process.cwd(), 'src/lib/evaluations/managerEvaluationService.ts'), 'utf8');
    const savePath = service.match(
      /export async function saveWeeklyEvaluation[\s\S]*?(?=\nexport async function fetchEvaluationHistory)/
    )?.[0] ?? '';

    expect(savePath).toMatch(/supabase\.rpc\('save_manager_weekly_evaluation_v5'/);
    expect(savePath).not.toMatch(/\.from\([^)]*managerWeeklyEvaluations[^)]*\)\s*\.upsert\(/);
  });
});
