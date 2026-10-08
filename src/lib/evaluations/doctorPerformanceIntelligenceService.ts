import { describeSourceProblem, UserFacingError, type DecisionSourceDiagnostic } from '@/lib/evaluations/decisionSourceState';
import { supabase } from '@/lib/supabase';
import { loadPerformanceSalesBundle, type PerformanceSalesBundlePayload } from '@/lib/evaluations/performanceSalesBundleCache';
import { evaluationCycleRangeFromLabel, evaluationCycleDateKeys, isEvaluationCycleClosed, previousEvaluationCycleLabel } from '@/lib/evaluations/monthlyEvaluationCycle';
import { readAttendanceRange } from '@/lib/readModels/attendanceReadModel';
import { getStaffAttendanceDetail } from '@/lib/attendance/attendanceBreakdownService';
import { cairoDateBoundaryIso, cairoDayOf } from '@/lib/time/cairoDateBoundary';
import { addDays } from '@/lib/attendance/period';

/** First evidence later than this many days into a cycle means the doctor joined mid-cycle. */
const JOIN_TOLERANCE_DAYS=3;

export type PerformanceCoverage = 'available' | 'partial' | 'not_applicable' | 'unavailable';
export type PerformanceConfidence = 'high' | 'medium' | 'low';

export type DoctorPerformanceDiagnosis = {
  kind: 'data_quality' | 'sales_trend' | 'efficiency' | 'conversion' | 'customer_impact' | 'opportunity';
  severity: 'positive' | 'watch' | 'attention';
  title: string;
  detail: string;
  evidence: string[];
};

export type DoctorCustomerImpact = {
  available: boolean;
  commercialConversations: number | null;
  verifiedSaleConversations: number | null;
  verifiedRevenue: number | null;
  verifiedConversionRate: number | null;
  followupsNeeded: number | null;
  complaints: number | null;
  saleLeakage: number | null;
  unavailableProducts: number | null;
  acceptedProducts: number | null;
};

export type DoctorPerformanceMonth = {
  cycleLabel: string; displayLabel: string;
  sales: number | null; invoices: number | null; customers: number | null; averageInvoice: number | null;
  workedHours: number | null; salesPerHour: number | null; invoicesPerHour: number | null; customersPerHour: number | null;
  /** Reviewed conversations; conversion uses only those whose sale outcome was recorded (null outcome = unknown). */
  conversations: number | null; convertedConversations: number | null; conversionRate: number | null; conversionRecorded: number | null;
  /** Canonical attendance for the cycle (same truth as the evaluation header); null when unavailable. */
  attendanceDetail: null | { workedDays: number; lateDays: number; lateMinutes: number; pendingDays: number; approvedHours: number; pendingHours: number };
  /** Per-hour productivity is computed only when every attendance day of the cycle is settled. */
  hoursComplete: boolean;
  hoursNote: string | null;
  /** Days of sales data behind the totals: the full cycle when closed, the loaded days when running. */
  salesDays: number | null;
  coverage: PerformanceCoverage;
  confidence: PerformanceConfidence;
  coverageReason: string;
  comparisonEligible: boolean;
  comparisonMode: 'full_cycle' | 'same_period' | 'blocked';
  comparisonReason: string;
  comparisonSnapshot: null | {
    days: number | null; dataAsOf: string | null;
    sales: number | null; previousSales: number | null;
    invoices: number | null; previousInvoices: number | null;
    customers: number | null; previousCustomers: number | null;
    averageInvoice: number | null; previousAverageInvoice: number | null;
  };
  salesIdentity: 'canonical' | 'unavailable';
  salesSourceAvailable: boolean; attendanceSourceAvailable: boolean; conversationSourceAvailable: boolean;
  salesEvidenceCount: number; attendanceEvidenceCount: number; conversationEvidenceCount: number;
  customerImpact: DoctorCustomerImpact;
  diagnoses: DoctorPerformanceDiagnosis[];
};

export type PerformanceSourceStatus = 'available' | 'partial' | 'unavailable';
/**
 * What the UI says about a source: `partial` (some reads failed), `insufficient` (loaded, too little evidence),
 * `not_enabled` (endpoint not deployed yet) or `failed` (read did not complete). Never a technical message.
 */
export type PerformanceSourceState = 'available' | 'partial' | 'insufficient' | 'not_enabled' | 'failed';

/**
 * Health of one evidence source across the 3-cycle window. `reason` is plain language for the screen; the
 * technical failure lives in `diagnostic` and is already written to the diagnostic log. Missing is never zero.
 */
export type PerformanceSourceHealth = {
  status: PerformanceSourceStatus;
  state: PerformanceSourceState;
  reason: string | null;
  diagnostic: DecisionSourceDiagnostic | null;
  evidenceCount: number;
  firstEvidenceDate: string | null;
  dataAsOf: string | null;
};

export type DoctorPerformanceAction = {
  owner: 'doctor' | 'manager';
  title: string;
  detail: string;
  focus: 'all' | 'conversion' | 'opportunity' | 'availability';
};

export type DoctorPerformanceIntelligence = {
  months: DoctorPerformanceMonth[];
  sources: { sales: PerformanceSourceHealth; attendance: PerformanceSourceHealth; conversations: PerformanceSourceHealth; customerImpact: PerformanceSourceHealth };
  actions: DoctorPerformanceAction[];
  generatedAt: string;
  firstEvidenceDate: string | null;
  firstSalesEvidenceDate: string | null;
  firstAttendanceEvidenceDate: string | null;
  firstConversationEvidenceDate: string | null;
};

