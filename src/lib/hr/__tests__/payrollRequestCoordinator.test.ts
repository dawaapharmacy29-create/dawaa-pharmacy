import { describe, it, expect } from 'vitest';
import { markPayrollTruthChanged, runPayrollHeavyRequest } from '@/lib/hr/payrollRequestCoordinator';

describe('payroll request coordinator', () => {
  it('shares one in-flight request per key and never caches a failure', async () => {
    let calls = 0;
    const task = () => { calls += 1; return Promise.resolve(calls); };
    const [a, b] = await Promise.all([runPayrollHeavyRequest('statement:s1:2026-10', task), runPayrollHeavyRequest('statement:s1:2026-10', task)]);
    expect(a).toBe(1);
    expect(b).toBe(1);
    let failed = false;
    try { await runPayrollHeavyRequest('gate:s1:2026-10', () => Promise.reject(new Error('down'))); } catch { failed = true; }
    expect(failed).toBe(true);
    expect(await runPayrollHeavyRequest('gate:s1:2026-10', () => Promise.resolve('ok'))).toBe('ok');
  });

  it('a read after a payroll write never joins a request that started before it', async () => {
    let release: (v: string) => void = () => undefined;
    let calls = 0;
    const before = runPayrollHeavyRequest('statement:s2:2026-10', () => { calls += 1; return new Promise<string>((resolve) => { release = resolve; }); });
    markPayrollTruthChanged();
    const after = runPayrollHeavyRequest('statement:s2:2026-10', () => { calls += 1; return Promise.resolve('after'); });
    // Checked before awaiting: a joined request would otherwise wait on the pre-write promise.
    await Promise.resolve();
    await Promise.resolve();
    const callsAfterWrite = calls;
    release('before');
    expect(callsAfterWrite).toBe(2);
    expect(await after).toBe('after');
    expect(await before).toBe('before');
  });
});
