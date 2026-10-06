import { supabase } from '@/lib/supabase';
import { loadPerformanceSalesBundle, type PerformanceSalesBundlePayload } from '@/lib/evaluations/performanceSalesBundleCache';
import { evaluationCycleRangeFromLabel, evaluationCycleDateKeys, isEvaluationCycleClosed, previousEvaluationCycleLabel } from '@/lib/evaluations/monthlyEvaluationCycle';
import { readAttendanceRange } from '@/lib/readModels/attendanceReadModel';

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
  conversations: number | null; convertedConversations: number | null; conversionRate: number | null;
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

export type DoctorPerformanceIntelligence = {
  months: DoctorPerformanceMonth[];
  generatedAt: string;
  firstEvidenceDate: string | null;
};

const n=(v:unknown)=>{const x=Number(v);return Number.isFinite(x)?x:0};
const previousCycle=(label:string,back:number)=>{let value=label;for(let i=0;i<back;i+=1)value=previousEvaluationCycleLabel(value);return value};
type SalesCycleSummaryRow = {
  cycle_start?: string; cycle_end?: string; sales?: number; invoices?: number; customers?: number; first_sale_date?: string | null;
};

type SalesPeriodSummaryRow = { sales?: number; invoices?: number; customers?: number; first_sale_date?: string | null };
async function salesBundle(staffId:string,windowStart:string,windowEnd:string,currentStart:string,elapsedDays:number){
  const {payload,error}=await loadPerformanceSalesBundle({
    staffId,windowStart,windowEnd,currentStart,elapsedDays,
  });
  return {rows:Array.isArray(payload.cycles)?payload.cycles:[],samePeriod:payload.samePeriod||{},dataAsOf:payload.dataAsOf||null,effectiveDays:Math.max(0,n(payload.effectiveDays)),available:!error,identity:error?'unavailable' as const:'canonical' as const};
}

function minDate(values:(string|null)[]){
  const valid=values.filter((v):v is string=>Boolean(v)).sort();
  return valid[0]||null;
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
  return {rows:(data||[]) as DoctorCycleImpactRow[],available:!error};
}