const n=(v:unknown)=>{const x=Number(v);return Number.isFinite(x)?x:0};
const previousCycle=(label:string,back:number)=>{let value=label;for(let i=0;i<back;i+=1)value=previousEvaluationCycleLabel(value);return value};
type SalesCycleSummaryRow = {
  cycle_start?: string; cycle_end?: string; sales?: number; invoices?: number; customers?: number; first_sale_date?: string | null;
};

type SalesPeriodSummaryRow = { sales?: number; invoices?: number; customers?: number; first_sale_date?: string | null };
/** Maps a Supabase/PostgREST failure to a readable reason that keeps the real code visible. */
type SourceProblem = ReturnType<typeof describeSourceProblem>;
const problemOf = (error: unknown, label: string, source: string): SourceProblem | null => (error ? describeSourceProblem(error, label, source) : null);

/** Maps a read outcome to what the screen may say. `insufficientReason` marks a loaded source with too little evidence. */
export function sourceStateOf(problem:SourceProblem|null,insufficientReason:string|null=null):{state:PerformanceSourceState;reason:string|null;diagnostic:DecisionSourceDiagnostic|null}{
  if(problem)return {state:problem.status,reason:problem.reason,diagnostic:problem.diagnostic};
  if(insufficientReason)return {state:'insufficient',reason:insufficientReason,diagnostic:null};
  return {state:'available',reason:null,diagnostic:null};
}

async function salesBundle(staffId:string,windowStart:string,windowEnd:string,currentStart:string,elapsedDays:number){
  const {payload,error}=await loadPerformanceSalesBundle({
    staffId,windowStart,windowEnd,currentStart,elapsedDays,
  });
  return {rows:Array.isArray(payload.cycles)?payload.cycles:[],samePeriod:payload.samePeriod||{},dataAsOf:payload.dataAsOf||null,effectiveDays:Math.max(0,n(payload.effectiveDays)),available:!error,identity:error?'unavailable' as const:'canonical' as const,problem:problemOf(error,'المبيعات','sales')};
}

function minDate(values:(string|null)[]){
  const valid=values.filter((v):v is string=>Boolean(v)).sort();
  return valid[0]||null;
}
function maxDate(values:(string|null)[]){
  const valid=values.filter((v):v is string=>Boolean(v)).sort();
  return valid[valid.length-1]||null;
}

type DoctorCycleImpactRow = {
  cycle_start?: string; cycle_end?: string;
  commercial_conversations?: number; verified_sale_conversations?: number; verified_revenue?: number;
  verified_conversion_rate?: number; conversations_needing_followup?: number; complaint_conversations?: number;
  sale_leakage_count?: number; unavailable_product_count?: number; accepted_product_count?: number;
};

async function customerImpactWindow(staffId:string,start:string,endExclusive:string){
  const {data,error}=await supabase.from('whatsapp_doctor_cycle_intelligence_v1')
    .select('cycle_start,cycle_end,commercial_conversations,verified_sale_conversations,verified_revenue,verified_conversion_rate,conversations_needing_followup,complaint_conversations,sale_leakage_count,unavailable_product_count,accepted_product_count')
    .eq('staff_id',staffId).gte('cycle_start',start).lt('cycle_start',endExclusive);
  return {rows:(data||[]) as DoctorCycleImpactRow[],available:!error,problem:problemOf(error,'أثر العملاء','customer_impact')};
}

export function aggregateImpactEvidence(rows:DoctorCycleImpactRow[],available:boolean):DoctorCustomerImpact{
  // A successful read with no cycle rows is not evidence of zero customer impact.
  // Keep all derived metrics unknown until a canonical staff/cycle row exists.
  if(!available || rows.length===0) return {available:false,commercialConversations:null,verifiedSaleConversations:null,verifiedRevenue:null,verifiedConversionRate:null,followupsNeeded:null,complaints:null,saleLeakage:null,unavailableProducts:null,acceptedProducts:null};
  const commercial=rows.reduce((s,r)=>s+n(r.commercial_conversations),0);
  const verified=rows.reduce((s,r)=>s+n(r.verified_sale_conversations),0);
  return {
    available:true,
    commercialConversations:commercial,
    verifiedSaleConversations:verified,
    verifiedRevenue:rows.reduce((s,r)=>s+n(r.verified_revenue),0),
    verifiedConversionRate:commercial?verified/commercial*100:null,
    followupsNeeded:rows.reduce((s,r)=>s+n(r.conversations_needing_followup),0),
    complaints:rows.reduce((s,r)=>s+n(r.complaint_conversations),0),
    saleLeakage:rows.reduce((s,r)=>s+n(r.sale_leakage_count),0),
    unavailableProducts:rows.reduce((s,r)=>s+n(r.unavailable_product_count),0),
    acceptedProducts:rows.reduce((s,r)=>s+n(r.accepted_product_count),0),
  };
}

