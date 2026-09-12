import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { normalizeRole } from '@/lib/core/permissionSystem';
import { canViewAllBranches, rowMatchesCurrentUserScope } from '@/lib/security/userDataScope';
import { toNumber } from '@/lib/utils';

interface ReviewRow {
  id: string;
  created_at: string | null;
  reviewer_id: string | null;
  reviewer_name: string | null;
  reviewer_role: string | null;
  staff_id: string | null;
  doctor_id: string | null;
  staff_name: string | null;
  doctor_name: string | null;
  branch: string | null;
  customer_name: string | null;
  customer_code: string | null;
  customer_phone: string | null;
  invoice_number: string | null;
  evaluation_kind: string | null;
  evaluation_reason: string | null;
  conversation_date: string | null;
  review_date: string | null;
  final_score: number | string | null;
  total_score: number | string | null;
  doctor_points_impact: number | string | null;
  point_impact: number | string | null;
  manager_review_score: number | string | null;
  converted_to_sale: boolean | null;
  has_critical_error: boolean | null;
  excellent_case: boolean | null;
  missed_sales_opportunity: boolean | null;
  forgotten_customer: boolean | null;
}

type ScorePreset = '' | '100' | 'below100' | '95_99' | '90_94' | '80_89' | '70_79' | 'below70';
type ReviewStatus = '' | 'reviewed' | 'unreviewed';
type SaleStatus = '' | 'yes' | 'no';
type ImpactStatus = '' | 'positive' | 'negative' | 'zero';
type ImportantCase = '' | 'critical' | 'excellent' | 'missed_sale' | 'forgotten_customer';
type DateBasis = 'conversation' | 'created';

const SELECT = [
  'id','created_at','reviewer_id','reviewer_name','reviewer_role','staff_id','doctor_id','staff_name','doctor_name','branch',
  'customer_name','customer_code','customer_phone','invoice_number','evaluation_kind','evaluation_reason','conversation_date','review_date',
  'final_score','total_score','doctor_points_impact','point_impact','manager_review_score','converted_to_sale','has_critical_error',
  'excellent_case','missed_sales_opportunity','forgotten_customer'
].join(',');

const EVAL_KINDS = ['واتساب','مكالمة','داخل الفرع','متابعة عميل','شكوى','عملية بيع','مراجعة فاتورة'];
const EVAL_REASONS = ['مراجعة عشوائية','شكوى عميل','متابعة جودة','عملية بيع مهمة','عميل VIP','خطأ فاتورة','تقييم تدريب','مراجعة أداء شهرية'];

function canSeeBranch(user: any, branch?: string | null) {
  if (!user) return false;
  if (canViewAllBranches(user)) return true;
  const normalizedBranch = normalizeBranchName(branch || '');
  if (
    normalizeRole(user.role) === 'customer_service_manager' &&
    new Set(['فرع الشامي', 'فرع شكري']).has(normalizedBranch)
  ) return true;
  return rowMatchesCurrentUserScope(user, { branch } as Record<string, unknown>);
}

function scoreOf(row: ReviewRow) {
  return toNumber(row.final_score ?? row.total_score ?? 0);
}

function impactOf(row: ReviewRow) {
  return toNumber(row.doctor_points_impact ?? row.point_impact ?? 0);
}

function cairoDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', dateStyle: 'short', timeStyle: 'short' });
}

function matchesScore(score: number, preset: ScorePreset) {
  if (!preset) return true;
  if (preset === '100') return score === 100;
  if (preset === 'below100') return score < 100;
  if (preset === '95_99') return score >= 95 && score <= 99;
  if (preset === '90_94') return score >= 90 && score <= 94;
  if (preset === '80_89') return score >= 80 && score <= 89;
  if (preset === '70_79') return score >= 70 && score <= 79;
  return score < 70;
}

