import { getStaffAttendanceDetail } from '@/lib/attendance/attendanceBreakdownService';
import { getAnnualLeaveBalanceV1, getPermissionPolicyStatusV2, listStaffTimeOffRequests } from '@/lib/timeOffService';
import { getStaffCycleSales } from '@/lib/staffSalesService';

const HEADER_CACHE=new Map<string,{value:EvaluationHeaderSummary;at:number}>();
const HEADER_CACHE_TTL_MS=5*60*1000;
import type { EmployeeMonthlyEvidence } from '@/lib/staff/employeeMonthlyEvidenceService';
import { canonicalStaffRole } from '@/lib/staff/staffRoleCapabilities';

export type EvaluationRoleGroup='doctor'|'assistant'|'warehouse'|'delivery'|'manager'|'customer_service'|'other';
export type EvaluationHeaderSummary={
 roleGroup:EvaluationRoleGroup; branch:string;
 sales:{state:'available'|'unavailable';total:number|null;invoices:number|null;avgInvoice:number|null;customers:number|null};
 conversations:{state:'available'|'unavailable';count:number|null;average:number|null};
 attendance:{state:'available'|'unavailable';workedDays:number|null;workedHours:number|null;scheduledDays:number|null;lateDays:number|null;absenceReviewDays:number|null};
 timeOff:{state:'available'|'partial'|'unavailable';permissions:number|null;permissionMinutes:number|null;annualLeaveCycleDays:number|null;annualLeaveYearUsed:number|null;annualLeaveYearBalance:number|null;weeklyOffDays:number|null;otherApprovedLeaveDays:number|null};
 warnings:string[];
};

function overlapDays(start:string,end:string,rangeStart:string,rangeEnd:string){const lo=start<rangeStart?rangeStart:start;const hi=end>rangeEnd?rangeEnd:end;if(hi<lo)return 0;const a=new Date(lo+'T12:00:00Z'),b=new Date(hi+'T12:00:00Z');return Math.round((b.getTime()-a.getTime())/86400000)+1}
export function evaluationRoleGroup(role:unknown):EvaluationRoleGroup{
 const r=canonicalStaffRole(role);
 if(r==='doctor')return'doctor';
 if(r==='delivery')return'delivery';
 if(r==='inventory_assistant')return'warehouse';
 if(r==='assistant')return'assistant';
 if(r==='customer_service')return'customer_service';
 if(['branch_manager','branches_manager','shift_supervisor','customer_service_manager','executive','admin'].includes(r))return'manager';
 return'other';
}

export async function loadEmployeeEvaluationHeader(args:{staffId:string;staffName:string;role:unknown;branch:string;start:string;end:string;evidence:EmployeeMonthlyEvidence}):Promise<EvaluationHeaderSummary>{
 const cacheKey=`${args.staffId}:${args.start}:${args.end}:${args.branch}:${evaluationRoleGroup(args.role)}`;
 const cached=HEADER_CACHE.get(cacheKey);
 if(cached&&Date.now()-cached.at<HEADER_CACHE_TTL_MS)return cached.value;
 const warnings:string[]=[];
 const roleGroup=evaluationRoleGroup(args.role);
 const needsPersonalAttendance=['doctor','assistant','warehouse','delivery','customer_service'].includes(roleGroup);
 const [salesR,attendanceR,permissionR,requestsR,annualR]=await Promise.allSettled([
  roleGroup==='doctor'
   ? getStaffCycleSales(args.staffId,args.staffName,args.branch,args.start,args.end)
   : Promise.resolve(null),
  needsPersonalAttendance ? getStaffAttendanceDetail(args.staffId,args.start,args.end) : Promise.resolve(null),
  needsPersonalAttendance ? getPermissionPolicyStatusV2(args.staffId,args.start,args.end) : Promise.resolve(null),
  needsPersonalAttendance ? listStaffTimeOffRequests({staffId:args.staffId,from:args.start,to:args.end,status:'approved',limit:200}) : Promise.resolve([]),
  needsPersonalAttendance ? getAnnualLeaveBalanceV1(args.staffId,Number(args.end.slice(0,4))) : Promise.resolve(null),
 ]);
 const sales=salesR.status==='fulfilled'?salesR.value:null;
 const salesAvailable=roleGroup==='doctor'&&Boolean(sales&&sales.sourceTableUsed!=='none');
 const attendance=attendanceR.status==='fulfilled'?attendanceR.value:null;
 const permission=permissionR.status==='fulfilled'?permissionR.value:null;
 const requests=requestsR.status==='fulfilled'?requestsR.value:[];
 const annual=annualR.status==='fulfilled'?annualR.value:null;
 if(roleGroup==='doctor'&&!salesAvailable)warnings.push('ملخص المبيعات غير متاح؛ لا يتم تفسير غياب المصدر كصفر.');
 if(roleGroup==='doctor'&&sales?.warnings?.length)warnings.push(...sales.warnings);
 if(needsPersonalAttendance&&!attendance)warnings.push('تفاصيل الحضور والساعات غير متاحة');
 if(needsPersonalAttendance&&!permission)warnings.push('ملخص الأذونات غير متاح');
 if(needsPersonalAttendance&&requestsR.status!=='fulfilled')warnings.push('تفاصيل الإجازات غير متاحة');
 const annualCycleDays=requests.filter(x=>x.request_kind==='annual_leave').reduce((n,x)=>n+overlapDays(x.start_date,x.end_date,args.start,args.end),0);
 const otherLeaveDays=requests.filter(x=>['sick_leave','exceptional_leave','approved_absence'].includes(x.request_kind)).reduce((n,x)=>n+overlapDays(x.start_date,x.end_date,args.start,args.end),0);
 const weeklyOffDays=attendance?.days.filter(x=>x.is_off_day===true||x.resolution_status==='off_day').length??null;
 const value:EvaluationHeaderSummary={
  roleGroup,branch:args.branch,
  sales:roleGroup==='doctor'&&salesAvailable
   ? {state:'available',total:sales!.totalSales,invoices:sales!.invoicesCount,avgInvoice:sales!.avgInvoice,customers:sales!.uniqueCustomersCount}
   : {state:'unavailable',total:null,invoices:null,avgInvoice:null,customers:null},
  conversations:{state:args.evidence.health.reviews==='available'?'available':'unavailable',count:args.evidence.health.reviews==='available'?args.evidence.coaching.conversation.reviewCount:null,average:args.evidence.health.reviews==='available'?args.evidence.coaching.conversation.coreAverage:null},
  attendance:{state:attendance?'available':'unavailable',workedDays:attendance?.summary.actual_worked_days??null,workedHours:attendance?.summary.total_worked_hours??null,scheduledDays:attendance?.summary.scheduled_workdays??null,lateDays:attendance?.summary.late_days??null,absenceReviewDays:attendance?.summary.absence_review_days??null},
  timeOff:{state:permission&&requestsR.status==='fulfilled'?'available':permission||requestsR.status==='fulfilled'?'partial':'unavailable',permissions:permission?.approved_permissions??null,permissionMinutes:permission?.total_minutes??null,annualLeaveCycleDays:requestsR.status==='fulfilled'?annualCycleDays:null,annualLeaveYearUsed:annual?.used??null,annualLeaveYearBalance:annual?.balance??null,weeklyOffDays,otherApprovedLeaveDays:requestsR.status==='fulfilled'?otherLeaveDays:null},
  warnings,
 };
 HEADER_CACHE.set(cacheKey,{value,at:Date.now()});
 return value;
}