export function diagnoseMonth(current:DoctorPerformanceMonth,previous:DoctorPerformanceMonth|null):DoctorPerformanceDiagnosis[]{
  const out:DoctorPerformanceDiagnosis[]=[];
  if(!current.comparisonEligible){
    out.push({kind:'data_quality',severity:'watch',title:'لا يوجد حكم أداء تلقائي',detail:current.comparisonReason,evidence:[current.coverageReason]});
    return out;
  }
  if(previous?.comparisonEligible){
    const change=(now:number|null,before:number|null)=>before&&now!==null?((now-before)/Math.abs(before))*100:null;
    const salesDelta=change(current.sales,previous.sales);
    const efficiencyDelta=change(current.salesPerHour,previous.salesPerHour);
    // Approved hours alone shrink while days are pending review; they are compared only when both cycles are settled.
    const hoursDelta=current.hoursComplete&&previous.hoursComplete?change(current.workedHours,previous.workedHours):null;
    const customersDelta=change(current.customers,previous.customers);
    const avgInvoiceDelta=change(current.averageInvoice,previous.averageInvoice);
    const conversationConversionDelta=change(current.conversionRate,previous.conversionRate);
    const verifiedConversionDelta=current.customerImpact.available&&previous.customerImpact.available
      ?change(current.customerImpact.verifiedConversionRate,previous.customerImpact.verifiedConversionRate):null;

    if(salesDelta!==null&&salesDelta<=-10){
      const contributors:string[]=[];
      if(hoursDelta!==null&&hoursDelta<=-10) contributors.push(`ساعات العمل ${hoursDelta.toFixed(1)}%`);
      if(customersDelta!==null&&customersDelta<=-10) contributors.push(`العملاء ${customersDelta.toFixed(1)}%`);
      if(avgInvoiceDelta!==null&&avgInvoiceDelta<=-10) contributors.push(`متوسط الفاتورة ${avgInvoiceDelta.toFixed(1)}%`);
      if(efficiencyDelta!==null&&efficiencyDelta<=-10) contributors.push(`مبيعات/ساعة ${efficiencyDelta.toFixed(1)}%`);
      if(verifiedConversionDelta!==null&&verifiedConversionDelta<=-10) contributors.push(`Conversion المؤكد ${verifiedConversionDelta.toFixed(1)}%`);
      else if(conversationConversionDelta!==null&&conversationConversionDelta<=-10) contributors.push(`Conversion المحادثات ${conversationConversionDelta.toFixed(1)}%`);
      out.push({
        kind:'sales_trend',severity:'attention',title:'تراجع بيعي موثوق',
        detail:contributors.length
          ?'المبيعات انخفضت، وتوجد مؤشرات متزامنة قد تفسر جزءًا من الاتجاه دون اعتبارها سببًا قاطعًا.'
          :'المبيعات انخفضت بأكثر من 10%، لكن المؤشرات المتاحة لا تكفي لتسمية محرك واضح للتراجع.',
        evidence:[`تغير المبيعات ${salesDelta.toFixed(1)}%`,...contributors],
      });
    } else if(salesDelta!==null&&salesDelta>=10){
      const contributors:string[]=[];
      if(customersDelta!==null&&customersDelta>=10) contributors.push(`العملاء +${customersDelta.toFixed(1)}%`);
      if(avgInvoiceDelta!==null&&avgInvoiceDelta>=10) contributors.push(`متوسط الفاتورة +${avgInvoiceDelta.toFixed(1)}%`);
      if(efficiencyDelta!==null&&efficiencyDelta>=10) contributors.push(`مبيعات/ساعة +${efficiencyDelta.toFixed(1)}%`);
      if(verifiedConversionDelta!==null&&verifiedConversionDelta>=10) contributors.push(`Conversion المؤكد +${verifiedConversionDelta.toFixed(1)}%`);
      out.push({kind:'sales_trend',severity:'positive',title:'نمو بيعي موثوق',detail:contributors.length?'النمو البيعي متزامن مع تحسن في مؤشرات داعمة موثقة.':'المبيعات تحسنت بأكثر من 10% دون محرك واحد واضح من المؤشرات الحالية.',evidence:[`تغير المبيعات +${salesDelta.toFixed(1)}%`,...contributors]});
    }
    if(efficiencyDelta!==null&&efficiencyDelta<=-10) out.push({kind:'efficiency',severity:'attention',title:'كفاءة الساعة تحتاج مراجعة',detail:'البيع لكل ساعة عمل انخفض رغم صلاحية المقارنة؛ لذلك التغير ليس مجرد انعكاس لساعات عمل أقل.',evidence:[`تغير مبيعات/ساعة ${efficiencyDelta.toFixed(1)}%`,hoursDelta===null?'تغير الساعات غير قابل للحساب':`تغير الساعات ${hoursDelta>=0?'+':''}${hoursDelta.toFixed(1)}%`]});
  }
  const impact=current.customerImpact;
  if(impact.available){
    if((impact.commercialConversations||0)>=5&&impact.verifiedConversionRate!==null&&impact.verifiedConversionRate<25) out.push({kind:'conversion',severity:'attention',title:'فرص تجارية لا تتحول لبيع كفاية',detail:'يوجد حجم فرص يسمح بالقراءة، لكن نسبة البيع المؤكد منخفضة.',evidence:[`Conversion موثق ${impact.verifiedConversionRate.toFixed(1)}%`,`فرص تجارية ${impact.commercialConversations}`]});
    if((impact.saleLeakage||0)>0) out.push({kind:'opportunity',severity:'attention',title:'فرص بيع متوقفة قابلة للمراجعة',detail:'هناك فرص مسجلة وصلت لمسار تجاري ولم تُغلق كبيع مؤكد.',evidence:[`فقد بيع ${impact.saleLeakage}`,`متابعات مطلوبة ${impact.followupsNeeded||0}`]});
    if((impact.unavailableProducts||0)>0) out.push({kind:'customer_impact',severity:'watch',title:'التوافر يؤثر على تجربة العميل',detail:'جزء من الفرص تأثر بأصناف غير متاحة؛ لا يُنسب السبب تلقائيًا للدكتور.',evidence:[`أصناف/فرص غير متاحة ${impact.unavailableProducts}`]});
    if((impact.acceptedProducts||0)>0) out.push({kind:'customer_impact',severity:'positive',title:'ترشيحات مقبولة من العملاء',detail:'يوجد Evidence على قبول العميل لترشيحات أو بدائل داخل المحادثات.',evidence:[`ترشيحات مقبولة ${impact.acceptedProducts}`]});
  }
  // "No negative signal" is a claim: it needs a fair comparison with the previous cycle and the customer-impact evidence.
  if(!out.length&&previous?.comparisonEligible&&impact.available) out.push({kind:'data_quality',severity:'positive',title:'لا توجد إشارة سلبية قوية',detail:'البيانات الحالية لا تُظهر تراجعًا موثقًا يتجاوز قواعد التشخيص.',evidence:['تغطية كاملة للدورة','مقارنة عادلة بالدورة السابقة']});
  return out;
}

