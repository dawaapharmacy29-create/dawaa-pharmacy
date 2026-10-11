import {describe,expect,it} from 'vitest';
import {buildPerformanceTaskEvidenceReadModel} from '@/lib/performance/performanceTaskEvidenceReadModel';
import type {TaskEvidenceSourceBatch} from '@/lib/tasks/taskCompletionProjection';

const staffId='11111111-1111-4111-8111-111111111111';
const branch='الشامي';
const batch=(sourceType:TaskEvidenceSourceBatch['sourceType'],availability:TaskEvidenceSourceBatch['availability']):TaskEvidenceSourceBatch=>({sourceType,availability,evidence:[],observedAt:'2026-09-25T20:00:00.000Z'});

describe('performance task evidence read model',()=>{
 it('fails closed when applicable role sources are not supplied',()=>{
   const m=buildPerformanceTaskEvidenceReadModel({staffId,branch,role:'doctor',batches:[]});
   expect(m?.taskCompletionRate).toBeNull(); expect(m?.isTaskEvidenceReady).toBe(false); expect(m?.sourceUnavailableCount).toBe(3);
 });
 it('does not let unrelated source outages affect a doctor',()=>{
   const m=buildPerformanceTaskEvidenceReadModel({staffId,branch,role:'doctor',batches:[batch('shift_note','available'),batch('customer_followup','available'),batch('customer_request','available'),batch('cleaning_task','unavailable')]});
   expect(m?.sourceUnavailableCount).toBe(0); expect(m?.dataConfidence).toBe('high'); expect(m?.isTaskEvidenceReady).toBe(false);
 });
 it('keeps zero resolved outcomes as no score, not 0%',()=>{
   const m=buildPerformanceTaskEvidenceReadModel({staffId,branch,role:'delivery',batches:[batch('task','available'),batch('shift_note','available'),batch('customer_request','available')]});
   expect(m?.taskResolvedCount).toBe(0); expect(m?.taskCompletionRate).toBeNull(); expect(m?.isTaskEvidenceReady).toBe(false);
 });
 it('returns null for an unconfigured role instead of inventing applicability',()=>{
   expect(buildPerformanceTaskEvidenceReadModel({staffId,branch,role:'other',batches:[]})).toBeNull();
 });
});