export default function ConversationReviewsHistoryAdvanced() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const [doctorId, setDoctorId] = useState('');
  const [reviewerKey, setReviewerKey] = useState('');
  const [branch, setBranch] = useState('');
  const [customer, setCustomer] = useState('');
  const [scorePreset, setScorePreset] = useState<ScorePreset>('');
  const [scoreMin, setScoreMin] = useState('');
  const [scoreMax, setScoreMax] = useState('');
  const [dateBasis, setDateBasis] = useState<DateBasis>('conversation');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [evaluationKind, setEvaluationKind] = useState('');
  const [evaluationReason, setEvaluationReason] = useState('');
  const [managerStatus, setManagerStatus] = useState<ReviewStatus>('');
  const [saleStatus, setSaleStatus] = useState<SaleStatus>('');
  const [impactStatus, setImpactStatus] = useState<ImpactStatus>('');
  const [importantCase, setImportantCase] = useState<ImportantCase>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const all: ReviewRow[] = [];
      const PAGE = 1000;
      for (let from = 0; from < 10000; from += PAGE) {
        const { data, error: queryError } = await supabase
          .from('conversation_sales_reviews')
          .select(SELECT)
          .order('created_at', { ascending: false })
          .range(from, from + PAGE - 1);
        if (queryError) throw queryError;
        const batch = (data || []) as ReviewRow[];
        all.push(...batch);
        if (batch.length < PAGE) break;
      }
      setRows(all.filter((row) => canSeeBranch(user, row.branch)));
      setUpdatedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل سجل التقييمات');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const doctors = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((row) => {
      const id = row.staff_id || row.doctor_id || '';
      const name = row.staff_name || row.doctor_name || '';
      if (name) map.set(id || `name:${name}`, name);
    });
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ar'));
  }, [rows]);

  const reviewers = useMemo(() => {
    const map = new Map<string, { id: string | null; name: string }>();
    rows.forEach((row) => {
      const name = String(row.reviewer_name || '').trim();
      if (!name) return;
      const key = row.reviewer_id ? `id:${row.reviewer_id}` : `name:${name}`;
      map.set(key, { id: row.reviewer_id, name });
    });
    return [...map.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, 'ar'));
  }, [rows]);

  const branches = useMemo(
    () => [...new Set(rows.map((r) => normalizeBranchName(r.branch || '')).filter(Boolean))].sort(),
    [rows]
  );

  const filtered = useMemo(() => {
    const term = customer.trim().toLowerCase();
    const min = scoreMin === '' ? null : Number(scoreMin);
    const max = scoreMax === '' ? null : Number(scoreMax);
    return rows.filter((row) => {
      const staffKey = row.staff_id || row.doctor_id || `name:${row.staff_name || row.doctor_name || ''}`;
      if (doctorId && staffKey !== doctorId) return false;
      if (reviewerKey) {
        const rowKey = row.reviewer_id ? `id:${row.reviewer_id}` : `name:${String(row.reviewer_name || '').trim()}`;
        if (rowKey !== reviewerKey) return false;
      }
      if (branch && normalizeBranchName(row.branch || '') !== branch) return false;
      if (term) {
        const hay = `${row.customer_name || ''} ${row.customer_code || ''} ${row.customer_phone || ''} ${row.invoice_number || ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      const score = scoreOf(row);
      if (!matchesScore(score, scorePreset)) return false;
      if (min != null && Number.isFinite(min) && score < min) return false;
      if (max != null && Number.isFinite(max) && score > max) return false;
      const rowDate = dateBasis === 'conversation'
        ? String(row.review_date || row.conversation_date || '').slice(0, 10)
        : cairoDate(row.created_at);
      if (dateFrom && (!rowDate || rowDate < dateFrom)) return false;
      if (dateTo && (!rowDate || rowDate > dateTo)) return false;
      if (evaluationKind && row.evaluation_kind !== evaluationKind) return false;
      if (evaluationReason && row.evaluation_reason !== evaluationReason) return false;
      if (managerStatus === 'reviewed' && row.manager_review_score == null) return false;
      if (managerStatus === 'unreviewed' && row.manager_review_score != null) return false;
      if (saleStatus === 'yes' && row.converted_to_sale !== true) return false;
      if (saleStatus === 'no' && row.converted_to_sale !== false) return false;
      const impact = impactOf(row);
      if (impactStatus === 'positive' && impact <= 0) return false;
      if (impactStatus === 'negative' && impact >= 0) return false;
      if (impactStatus === 'zero' && impact !== 0) return false;
      if (importantCase === 'critical' && !row.has_critical_error) return false;
      if (importantCase === 'excellent' && !row.excellent_case) return false;
      if (importantCase === 'missed_sale' && !row.missed_sales_opportunity) return false;
      if (importantCase === 'forgotten_customer' && !row.forgotten_customer) return false;
      return true;
    });
  }, [rows, doctorId, reviewerKey, branch, customer, scorePreset, scoreMin, scoreMax, dateBasis, dateFrom, dateTo, evaluationKind, evaluationReason, managerStatus, saleStatus, impactStatus, importantCase]);

  const stats = useMemo(() => {
    const count = filtered.length;
    const avg = count ? Math.round(filtered.reduce((sum, row) => sum + scoreOf(row), 0) / count) : 0;
    return {
      count,
      avg,
      perfect: filtered.filter((row) => scoreOf(row) === 100).length,
      below90: filtered.filter((row) => scoreOf(row) < 90).length,
      unreviewed: filtered.filter((row) => row.manager_review_score == null).length,
    };
  }, [filtered]);

  const hasFilters = Boolean(doctorId || reviewerKey || branch || customer || scorePreset || scoreMin || scoreMax || dateFrom || dateTo || evaluationKind || evaluationReason || managerStatus || saleStatus || impactStatus || importantCase);

  const clearFilters = () => {
    setDoctorId(''); setReviewerKey(''); setBranch(''); setCustomer(''); setScorePreset(''); setScoreMin(''); setScoreMax('');
    setDateBasis('conversation'); setDateFrom(''); setDateTo(''); setEvaluationKind(''); setEvaluationReason('');
    setManagerStatus(''); setSaleStatus(''); setImpactStatus(''); setImportantCase('');
  };

  return <div dir="rtl" className="space-y-4">
    <div className="dawaa-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="dawaa-title text-xl font-black">سجل تقييم المحادثات</h1>
          <p className="dawaa-caption mt-1 text-sm">فلاتر تشغيلية دقيقة على تاريخ المحادثة أو تاريخ تسجيل التقييم، المقيّم، الدرجة، الدكتور، العميل وباقي حالة التقييم.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="dawaa-button dawaa-button--secondary" onClick={() => navigate('/reviews')}>التحليل والتقارير</button>
          <button type="button" className="dawaa-button dawaa-button--primary" onClick={() => navigate('/reviews?mode=new')}>تقييم جديد</button>
          <button type="button" className="dawaa-button dawaa-button--secondary flex items-center gap-2" onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={loading ? 'animate-spin' : ''}/>تحديث</button>
        </div>
      </div>
    </div>

    <section className="dawaa-card p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-black"><SlidersHorizontal size={18}/>الفلاتر</div>
        {hasFilters ? <button type="button" className="dawaa-button dawaa-button--secondary flex items-center gap-1 text-xs" onClick={clearFilters}><X size={14}/>مسح الكل</button> : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        <label className="text-xs">الدكتور<select className="input-field mt-1" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}><option value="">كل الدكاترة</option>{doctors.map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="text-xs">مسؤول خدمة العملاء / المقيّم<select className="input-field mt-1" value={reviewerKey} onChange={(e) => setReviewerKey(e.target.value)}><option value="">كل المقيمين</option>{reviewers.map(([key,item]) => <option key={key} value={key}>{item.name}</option>)}</select></label>
        <label className="text-xs">الفرع<select className="input-field mt-1" value={branch} onChange={(e) => setBranch(e.target.value)}><option value="">كل الفروع المتاحة</option>{branches.map((b) => <option key={b} value={b}>{b}</option>)}</select></label>
        <label className="text-xs">قيمة التقييم<select className="input-field mt-1" value={scorePreset} onChange={(e) => setScorePreset(e.target.value as ScorePreset)}><option value="">كل الدرجات</option><option value="100">100 فقط</option><option value="below100">أقل من 100</option><option value="95_99">95–99</option><option value="90_94">90–94</option><option value="80_89">80–89</option><option value="70_79">70–79</option><option value="below70">أقل من 70</option></select></label>
        <label className="text-xs">العميل / الكود / الهاتف / الفاتورة<div className="relative mt-1"><Search size={15} className="absolute right-3 top-3 text-slate-400"/><input className="input-field pr-9" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="بحث..."/></div></label>

        <label className="text-xs">نوع التاريخ<select className="input-field mt-1" value={dateBasis} onChange={(e) => setDateBasis(e.target.value as DateBasis)}><option value="conversation">تاريخ المحادثة</option><option value="created">تاريخ تسجيل التقييم</option></select></label>
        <label className="text-xs">من تاريخ<input type="date" className="input-field mt-1" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}/></label>
        <label className="text-xs">إلى تاريخ<input type="date" className="input-field mt-1" value={dateTo} onChange={(e) => setDateTo(e.target.value)}/></label>
        <label className="text-xs">نوع المحادثة<select className="input-field mt-1" value={evaluationKind} onChange={(e) => setEvaluationKind(e.target.value)}><option value="">الكل</option>{EVAL_KINDS.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
        <label className="text-xs">سبب التقييم<select className="input-field mt-1" value={evaluationReason} onChange={(e) => setEvaluationReason(e.target.value)}><option value="">الكل</option>{EVAL_REASONS.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>

        <label className="text-xs">مراجعة المدير<select className="input-field mt-1" value={managerStatus} onChange={(e) => setManagerStatus(e.target.value as ReviewStatus)}><option value="">الكل</option><option value="reviewed">تمت المراجعة</option><option value="unreviewed">لم تتم المراجعة</option></select></label>
        <label className="text-xs">تحولت لبيع<select className="input-field mt-1" value={saleStatus} onChange={(e) => setSaleStatus(e.target.value as SaleStatus)}><option value="">الكل</option><option value="yes">نعم</option><option value="no">لا</option></select></label>
        <label className="text-xs">تأثير النقاط<select className="input-field mt-1" value={impactStatus} onChange={(e) => setImpactStatus(e.target.value as ImpactStatus)}><option value="">الكل</option><option value="positive">مكافأة</option><option value="negative">خصم</option><option value="zero">بدون تأثير</option></select></label>
        <label className="text-xs">حالات مهمة<select className="input-field mt-1" value={importantCase} onChange={(e) => setImportantCase(e.target.value as ImportantCase)}><option value="">الكل</option><option value="critical">خطأ حرج</option><option value="excellent">حالة ممتازة</option><option value="missed_sale">فرصة بيع مهدرة</option><option value="forgotten_customer">عميل منسي</option></select></label>
        <div className="grid grid-cols-2 gap-2"><label className="text-xs">من درجة<input type="number" min="0" max="100" className="input-field mt-1" value={scoreMin} onChange={(e) => setScoreMin(e.target.value)}/></label><label className="text-xs">إلى درجة<input type="number" min="0" max="100" className="input-field mt-1" value={scoreMax} onChange={(e) => setScoreMax(e.target.value)}/></label></div>
      </div>

      <div className="flex flex-wrap gap-2">
        {[['100','100 فقط'],['below100','أقل من 100'],['90_94','90–94'],['below70','أقل من 70']].map(([value,label]) => <button key={value} type="button" className={`rounded-full border px-3 py-1.5 text-xs font-bold ${scorePreset === value ? 'border-teal-400 bg-teal-500/20 text-teal-100' : 'border-slate-600 text-slate-300'}`} onClick={() => setScorePreset(scorePreset === value ? '' : value as ScorePreset)}>{label}</button>)}
      </div>
    </section>

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Metric label="النتائج" value={stats.count}/><Metric label="متوسط التقييم" value={`${stats.avg}/100`}/><Metric label="100/100" value={stats.perfect}/><Metric label="أقل من 90" value={stats.below90}/><Metric label="لم يراجعها المدير" value={stats.unreviewed}/>
    </div>

    {error ? <div className="dawaa-alert dawaa-alert--danger">تعذر تحميل السجل: {error}</div> : null}
    <section className="dawaa-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700 p-3 text-xs text-slate-400"><span>{loading ? 'جاري التحميل...' : `عرض ${filtered.length} من ${rows.length} تقييم`}</span>{updatedAt ? <span>آخر تحديث: {updatedAt.toLocaleTimeString('ar-EG')}</span> : null}</div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1200px] text-sm">
          <thead className="bg-slate-900/70 text-slate-200"><tr><Th>تاريخ المحادثة</Th><Th>تاريخ التسجيل</Th><Th>المقيّم</Th><Th>الدكتور</Th><Th>الفرع</Th><Th>العميل</Th><Th>النوع</Th><Th>الدرجة</Th><Th>النقاط</Th><Th>مراجعة المدير</Th></tr></thead>
          <tbody>{!loading && filtered.map((row) => {
            const score = scoreOf(row); const impact = impactOf(row);
            return <tr key={row.id} onClick={() => navigate(`/reviews?section=history&id=${row.id}`)} className="cursor-pointer border-t border-slate-800 hover:bg-teal-500/5">
              <Td>{row.review_date || String(row.conversation_date || '').slice(0,10) || '-'}</Td><Td>{formatDate(row.created_at)}</Td><Td>{row.reviewer_name || '-'}</Td><Td>{row.staff_name || row.doctor_name || '-'}</Td><Td>{row.branch || '-'}</Td><Td><div className="font-semibold">{row.customer_name || '-'}</div><div className="text-xs text-slate-400">{row.customer_code || row.customer_phone || row.invoice_number || ''}</div></Td><Td>{row.evaluation_kind || '-'}</Td><Td><span className={`rounded-full px-2 py-1 font-black ${score === 100 ? 'bg-emerald-500/15 text-emerald-300' : score >= 90 ? 'bg-cyan-500/15 text-cyan-300' : score >= 70 ? 'bg-amber-500/15 text-amber-300' : 'bg-red-500/15 text-red-300'}`}>{score}/100</span></Td><Td><span className={impact > 0 ? 'text-emerald-300' : impact < 0 ? 'text-red-300' : 'text-slate-400'}>{impact > 0 ? `+${impact}` : impact}</span></Td><Td>{row.manager_review_score == null ? <span className="text-amber-300">لم يراجع</span> : `${row.manager_review_score}/100`}</Td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      {!loading && filtered.length === 0 ? <div className="p-8 text-center text-slate-400">لا توجد تقييمات مطابقة للفلاتر الحالية.</div> : null}
    </section>
  </div>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="dawaa-card p-3"><div className="dawaa-caption text-xs">{label}</div><div className="mt-1 text-xl font-black num">{value}</div></div>;
}
function Th({ children }: { children: React.ReactNode }) { return <th className="whitespace-nowrap p-3 text-right font-black">{children}</th>; }
function Td({ children }: { children: React.ReactNode }) { return <td className="p-3 align-top text-slate-200">{children}</td>; }
