import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, ClipboardCheck, FileSpreadsheet, Filter, MessageSquareText, RefreshCw, Star, Users } from 'lucide-react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';

type ReviewRow = Record<string, any>;
type FollowupRow = Record<string, any>;

type DoctorSummary = {
  key: string;
  name: string;
  branch: string;
  reviews: number;
  average: number;
  weightedScore: number;
  excellent: number;
  weak: number;
  positivePoints: number;
  negativePoints: number;
  strengths: string;
  development: string;
  recommendation: string;
};

const ALL = 'الكل';

function num(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function scoreOf(row: ReviewRow) {
  return num(row.final_score ?? row.total_score ?? row.score);
}

function impactOf(row: ReviewRow) {
  return num(row.doctor_points_impact ?? row.point_impact);
}

function normalizeName(value: unknown) {
  return String(value || '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\u0621-\u064A0-9a-zA-Z ]/g, ' ')
    .replace(/\b(دكتور|د|dr|doctor)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function doctorIdentity(row: ReviewRow) {
  const raw = String(row.staff_name || row.doctor_name || 'غير محدد');
  const id = String(row.staff_id || row.doctor_id || '');
  const normalized = normalizeName(raw);
  return { key: id ? `id:${id}` : `name:${normalized || 'unknown'}`, name: raw };
}

function monthKey(row: ReviewRow) {
  return String(row.conversation_date || row.created_at || '').slice(0, 7);
}

function dateKey(row: ReviewRow) {
  return String(row.conversation_date || row.created_at || '').slice(0, 10);
}

function repeatedText(values: unknown[], fallback: string) {
  const counts = new Map<string, number>();
  values
    .flatMap((value) => String(value || '').split(/[،,.\n؛]/))
    .map((value) => value.trim())
    .filter((value) => value.length >= 4)
    .forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([value]) => value)
    .join(' · ') || fallback;
}

function recommendationFor(rows: ReviewRow[], average: number) {
  const text = repeatedText(
    rows.map((row) => row.main_negative_reason || row.training_recommendation || row.reviewer_notes),
    average >= 90 ? 'الحفاظ على الجودة مع زيادة تنوع المحادثات المراجعة' : 'زيادة عينة التقييمات وتحديد البند الأضعف أسبوعيًا'
  );
  const steps: string[] = [];
  if (/رد|سرع|انتظار|متابع/i.test(text)) steps.push('الالتزام بأول رد خلال 5 دقائق وتسجيل موعد واضح لأي متابعة');
  if (/ترحيب|اسم العميل|اسلوب|رساله/i.test(text)) steps.push('استخدام اسم العميل، تأكيد الطلب، وإغلاق المحادثة برسالة واضحة');
  if (/بيع|احتياج|اضافي|بديل|صنف/i.test(text)) steps.push('طرح سؤالين لاكتشاف الاحتياج واقتراح بديل أو منتج مكمل مناسب');
  if (/توثيق|تسجيل|فاتور|ملاحظه/i.test(text)) steps.push('تسجيل رقم الفاتورة والنتيجة والملاحظة قبل إغلاق التقييم');
  if (rows.some((row) => scoreOf(row) < 70)) steps.push('مراجعة المحادثات الأقل من 70 مع مدير الفرع ووضع إجراء تصحيحي خلال أسبوع');
  if (!steps.length) steps.push('مراجعة 5 محادثات أسبوعيًا والحفاظ على متوسط لا يقل عن 90/100');
  return steps.slice(0, 4).join(' • ');
}

function canSeeServicePerformance(user: any) {
  const role = String(user?.role || '').toLowerCase();
  const name = normalizeName(user?.name || user?.username || '');
  return role.includes('general_manager') || role.includes('admin') || role.includes('area_manager') || name.includes('معاذ') || name.includes('علا');
}

function scrollToHeading(text: string) {
  const elements = Array.from(document.querySelectorAll('h1,h2,h3,button')) as HTMLElement[];
  const target = elements.find((element) => String(element.textContent || '').includes(text));
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return Boolean(target);
}

export default function ReviewsInsightsHub() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [followups, setFollowups] = useState<FollowupRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [branch, setBranch] = useState(ALL);
  const [doctor, setDoctor] = useState(ALL);
  const [activeView, setActiveView] = useState<'overview' | 'doctors' | 'service'>('overview');
  const showService = canSeeServicePerformance(user);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const reviewResult = await supabase
        .from('conversation_sales_reviews')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(3000);
      if (reviewResult.error) throw reviewResult.error;
      setReviews((reviewResult.data || []) as ReviewRow[]);

      if (showService) {
        const sources = ['customer_followups', 'customer_service_followups'];
        let loaded: FollowupRow[] = [];
        for (const table of sources) {
          const result = await supabase.from(table).select('*').order('created_at', { ascending: false }).limit(2500);
          if (!result.error) {
            loaded = (result.data || []) as FollowupRow[];
            break;
          }
        }
        setFollowups(loaded);
      }
    } catch (error) {
      toast.error(`تعذر تحميل تقارير التقييمات: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [showService]);

  useEffect(() => { void load(); }, [load]);

  const branches = useMemo(() => [ALL, ...Array.from(new Set(reviews.map((row) => normalizeBranchName(row.branch || '')).filter(Boolean)))], [reviews]);
  const doctors = useMemo(() => [ALL, ...Array.from(new Set(reviews.map((row) => doctorIdentity(row).name).filter((name) => name !== 'غير محدد')))], [reviews]);

  const filtered = useMemo(() => reviews.filter((row) => {
    if (month && monthKey(row) !== month) return false;
    if (branch !== ALL && normalizeBranchName(row.branch || '') !== branch) return false;
    if (doctor !== ALL && doctorIdentity(row).name !== doctor) return false;
    return true;
  }), [branch, doctor, month, reviews]);

  const doctorSummaries = useMemo<DoctorSummary[]>(() => {
    const grouped = new Map<string, ReviewRow[]>();
    filtered.forEach((row) => {
      const identity = doctorIdentity(row);
      grouped.set(identity.key, [...(grouped.get(identity.key) || []), row]);
    });
    return [...grouped.entries()].map(([key, rows]) => {
      const identity = doctorIdentity(rows[0]);
      const count = rows.length;
      const average = count ? rows.reduce((sum, row) => sum + scoreOf(row), 0) / count : 0;
      const bayesian = (average * count + 80 * 3) / (count + 3);
      const volume = Math.min(count / 12, 1) * 100;
      const weightedScore = bayesian * 0.82 + volume * 0.18;
      const development = repeatedText(rows.map((row) => row.main_negative_reason || row.training_recommendation), 'لا توجد ملاحظات تطوير متكررة');
      return {
        key,
        name: identity.name,
        branch: normalizeBranchName(rows[0].branch || '') || 'غير محدد',
        reviews: count,
        average: Math.round(average * 10) / 10,
        weightedScore: Math.round(weightedScore * 10) / 10,
        excellent: rows.filter((row) => scoreOf(row) >= 95).length,
        weak: rows.filter((row) => scoreOf(row) < 70).length,
        positivePoints: rows.reduce((sum, row) => sum + Math.max(0, impactOf(row)), 0),
        negativePoints: rows.reduce((sum, row) => sum + Math.max(0, -impactOf(row)), 0),
        strengths: repeatedText(rows.map((row) => row.main_positive_reason), 'يحتاج مزيدًا من التقييمات لإظهار نقاط القوة'),
        development,
        recommendation: recommendationFor(rows, average),
      };
    }).sort((a, b) => b.weightedScore - a.weightedScore || b.reviews - a.reviews);
  }, [filtered]);

  const branchSummaries = useMemo(() => {
    const grouped = new Map<string, ReviewRow[]>();
    filtered.forEach((row) => {
      const key = normalizeBranchName(row.branch || '') || 'غير محدد';
      grouped.set(key, [...(grouped.get(key) || []), row]);
    });
    return [...grouped.entries()].map(([name, rows]) => ({
      name,
      reviews: rows.length,
      doctors: new Set(rows.map((row) => doctorIdentity(row).key)).size,
      customers: new Set(rows.map((row) => row.customer_id || row.customer_code || row.customer_phone).filter(Boolean)).size,
      average: Math.round(rows.reduce((sum, row) => sum + scoreOf(row), 0) / Math.max(1, rows.length)),
      weak: rows.filter((row) => scoreOf(row) < 70).length,
    })).sort((a, b) => b.average - a.average);
  }, [filtered]);

  const serviceSummary = useMemo(() => {
    const monthRows = followups.filter((row) => String(row.completed_at || row.updated_at || row.created_at || '').slice(0, 7) === month);
    const grouped = new Map<string, FollowupRow[]>();
    monthRows.forEach((row) => {
      const name = String(row.responsible_name || row.assigned_to_name || row.assigned_doctor || row.completed_by_name || 'غير محدد');
      grouped.set(name, [...(grouped.get(name) || []), row]);
    });
    return [...grouped.entries()].map(([name, rows]) => {
      const completed = rows.filter((row) => /completed|done|closed|تم|مكتمل/i.test(String(row.status || row.followup_status || '')) || row.completed_at).length;
      const positive = rows.filter((row) => /شراء|طلب|راضي|حل|روشته|استمر/i.test(String(row.result || row.outcome || row.notes || ''))).length;
      const documented = rows.filter((row) => String(row.result || row.outcome || row.notes || '').trim().length >= 10).length;
      const quality = Math.round((completed / Math.max(1, rows.length)) * 45 + (positive / Math.max(1, completed)) * 35 + (documented / Math.max(1, rows.length)) * 20);
      return { name, total: rows.length, completed, positive, documented, quality };
    }).sort((a, b) => b.quality - a.quality || b.completed - a.completed);
  }, [followups, month]);

  const exportReport = () => {
    if (!filtered.length) { toast.error('لا توجد بيانات في الفلاتر الحالية'); return; }
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(doctorSummaries.map((row, index) => ({
      الترتيب: index + 1, الدكتور: row.name, الفرع: row.branch, 'عدد التقييمات': row.reviews, المتوسط: row.average,
      'النتيجة الذكية': row.weightedScore, ممتازة: row.excellent, 'أقل من 70': row.weak, 'نقاط إيجابية': row.positivePoints,
      خصومات: row.negativePoints, 'نقاط القوة': row.strengths, 'أولوية التطوير': row.development, 'التوصية العملية': row.recommendation,
    }))), 'أداء الدكاترة');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(branchSummaries.map((row) => ({
      الفرع: row.name, التقييمات: row.reviews, الدكاترة: row.doctors, العملاء: row.customers, المتوسط: row.average, 'أقل من 70': row.weak,
    }))), 'تحليل الفروع');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(filtered.map((row, index) => ({
      '#': index + 1, التاريخ: dateKey(row), المراجع: row.reviewer_name, الدكتور: row.staff_name || row.doctor_name, الفرع: row.branch,
      العميل: row.customer_name, 'كود العميل': row.customer_code, 'نوع التقييم': row.evaluation_kind || row.conversation_type,
      التقييم: scoreOf(row), 'تأثير النقاط': impactOf(row), 'نقطة القوة': row.main_positive_reason,
      'نقطة التطوير': row.main_negative_reason, 'التوصية': row.training_recommendation, 'ملاحظات المراجع': row.reviewer_notes,
    }))), 'تفاصيل التقييمات');
    if (showService && serviceSummary.length) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(serviceSummary), 'أداء خدمة العملاء');
    XLSX.writeFile(workbook, `تقرير-تقييم-المحادثات-${month}.xlsx`);
    toast.success('تم إصدار التقرير التفصيلي');
  };

  const triggerNewReview = () => {
    navigate('/reviews?mode=new');
  };

  return (
    <section data-reviews-hub dir="rtl" className="space-y-4 rounded-3xl border border-cyan-400/25 bg-slate-950/45 p-4 shadow-xl md:p-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <button type="button" onClick={triggerNewReview} className="rounded-2xl border border-teal-300/30 bg-teal-500/15 p-4 text-right hover:bg-teal-500/20">
          <Star className="h-5 w-5 text-teal-300" /><div className="mt-3 font-black text-white">تقييم جديد</div><div className="mt-1 text-xs font-bold text-slate-300">فتح نموذج تقييم محادثة أو عملية بيع</div>
        </button>
        <button type="button" onClick={() => navigate('/reviews?section=history')} className="rounded-2xl border border-sky-300/25 bg-sky-500/10 p-4 text-right hover:bg-sky-500/15">
          <ClipboardCheck className="h-5 w-5 text-sky-300" /><div className="mt-3 font-black text-white">سجل التقييمات</div><div className="mt-1 text-xs font-bold text-slate-300">عرض التقييمات والتفاصيل والإجراءات</div>
        </button>
        <button type="button" onClick={() => setActiveView('doctors')} className={`rounded-2xl border border-violet-300/25 bg-violet-500/10 p-4 text-right hover:bg-violet-500/15 ${activeView === 'doctors' ? 'ring-2 ring-violet-300 ring-offset-2 ring-offset-slate-950' : ''}`}>
          <BarChart3 className="h-5 w-5 text-violet-300" /><div className="mt-3 font-black text-white">تقرير أداء الدكاترة</div><div className="mt-1 text-xs font-bold text-slate-300">ترتيب وتوصيات وخطة تطوير لكل دكتور</div>
        </button>
        {showService ? <button type="button" onClick={() => setActiveView('service')} className={`rounded-2xl border border-amber-300/25 bg-amber-500/10 p-4 text-right hover:bg-amber-500/15 ${activeView === 'service' ? 'ring-2 ring-amber-300 ring-offset-2 ring-offset-slate-950' : ''}`}>
          <Users className="h-5 w-5 text-amber-300" /><div className="mt-3 font-black text-white">أداء خدمة العملاء</div><div className="mt-1 text-xs font-bold text-slate-300">خاص بالمدير العام ومديرة الفروع</div>
        </button> : <button type="button" onClick={() => setActiveView('overview')} className={`rounded-2xl border border-slate-300/20 bg-white/[0.03] p-4 text-right hover:bg-white/[0.06] ${activeView === 'overview' ? 'ring-2 ring-slate-300 ring-offset-2 ring-offset-slate-950' : ''}`}>
          <MessageSquareText className="h-5 w-5 text-slate-300" /><div className="mt-3 font-black text-white">تحليل الفرعين</div><div className="mt-1 text-xs font-bold text-slate-300">مقارنة أداء الفرعين والمتوسطات</div>
        </button>}
      </div>

      <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-black text-white"><Filter className="h-4 w-4 text-cyan-300" /> فلاتر وتحكم التقارير</div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void load()} disabled={loading} className="btn-secondary inline-flex items-center gap-2"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> تحديث</button>
            <button type="button" onClick={exportReport} className="btn-primary inline-flex items-center gap-2"><FileSpreadsheet className="h-4 w-4" /> تصدير التقرير الكامل</button>
          </div>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <input type="month" className="input-dark" value={month} onChange={(event) => setMonth(event.target.value)} />
          <select className="input-dark" value={branch} onChange={(event) => setBranch(event.target.value)}>{branches.map((item) => <option key={item}>{item}</option>)}</select>
          <select className="input-dark" value={doctor} onChange={(event) => setDoctor(event.target.value)}>{doctors.map((item) => <option key={item}>{item}</option>)}</select>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setActiveView('overview')} className={activeView === 'overview' ? 'btn-primary' : 'btn-secondary'}>تحليل الفرعين</button>
        <button type="button" onClick={() => setActiveView('doctors')} className={activeView === 'doctors' ? 'btn-primary' : 'btn-secondary'}>ترتيب الدكاترة والتوصيات</button>
        {showService && <button type="button" onClick={() => setActiveView('service')} className={activeView === 'service' ? 'btn-primary' : 'btn-secondary'}>تقييم خدمة العملاء</button>}
      </div>

      {activeView === 'overview' && <div className="grid gap-3 md:grid-cols-2">
        {branchSummaries.map((row, index) => <div key={row.name} className="rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-4">
          <div className="flex items-center justify-between"><div className="font-black text-white">#{index + 1} {row.name}</div><div className="rounded-xl bg-teal-500/15 px-3 py-2 font-black text-teal-200">{row.average}/100</div></div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm font-bold text-slate-300"><div>التقييمات: <b className="text-white">{row.reviews}</b></div><div>الدكاترة: <b className="text-white">{row.doctors}</b></div><div>العملاء: <b className="text-white">{row.customers}</b></div><div>أقل من 70: <b className="text-red-300">{row.weak}</b></div></div>
        </div>)}
        {!branchSummaries.length && <div className="text-sm font-bold text-slate-400">لا توجد بيانات في الفلاتر الحالية.</div>}
      </div>}

      {activeView === 'doctors' && <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {doctorSummaries.map((row, index) => <article key={row.key} className="rounded-2xl border border-violet-400/20 bg-violet-500/5 p-4">
          <div className="flex items-start justify-between gap-2"><div><div className="text-xs font-black text-violet-300">المركز {index + 1}</div><div className="mt-1 font-black text-white">{row.name}</div><div className="text-xs font-bold text-slate-400">{row.branch}</div></div><div className="rounded-xl bg-teal-500/15 px-3 py-2 font-black text-teal-100">{row.weightedScore}</div></div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs font-bold"><div className="rounded-xl bg-white/[0.04] p-2"><div className="text-slate-400">العدد</div><div className="text-white">{row.reviews}</div></div><div className="rounded-xl bg-white/[0.04] p-2"><div className="text-slate-400">المتوسط</div><div className="text-white">{row.average}</div></div><div className="rounded-xl bg-white/[0.04] p-2"><div className="text-slate-400">ممتازة</div><div className="text-emerald-200">{row.excellent}</div></div></div>
          <div className="mt-3 rounded-xl bg-emerald-500/10 p-3 text-xs font-bold text-emerald-100"><b className="text-emerald-300">نقاط القوة:</b> {row.strengths}</div>
          <div className="mt-2 rounded-xl bg-amber-500/10 p-3 text-xs font-bold text-amber-100"><b className="text-amber-300">أولوية التطوير:</b> {row.development}</div>
          <div className="mt-2 rounded-xl bg-cyan-500/10 p-3 text-xs font-bold leading-6 text-cyan-50"><b className="text-cyan-300">خطة العمل:</b> {row.recommendation}</div>
        </article>)}
        {!doctorSummaries.length && <div className="text-sm font-bold text-slate-400">لا توجد تقييمات في الفلاتر الحالية.</div>}
      </div>}

      {activeView === 'service' && showService && <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {serviceSummary.map((row, index) => <article key={row.name} className="rounded-2xl border border-amber-400/20 bg-amber-500/5 p-4">
          <div className="flex items-center justify-between"><div><div className="text-xs font-black text-amber-300">المركز {index + 1}</div><div className="font-black text-white">{row.name}</div></div><div className="rounded-xl bg-amber-500/15 px-3 py-2 font-black text-amber-100">{row.quality}/100</div></div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm font-bold text-slate-300"><div>الإجمالي: <b className="text-white">{row.total}</b></div><div>المكتمل: <b className="text-white">{row.completed}</b></div><div>نتيجة إيجابية: <b className="text-emerald-200">{row.positive}</b></div><div>موثق جيدًا: <b className="text-cyan-200">{row.documented}</b></div></div>
        </article>)}
        {!serviceSummary.length && <div className="text-sm font-bold text-slate-400">لا توجد بيانات متابعة متاحة للشهر المحدد.</div>}
      </div>}
    </section>
  );
}