const severityRank={attention:0,watch:1,positive:2} as const;

/** Concrete next steps derived only from evidence-backed diagnoses; no action is invented without a diagnosis. */
export function deriveDoctorPerformanceActions(month:DoctorPerformanceMonth):DoctorPerformanceAction[]{
  const out:DoctorPerformanceAction[]=[];
  const impact=month.customerImpact;
  for(const d of [...month.diagnoses].sort((a,b)=>severityRank[a.severity]-severityRank[b.severity])){
    if(d.kind==='data_quality'&&d.severity!=='positive') out.push({owner:'manager',title:'استكمال مصادر الدليل قبل الحكم',detail:'لا يُبنى قرار أداء على مصدر غير متاح؛ أعد التحميل أو راجع مصدر البيانات المتعطل في "مصادر الحقيقة".',focus:'all'});
    if(d.kind==='sales_trend'&&d.severity==='attention') out.push({owner:'manager',title:'جلسة مراجعة للتراجع البيعي',detail:'راجع مع الدكتور المؤشرات المتزامنة المذكورة في الدليل (الساعات، العملاء، متوسط الفاتورة) قبل نسب التراجع لسبب واحد.',focus:'all'});
    if(d.kind==='efficiency') out.push({owner:'manager',title:'مراجعة توزيع الساعات والشيفتات',detail:'البيع لكل ساعة انخفض؛ قارن شيفتات الدكتور بأوقات الذروة في الفرع.',focus:'all'});
    if(d.kind==='conversion') out.push({owner:'doctor',title:'رفع تحويل المحادثات التجارية',detail:`راجع المحادثات التي لم تتحول لبيع مؤكد${impact.commercialConversations!==null?` (${impact.commercialConversations} فرصة تجارية)`:''} وحدد نقطة التوقف في كل منها.`,focus:'conversion'});
    if(d.kind==='opportunity') out.push({owner:'doctor',title:'متابعة الفرص المتوقفة',detail:`أغلق المتابعات المطلوبة${impact.followupsNeeded!==null?` (${impact.followupsNeeded})`:''} وسجّل نتيجة كل فرصة.`,focus:'opportunity'});
    if(d.kind==='customer_impact'&&d.severity==='watch') out.push({owner:'manager',title:'تصعيد الأصناف غير المتاحة للمشتريات',detail:'الفرص المتأثرة بعدم التوافر لا تُحسب على الدكتور؛ ارفع الأصناف المتكررة لفريق المشتريات.',focus:'availability'});
    if(d.kind==='sales_trend'&&d.severity==='positive') out.push({owner:'manager',title:'تثبيت ما نجح',detail:'وثّق مع الدكتور الممارسات التي صاحبت النمو لتعميمها على الفريق.',focus:'all'});
  }
  const seen=new Set<string>();
  return out.filter(a=>!seen.has(a.title)&&Boolean(seen.add(a.title))).slice(0,4);
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

/**
 * Per-hour productivity and conversion for one cycle.
 * - Sales cover every day worked, so dividing by approved hours alone overstates the rate while days are pending
 *   review: per-hour figures exist only when every attendance day of the cycle is settled.
 * - A review whose sale outcome was never recorded is unknown, not "not converted": conversion is converted ÷
 *   recorded outcomes, and null when no outcome was recorded.
 */
export function cycleRates(a:{salesTotal:number|null;invoices:number|null;customers:number|null;hours:number|null;detail:DoctorPerformanceMonth['attendanceDetail'];outcomes:(boolean|null|undefined)[]|null}){
  const recorded=a.outcomes===null?null:a.outcomes.filter(v=>v===true||v===false).length;
  const converted=a.outcomes===null?null:a.outcomes.filter(v=>v===true).length;
  const hoursComplete=a.hours!==null&&a.hours>0&&a.detail!==null&&a.detail.pendingDays===0;
  const hoursNote=a.hours===null?null:!a.detail?'تفاصيل الحضور غير متاحة؛ إنتاجية الساعة غير محسوبة.':a.detail.pendingDays>0?`${a.detail.pendingDays} يوم حضور بانتظار المراجعة؛ إنتاجية الساعة لا تُحسب على ساعات ناقصة.`:null;
  const perHour=(v:number|null)=>hoursComplete&&v!==null?v/(a.hours as number):null;
  return {
    recorded,converted,hoursComplete,hoursNote,
    salesPerHour:perHour(a.salesTotal),invoicesPerHour:perHour(a.invoices),customersPerHour:perHour(a.customers),
    conversionRate:recorded&&converted!==null?converted/recorded*100:null,
  };
}

export async function loadDoctorPerformanceIntelligence(args:{staffId:string;staffName:string;cycleLabel:string}):Promise<DoctorPerformanceIntelligence>{
  const cycleSpecs=Array.from({length:3},(_,back)=>{
    const cycleLabel=previousCycle(args.cycleLabel,back);
    const range=evaluationCycleRangeFromLabel(cycleLabel);
    const keys=evaluationCycleDateKeys(cycleLabel);
    return {cycleLabel,range,start:keys.startDate,endInclusive:keys.endDate,endExclusive:keys.endDateExclusive};
  });
  const windowStart=cycleSpecs[2].start;
  const windowEnd=cycleSpecs[0].endExclusive;
  // Conversation timestamps are timestamptz: bound and bucket them on Cairo calendar days, never UTC.
  const windowStartAt=cairoDateBoundaryIso(windowStart);
  const windowEndAt=cairoDateBoundaryIso(windowEnd);

  const currentSpec=cycleSpecs[0];
  const now=new Date();
  const localDayUtc=(date:Date)=>Date.UTC(date.getFullYear(),date.getMonth(),date.getDate());
  const cycleDays=Math.round((localDayUtc(currentSpec.range.endExclusive)-localDayUtc(currentSpec.range.start))/86400000);
  const requestedElapsedDays=Math.max(1,Math.min(Math.round((Date.UTC(now.getFullYear(),now.getMonth(),now.getDate())-localDayUtc(currentSpec.range.start))/86400000)+1,cycleDays));

  // Worked hours come from the canonical attendance detail (same truth as the evaluation header); the raw
  // attendance read model carries no hours and is used only for evidence dates/counts.
  const canonicalAttendance=Promise.allSettled(cycleSpecs.map(spec=>getStaffAttendanceDetail(args.staffId,spec.start,spec.endInclusive)));
  const [salesTruth,attendanceWindow,conversationWindow,impactWindow]=await Promise.all([
    salesBundle(args.staffId,windowStart,windowEnd,currentSpec.start,requestedElapsedDays),
    readAttendanceRange({staffId:args.staffId,startDate:windowStart,endDateExclusive:windowEnd,limit:400}),
    supabase.from('conversation_sales_reviews_canonical_v2').select('id,converted_to_sale,conversation_date,created_at').or(`doctor_id.eq.${args.staffId},staff_id.eq.${args.staffId}`).or(`and(conversation_date.gte.${windowStartAt},conversation_date.lt.${windowEndAt}),and(conversation_date.is.null,created_at.gte.${windowStartAt},created_at.lt.${windowEndAt})`).limit(3000),
    customerImpactWindow(args.staffId,windowStart,windowEnd),
  ]);
  const attendanceDetails=await canonicalAttendance;
  const failedDetail=attendanceDetails.find((r):r is PromiseRejectedResult=>r.status==='rejected');
  const attendanceDetailProblem=failedDetail?describeSourceProblem(failedDetail.reason,'ساعات الحضور','attendance_hours'):null;
  const attendanceWindowRows=attendanceWindow.status==='unavailable'?[]:attendanceWindow.rows;
  const firstAttendanceDate=attendanceWindow.status!=='unavailable'
    ?minDate(attendanceWindowRows.map(r=>String(r.attendance_date||r.date||'').slice(0,10)||null))
    :null;
  const elapsedDays=salesTruth.effectiveDays;
  const salesDataAsOf=salesTruth.dataAsOf;

  const rawMonths=cycleSpecs.map((spec,specIndex)=>{
    const {cycleLabel,range,start,endExclusive}=spec;
    const detail=attendanceDetails[specIndex];
    const summary=detail.status==='fulfilled'?detail.value?.summary:null;
    const canonicalHours=summary&&Number.isFinite(Number(summary.total_worked_hours))?Number(summary.total_worked_hours):null;
    const attendanceDetail=summary?{workedDays:n(summary.actual_worked_days),lateDays:n(summary.late_days),lateMinutes:n(summary.total_late_minutes),pendingDays:n(summary.pending_review_days),approvedHours:n(summary.total_worked_hours),pendingHours:n(summary.pending_worked_hours)}:null;
    const salesSummary=salesTruth.rows.find(r=>String(r.cycle_start||'').slice(0,10)===start);
    const sales={
      summary:salesSummary||null,
      available:salesTruth.available,
      identity:salesTruth.identity,
    };
    const attendance={
      data:attendanceWindowRows.filter(r=>{
        const date=String(r.attendance_date||r.date||'').slice(0,10);
        return date>=start&&date<endExclusive;
      }),
      // A partial attendance read (one of two sources failed) understates hours; it is never treated as complete.
      error:attendanceWindow.status==='available'?null:(attendanceWindow.error||'attendance partially unavailable'),
      hours:canonicalHours,
      detail:attendanceDetail,
    };
    const conversations={
      data:(conversationWindow.data||[]).filter(r=>{
        const date=cairoDayOf(r.conversation_date||r.created_at)||'';
        return date>=start&&date<endExclusive;
      }),
      error:conversationWindow.error,
    };
    const end=new Date(`${endExclusive}T12:00:00Z`);end.setUTCDate(end.getUTCDate()-1);
    const endInclusive=end.toISOString().slice(0,10);
    const impact={
      rows:impactWindow.rows.filter(r=>String(r.cycle_start||'').slice(0,10)===start&&String(r.cycle_end||'').slice(0,10)===endInclusive),
      available:impactWindow.available,
    };
    return {cycleLabel,range,start,endExclusive,sales,attendance,conversations,impact};
  });
  const firstSalesDate=minDate(rawMonths.map(m=>String(m.sales.summary?.first_sale_date||'').slice(0,10)||null));
  const firstConversationDate=minDate(rawMonths.flatMap(m=>(m.conversations.data||[]).map(r=>cairoDayOf(r.conversation_date||r.created_at))));
  const firstEvidenceDate=minDate([firstAttendanceDate,firstSalesDate,firstConversationDate]);

  const months:DoctorPerformanceMonth[]=rawMonths.map(({cycleLabel,range,start,endExclusive,sales,attendance,conversations,impact})=>{
    const cycleClosed=isEvaluationCycleClosed(cycleLabel);
    const attendanceAvailable=!attendance.error;
    const conversationAvailable=!conversations.error;
    const attendanceRows=attendance.data||[];
    const conversationRows=conversations.data||[];
    const cycleBeforeFirstEvidence=Boolean(firstEvidenceDate && endExclusive<=firstEvidenceDate);
    const hasCoreEvidence=n(sales.summary?.invoices)>0||attendanceRows.length>0;

    const coverage:PerformanceCoverage=cycleBeforeFirstEvidence
      ?'not_applicable'
      :(!sales.available&&!attendanceAvailable?'unavailable':(!sales.available||!attendanceAvailable?'partial':'available'));

    const confidence:PerformanceConfidence=coverage==='available'
      ?(hasCoreEvidence?(conversationAvailable?'high':'medium'):'medium')
      :coverage==='partial'?'low':'low';

    const salesUsable=coverage!=='not_applicable'&&sales.available;
    const salesTotal=salesUsable?n(sales.summary?.sales):null;
    const invoices=salesUsable?n(sales.summary?.invoices):null;
    const customers=salesUsable?n(sales.summary?.customers):null;
    const avg=salesUsable&&invoices? salesTotal!/invoices:null;
    // Unknown hours stay null (never 0): canonical detail failed, attendance incomplete, or before first evidence.
    const hours=coverage==='not_applicable'||attendance.error?null:attendance.hours;
    const conv=coverage==='not_applicable'||conversations.error?null:conversationRows.length;
    const detail=attendance.detail;
    const rates=cycleRates({salesTotal,invoices,customers,hours,detail,outcomes:conv===null?null:conversationRows.map(r=>r.converted_to_sale)});
    const {recorded,converted,hoursComplete,hoursNote}=rates;
    const salesDays=!salesUsable?null:cycleClosed?Math.round((Date.parse(`${endExclusive}T00:00:00Z`)-Date.parse(`${start}T00:00:00Z`))/86400000):(elapsedDays>0?elapsedDays:null);
    const customerImpact=aggregateImpactEvidence(impact.rows,impact.available);

    // A cycle the doctor joined mid-way, or a closed cycle whose sales are not loaded to its last day, is not a
    // fair full cycle: comparing it would show a false growth or decline.
    const joinedMidCycle=Boolean(firstEvidenceDate&&firstEvidenceDate>addDays(start,JOIN_TOLERANCE_DAYS)&&firstEvidenceDate<endExclusive);
    const salesLoadedToEnd=!cycleClosed||Boolean(salesDataAsOf&&salesDataAsOf>=addDays(endExclusive,-1));
    const comparisonReady=coverage==='available'&&confidence!=='low'&&hasCoreEvidence&&!joinedMidCycle&&salesLoadedToEnd;
    const comparisonMode:DoctorPerformanceMonth['comparisonMode']=comparisonReady?(cycleClosed?'full_cycle':'same_period'):'blocked';
    const comparisonEligible=comparisonMode!=='blocked';
    const comparisonReason=joinedMidCycle&&coverage==='available'
      ?'بدأ الدكتور العمل خلال هذه الدورة؛ لا تُقارن دورة جزئية بدورة كاملة.'
      :!salesLoadedToEnd&&coverage==='available'
        ?'مبيعات آخر أيام الدورة لم تُحمّل بعد؛ المقارنة محجوبة بدل اعتبار الأيام الناقصة صفرًا.'
      :comparisonMode==='same_period'
      ?`الدورة جارية؛ المقارنة تستخدم أول ${elapsedDays} يوم من كل دورة${salesDataAsOf?`، وبيانات المبيعات محمّلة حتى ${salesDataAsOf}`:''}.`
      :!cycleClosed
        ?'الدورة ما زالت جارية، لكن التغطية الحالية لا تكفي لمقارنة عادلة.'
      :coverage==='not_applicable'
        ?'الدورة خارج نطاق المقارنة لأنها تسبق أول Evidence موثوق.'
        :coverage!=='available'
        ?'التغطية غير مكتملة، لذلك المقارنة محجوبة.'
        :!hasCoreEvidence
          ?'لا يوجد Evidence فعلي كافٍ داخل الدورة لبناء اتجاه.'
          :'الدورة مؤهلة للمقارنة عند وجود دورة أخرى مؤهلة.';

    return {
      cycleLabel,displayLabel:range.displayLabel,
      sales:salesTotal,invoices,customers,averageInvoice:avg,
      workedHours:hours,salesPerHour:rates.salesPerHour,invoicesPerHour:rates.invoicesPerHour,customersPerHour:rates.customersPerHour,
      conversations:conv,convertedConversations:converted,conversionRate:rates.conversionRate,conversionRecorded:recorded,
      attendanceDetail:coverage==='not_applicable'?null:detail,hoursComplete,hoursNote,salesDays,
      coverage,confidence,
      coverageReason:coverageText(coverage,sales.available,attendanceAvailable,hasCoreEvidence),
      comparisonEligible,comparisonMode,comparisonReason,comparisonSnapshot:null,
      salesIdentity:sales.identity,salesSourceAvailable:sales.available,attendanceSourceAvailable:attendanceAvailable,conversationSourceAvailable:conversationAvailable,
      salesEvidenceCount:salesUsable?n(sales.summary?.invoices):0,attendanceEvidenceCount:attendanceRows.length,conversationEvidenceCount:conversationRows.length,
      customerImpact,diagnoses:[],
    };
  });

  months.forEach((month,index)=>{month.diagnoses=diagnoseMonth(month,months[index+1]||null)});
  const windowConversationRows=rawMonths.flatMap(m=>m.conversations.data||[]);
  const conversationProblem=problemOf(conversationWindow.error,'المحادثات','conversations');
  // Attendance reports failures as text; a partial read is still a real failure for the diagnostic log.
  const attendanceProblem=attendanceWindow.status==='available'?null:describeSourceProblem({message:attendanceWindow.error||'attendance read failed'},'الحضور','attendance');
  const sources:DoctorPerformanceIntelligence['sources']={
    sales:{
      status:salesTruth.available?'available':'unavailable',...sourceStateOf(salesTruth.problem),
      evidenceCount:salesTruth.available?rawMonths.reduce((sum,m)=>sum+n(m.sales.summary?.invoices),0):0,
      firstEvidenceDate:firstSalesDate,dataAsOf:salesDataAsOf,
    },
    attendance:{
      status:attendanceWindow.status,
      ...(attendanceWindow.status==='partial'
        ?{state:'partial' as const,reason:'أحد مصدري الحضور لم يُحمّل؛ أرقام الحضور قد تكون ناقصة وليست صفرًا.',diagnostic:attendanceProblem?.diagnostic||null}
        :attendanceWindow.status==='available'&&attendanceDetailProblem
          ?{state:'partial' as const,reason:'ساعات الحضور لم تُحمّل؛ مؤشرات الساعة محجوبة وليست صفرًا.',diagnostic:attendanceDetailProblem.diagnostic}
          :sourceStateOf(attendanceProblem)),
      evidenceCount:attendanceWindowRows.length,firstEvidenceDate:firstAttendanceDate,
      dataAsOf:maxDate(attendanceWindowRows.map(r=>String(r.attendance_date||r.date||'').slice(0,10)||null)),
    },
    conversations:{
      status:conversationWindow.error?'unavailable':'available',...sourceStateOf(conversationProblem),
      evidenceCount:conversationWindow.error?0:windowConversationRows.length,firstEvidenceDate:firstConversationDate,
      dataAsOf:conversationWindow.error?null:maxDate(windowConversationRows.map(r=>cairoDayOf(r.conversation_date||r.created_at))),
    },
    customerImpact:{
      status:!impactWindow.available?'unavailable':impactWindow.rows.length?'available':'partial',
      ...sourceStateOf(impactWindow.problem,impactWindow.available&&!impactWindow.rows.length?'لا توجد بيانات أثر عملاء لهذه الفترة بعد.':null),
      evidenceCount:impactWindow.rows.length,firstEvidenceDate:null,dataAsOf:null,
    },
  };
  if(months[0]?.comparisonMode==='same_period'&&elapsedDays>0){
    const currentSummary={summary:salesTruth.samePeriod.current||null,available:salesTruth.available};
    const previousSummary={summary:salesTruth.samePeriod.previous||null,available:salesTruth.available};
    const previousSamePeriodEnd=(()=>{
      const d=new Date(cycleSpecs[1].start+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+elapsedDays);return d.toISOString().slice(0,10);
    })();
    const previousSalesEvidenceDate=salesTruth.rows.find(row=>String(row.cycle_start||'').slice(0,10)===cycleSpecs[1].start)?.first_sale_date||null;
    // The previous window must cover the same days: the doctor sold from (almost) its first day, and it cannot
    // run past the previous cycle into the current one (a 31-day cycle after a 30-day one, or after February).
    const previousWindowHasSalesEvidence=Boolean(previousSalesEvidenceDate&&String(previousSalesEvidenceDate).slice(0,10)<=addDays(cycleSpecs[1].start,JOIN_TOLERANCE_DAYS)&&String(previousSalesEvidenceDate).slice(0,10)<previousSamePeriodEnd);
    const previousCycleDays=Math.round((Date.parse(`${cycleSpecs[0].start}T00:00:00Z`)-Date.parse(`${cycleSpecs[1].start}T00:00:00Z`))/86400000);
    const windowFitsPreviousCycle=elapsedDays<=previousCycleDays;
    if(currentSummary?.available&&previousSummary?.available&&months[1]?.coverage==='available'&&previousWindowHasSalesEvidence&&windowFitsPreviousCycle){
      const cs=currentSummary.summary,ps=previousSummary.summary;
      const ci=n(cs?.invoices),pi=n(ps?.invoices),cSales=n(cs?.sales),pSales=n(ps?.sales);
      months[0].comparisonSnapshot={
        days:elapsedDays,dataAsOf:salesDataAsOf,sales:cSales,previousSales:pSales,invoices:ci,previousInvoices:pi,
        customers:n(cs?.customers),previousCustomers:n(ps?.customers),
        averageInvoice:ci?cSales/ci:null,previousAverageInvoice:pi?pSales/pi:null,
      };
      const current={...months[0],sales:cSales,invoices:ci,customers:n(cs?.customers),averageInvoice:ci?cSales/ci:null,
        workedHours:null,salesPerHour:null,invoicesPerHour:null,customersPerHour:null,conversionRate:null,
        customerImpact:{...months[0].customerImpact,available:false}};
      const previous={...months[1],comparisonEligible:true,sales:pSales,invoices:pi,customers:n(ps?.customers),averageInvoice:pi?pSales/pi:null,
        workedHours:null,salesPerHour:null,invoicesPerHour:null,customersPerHour:null,conversionRate:null,
        customerImpact:{...months[1].customerImpact,available:false}};
      months[0].diagnoses=diagnoseMonth(current,previous).map(d=>({...d,evidence:[`نفس الفترة: أول ${elapsedDays} يوم${salesDataAsOf?` — البيانات حتى ${salesDataAsOf}`:''}`,...d.evidence]}));
    }else{
      months[0].comparisonEligible=false;
      months[0].comparisonMode='blocked';
      months[0].comparisonReason=!windowFitsPreviousCycle
        ?'الأيام المنقضية من الدورة الحالية أكثر من أيام الدورة السابقة؛ لا توجد نافذة مماثلة عادلة للمقارنة.'
        :previousWindowHasSalesEvidence?'تعذر بناء نافذة مقارنة مماثلة موثوقة من مصدر المبيعات؛ المقارنة محجوبة بدل عرض نسبة مضللة.':'الدكتور لم يبدأ البيع من أول الدورة السابقة؛ لا تُقارن فترة جزئية بفترة كاملة.';
      months[0].diagnoses=diagnoseMonth(months[0],null);
    }
  }
  if(months[0]?.comparisonMode==='same_period'&&elapsedDays<=0){
    months[0].comparisonEligible=false;
    months[0].comparisonMode='blocked';
    months[0].comparisonReason='لا يوجد تاريخ تحميل مبيعات موثوق داخل الدورة الحالية؛ المقارنة محجوبة بدل اعتبار الأيام غير المحملة صفراً.';
    months[0].diagnoses=diagnoseMonth(months[0],null);
  }
  return {months,sources,actions:months[0]?deriveDoctorPerformanceActions(months[0]):[],generatedAt:new Date().toISOString(),firstEvidenceDate,firstSalesEvidenceDate:firstSalesDate,firstAttendanceEvidenceDate:firstAttendanceDate,firstConversationEvidenceDate:firstConversationDate};
}

export type DoctorEvidenceConversation = {
  id: string; customer_name: string | null; customer_code: string | null; conversation_started_at: string | null;
  followup_required: boolean | null; invoice_match_status: string | null; matched_invoice_number: string | null;
  matched_invoice_value: number | null; review_status: string | null;
};
export type DoctorEvidenceProduct = {
  source_id: string; customer_name: string | null; customer_code: string | null; product_name: string | null;
  current_stage: string | null; leakage_reason: string | null; next_action: string | null; invoice_match_status: string | null;
  matched_invoice_number: string | null; matched_invoice_value: number | null; confidence: string | number | null;
};

/**
 * Drill-down evidence for one cycle. Uses the cycle date keys (not Date#toISOString, which shifts
 * Cairo local midnight to the previous UTC day) and fails loudly instead of returning empty lists.
 */
export async function loadDoctorPerformanceEvidence(args:{staffId:string;cycleLabel:string}):Promise<{conversations:DoctorEvidenceConversation[];products:DoctorEvidenceProduct[]}>{
  const {startDate,endDate,endDateExclusive}=evaluationCycleDateKeys(args.cycleLabel);
  const [sources,products]=await Promise.all([
    supabase.from('whatsapp_review_sources')
      .select('id,customer_name,customer_code,conversation_started_at,followup_required,invoice_match_status,matched_invoice_number,matched_invoice_value,review_status')
      .eq('staff_id',args.staffId).gte('conversation_started_at',`${startDate}T00:00:00`).lt('conversation_started_at',`${endDateExclusive}T00:00:00`)
      .order('conversation_started_at',{ascending:false}).limit(80),
    supabase.from('whatsapp_product_journey_detail_v1')
      .select('source_id,customer_name,customer_code,product_name,current_stage,leakage_reason,next_action,invoice_match_status,matched_invoice_number,matched_invoice_value,confidence')
      .eq('staff_id',args.staffId).eq('cycle_start',startDate).eq('cycle_end',endDate).limit(120),
  ]);
  if(sources.error)throw new UserFacingError(describeSourceProblem(sources.error,'محادثات الدليل','evidence_conversations').reason);
  if(products.error)throw new UserFacingError(describeSourceProblem(products.error,'رحلات الأصناف','evidence_products').reason);
  return {conversations:(sources.data||[]) as DoctorEvidenceConversation[],products:(products.data||[]) as DoctorEvidenceProduct[]};
}
