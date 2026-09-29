import { useEffect, useMemo, useState } from 'react';
import { BadgeDollarSign, ChevronLeft, CircleAlert, FileText, PackageSearch, RefreshCw, Search, Stethoscope, TrendingUp, UserRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { loadOperationalSourceIds } from '@/lib/whatsappOperationalSourceOwner';

type Row = {
  owner_account_id: string | null;
  owner_name: string | null;
  owner_role: string | null;
  branch: string | null;
  cycle_start: string;
  cycle_end: string;
  handled_cases: number;
  commercial_opportunities: number;
  recommendation_cases: number;
  confirmed_orders: number;
  verified_sales: number;
  verified_conversion_rate: number | null;
  verified_revenue: number;
  lost_opportunities: number;
  cases_with_failure_signal: number;
  cases_with_complaint_signal: number;
};

type ConversationRow = {
  id: string;
  customer_name: string | null;
  customer_code: string | null;
  conversation_started_at: string | null;
  review_status: string | null;
  followup_required: boolean | null;
  invoice_match_status: string | null;
  matched_invoice_number: string | null;
  matched_invoice_value: number | null;
  analysis_json: any;
};

type ProductRow = {
  source_id: string;
  customer_name: string | null;
  customer_code: string | null;
  product_name: string | null;
  current_stage: string | null;
  sale_intent: boolean | null;
  closed_in_chat: boolean | null;
  followup_candidate: boolean | null;
  leakage_reason: string | null;
  next_action: string | null;
  invoice_match_status: string | null;
  matched_invoice_number: string | null;
  matched_invoice_value: number | null;
  confidence: number | null;
};

type DoctorCanonicalCaseRow = {
  id: string;
  root_source_id: string | null;
  source_ids: string[] | null;
  started_at: string | null;
  branch: string | null;
  proposed_outcome: string | null;
  confirmed_outcome: string | null;
  verified_revenue: number | null;
  verified_invoice_id: string | null;
  verified_invoice_number: string | null;
};

function cairoDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function money(value: unknown) {
  return `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج`;
}

function dateLabel(value: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
}

function normalizeDoctorName(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^(?:د\s*[\/.-]?\s*|دكتور(?:ه|ة)?\s+)/i, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[\u064B-\u065F]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-center"><div className="text-[11px] text-slate-500">{label}</div><div className="mt-1 text-lg font-black text-white">{value}</div></div>;
}

export default function WhatsAppDoctorCycleIntelligenceV8({
  onOpenSource,
}: {
  onOpenSource?: (sourceId: string, evidenceMessageIds?: string[]) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState('all');
  const [selected, setSelected] = useState<Row | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [detailCanonicalCases, setDetailCanonicalCases] = useState<DoctorCanonicalCaseRow[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const today = cairoDate();
      const { data, error } = await supabase
        .from('whatsapp_case_doctor_kpis_v23')
        .select('*')
        .lte('cycle_start', today)
        .gte('cycle_end', today)
        .in('owner_role', ['pharmacist', 'pharmacy_unknown'])
        .order('verified_revenue', { ascending: false });
      if (error) throw error;
      setRows((data || []) as Row[]);
    } catch (error) {
      console.error('[whatsapp-doctor-cycle-v8] load failed', error);
    } finally {
      setLoading(false);
    }
  };

  const loadDoctorDetail = async (row: Row) => {
    setSelected(row);
    setDetailLoading(true);
    try {
      let ownershipQuery = supabase
        .from('whatsapp_case_stage_ownership_v23')
        .select('evidence_source_ids,owner_account_id,owner_name,owner_role')
        .in('owner_role', ['pharmacist', 'pharmacy_unknown'])
        .limit(1000);
      ownershipQuery = row.owner_account_id
        ? ownershipQuery.eq('owner_account_id', row.owner_account_id)
        : ownershipQuery.eq('owner_name', row.owner_name || '');

      const ownershipResult = await ownershipQuery;
      if (ownershipResult.error) throw ownershipResult.error;
      const ownedSourceIds = Array.from(new Set(
        (ownershipResult.data || []).flatMap((item: any) => Array.isArray(item.evidence_source_ids) ? item.evidence_source_ids : [])
      )).filter(Boolean) as string[];
      // Canonical-only: the doctor's evidence is the V22 stage-owned sources that the operational
      // owner admits. There is no staff-name fallback; no canonical source means nothing to show.
      const sourceIds = Array.from(await loadOperationalSourceIds(supabase, ownedSourceIds)).slice(0, 400);
      const emptyResult = Promise.resolve({ data: [] as any[], error: null });

      let sourceQuery = supabase
        .from('whatsapp_review_sources')
        .select('id,customer_name,customer_code,conversation_started_at,review_status,followup_required,invoice_match_status,matched_invoice_number,matched_invoice_value,analysis_json')
        .gte('conversation_started_at', `${row.cycle_start}T00:00:00`)
        .lte('conversation_started_at', `${row.cycle_end}T23:59:59`)
        .order('conversation_started_at', { ascending: false })
        .limit(400);
      if (row.branch) sourceQuery = sourceQuery.eq('branch', row.branch);
      sourceQuery = sourceQuery.in('id', sourceIds);

      let productQuery = supabase
        .from('whatsapp_product_journey_detail_v1')
        .select('source_id,customer_name,customer_code,product_name,current_stage,sale_intent,closed_in_chat,followup_candidate,leakage_reason,next_action,invoice_match_status,matched_invoice_number,matched_invoice_value,confidence')
        .eq('cycle_start', row.cycle_start)
        .eq('cycle_end', row.cycle_end)
        .order('conversation_started_at', { ascending: false })
        .limit(500);
      if (row.branch) productQuery = productQuery.eq('branch', row.branch);
      productQuery = productQuery.in('source_id', sourceIds);

      let canonicalQuery = supabase
        .from('whatsapp_customer_cases_v22')
        .select('id,root_source_id,source_ids,started_at,branch,proposed_outcome,confirmed_outcome,verified_revenue,verified_invoice_id,verified_invoice_number')
        .gte('started_at', `${row.cycle_start}T00:00:00+03:00`)
        .lte('started_at', `${row.cycle_end}T23:59:59+03:00`)
        .limit(600);
      if (row.branch) canonicalQuery = canonicalQuery.eq('branch', row.branch);

      const [sourceResult, productResult, canonicalResult] = await Promise.all([
        sourceIds.length ? sourceQuery : emptyResult,
        sourceIds.length ? productQuery : emptyResult,
        canonicalQuery,
      ]);
      if (sourceResult.error) throw sourceResult.error;
      if (productResult.error) throw productResult.error;
      if (canonicalResult.error) throw canonicalResult.error;
      setConversations((sourceResult.data || []) as ConversationRow[]);
      setProducts((productResult.data || []) as ProductRow[]);
      setDetailCanonicalCases((canonicalResult.data || []) as DoctorCanonicalCaseRow[]);
    } catch (error) {
      console.error('[whatsapp-doctor-cycle-v33] detail load failed', error);
      setConversations([]);
      setProducts([]);
      setDetailCanonicalCases([]);
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const doctorCaseBySource = useMemo(() => {
    const map = new Map<string, DoctorCanonicalCaseRow>();
    for (const item of detailCanonicalCases) {
      if (item.root_source_id) map.set(item.root_source_id, item);
      for (const sourceId of item.source_ids || []) map.set(sourceId, item);
    }
    return map;
  }, [detailCanonicalCases]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (branch !== 'all' && row.branch !== branch) return false;
      if (!q) return true;
      return String(row.owner_name || '').toLowerCase().includes(q);
    });
  }, [rows, search, branch]);

  const totals = useMemo(() => ({
    revenue: filtered.reduce((sum, row) => sum + Number(row.verified_revenue || 0), 0),
    sales: filtered.reduce((sum, row) => sum + Number(row.verified_sales || 0), 0),
    opportunities: filtered.reduce((sum, row) => sum + Number(row.commercial_opportunities || 0), 0),
    leakage: filtered.reduce((sum, row) => sum + Number(row.lost_opportunities || 0), 0),
  }), [filtered]);

  const doctorInsights = useMemo(() => {
    const selectedName = normalizeDoctorName(selected?.owner_name);
    const enriched = conversations.map((item) => {
      const journey = item.analysis_json?.groundedSaleJourneyV33 || null;
      const staffCoaching = Array.isArray(journey?.staffCoaching)
        ? journey.staffCoaching.find((coach: any) => normalizeDoctorName(coach?.staffName) === selectedName) || null
        : null;
      const scoreRaw = staffCoaching?.score;
      const score = Number(scoreRaw);
      return {
        item,
        journey,
        staffCoaching,
        score: Number.isFinite(score) ? score : null,
        strengths: Array.isArray(staffCoaching?.strengths) ? staffCoaching.strengths as string[] : [],
        gaps: Array.isArray(staffCoaching?.gaps) ? staffCoaching.gaps as string[] : [],
        findings: Array.isArray(staffCoaching?.findings) ? staffCoaching.findings as Array<{
          type: string;
          tone: 'strong' | 'improvement' | 'context';
          title: string;
          detail: string;
          evidenceMessageIds: string[];
          attributionConfidence: number;
        }> : [],
        complaintPoints: Array.isArray(journey?.coaching?.complaintPoints) ? journey.coaching.complaintPoints as string[] : [],
        delayPoints: Number(staffCoaching?.slowResponseCount || 0) > 0
          ? [`لديه ${Number(staffCoaching.slowResponseCount)} رد متأخر أكثر من 10 دقائق داخل نطاقه.`]
          : [],
      };
    });
    const grounded = enriched.filter((row) => row.journey);
    const commercial = grounded.filter((row) => row.journey?.commercial);
    // Official sale/revenue metrics come from whatsapp_case_doctor_kpis_v23 only.
    // Grounded Journey explains the conversation but never proves the financial sale.
    const verifiedSales: typeof grounded = [];
    const verifiedRevenue = 0;
    const best = enriched
      .filter((row) => row.score != null && row.findings.some((finding) => finding.tone === 'strong'))
      .sort((a,b) => (b.score || 0) - (a.score || 0))
      .slice(0, 5);
    const improvement = enriched
      .filter((row) => row.findings.some((finding) => finding.tone === 'improvement'))
      .sort((a,b) => {
        const aCount = a.findings.filter((finding) => finding.tone === 'improvement').length;
        const bCount = b.findings.filter((finding) => finding.tone === 'improvement').length;
        return bCount - aCount || (a.score ?? 101) - (b.score ?? 101);
      })
      .slice(0, 8);

    const countText = (rows: string[]) => {
      const map = new Map<string, number>();
      rows.forEach((text) => map.set(text, (map.get(text) || 0) + 1));
      return [...map.entries()].sort((a,b) => b[1] - a[1]);
    };
    const repeatedStrengths = countText(enriched.flatMap((row) =>
      row.findings.filter((finding) => finding.tone === 'strong').map((finding) => finding.title)
    )).slice(0, 4);
    const repeatedGaps = countText(enriched.flatMap((row) =>
      row.findings.filter((finding) => finding.tone === 'improvement').map((finding) => finding.title)
    )).slice(0, 4);

    return {
      enriched,
      commercialCount: commercial.length,
      verifiedSales: verifiedSales.length,
      verifiedRevenue,
      conversionRate: commercial.length ? Math.round((verifiedSales.length / commercial.length) * 1000) / 10 : null,
      complaintCases: grounded.filter((row) => (row.journey?.complaintMessageIds || []).length).length,
      complaintHandled: enriched.filter((row) => Number(row.staffCoaching?.complaintResponseCount || 0) > 0).length,
      delays: enriched.filter((row) => Number(row.staffCoaching?.slowResponseCount || 0) > 0).length,
      best,
      improvement,
      repeatedStrengths,
      repeatedGaps,
    };
  }, [conversations, selected?.owner_name]);

  const detailStats = useMemo(() => ({
    customers: new Set(conversations.map((x) => x.customer_code || x.customer_name).filter(Boolean)).size,
    verifiedSales: Number(selected?.verified_sales || 0),
    verifiedRevenue: Number(selected?.verified_revenue || 0),
    conversionRate: selected?.verified_conversion_rate == null ? null : Number(selected.verified_conversion_rate),
    complaintCases: doctorInsights.complaintCases,
    complaintHandled: doctorInsights.complaintHandled,
    delays: doctorInsights.delays,
  }), [conversations, doctorInsights, selected]);

  return <section className="dawaa-card dawaa-card--raised p-5" dir="rtl">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
      <div>
        <div className="flex items-center gap-2 text-xs font-black text-emerald-200"><Stethoscope size={16}/> ذكاء أداء الدكاترة</div>
        <h2 className="mt-1 text-xl font-black text-white">الأداء التشغيلي والبيعي في سايكل 26→25</h2>
        <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-400">المؤشرات مبنية على ملكية مراحل الـCase، والبيع الموثق، ورسائل المحادثة الفعلية. افتح أي دكتور لرؤية أفضل محادثاته ونقاط التحسين والشكاوى والتأخير.</p>
      </div>
      <button onClick={() => void load()} disabled={loading} className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-black text-white disabled:opacity-50"><RefreshCw size={15} className={loading ? 'animate-spin' : ''}/> تحديث</button>
    </div>

    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="إيراد Canonical مثبت" value={money(totals.revenue)} />
      <Metric label="مبيعات Canonical مثبتة" value={totals.sales} />
      <Metric label="فرص تجارية" value={totals.opportunities} />
      <Metric label="فرص بيع متوقفة" value={totals.leakage} />
    </div>

    <div className="mt-4 flex flex-col gap-2 lg:flex-row">
      <label className="relative flex-1"><Search size={15} className="absolute right-3 top-3 text-slate-500"/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث باسم الدكتور" className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pr-9 pl-3 text-sm text-white"/></label>
      <select value={branch} onChange={(e) => setBranch(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"><option value="all">كل الفروع</option><option value="فرع الشامي">فرع الشامي</option><option value="فرع شكري">فرع شكري</option></select>
    </div>

    <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-800">
      <table className="min-w-[1180px] w-full text-right text-sm">
        <thead className="bg-slate-950/70 text-xs text-slate-400"><tr><th className="p-3">الدكتور</th><th className="p-3">الفرع</th><th className="p-3">Cases</th><th className="p-3">فرص تجارية</th><th className="p-3">طلبات مؤكدة</th><th className="p-3">بيع Canonical</th><th className="p-3">Conversion Canonical</th><th className="p-3">إيراد Canonical مثبت</th><th className="p-3">ترشيحات</th><th className="p-3">فقد بيع</th><th className="p-3">تعثر/فشل</th><th className="p-3">شكاوى</th><th className="p-3">تفاصيل</th></tr></thead>
        <tbody>{filtered.map((row) => <tr key={`${row.owner_account_id || row.owner_name}-${row.branch}-${row.cycle_start}`} className="border-t border-slate-800 bg-slate-950/25 text-slate-200 hover:bg-slate-900/45"><td className="p-3 font-black text-white">{row.owner_name || 'غير محدد'}</td><td className="p-3">{row.branch || '—'}</td><td className="p-3">{row.handled_cases}</td><td className="p-3">{row.commercial_opportunities}</td><td className="p-3">{row.confirmed_orders}</td><td className="p-3 text-emerald-300">{row.verified_sales}</td><td className="p-3"><span className="inline-flex items-center gap-1"><TrendingUp size={13}/>{row.verified_conversion_rate == null ? '—' : `${Number(row.verified_conversion_rate).toFixed(1)}%`}</span></td><td className="p-3 font-black text-emerald-300"><span className="inline-flex items-center gap-1"><BadgeDollarSign size={13}/>{money(row.verified_revenue)}</span></td><td className="p-3">{row.recommendation_cases}</td><td className="p-3 text-amber-300">{row.lost_opportunities}</td><td className="p-3 text-amber-200">{row.cases_with_failure_signal}</td><td className="p-3 text-rose-300">{row.cases_with_complaint_signal}</td><td className="p-3"><button type="button" onClick={() => void loadDoctorDetail(row)} className="inline-flex items-center gap-1 rounded-lg border border-cyan-400/25 bg-cyan-500/10 px-2.5 py-1.5 text-xs font-black text-cyan-200">فتح <ChevronLeft size={13}/></button></td></tr>)}</tbody>
      </table>
      {!loading && filtered.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">لا توجد بيانات كافية للدكاترة في السايكل الحالي حتى الآن.</div> : null}
    </div>

    {selected ? <div className="mt-5 rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div><div className="flex items-center gap-2 font-black text-white"><UserRound size={17}/> د. {selected.owner_name || 'غير محدد'} • {selected.branch || '—'}</div><div className="mt-1 text-xs text-slate-400">تحليل السايكل {selected.cycle_start} → {selected.cycle_end} حسب ملكية مراحل الـCase</div></div>
        <button onClick={() => setSelected(null)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-black text-slate-300">إغلاق التفاصيل</button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-7">
        <Metric label="العملاء" value={detailStats.customers}/>
        <Metric label="بيع Canonical" value={detailStats.verifiedSales}/>
        <Metric label="Conversion Canonical" value={detailStats.conversionRate == null ? '—' : `${detailStats.conversionRate}%`}/>
        <Metric label="إيراد Canonical مثبت" value={money(detailStats.verifiedRevenue)}/>
        <Metric label="Cases بها شكوى" value={detailStats.complaintCases}/>
        <Metric label="شكاوى شارك في معالجتها" value={detailStats.complaintHandled}/>
        <Metric label="تأخير في ردوده" value={detailStats.delays}/>
      </div>

      {detailLoading ? <div className="mt-4 p-6 text-center text-sm text-slate-400">جاري تحميل التفاصيل...</div> : <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-3">
          <div className="mb-3 flex items-center gap-2 font-black text-white"><FileText size={16}/> المحادثات والفواتير</div>
          <div className="max-h-[430px] space-y-2 overflow-y-auto">{conversations.map((item) => {
            const op = item.analysis_json?.operational;
            const journey = item.analysis_json?.groundedSaleJourneyV33;
            const canonicalCase = doctorCaseBySource.get(item.id) || null;
            const effectiveOutcome = canonicalCase?.confirmed_outcome || canonicalCase?.proposed_outcome || null;
            const verified = effectiveOutcome === 'verified_sale' && Boolean(canonicalCase?.verified_invoice_id);
            return <button type="button" key={item.id} onClick={() => onOpenSource?.(item.id)} className="w-full rounded-xl border border-slate-800 bg-slate-950/55 p-3 text-right transition hover:border-cyan-400/30">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <b className="text-white">{item.customer_name || 'عميل غير محدد'}</b>
                  {item.customer_code ? <span className="mr-2 text-xs text-cyan-300">#{item.customer_code}</span> : null}
                  <div className="mt-1 text-[11px] text-slate-500">{dateLabel(item.conversation_started_at)}</div>
                </div>
                <span className={`rounded-lg px-2 py-1 text-[10px] font-black ${
                  verified
                    ? 'bg-emerald-500/10 text-emerald-200'
                    : canonicalCase
                      ? 'bg-cyan-500/10 text-cyan-200'
                      : journey?.commercial
                        ? 'bg-amber-500/10 text-amber-200'
                        : 'bg-slate-800 text-slate-300'
                }`}>
                  {verified
                    ? 'بيع Canonical مثبت'
                    : canonicalCase
                      ? `Case Canonical · ${effectiveOutcome || 'غير محسوم'}`
                      : journey?.outcomeLabel || 'لا توجد Case Canonical مرتبطة'}
                </span>
              </div>
              <div className="mt-2 text-xs text-slate-300">
                {op?.primaryIntent || item.review_status || '—'}
                {journey?.coaching?.bestPracticeScore != null ? <span className="text-cyan-300"> • جودة {journey.coaching.bestPracticeScore}/100</span> : null}
              </div>
              {verified ? (
                <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-black">
                  {canonicalCase?.verified_invoice_number ? <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-300">فاتورة #{canonicalCase.verified_invoice_number}</span> : null}
                  <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-300">{money(canonicalCase?.verified_revenue)}</span>
                </div>
              ) : item.invoice_match_status === 'verified' ? (
                <div className="mt-2 text-[10px] leading-5 text-slate-500">
                  مطابقة فاتورة آلية Legacy {item.matched_invoice_number ? `#${item.matched_invoice_number}` : ''}{item.matched_invoice_value != null ? ` · ${money(item.matched_invoice_value)}` : ''} — ليست Sale Proof.
                </div>
              ) : null}
            </button>;
          })}{!conversations.length ? <div className="p-5 text-center text-xs text-slate-500">لا توجد محادثات مرتبطة بهذا الدكتور في السايكل.</div> : null}</div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-3">
          <div className="mb-3 flex items-center gap-2 font-black text-white"><PackageSearch size={16}/> الأصناف والفرص البيعية</div>
          <div className="max-h-[430px] space-y-2 overflow-y-auto">{products.map((item, index) => <button type="button" key={`${item.source_id}-${item.product_name}-${index}`} onClick={() => onOpenSource?.(item.source_id)} className="w-full rounded-xl border border-slate-800 bg-slate-950/55 p-3 text-right hover:border-violet-400/30">
            <div className="flex items-start justify-between gap-2"><div><b className="text-white">{item.product_name || 'صنف غير محدد'}</b><div className="mt-1 text-[11px] text-slate-500">{item.customer_name || 'عميل غير محدد'}{item.customer_code ? ` • #${item.customer_code}` : ''}</div></div><span className="rounded-lg bg-violet-500/10 px-2 py-1 text-[10px] font-black text-violet-200">{item.current_stage || '—'}</span></div>
            {item.leakage_reason ? <div className="mt-2 flex items-start gap-1 text-xs text-amber-200"><CircleAlert size={13} className="mt-0.5 shrink-0"/>{item.leakage_reason}</div> : null}
            <div className="mt-2 text-[11px] text-slate-400">{item.next_action || (item.invoice_match_status === 'verified' ? 'توجد مطابقة فاتورة آلية Legacy؛ البيع غير مثبت رسميًا.' : 'لا توجد خطوة تالية مثبتة.')}{item.matched_invoice_value ? <span className="text-emerald-300"> • {money(item.matched_invoice_value)}</span> : null}</div>
          </button>)}{!products.length ? <div className="p-5 text-center text-xs text-slate-500">لا توجد رحلات أصناف مرتبطة بهذا الدكتور حتى الآن.</div> : null}</div>
        </div>
      </div>}

      {!detailLoading ? (
        <section className="mt-4 rounded-2xl border border-violet-800/30 bg-violet-950/10 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-black text-violet-100">الملخص التدريبي للدكتور</div>
              <div className="mt-1 text-[10px] text-slate-500">مستخرج من أكثر الأنماط تكرارًا في المحادثات المرتبطة بمراحل يمتلكها الدكتور فعليًا.</div>
            </div>
            <div className="text-left text-[10px] text-slate-500">
              {doctorInsights.enriched.filter((row) => row.staffCoaching).length} محادثة فيها Coaching شخصي موثق
            </div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl bg-emerald-500/5 p-3">
              <div className="text-[10px] font-black text-emerald-300">أقوى السلوكيات المتكررة</div>
              <div className="mt-2 space-y-1 text-xs leading-5 text-slate-300">
                {doctorInsights.repeatedStrengths.length
                  ? doctorInsights.repeatedStrengths.map(([label, count]) => <div key={label}>✓ {label} <span className="text-[10px] text-slate-500">({count})</span></div>)
                  : <div className="text-slate-500">لسه مفيش عدد كافٍ من المحادثات المعاد تحليلها لاستخراج نمط ثابت.</div>}
              </div>
            </div>
            <div className="rounded-xl bg-amber-500/5 p-3">
              <div className="text-[10px] font-black text-amber-300">أولوية التحسين القادمة</div>
              <div className="mt-2 space-y-1 text-xs leading-5 text-slate-300">
                {doctorInsights.repeatedGaps.length
                  ? doctorInsights.repeatedGaps.map(([label, count]) => <div key={label}>• {label} <span className="text-[10px] text-slate-500">({count})</span></div>)
                  : <div className="text-slate-500">لا توجد ملاحظة متكررة موثقة حتى الآن.</div>}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {!detailLoading ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <section className="rounded-2xl border border-emerald-800/30 bg-emerald-950/10 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-black text-emerald-100">أفضل محادثات للتعلم منها</div>
                <div className="mt-1 text-[10px] text-slate-500">مختارة من المحادثات ذات السلوكيات القوية الموثقة؛ البيع Canonical يظهر كمعلومة إضافية عند وجوده.</div>
              </div>
              <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-black text-emerald-300">{doctorInsights.best.length}</span>
            </div>
            <div className="mt-3 space-y-2">
              {doctorInsights.best.map(({ item, journey, score, findings }) => {
                const strongFindings = findings.filter((finding) => finding.tone === 'strong').slice(0, 3);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onOpenSource?.(
                      item.id,
                      Array.from(new Set(strongFindings.flatMap((finding) => finding.evidenceMessageIds)))
                    )}
                    className="w-full rounded-xl border border-emerald-800/25 bg-black/10 p-3 text-right transition hover:border-emerald-500/40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-black text-white">{item.customer_name || 'عميل غير محدد'}</div>
                        <div className="mt-1 text-[10px] text-slate-500">{dateLabel(item.conversation_started_at)} · {journey?.outcomeLabel || '—'}</div>
                      </div>
                      <div className="rounded-lg bg-emerald-500/10 px-2.5 py-1 text-sm font-black text-emerald-300">{score ?? '—'}</div>
                    </div>
                    <div className="mt-2 space-y-2 text-[11px] leading-5 text-slate-300">
                      {strongFindings.map((finding) => (
                        <div key={`${finding.type}-${finding.title}`} className="rounded-lg bg-emerald-500/5 p-2">
                          <div className="font-black text-emerald-200">✓ {finding.title}</div>
                          <div className="text-slate-400">{finding.detail}</div>
                          <div className="mt-0.5 text-[9px] text-slate-600">دليل: {finding.evidenceMessageIds.length} رسالة · ثقة النسبة {finding.attributionConfidence}%</div>
                        </div>
                      ))}
                    </div>
                  </button>
                );
              })}
              {!doctorInsights.best.length ? <div className="rounded-xl border border-dashed border-slate-800 p-4 text-xs text-slate-500">لا توجد محادثات أعيد تحليلها بالـGrounded Journey كفاية لاختيار أمثلة قوية بعد.</div> : null}
            </div>
          </section>

          <section className="rounded-2xl border border-amber-800/30 bg-amber-950/10 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-black text-amber-100">أهم فرص التحسين</div>
                <div className="mt-1 text-[10px] text-slate-500">كل ملاحظة مرتبطة بالمحادثة نفسها؛ لا يتم إنشاء خصم أو حكم رسمي من هنا تلقائيًا.</div>
              </div>
              <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[10px] font-black text-amber-300">{doctorInsights.improvement.length}</span>
            </div>
            <div className="mt-3 space-y-2">
              {doctorInsights.improvement.map(({ item, journey, score, findings }) => {
                const improvementFindings = findings.filter((finding) => finding.tone === 'improvement').slice(0, 4);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onOpenSource?.(
                      item.id,
                      Array.from(new Set(improvementFindings.flatMap((finding) => finding.evidenceMessageIds)))
                    )}
                    className="w-full rounded-xl border border-amber-800/25 bg-black/10 p-3 text-right transition hover:border-amber-500/40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-black text-white">{item.customer_name || 'عميل غير محدد'}</div>
                        <div className="mt-1 text-[10px] text-slate-500">{dateLabel(item.conversation_started_at)} · {journey?.outcomeLabel || '—'}</div>
                      </div>
                      <div className="rounded-lg bg-amber-500/10 px-2.5 py-1 text-sm font-black text-amber-300">{score ?? '—'}</div>
                    </div>
                    <div className="mt-2 space-y-2 text-[11px] leading-5">
                      {improvementFindings.map((finding) => (
                        <div key={`${finding.type}-${finding.title}`} className="rounded-lg bg-amber-500/5 p-2">
                          <div className="font-black text-amber-200">• {finding.title}</div>
                          <div className="text-slate-300">{finding.detail}</div>
                          <div className="mt-0.5 text-[9px] text-slate-600">دليل: {finding.evidenceMessageIds.length} رسالة · ثقة النسبة {finding.attributionConfidence}%</div>
                        </div>
                      ))}
                    </div>
                  </button>
                );
              })}
              {!doctorInsights.improvement.length ? <div className="rounded-xl border border-dashed border-slate-800 p-4 text-xs text-slate-500">لا توجد نقاط تحسين موثقة كفاية في المحادثات المعاد تحليلها.</div> : null}
            </div>
          </section>
        </div>
      ) : null}
    </div> : null}
  </section>;
}