function aggregateImpact(rows:DoctorCycleImpactRow[],available:boolean):DoctorCustomerImpact{
  if(!available) return {available:false,commercialConversations:null,verifiedSaleConversations:null,verifiedRevenue:null,verifiedConversionRate:null,followupsNeeded:null,complaints:null,saleLeakage:null,unavailableProducts:null,acceptedProducts:null};
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

function diagnoseMonth(current:DoctorPerformanceMonth,previous:DoctorPerformanceMonth|null):DoctorPerformanceDiagnosis[]{
  const out:DoctorPerformanceDiagnosis[]=[];
  if(!current.comparisonEligible){
    out.push({kind:'data_quality',severity:'watch',title:'لا يوجد حكم أداء تلقائي',detail:current.comparisonReason,evidence:[current.coverageReason]});
    return out;
  }
  if(previous?.comparisonEligible){
    const change=(now:number|null,before:number|null)=>before&&now!==null?((now-before)/Math.abs(before))*100:null;
    const salesDelta=change(current.sales,previous.sales);
    const efficiencyDelta=change(current.salesPerHour,previous.salesPerHour);
    const hoursDelta=change(current.workedHours,previous.workedHours);
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
  if(!out.length) out.push({kind:'data_quality',severity:'positive',title:'لا توجد إشارة سلبية قوية',detail:'البيانات الحالية لا تُظهر تراجعًا موثقًا يتجاوز قواعد التشخيص.',evidence:[`Coverage ${current.coverage}`,`Confidence ${current.confidence}`]});
  return out;
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
  const cycleSpecs=Array.from({length:3},(_,back)=>{
    const cycleLabel=previousCycle(args.cycleLabel,back);
    const range=evaluationCycleRangeFromLabel(cycleLabel);
    const keys=evaluationCycleDateKeys(cycleLabel);
    return {cycleLabel,range,start:keys.startDate,endExclusive:keys.endDateExclusive};
  });
  const windowStart=cycleSpecs[2].start;
  const windowEnd=cycleSpecs[0].endExclusive;

  const currentSpec=cycleSpecs[0];
  const now=new Date();
  const localDayUtc=(date:Date)=>Date.UTC(date.getFullYear(),date.getMonth(),date.getDate());
  const cycleDays=Math.round((localDayUtc(currentSpec.range.endExclusive)-localDayUtc(currentSpec.range.start))/86400000);
  const requestedElapsedDays=Math.max(1,Math.min(Math.round((Date.UTC(now.getFullYear(),now.getMonth(),now.getDate())-localDayUtc(currentSpec.range.start))/86400000)+1,cycleDays));

  const [salesTruth,attendanceWindow,conversationWindow,impactWindow]=await Promise.all([
    salesBundle(args.staffId,windowStart,windowEnd,currentSpec.start,requestedElapsedDays),
    readAttendanceRange({staffId:args.staffId,startDate:windowStart,endDateExclusive:windowEnd,limit:400}),
    supabase.from('conversation_sales_reviews_canonical_v2').select('id,converted_to_sale,conversation_date,created_at').or(`doctor_id.eq.${args.staffId},staff_id.eq.${args.staffId}`).or(`and(conversation_date.gte.${windowStart},conversation_date.lt.${windowEnd}),and(conversation_date.is.null,created_at.gte.${windowStart},created_at.lt.${windowEnd})`).limit(3000),
    customerImpactWindow(args.staffId,windowStart,windowEnd),
  ]);
  const attendanceWindowRows=attendanceWindow.status==='available'?attendanceWindow.rows:[];
  const firstAttendanceDate=attendanceWindow.status==='available'
    ?minDate(attendanceWindowRows.map(r=>String(r.attendance_date||r.date||'').slice(0,10)||null))
    :null;
  const elapsedDays=salesTruth.effectiveDays;
  const salesDataAsOf=salesTruth.dataAsOf;

  const rawMonths=cycleSpecs.map(spec=>{
    const {cycleLabel,range,start,endExclusive}=spec;
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
      error:attendanceWindow.status==='unavailable'?attendanceWindow.error:null,
    };
    const conversations={
      data:(conversationWindow.data||[]).filter(r=>{
        const date=String(r.conversation_date||r.created_at||'').slice(0,10);
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
  const firstConversationDate=minDate(rawMonths.flatMap(m=>(m.conversations.data||[]).map(r=>String(r.conversation_date||'').slice(0,10)||null)));
  const firstEvidenceDate=minDate([firstAttendanceDate,firstSalesDate,firstConversationDate]);

  const months:DoctorPerformanceMonth[]=rawMonths.map(({cycleLabel,range,endExclusive,sales,attendance,conversations,impact})=>{
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
    const hours=coverage==='not_applicable'||attendance.error?null:attendanceRows.reduce((s,r)=>s+n(r.payroll_eligible_hours ?? r.total_hours),0);
    const conv=coverage==='not_applicable'||conversations.error?null:conversationRows.length;
    const converted=coverage==='not_applicable'||conversations.error?null:conversationRows.filter(r=>r.converted_to_sale===true).length;
    const customerImpact=aggregateImpact(impact.rows,impact.available);

    const comparisonReady=coverage==='available'&&confidence!=='low'&&hasCoreEvidence;
    const comparisonMode:DoctorPerformanceMonth['comparisonMode']=comparisonReady?(cycleClosed?'full_cycle':'same_period'):'blocked';
    const comparisonEligible=comparisonMode!=='blocked';
    const comparisonReason=comparisonMode==='same_period'
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
      workedHours:hours,salesPerHour:hours&&salesTotal!==null?salesTotal/hours:null,
      invoicesPerHour:hours&&invoices!==null?invoices/hours:null,customersPerHour:hours&&customers!==null?customers/hours:null,
      conversations:conv,convertedConversations:converted,conversionRate:conv&&converted!==null?converted/conv*100:null,
      coverage,confidence,
      coverageReason:coverageText(coverage,sales.available,attendanceAvailable,hasCoreEvidence),
      comparisonEligible,comparisonMode,comparisonReason,comparisonSnapshot:null,
      salesIdentity:sales.identity,salesSourceAvailable:sales.available,attendanceSourceAvailable:attendanceAvailable,conversationSourceAvailable:conversationAvailable,
      salesEvidenceCount:salesUsable?n(sales.summary?.invoices):0,attendanceEvidenceCount:attendanceRows.length,conversationEvidenceCount:conversationRows.length,
      customerImpact,diagnoses:[],
    };
  });

  months.forEach((month,index)=>{month.diagnoses=diagnoseMonth(month,months[index+1]||null)});
  if(months[0]?.comparisonMode==='same_period'&&elapsedDays>0){
    const currentSummary={summary:salesTruth.samePeriod.current||null,available:salesTruth.available};
    const previousSummary={summary:salesTruth.samePeriod.previous||null,available:salesTruth.available};
    const previousSamePeriodEnd=(()=>{
      const d=new Date(cycleSpecs[1].start+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+elapsedDays);return d.toISOString().slice(0,10);
    })();
    const previousSalesEvidenceDate=salesTruth.rows.find(row=>row.cycle_start===cycleSpecs[1].start)?.first_sale_date||null;
    const previousWindowHasSalesEvidence=Boolean(previousSalesEvidenceDate&&previousSalesEvidenceDate<previousSamePeriodEnd);
    if(currentSummary?.available&&previousSummary?.available&&months[1]?.coverage==='available'&&previousWindowHasSalesEvidence){
      const cs=currentSummary.summary,ps=previousSummary.summary;
      const ci=n(cs?.invoices),pi=n(ps?.invoices),cSales=n(cs?.sales),pSales=n(ps?.sales);
      months[0].comparisonSnapshot={
        days:elapsedDays,dataAsOf:salesDataAsOf,sales:cSales,previousSales:pSales,invoices:ci,previousInvoices:pi,
        customers:n(cs?.customers),previousCustomers:n(ps?.customers),
        averageInvoice:ci?cSales/ci:null,previousAverageInvoice:pi?pSales/pi:null,
      };
      const current={...months[0],sales:cSales,invoices:ci,customers:n(cs?.customers),averageInvoice:ci?cSales/ci:null,
        salesPerHour:null,invoicesPerHour:null,customersPerHour:null,conversionRate:null,
        customerImpact:{...months[0].customerImpact,available:false}};
      const previous={...months[1],comparisonEligible:true,sales:pSales,invoices:pi,customers:n(ps?.customers),averageInvoice:pi?pSales/pi:null,
        salesPerHour:null,invoicesPerHour:null,customersPerHour:null,conversionRate:null,
        customerImpact:{...months[1].customerImpact,available:false}};
      months[0].diagnoses=diagnoseMonth(current,previous).map(d=>({...d,evidence:[`Same-period: أول ${elapsedDays} يوم${salesDataAsOf?` — البيانات حتى ${salesDataAsOf}`:''}`,...d.evidence]}));
    }else{
      months[0].comparisonEligible=false;
      months[0].comparisonMode='blocked';
      months[0].comparisonReason=previousWindowHasSalesEvidence?'تعذر بناء نافذة Same-period موثوقة من المصدر البيعي؛ المقارنة محجوبة بدل عرض Delta مضلل.':'نافذة Same-period السابقة تسبق أول مبيعات موثقة للموظف؛ لا تتم مقارنة المبيعات بصفر غير عادل.';
      months[0].diagnoses=diagnoseMonth(months[0],null);
    }
  }
  if(months[0]?.comparisonMode==='same_period'&&elapsedDays<=0){
    months[0].comparisonEligible=false;
    months[0].comparisonMode='blocked';
    months[0].comparisonReason='لا يوجد تاريخ تحميل مبيعات موثوق داخل الدورة الحالية؛ المقارنة محجوبة بدل اعتبار الأيام غير المحملة صفراً.';
    months[0].diagnoses=diagnoseMonth(months[0],null);
  }
  return {months,generatedAt:new Date().toISOString(),firstEvidenceDate};
}
