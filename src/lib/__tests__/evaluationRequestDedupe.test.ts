import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  MAX_CONCURRENT_HEAVY_EVALUATION_REQUESTS,
  markManagerEvaluationChanged,
  shareEvaluationRequest,
} from '../evaluations/evaluationRequestCoordinator';

// Regression for the Production smoke finding: /weekly-evaluation/* issued
// calculate_weekly_manager_metrics_v5 ×14–21 and manager_weekly_evaluations ×7–12 per load, because the
// page, ManagerLiveIncentiveCard and ManagerMonthlyPerformanceReport (×2 under StrictMode) each sent the
// same reads independently.

const tick = (ms = 2) => new Promise((resolve) => setTimeout(resolve, ms));

describe('manager evaluation request dedupe', () => {
  it('identical concurrent reads (page + card + report + StrictMode replay) share one request', async () => {
    let calls = 0;
    const task = async () => {
      calls += 1;
      await tick();
      return { ok: true };
    };
    const key = `test-identical-${Date.now()}`;
    const results = await Promise.all(Array.from({ length: 8 }, () => shareEvaluationRequest(key, task, { heavy: true })));
    expect(calls).toBe(1);
    expect(results.every((result) => result.ok)).toBe(true);
  });

  it('nothing is cached after a request settles', async () => {
    let calls = 0;
    const key = `test-settled-${Date.now()}`;
    await shareEvaluationRequest(key, async () => ++calls);
    await shareEvaluationRequest(key, async () => ++calls);
    expect(calls).toBe(2);
  });

  it('a read issued after an evaluation write never joins an older in-flight request', async () => {
    let calls = 0;
    const key = `test-epoch-${Date.now()}`;
    const slow = async () => {
      calls += 1;
      await tick(5);
      return calls;
    };
    const before = shareEvaluationRequest(key, slow);
    markManagerEvaluationChanged();
    const after = shareEvaluationRequest(key, slow);
    await Promise.all([before, after]);
    expect(calls).toBe(2);
  });

  it('REQUEST_COUNT_BOUNDED: heavy aggregations never exceed the concurrency cap', async () => {
    let active = 0;
    let maxActive = 0;
    const heavy = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await tick(3);
      active -= 1;
    };
    await Promise.all(
      Array.from({ length: 7 }, (_, index) => shareEvaluationRequest(`test-heavy-${Date.now()}-${index}`, heavy, { heavy: true }))
    );
    expect(maxActive).toBeLessThanOrEqual(MAX_CONCURRENT_HEAVY_EVALUATION_REQUESTS);
  });

  it('a failed shared request rejects every waiter and is not retained', async () => {
    let calls = 0;
    const key = `test-fail-${Date.now()}`;
    const failing = async () => {
      calls += 1;
      await tick();
      throw new Error('statement timeout');
    };
    const outcomes = await Promise.allSettled([shareEvaluationRequest(key, failing), shareEvaluationRequest(key, failing)]);
    expect(outcomes.every((outcome) => outcome.status === 'rejected')).toBe(true);
    expect(calls).toBe(1);
    await shareEvaluationRequest(key, async () => ++calls);
    expect(calls).toBe(2);
  });

  it('every heavy evaluation read and its shared inputs go through the coordinator', () => {
    const service = fs.readFileSync(path.join(process.cwd(), 'src/lib/evaluations/managerEvaluationService.ts'), 'utf8');
    expect(service).toMatch(/shareEvaluationRequest\(\s*`metrics:[\s\S]*readWeeklyEvaluationMetrics[\s\S]*\{ heavy: true \}/);
    expect(service).toMatch(/shareEvaluationRequest\(\s*`fast:[\s\S]*readWeeklyAutoMetricsFast[\s\S]*\{ heavy: true \}/);
    expect(service).toMatch(/shareEvaluationRequest\(`checklist:/);
    expect(service).toMatch(/shareEvaluationRequest\(`history:/);
    expect(service).toMatch(/shareEvaluationRequest\(`sales-target:/);
    expect(service).toMatch(/save_manager_weekly_evaluation_v5[\s\S]*markManagerEvaluationChanged\(\);/);
  });
});
