import { supabase } from '@/lib/supabase';
import { TABLES } from '@/lib/supabaseTables';
import type { CanonicalStaffRole } from '@/lib/staff/staffRoleCapabilities';
import type { TaskEvidenceSourceType } from '@/lib/tasks/taskEvidence';
import type { TaskEvidenceSourceBatch } from '@/lib/tasks/taskCompletionProjection';
import { customerFollowupToTaskEvidence, managerChecklistToTaskEvidence } from '@/lib/tasks/taskEvidenceAdapters';
import { taskEvidenceSourcesForRole } from './performanceEvidenceApplicability';
import { buildPerformanceTaskEvidenceReadModel } from './performanceTaskEvidenceReadModel';

type Input={staffId:string;branch:string;role:CanonicalStaffRole;start:string;end:string;observedAt?:string};

function unavailable(sourceType:TaskEvidenceSourceType,reason:string,observedAt:string):TaskEvidenceSourceBatch{
 return {sourceType,availability:'unavailable',evidence:[],reason,observedAt};
}
function dateEnd(end:string){return end.length===10?`${end}T23:59:59+03:00`:end;}

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
    const {data,error}=await supabase.from(TABLES.dailyFollowups).select('*')
      .eq('branch',input.branch).gte('followup_datetime',input.start).lte('followup_datetime',dateEnd(input.end));
    if(error)throw error;
    const evidence=(data||[]).map(row=>customerFollowupToTaskEvidence(row,observedAt)).filter(Boolean);
    batches.push({sourceType,availability:'available',evidence:evidence as any[],observedAt});
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
