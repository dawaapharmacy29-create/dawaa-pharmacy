import { supabase } from '@/lib/supabase';
import { evaluationCycleRangeFromLabel } from '@/lib/evaluations/monthlyEvaluationCycle';

export type PerformanceCoverage = 'available' | 'partial' | 'not_applicable' | 'unavailable';
export type PerformanceConfidence = 'high' | 'medium' | 'low';

export type DoctorPerformanceMonth = {
  cycleLabel: string; displayLabel: string;
  sales: number | null; invoices: number | null; customers: number | null; averageInvoice: number | null;
  workedHours: number | null; salesPerHour: number | null; invoicesPerHour: number | null; customersPerHour: number | null;
  conversations: number | null; convertedConversations: number | null; conversionRate: number | null;
  coverage: PerformanceCoverage;
  confidence: PerformanceConfidence;
  coverageReason: string;
  comparisonEligible: boolean;
  comparisonReason: string;
  salesIdentity: 'canonical' | 'unavailable';
  salesSourceAvailable: boolean; attendanceSourceAvailable: boolean; conversationSourceAvailable: boolean;
  salesEvidenceCount: number; attendanceEvidenceCount: number; conversationEvidenceCount: number;
};

export type DoctorPerformanceIntelligence = {
  months: DoctorPerformanceMonth[];
  generatedAt: string;
  firstEvidenceDate: string | null;
};

const n=(v:unknown)=>{const x=Number(v);return Number.isFinite(x)?x:0};
const money=(row:Record<string,unknown>)=>n(row.net_total ?? row.net_amount ?? row.discounted_amount ?? row.total_amount ?? row.amount ?? row.gross_total ?? row.gross_amount);
const customerKey=(row:Record<string,unknown>)=>String(row.customer_id||row.customer_code||row.customer_phone||'').trim();
const rowDate=(row:Record<string,unknown>)=>{
  const raw=row.invoice_date ?? row.sale_date ?? row.created_at ?? row.date;
  const value=String(raw||'').slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value)?value:null;
};
type StaffInvoiceTruthPayload = { rows?: Record<string,unknown>[]; matchedCount?: number; matchedSales?: number; staff?: Record<string,unknown> | null };

function previousCycle(label:string,back:number){const [y,m]=label.split('-').map(Number);const d=new Date(Date.UTC(y,m-1-back,1));return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;}

async function salesRows(staffId:string,start:string,endExclusive:string){
  const end=new Date(`${endExclusive}T12:00:00Z`); end.setUTCDate(end.getUTCDate()-1);
  const endInclusive=end.toISOString().slice(0,10);
  const {data,error}=await supabase.rpc('get_staff_invoice_truth_read_v1',{p_staff_id:staffId,p_start:start,p_end:endInclusive});
  if(error) return {rows:[] as Record<string,unknown>[],available:false,identity:'unavailable' as const};
  const payload=(data||{}) as StaffInvoiceTruthPayload;
  return {rows:Array.isArray(payload.rows)?payload.rows:[],available:true,identity:'canonical' as const};
}

function minDate(values:(string|null)[]){
  const valid=values.filter((v):v is string=>Boolean(v)).sort();
  return valid[0]||null;
}

function coverageText(coverage:PerformanceCoverage, salesAvailable:boolean, attendanceAvailable:boolean, hasCoreEvidence:boolean){
  if(coverage==='not_applicable') return 'الدورة تسبق أول دليل موثوق لوجود الموظف، لذلك لا تُحسب صفرًا ولا تدخل في المقارنة.';
  if(coverage==='unavailable') return 'مصادر البيع والحضور الأساسية غير متاحة لهذه الدورة.';
  if(coverage==='partial'){
    if(!salesAvailable) return 'مصدر المبيعات الموثق غير متاح؛ البيانات جزئية ولا يجوز استنتاج أداء بيعي.';
    if(!attendanceAvailable) return 'مصدر الحضور غير متاح؛ لا يجوز استخدام مؤشرات الكفاءة لكل ساعة.';
    return 'التغطية جزئية ولا تكفي لمقارنة عادلة.';
  }
  if(!hasCoreEvidence) return 'المصادر متاحة لكن لا يوجد دليل بيع أو حضور مسجل داخل الدورة؛ تُعرض البيانات دون استنتاج اتجاه.';
  return 'مصادر البيع والحضور الأساسية متاحة ويوجد دليل فعلي داخل الدورة.';
}

