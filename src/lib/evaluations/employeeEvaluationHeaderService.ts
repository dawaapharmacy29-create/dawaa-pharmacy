import { getStaffAttendanceDetail } from '@/lib/attendance/attendanceBreakdownService';
import { getAnnualLeaveBalanceV1, getPermissionPolicyStatusV2, listStaffTimeOffRequests } from '@/lib/timeOffService';
import { loadStaffPerformanceProfile } from '@/lib/staff/staffPerformanceProfileService';
import type { EmployeeMonthlyEvidence } from '@/lib/staff/employeeMonthlyEvidenceService';
import { canonicalStaffRole } from '@/lib/staff/staffRoleCapabilities';

export type EvaluationRoleGroup='doctor'|'assistant'|'delivery'|'other';
export type EvaluationHeaderSummary={
 roleGroup:EvaluationRoleGroup; branch:string;
 sales:{state:'available'|'unavailable';total:number|null;invoices:number|null;avgInvoice:number|null;customers:number|null};
 conversations:{state:'available'|'unavailable';count:number|null;average:number|null};
 attendance:{state:'available'|'unavailable';workedDays:number|null;workedHours:number|null;scheduledDays:number|null;lateDays:number|null;absenceReviewDays:number|null};
 timeOff:{state:'available'|'partial'|'unavailable';permissions:number|null;permissionMinutes:number|null;annualLeaveCycleDays:number|null;annualLeaveYearUsed:number|null;annualLeaveYearBalance:number|null;weeklyOffDays:number|null;otherApprovedLeaveDays:number|null};
 warnings:string[];
};

function overlapDays(start:string,end:string,rangeStart:string,rangeEnd:string){const lo=start<rangeStart?rangeStart:start;const hi=end>rangeEnd?rangeEnd:end;if(hi<lo)return 0;const a=new Date(lo+'T12:00:00Z'),b=new Date(hi+'T12:00:00Z');return Math.round((b.getTime()-a.getTime())/86400000)+1}
export function evaluationRoleGroup(role:unknown):EvaluationRoleGroup{const r=canonicalStaffRole(role);if(r==='doctor')return'doctor';if(r==='delivery')return'delivery';if(r==='assistant'||r==='inventory_assistant')return'assistant';return'other'}

export async function loadEmployeeEvaluationHeader(args:{staffId:string;staffName:string;role:unknown;branch:string;start:string;end:string;evidence:EmployeeMonthlyEvidence}):Promise<EvaluationHeaderSummary>{
 const warnings:string[]=[];
 const [profileR,attendanceR,permissionR,requestsR,annualR]=await Promise.allSettled([
  loadStaffPerformanceProfile({staffId:args.staffId,cycleStart:args.start,cycleEnd:args.end,branchFilter:args.branch}),
  getStaffAttendanceDetail(args.staffId,args.start,args.end),
  getPermissionPolicyStatusV2(args.staffId,args.start,args.end),
  listStaffTimeOffRequests({staffId:args.staffId,from:args.start,to:args.end,status:'approved',limit:200}),
  getAnnualLeaveBalanceV1(args.staffId,Number(args.end.slice(0,4))),
 ]);
 const roleGroup=evaluationRoleGroup(args.role);
 const profile=profileR.status==='fulfilled'?profileR.value:null;
 const attendance=attendanceR.status==='fulfilled'?attendanceR.value:null;
 const permission=permissionR.status==='fulfilled'?permissionR.value:null;
 const requests=requestsR.status==='fulfilled'?requestsR.value:[];
 const annual=annualR.status==='fulfilled'?annualR.value:null;
 if(roleGroup==='doctor'&&!profile)warnings.push('ملخص المبيعات غير متاح');
 if(!attendance)warnings.push('تفاصيل الحضور والساعات غير متاحة');
 if(!permission)warnings.push('ملخص الأذونات غير متاح');
 if(requestsR.status!=='fulfilled')warnings.push('تفاصيل الإجازات غير متاحة');
 const annualCycleDays=requests.filter(x=>x.request_kind==='annual_leave').reduce((n,x)=>n+overlapDays(x.start_date,x.end_date,args.start,args.end),0);
 const otherLeaveDays=requests.filter(x=>['sick_leave','exceptional_leave','approved_absence'].includes(x.request_kind)).reduce((n,x)=>n+overlapDays(x.start_date,x.end_date,args.start,args.end),0);
 const weeklyOffDays=attendance?.days.filter(x=>x.is_off_day===true||x.resolution_status==='off_day').length??null;
 return{
  roleGroup,branch:args.branch,
  sales:roleGroup==='doctor'?{state:profile?.sales?'available':'unavailable',total:profile?.sales?.cycleNetSales??null,invoices:profile?.sales?.cycleInvoicesCount??null,avgInvoice:profile?.sales?.avgInvoice??null,customers:profile?.sales?.uniqueCustomers??null}:{state:'unavailable',total:null,invoices:null,avgInvoice:null,customers:null},
  conversations:{state:args.evidence.health.reviews==='available'?'available':'unavailable',count:args.evidence.health.reviews==='available'?args.evidence.coaching.conversation.reviewCount:null,average:args.evidence.health.reviews==='available'?args.evidence.coaching.conversation.coreAverage:null},
  attendance:{state:attendance?'available':'unavailable',workedDays:attendance?.summary.actual_worked_days??null,workedHours:attendance?.summary.total_worked_hours??null,scheduledDays:attendance?.summary.scheduled_workdays??null,lateDays:attendance?.summary.late_days??null,absenceReviewDays:attendance?.summary.absence_review_days??null},
  timeOff:{state:permission&&requestsR.status==='fulfilled'?'available':permission||requestsR.status==='fulfilled'?'partial':'unavailable',permissions:permission?.approved_permissions??null,permissionMinutes:permission?.total_minutes??null,annualLeaveCycleDays:requestsR.status==='fulfilled'?annualCycleDays:null,annualLeaveYearUsed:annual?.used??null,annualLeaveYearBalance:annual?.balance??null,weeklyOffDays,otherApprovedLeaveDays:requestsR.status==='fulfilled'?otherLeaveDays:null},
  warnings,
 };
}
