import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { supabase } from '../supabase';
import {
  assignAttendancePolicy,
  createAttendancePolicyVersion,
  getAttendancePolicyRollout,
  setAttendancePolicyRollout,
} from '../hr/workforceServiceLegacy';

// Regression for /hr-settings: HRSettings and its AttendancePolicyGovernance panel each loaded
// list_attendance_policy_rollout_v1 on mount. Concurrent loads now share one in-flight request only.

type RpcResult = { data: unknown; error: { message: string } | null };
type Pending = { name: string; resolve: (value: RpcResult) => void };

function installRpc() {
  const client = supabase as unknown as { rpc: (name: string, args?: unknown) => Promise<RpcResult> };
  const original = client.rpc;
  const calls: string[] = [];
  const pending: Pending[] = [];
  client.rpc = (name: string) => {
    calls.push(name);
    return new Promise<RpcResult>((resolve) => pending.push({ name, resolve }));
  };
  const settle = (name: string, value: RpcResult) => {
    const index = pending.findIndex((entry) => entry.name === name);
    if (index < 0) throw new Error(`no pending ${name}`);
    const [entry] = pending.splice(index, 1);
    entry.resolve(value);
  };
  const restore = () => {
    client.rpc = original;
  };
  return { calls, settle, restore, rolloutCalls: () => calls.filter((name) => name === 'list_attendance_policy_rollout_v1').length };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const row = { id: 'r1', scope_type: 'default', mode: 'shadow' };

describe('attendance policy rollout in-flight dedupe', () => {
  it('concurrent callers share one in-flight request', async () => {
    const rpc = installRpc();
    try {
      const loads = [getAttendancePolicyRollout(), getAttendancePolicyRollout(), getAttendancePolicyRollout()];
      expect(rpc.rolloutCalls()).toBe(1);
      expect(loads[0] === loads[1] && loads[1] === loads[2]).toBe(true);
      rpc.settle('list_attendance_policy_rollout_v1', { data: [row], error: null });
      const results = await Promise.all(loads);
      expect(results.every((result) => result.length === 1 && result[0].id === 'r1')).toBe(true);
    } finally {
      rpc.restore();
    }
  });

  it('keeps no cache after the request settles', async () => {
    const rpc = installRpc();
    try {
      const first = getAttendancePolicyRollout();
      rpc.settle('list_attendance_policy_rollout_v1', { data: [row], error: null });
      await first;
      await flush();
      const second = getAttendancePolicyRollout();
      expect(rpc.rolloutCalls()).toBe(2);
      rpc.settle('list_attendance_policy_rollout_v1', { data: [], error: null });
      expect(await second).toEqual([]);
    } finally {
      rpc.restore();
    }
  });

  it('every policy/rollout write invalidates the in-flight request', async () => {
    for (const [write, rpcName] of [
      [() => setAttendancePolicyRollout({ scopeType: 'default', mode: 'shadow', effectiveFrom: '2026-10-15' }), 'set_attendance_policy_rollout_v1'],
      [() => assignAttendancePolicy({ policyVersionId: 'p1', scopeType: 'branch', scopeKey: 'فرع شكري', effectiveFrom: '2026-10-15' }), 'assign_attendance_policy_v1'],
      [() => createAttendancePolicyVersion({ policyCode: 'v3', effectiveFrom: '2026-10-15', lateGraceMinutes: 10, veryLateMinutes: 30 }), 'create_attendance_policy_version_v1'],
    ] as const) {
      const rpc = installRpc();
      try {
        const before = getAttendancePolicyRollout();
        const saving = write();
        rpc.settle(rpcName, { data: {}, error: null });
        await saving;
        const after = getAttendancePolicyRollout();
        expect(after === before).toBe(false);
        expect(rpc.rolloutCalls()).toBe(2);
        rpc.settle('list_attendance_policy_rollout_v1', { data: [], error: null });
        rpc.settle('list_attendance_policy_rollout_v1', { data: [row], error: null });
        await Promise.all([before, after]);
      } finally {
        rpc.restore();
      }
    }
  });

  it('errors reach every waiter, are not retained, and are not retried', async () => {
    const rpc = installRpc();
    try {
      const loads = [getAttendancePolicyRollout(), getAttendancePolicyRollout()];
      rpc.settle('list_attendance_policy_rollout_v1', { data: null, error: { message: 'statement timeout' } });
      const outcomes = await Promise.allSettled(loads);
      expect(outcomes.every((outcome) => outcome.status === 'rejected' && String(outcome.reason?.message) === 'statement timeout')).toBe(true);
      await flush();
      expect(rpc.rolloutCalls()).toBe(1);
      const next = getAttendancePolicyRollout();
      expect(rpc.rolloutCalls()).toBe(2);
      rpc.settle('list_attendance_policy_rollout_v1', { data: [row], error: null });
      expect((await next).length).toBe(1);
    } finally {
      rpc.restore();
    }
  });

  it('no cross-user reuse: nothing survives a settled request, and an identity change reloads the app', () => {
    const service = fs.readFileSync(path.join(process.cwd(), 'src/lib/hr/workforceServiceLegacy.ts'), 'utf8');
    expect(service).toMatch(/if \(rolloutInFlight === request\) rolloutInFlight = null;/);
    const auth = fs.readFileSync(path.join(process.cwd(), 'src/hooks/useAuth.ts'), 'utf8');
    expect(auth).toMatch(/function discardPreviousAccountMemory[\s\S]*window\.location\.replace\('\/login'\)[\s\S]*window\.location\.reload\(\)/);
  });
});
