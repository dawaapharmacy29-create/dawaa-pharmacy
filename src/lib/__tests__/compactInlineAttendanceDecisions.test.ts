import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { recommendedAttendanceDecisionIds } from '@/lib/attendance/compactDecisionChoices';
import { ensureApprovedPermissionForAttendance, type InlinePermissionApi } from '@/lib/attendance/inlinePermissionDecision';

const source = readFileSync(resolve(process.cwd(),
  'src/components/attendance/AttendanceResolutionCenter.tsx'),'utf8');

const baseCase = {
  issue_group: 'early_leave',
  resolution_status: 'early_leave_review',
  first_in: '2026-10-09T05:16:00+00:00',
  last_out: '2026-10-09T12:02:00+00:00',
  candidate_hours: 6.75,
};

const staffId='00000000-0000-0000-0000-000000000001';
const date='2026-10-09';
const input={staffId,date,minutes:60,note:'إذن معتمد بعد مراجعة الدليل'};
function request(status:'pending'|'approved',minutes=60,id='request-1') {
  return {id, staff_id:staffId, request_kind:'permission',start_date:date,
    end_date:date,duration_minutes:minutes,status};
}
function policy({allowed=true,warnings=[],blockers=[]}:{
  allowed?:boolean;warnings?:{code:string;label:string}[];blockers?:{code:string;label:string}[]
}={}) {return {allowed,warnings,blockers};}

function fakes(rows:ReturnType<typeof request>[] = []) {
  const listRequests=vi.fn().mockResolvedValue(rows);
  const createRequest=vi.fn().mockResolvedValue(request('pending'));
  const preflight=vi.fn().mockResolvedValue(policy());
  const approveRequest=vi.fn().mockResolvedValue(request('approved'));
  return {listRequests,createRequest,preflight,approveRequest} as unknown as InlinePermissionApi & {
    listRequests: ReturnType<typeof vi.fn>;createRequest: ReturnType<typeof vi.fn>;
    preflight: ReturnType<typeof vi.fn>;approveRequest: ReturnType<typeof vi.fn>;
  };
}

describe('compact decision choices by evidence, not employee name',()=>{
  it('recommends evidenced actual-hours approval, inline permission, proposed financial review',()=>{
    expect(recommendedAttendanceDecisionIds(baseCase)).toEqual(['approve_actual','permission','time_deduction']);
    expect(recommendedAttendanceDecisionIds({...baseCase,last_out:null})).not.toContain('approve_actual');
  });
  it('offers the right actions for absence and missing punches',()=>{
    expect(recommendedAttendanceDecisionIds({...baseCase,issue_group:'absence',resolution_status:'absence_review'}))
      .toEqual(['annual_leave','sick_leave','approved_absence']);
    expect(recommendedAttendanceDecisionIds({...baseCase,issue_group:'missing_punch',resolution_status:'missing_checkout'}))
      .toEqual(['forgot_out','device_fault','cross_branch']);
  });
  it('renders small accessible selection buttons rather than a long dropdown',()=>{
    expect(source).toContain('aria-label="القرارات السريعة"');
    expect(source).toContain('aria-pressed={reason === item.id}');
    expect(source).toContain('خيارات أخرى');
    expect(source).not.toContain('<select value={reason}');
    expect(source).toContain('disabled={!reason || selected.queue_lane');
    expect(source).toContain("decision.id === 'approve_actual'");
    expect(source).toContain('Number(selected.candidate_hours)');
    expect(source).toContain('اعتماد الإذن والحضور');
    expect(source).toContain('معامل الخصم المقترح');
    expect(source).not.toContain('<select value={multiplier}');
  });
});

describe('inline permission approval safety',()=>{
  it('reuses a matching approved permission and never recreates it',async()=>{
    const api=fakes([request('approved')]);
    expect(await ensureApprovedPermissionForAttendance(input,api)).toEqual({requestId:'request-1',minutes:60});
    expect(api.createRequest).not.toHaveBeenCalled();
    expect(api.preflight).not.toHaveBeenCalled();
    expect(api.approveRequest).not.toHaveBeenCalled();
  });
  it('creates and approves one permission after successful policy checks',async()=>{
    const api=fakes();
    const result=await ensureApprovedPermissionForAttendance(input,api);
    expect(result.requestId).toBe('request-1');
    expect(api.createRequest).toHaveBeenCalledTimes(1);
    expect(api.preflight).toHaveBeenCalledWith('request-1');
    expect(api.approveRequest).toHaveBeenCalledTimes(1);
    expect(api.createRequest).toHaveBeenCalledWith(expect.objectContaining({kind:'permission',durationMinutes:60}));
  });
  it('reuses existing pending request rather than creating a duplicate',async()=>{
    const api=fakes([request('pending')]);
    await ensureApprovedPermissionForAttendance(input,api);
    expect(api.createRequest).not.toHaveBeenCalled();
    expect(api.approveRequest).toHaveBeenCalledTimes(1);
  });
  it('rejects conflicting existing durations and duplicate requests',async()=>{
    const api=fakes([request('pending',30)]);
    await expect(ensureApprovedPermissionForAttendance(input,api)).rejects.toThrow(/بمدة مختلفة/);
    expect(api.createRequest).not.toHaveBeenCalled();
    expect(api.approveRequest).not.toHaveBeenCalled();
    const duplicate=fakes([request('pending'),request('pending',60,'request-2')]);
    await expect(ensureApprovedPermissionForAttendance(input,duplicate)).rejects.toThrow(/إذن آخر/);
    expect(duplicate.createRequest).not.toHaveBeenCalled();
  });
  it('fails closed on policy blockers or warnings without approval',async()=>{
    const blocked=fakes([request('pending')]);
    blocked.preflight.mockResolvedValue(policy({allowed:false,blockers:[{code:'overlap',label:'تداخل'}]}));
    await expect(ensureApprovedPermissionForAttendance(input,blocked)).rejects.toThrow(/تداخل/);
    expect(blocked.approveRequest).not.toHaveBeenCalled();
    const warn=fakes([request('pending')]);
    warn.preflight.mockResolvedValue(policy({warnings:[{code:'over_limit',label:'تجاوز الحد'}]}));
    await expect(ensureApprovedPermissionForAttendance(input,warn)).rejects.toThrow(/تجاوز الحد/);
    expect(warn.approveRequest).not.toHaveBeenCalled();
  });
  it('refuses missing or invalid durations before creating any request',async()=>{
    const api=fakes();
    await expect(ensureApprovedPermissionForAttendance({...input,minutes:0},api)).rejects.toThrow();
    await expect(ensureApprovedPermissionForAttendance({...input,minutes:1441},api)).rejects.toThrow();
    await expect(ensureApprovedPermissionForAttendance({...input,minutes:3.25},api)).rejects.toThrow();
    expect(api.listRequests).not.toHaveBeenCalled();
    expect(api.createRequest).not.toHaveBeenCalled();
  });
});
