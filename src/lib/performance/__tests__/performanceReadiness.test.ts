import { describe, expect, it } from 'vitest';
import { buildEvaluationMetrics } from '@/lib/evaluations/evaluationMetrics';
import type { StaffTaskCompletionProjection } from '@/lib/tasks/taskCompletionProjection';

const base: StaffTaskCompletionProjection = {
  subjectStaffId:'s1', branch:'الشامي', completed:4, missed:1, active:2, cancelled:1,
  resolved:5, completionRate:80, onTimeCompleted:3, lateCompleted:1,
  sources:[
    {sourceType:'task',availability:'available',evidenceCount:5,resolvedCount:5,completedCount:4,missedCount:1,activeCount:0,cancelledCount:0,reason:null,observedAt:null},
    {sourceType:'customer_followup',availability:'unavailable',evidenceCount:0,resolvedCount:0,completedCount:0,missedCount:0,activeCount:0,cancelledCount:0,reason:'source outage',observedAt:null},
  ],
  availableSourceCount:1,partialSourceCount:0,unavailableSourceCount:1,hasUnavailableSources:true,
};

describe('evaluation readiness fail-closed contracts',()=>{
  it('does not become ready without explicit source applicability',()=>{
    const m=buildEvaluationMetrics([base])[0];
    expect(m.isTaskEvidenceReady).toBe(false);
    expect(m.dataConfidence).toBe('unavailable');
    expect(m.taskCompletionRate).toBe(80);
  });
  it('ignores an unavailable source that is not applicable to this staff member',()=>{
    const m=buildEvaluationMetrics([base],[{subjectStaffId:'s1',branch:'الشامي',expectedSourceTypes:['task']}])[0];
    expect(m.isTaskEvidenceReady).toBe(true);
    expect(m.dataConfidence).toBe('high');
    expect(m.sourceUnavailableCount).toBe(0);
  });
  it('keeps an applicable outage visible instead of converting it to a miss or zero',()=>{
    const m=buildEvaluationMetrics([base],[{subjectStaffId:'s1',branch:'الشامي',expectedSourceTypes:['task','customer_followup']}])[0];
    expect(m.taskMissedCount).toBe(1);
    expect(m.taskCompletionRate).toBe(80);
    expect(m.sourceUnavailableCount).toBe(1);
    expect(m.isTaskEvidenceReady).toBe(false);
  });
});
