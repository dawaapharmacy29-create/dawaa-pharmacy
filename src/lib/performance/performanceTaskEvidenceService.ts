import { supabase } from '@/lib/supabase';
import { TABLES } from '@/lib/supabaseTables';
import type { CanonicalStaffRole } from '@/lib/staff/staffRoleCapabilities';
import type { TaskEvidenceSourceType } from '@/lib/tasks/taskEvidence';
import type { TaskEvidenceSourceBatch } from '@/lib/tasks/taskCompletionProjection';
import { customerFollowupToTaskEvidence, managerChecklistToTaskEvidence } from '@/lib/tasks/taskEvidenceAdapters';
import { customerRequestToTaskEvidence } from '@/lib/tasks/customerRequestEvidenceAdapter';
import { taskEvidenceSourcesForRole } from './performanceEvidenceApplicability';
import { buildPerformanceTaskEvidenceReadModel } from './performanceTaskEvidenceReadModel';
import { cairoDateBoundaryIso } from '@/lib/time/cairoDateBoundary';

type Input={staffId:string;branch:string;role:CanonicalStaffRole;start:string;end:string;observedAt?:string};

function unavailable(sourceType:TaskEvidenceSourceType,reason:string,observedAt:string):TaskEvidenceSourceBatch{
 return {sourceType,availability:'unavailable',evidence:[],reason,observedAt};
}

/**
 * Canonical production reader for performance task evidence.
 * It only reads verified source contracts. Sources without a verified reader remain explicitly unavailable.
 */
export async function readPerformanceTaskEvidence(input:Input){
 const observedAt=input.observedAt||new Date().toISOString();
 const expected=taskEvidenceSourcesForRole(input.role);
 const batches:TaskEvidenceSourceBatch[]=[];

 for(const sourceType of expected){
  try{
   if(sourceType==='customer_followup'){
    const [timed,dated]=await Promise.all([
     supabase.from(TABLES.dailyFollowups).select('*').eq('branch',input.branch).gte('followup_datetime',cairoDateBoundaryIso(input.start)).lte('followup_datetime',cairoDateBoundaryIso(input.end,true)),
     supabase.from(TABLES.dailyFollowups).select('*').eq('branch',input.branch).gte('followup_date',input.start).lte('followup_date',input.end),
    ]);
    if(timed.error&&dated.error)throw timed.error;
    const rows=new Map<string,Record<string,unknown>>();
    for(const row of [...(timed.data||[]),...(dated.data||[])])rows.set(String(row.id),row as Record<string,unknown>);
    const evidence=[...rows.values()].map(row=>customerFollowupToTaskEvidence(row,observedAt)).filter((row):row is NonNullable<typeof row>=>Boolean(row)).filter(row=>row.subjectStaffId===input.staffId);
    batches.push({sourceType,availability:timed.error||dated.error?'partial':'available',evidence,reason:timed.error?.message||dated.error?.message,observedAt});
    continue;
   }
   if(sourceType==='customer_request'){
    const {data,error}=await supabase.from(TABLES.customerRequests).select('id,branch,status,request_type,doctor_id,primary_responsible_id,source_assigned_staff_id,source_recorded_staff_id,requested_at,created_at,updated_at,due_date,next_action_at,last_action_at,closed_at')
      .eq('branch',input.branch).gte('requested_at',cairoDateBoundaryIso(input.start)).lte('requested_at',cairoDateBoundaryIso(input.end,true));
    if(error)throw error;
    const evidence=(data||[]).map(row=>customerRequestToTaskEvidence(row,observedAt)).filter((row):row is NonNullable<typeof row>=>Boolean(row)).filter(row=>row.subjectStaffId===input.staffId);
    batches.push({sourceType,availability:'available',evidence,observedAt});
    continue;
   }
   if(sourceType==='manager_checklist'){
    const {data,error}=await supabase.from(TABLES.managerDailyChecklist)
      .select('id,staff_id,branch,task_date,task_key,completed,note,completed_at,created_at,updated_at')
      .eq('staff_id',input.staffId).eq('branch',input.branch).gte('task_date',input.start).lte('task_date',input.end);
    if(error)throw error;
    const evidence=(data||[]).map(row=>managerChecklistToTaskEvidence(row,observedAt)).filter(Boolean);
    batches.push({sourceType,availability:'available',evidence:evidence as any[],observedAt});
    continue;
   }
   batches.push(unavailable(sourceType,'Canonical production reader is not verified for this source yet.',observedAt));
  }catch(error){
   batches.push(unavailable(sourceType,error instanceof Error?error.message:'Evidence source read failed.',observedAt));
  }
 }
 return buildPerformanceTaskEvidenceReadModel({staffId:input.staffId,branch:input.branch,role:input.role,batches});
}