export async function loadDoctorPerformanceIntelligence(args:{staffId:string;staffName:string;cycleLabel:string}):Promise<DoctorPerformanceIntelligence>{
  const firstAttendanceResult=await supabase.from('attendance_daily_summary').select('attendance_date').eq('staff_id',args.staffId).order('attendance_date',{ascending:true}).limit(1).maybeSingle();
  const firstAttendanceDate=firstAttendanceResult.error?null:String(firstAttendanceResult.data?.attendance_date||'').slice(0,10)||null;

  const rawMonths=await Promise.all(Array.from({length:3},async(_,back)=>{
    const cycleLabel=previousCycle(args.cycleLabel,back);
    const range=evaluationCycleRangeFromLabel(cycleLabel);
    const start=range.start.toISOString().slice(0,10), endExclusive=range.endExclusive.toISOString().slice(0,10);
    const [sales,attendance,conversations]=await Promise.all([
      salesRows(args.staffId,start,endExclusive),
      supabase.from('attendance_daily_summary').select('attendance_date,payroll_eligible_hours,total_hours').eq('staff_id',args.staffId).gte('attendance_date',start).lt('attendance_date',endExclusive).limit(100),
      supabase.from('conversation_sales_reviews').select('id,converted_to_sale,conversation_date').or(`doctor_id.eq.${args.staffId},staff_id.eq.${args.staffId}`).eq('is_current',true).gte('conversation_date',start).lt('conversation_date',endExclusive).limit(1000),
    ]);
    return {cycleLabel,range,start,endExclusive,sales,attendance,conversations};
  }));

  const firstSalesDate=minDate(rawMonths.flatMap(m=>m.sales.rows.map(rowDate)));
  const firstConversationDate=minDate(rawMonths.flatMap(m=>(m.conversations.data||[]).map(r=>String(r.conversation_date||'').slice(0,10)||null)));
  const firstEvidenceDate=minDate([firstAttendanceDate,firstSalesDate,firstConversationDate]);

  const months:DoctorPerformanceMonth[]=rawMonths.map(({cycleLabel,range,endExclusive,sales,attendance,conversations})=>{
    const attendanceAvailable=!attendance.error;
    const conversationAvailable=!conversations.error;
    const attendanceRows=attendance.data||[];
    const conversationRows=conversations.data||[];
    const cycleBeforeFirstEvidence=Boolean(firstEvidenceDate && endExclusive<=firstEvidenceDate);
    const hasCoreEvidence=sales.rows.length>0||attendanceRows.length>0;

    const coverage:PerformanceCoverage=cycleBeforeFirstEvidence
      ?'not_applicable'
      :(!sales.available&&!attendanceAvailable?'unavailable':(!sales.available||!attendanceAvailable?'partial':'available'));

    const confidence:PerformanceConfidence=coverage==='available'
      ?(hasCoreEvidence?(conversationAvailable?'high':'medium'):'medium')
      :coverage==='partial'?'low':'low';

    const salesUsable=coverage!=='not_applicable'&&sales.available;
    const salesTotal=salesUsable?sales.rows.reduce((s,r)=>s+money(r),0):null;
    const invoices=salesUsable?sales.rows.length:null;
    const customers=salesUsable?new Set(sales.rows.map(customerKey).filter(Boolean)).size:null;
    const avg=salesUsable&&invoices? salesTotal!/invoices:null;
    const hours=coverage==='not_applicable'||attendance.error?null:attendanceRows.reduce((s,r)=>s+n(r.payroll_eligible_hours ?? r.total_hours),0);
    const conv=coverage==='not_applicable'||conversations.error?null:conversationRows.length;
    const converted=coverage==='not_applicable'||conversations.error?null:conversationRows.filter(r=>r.converted_to_sale===true).length;

    const comparisonEligible=coverage==='available'&&confidence!=='low'&&hasCoreEvidence;
    const comparisonReason=coverage==='not_applicable'
      ?'الدورة خارج نطاق المقارنة لأنها تسبق أول Evidence موثوق.'
      :coverage!=='available'
        ?'التغطية غير مكتملة، لذلك المقارنة محجوبة.'
        :!hasCoreEvidence
          ?'لا يوجد Evidence فعلي كافٍ داخل الدورة لبناء اتجاه.'
          :'الدورة مؤهلة للمقارنة عند وجود دورة أخرى مؤهلة.';

    return {
      cycleLabel,displayLabel:range.displayLabel,
      sales:salesTotal,invoices,customers,averageInvoice:avg,
      workedHours:hours,salesPerHour:hours&&salesTotal!==null?salesTotal/hours:null,
      invoicesPerHour:hours&&invoices!==null?invoices/hours:null,customersPerHour:hours&&customers!==null?customers/hours:null,
      conversations:conv,convertedConversations:converted,conversionRate:conv&&converted!==null?converted/conv*100:null,
      coverage,confidence,
      coverageReason:coverageText(coverage,sales.available,attendanceAvailable,hasCoreEvidence),
      comparisonEligible,comparisonReason,
      salesIdentity:sales.identity,salesSourceAvailable:sales.available,attendanceSourceAvailable:attendanceAvailable,conversationSourceAvailable:conversationAvailable,
      salesEvidenceCount:sales.rows.length,attendanceEvidenceCount:attendanceRows.length,conversationEvidenceCount:conversationRows.length,
    };
  });

  return {months,generatedAt:new Date().toISOString(),firstEvidenceDate};
}
