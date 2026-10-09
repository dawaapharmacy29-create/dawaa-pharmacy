import { describe,expect,it } from 'vitest';
import { buildResponsibilityProjection } from '@/lib/performance/responsibilityProjection';
import type { EvaluationMetricProjection } from '@/lib/evaluations/evaluationMetrics';

const metric=(overrides:Partial<EvaluationMetricProjection>={}):EvaluationMetricProjection=>({
 subjectStaffId:'s',branch:'الشامي',taskCompletionRate:80,taskResolvedCount:5,taskCompletedCount:4,taskMissedCount:1,taskActiveCount:0,taskOnTimeCompletionRate:75,
 sourceCoverageRate:100,sourceAvailableCount:3,sourcePartialCount:0,sourceUnavailableCount:0,expectedSourceTypes:['task','shift_note','customer_request'],
 dataConfidence:'high',isTaskEvidenceReady:true,confidenceReasons:[],...overrides
});

describe('responsibility projection',()=>{
 it('returns a score only from a ready canonical metric',()=>{const r=buildResponsibilityProjection('delivery',metric());expect(r.state).toBe('ready');expect(r.score).toBe(80);});
 it('does not score active unresolved work as failure',()=>{const r=buildResponsibilityProjection('delivery',metric({taskActiveCount:2}));expect(r.state).toBe('pending');expect(r.score).toBeNull();});
 it('does not turn unavailable evidence into zero',()=>{const r=buildResponsibilityProjection('delivery',metric({isTaskEvidenceReady:false,dataConfidence:'unavailable',taskCompletionRate:null,sourceCoverageRate:null}));expect(r.state).toBe('unavailable');expect(r.score).toBeNull();});
 it('fails closed when role applicability is absent',()=>{const r=buildResponsibilityProjection('other',metric());expect(r.state).toBe('unavailable');expect(r.score).toBeNull();});
});
