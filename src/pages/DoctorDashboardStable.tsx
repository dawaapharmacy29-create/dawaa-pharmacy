import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, Award, BarChart3, Bell, CheckCircle2, ChevronDown, ChevronUp, ClipboardCheck, Clock3,
  DollarSign, ExternalLink, Eye, Gift, Headphones, LogOut, Megaphone, MessageCircle, MoreHorizontal, RefreshCw, ShieldCheck,
  Star, Store, Target, TrendingDown, TrendingUp, Trophy, Users, WalletCards, X,
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { getCurrentCycle, formatCycleDate } from '@/lib/pharmacy-cycle';
import { formatCurrency } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { normalizeBranchName } from '@/lib/branch';
import { loadSalesAnalyticsSummary, type SalesAnalyticsSummary } from '@/lib/salesAnalyticsSummaryService';
import DoctorRequestedFollowups from '@/components/doctor/DoctorRequestedFollowups';
import { getEmployeeEvents } from '@/lib/employeeEventService';
import {
  listStaffNotifications,
  markAllStaffNotificationsRead,
  markStaffNotificationRead,
  subscribeToStaffNotifications,
  type StaffNotification,
} from '@/lib/staffNotificationService';

type LoadState = 'idle' | 'loading' | 'success' | 'error';
type Tab = 'overview' | 'requirements' | 'performance' | 'followups' | 'reviews' | 'notifications' | 'activity' | 'payroll' | 'offers' | 'rules';
type DoctorRow = SalesAnalyticsSummary['doctorRows'][number];
type Row = Record<string, unknown>;

type PersonalReview = {
  id: string; createdAt: string; kind: string; score: number; impact: number;
  positive: string; negative: string; notes: string; training: string; reviewer: string;
};
type EmployeeEvent = { id: string; title?: string; description?: string; category?: string; actor_name?: string; points_delta?: number; money_delta?: number; route?: string; event_at?: string };

// ملاحظة: التارجت مبيتاخدش من رقم ثابت هنا؛ بييجي حي من branch_sales_targets
// (نفس الجدول اللي شاشة تعديل التارجت الحقيقية بتستخدمه)، عشان لو اتغيّر من
// الإدارة يتحدث هنا أوتوماتيك من غير ما نرجع نعدل كود.
const SCORE_RULES = [
  ['الترحيب وبداية الحوار', '10', 'ترحيب ودود واستخدام اسم العميل عند توفره.'],
  ['فهم الاحتياج', '20', 'استمع واسأل ثم لخّص الطلب قبل الترشيح.'],
  ['الترشيح الآمن', '25', 'رشّح الأنسب مع مراجعة الموانع والتعارضات.'],
  ['شرح الاستخدام', '15', 'اشرح الفائدة وطريقة الاستخدام والفرق بين البدائل.'],
  ['Cross-selling أخلاقي', '10', 'منتج مكمل مرتبط باحتياج حقيقي وبدون ضغط.'],
  ['Up-selling مسؤول', '10', 'اختيار أفضل عند وجود فائدة واضحة مع شرح فرق السعر.'],
  ['الاحترام وعدم الضغط', '5', 'احترم قرار العميل ورفضه.'],
  ['الختام والمتابعة', '5', 'أكد الطلب واسأل عن احتياج إضافي واختم باهتمام.'],
] as const;
const WORK_RULE_GROUPS: Array<[string, typeof Store, string[]]> = [
  ['داخل الصيدلية', Store, ['الوقوف واستقبال العميل باهتمام', 'فهم الطلب قبل إحضار المنتج', 'شرح الجرعة والاستخدام', 'عرض بديل مناسب', 'التأكد من رضا العميل']],
  ['طريقة تنفيذ المطلوب', CheckCircle2, ['ابدأ المهام الجديدة في نفس اليوم', 'اكتب تقدمًا واضحًا', 'اطلب المساعدة قبل التأخير', 'أرسل المهمة للمراجعة بعد الإكمال']],
  ['الالتزام بالوقت', Clock3, ['راجع المواعيد النهائية يوميًا', 'أنهِ المتابعات في موعدها', 'لا تترك مهمة متأخرة دون ملاحظة']],
];

// التبويبات الأساسية تظهر في شريط التنقل السفلي مباشرة (الأكثر استخدامًا يوميًا).
// الباقي يفتح من زر "المزيد" عشان الشريط السفلي يفضل مريح على الموبايل.
const PRIMARY_TABS: Array<[Tab, string, typeof Star]> = [
  ['overview', 'الملخص', BarChart3],
  ['performance', 'أدائي', TrendingUp],
  ['reviews', 'تقييماتي', Star],
  ['notifications', 'إشعاراتي', Bell],
];
const MORE_TABS: Array<[Tab, string, typeof Star]> = [
  ['requirements', 'المطلوب مني', ClipboardCheck],
  ['followups', 'متابعاتي', Headphones],
  ['payroll', 'القبض والحوافز', WalletCards],
  ['offers', 'العروض والاستوريز', Megaphone],
  ['activity', 'سجل نشاطي', Activity],
  ['rules', 'قواعد الخدمة', ShieldCheck],
];

function normalizeName(value?: string | null) {
  return String(value || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\b(دكتور|دكتوره|د|dr)\b/gi, '').replace(/[\s/_.-]+/g, ' ').trim().toLowerCase();
}
function number(value: unknown) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function text(value: unknown) { return String(value ?? '').trim(); }
function formatDate(value?: string | null) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value.slice(0, 16) : date.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' }); }
function greeting() { const hour = new Date().getHours(); return hour < 12 ? 'صباح الخير' : hour < 18 ? 'نهارك سعيد' : 'مساء الخير'; }
function branchTargetFallback(sales: number) { return Math.max(sales * 1.25, 1); }
async function safeRows(query: PromiseLike<{ data: unknown[] | null; error: { message?: string } | null }>) { try { const result = await query; return result.error ? [] : (result.data || []) as Row[]; } catch { return []; } }

// ألوان الهوية الفعلية للتطبيق (navy/teal من tailwind.config) بدل درجات الرمادي العامة.
const surface = { background: 'var(--dawaa-theme-surface)', borderColor: 'var(--dawaa-theme-border)' };
const surfaceSoft = { background: 'var(--dawaa-theme-bg-soft)', borderColor: 'var(--dawaa-theme-border)' };
const mutedText = { color: 'var(--dawaa-theme-muted)' };

function Metric({ label, value, hint, icon: Icon, progress }: { label: string; value: string; hint?: string; icon: typeof DollarSign; progress?: number }) {
  return (
    <div className="rounded-2xl border p-4" style={surface}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-bold" style={mutedText}>{label}</div>
          <div className="mt-2 text-2xl font-black text-white">{value}</div>
          {hint ? <div className="mt-1 text-xs" style={mutedText}>{hint}</div> : null}
        </div>
        <div className="rounded-xl bg-teal-500/15 p-3 text-teal-300"><Icon size={20} /></div>
      </div>
      {progress != null ? (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.min(Math.max(progress, 0), 100)}%`,
              background: progress >= 100 ? '#34d399' : progress >= 60 ? '#2dd4bf' : '#f59e0b',
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function StatChip({
  label, value, hint, icon: Icon, tone = 'primary', trend,
}: {
  label: string; value: string; hint?: string; icon: typeof DollarSign; tone?: 'primary' | 'urgent';
  trend?: { direction: 'up' | 'down' | 'flat'; text: string };
}) {
  const iconTone = tone === 'urgent' ? 'bg-amber-500/15 text-amber-300' : 'bg-teal-500/15 text-teal-300';
  const trendTone =
    trend?.direction === 'up' ? 'text-emerald-300' : trend?.direction === 'down' ? 'text-rose-300' : 'text-slate-400';
  const TrendIcon = trend?.direction === 'down' ? TrendingDown : TrendingUp;
  return (
    <div className="min-w-[158px] shrink-0 rounded-2xl border p-4" style={surface}>
      <div className="flex items-center justify-between">
        <div className={`inline-flex rounded-xl p-2 ${iconTone}`}><Icon size={18} /></div>
        {trend && trend.direction !== 'flat' ? (
          <span className={`flex items-center gap-0.5 text-[11px] font-black ${trendTone}`}>
            <TrendIcon size={12} /> {trend.text}
          </span>
        ) : null}
      </div>
      <div className="mt-3 text-xl font-black text-white">{value}</div>
      <div className="mt-1 text-xs font-bold" style={mutedText}>{label}</div>
      {hint ? <div className="mt-1 text-[11px]" style={mutedText}>{hint}</div> : null}
    </div>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="rounded-2xl border border-dashed p-5 text-center text-sm font-bold" style={{ ...mutedText, borderColor: 'var(--dawaa-theme-border)' }}>{children}</p>;
}

// أيقونة مناسبة لنوع الإشعار — عشان الدكتور يقدر يميّز نوع الإشعار من أول نظرة
// بدل ما كل الإشعارات (تقييم، متابعة، خصم، مكافأة...) تظهر بنفس جرس الإشعار.
function notificationIcon(type: string) {
  const t = (type || '').toLowerCase();
  if (t.includes('review')) return Star;
  if (t.includes('deduction')) return TrendingDown;
  if (t.includes('reward') || t.includes('bonus')) return Gift;
  if (t.includes('attendance') || t.includes('leave')) return Clock3;
  if (t.includes('followup')) return Headphones;
  if (t.includes('customer')) return Users;
  if (t.includes('announce')) return Megaphone;
  if (t.includes('message') || t.includes('chat')) return MessageCircle;
  return Bell;
}

// حلقة تقدم دائرية لتارجت الفرع — العنصر البصري المميز الوحيد في الصفحة، والباقي هادي حواليها.
function ProgressRing({ percent }: { percent: number }) {
  const size = 96;
  const stroke = 9;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  const offset = circumference * (1 - clamped / 100);
  const color = clamped >= 100 ? '#34d399' : clamped >= 60 ? '#2dd4bf' : '#fbbf24';
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(148,211,226,0.18)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.8s ease, stroke 0.4s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-black text-white">{clamped.toFixed(0)}%</span>
        <span className="text-[9px] font-bold text-teal-300">للتارجت</span>
      </div>
    </div>
  );
}

function MiniPerfColumn({
  accent, label, mineValue, branchValue, topValue, topName, topIsMe, rankLabel, formatValue,
}: {
  accent: string; label: string; mineValue: number; branchValue: number; topValue: number;
  topName: string | null; topIsMe?: boolean; rankLabel: string | null; formatValue: (v: number) => string;
}) {
  const max = Math.max(mineValue, branchValue, topValue, 1);
  const rows = [
    { key: 'mine', label: 'أنا', value: mineValue, color: accent },
    { key: 'branch', label: 'متوسط الفرع', value: branchValue, color: 'rgba(255,255,255,0.16)' },
    { key: 'top', label: topIsMe ? 'الأعلى في الفرع' : topName ? `الأعلى (${topName})` : 'الأعلى في الفرع', value: topValue, color: 'rgba(255,255,255,0.16)' },
  ];
  return (
    <div className="rounded-2xl border border-white/5 bg-black/10 p-3">
      <p className="text-[11px] font-black" style={{ color: accent }}>{label}</p>
      <p className="mt-1 text-2xl font-black text-white">{formatValue(mineValue)}</p>
      <div className="mt-3 space-y-2">
        {rows.map((row) => (
          <div key={row.key}>
            <div className="mb-0.5 flex items-center justify-between text-[10px] font-bold text-slate-400">
              <span className="truncate">{row.label}</span>
              <span className="shrink-0 text-white/80">{formatValue(row.value)}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
              <div className="h-full rounded-full" style={{ width: `${Math.max(4, (row.value / max) * 100)}%`, background: row.color }} />
            </div>
          </div>
        ))}
      </div>
      {rankLabel ? <p className="mt-2 text-[10px] font-bold text-slate-400">{rankLabel}</p> : null}
    </div>
  );
}

export default function DoctorDashboardStable() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const validTabs: Tab[] = ['overview', 'requirements', 'performance', 'followups', 'reviews', 'notifications', 'activity', 'payroll', 'offers', 'rules'];
  const tab: Tab = validTabs.includes(requestedTab as Tab) ? requestedTab as Tab : 'overview';
  const cycle = useMemo(() => getCurrentCycle(), []);
  const [state, setState] = useState<LoadState>('idle');
  const [summary, setSummary] = useState<SalesAnalyticsSummary | null>(null);
  const [doctorTrend, setDoctorTrend] = useState<SalesAnalyticsSummary['dailyTrend']>([]);
  const [error, setError] = useState('');
  const [reviews, setReviews] = useState<PersonalReview[]>([]);
  const [notifications, setNotifications] = useState<StaffNotification[]>([]);
  const [events, setEvents] = useState<EmployeeEvent[]>([]);
  const [assignments, setAssignments] = useState<Row[]>([]);
  const [incentiveAssignments, setIncentiveAssignments] = useState<Row[]>([]);
  const [payrollRows, setPayrollRows] = useState<Row[]>([]);
  const [manualPayrollRows, setManualPayrollRows] = useState<Row[]>([]);
  const [offers, setOffers] = useState<Row[]>([]);
  const [stories, setStories] = useState<Row[]>([]);
  const [personalState, setPersonalState] = useState<Record<string, LoadState>>({});
  const [moreOpen, setMoreOpen] = useState(false);
  const [branchTargetAmount, setBranchTargetAmount] = useState<number | null>(null);
  const [openReviewId, setOpenReviewId] = useState<string | null>(null);
  const [invoiceQuality, setInvoiceQuality] = useState<{
    my_metrics: { avg_invoice: number; avg_items_per_invoice: number; unique_customers: number; invoices: number; items_rank: number | null; invoice_rank: number | null; customers_rank: number | null; branch_doctor_count: number };
    branch_avg: { avg_invoice: number; avg_items_per_invoice: number; unique_customers: number };
    top: {
      items: { name: string | null; value: number; is_me: boolean };
      invoice: { name: string | null; value: number; is_me: boolean };
      customers: { name: string | null; value: number; is_me: boolean };
    };
  } | null>(null);

  const branch = text(user?.branch);
  const staffId = text(user?.staffId);
  const username = text(user?.username);
  const doctorName = text(user?.name);
  const selectTab = (next: Tab) => setSearchParams({ tab: next }, { replace: true });

  const setPart = (key: string, value: LoadState) => setPersonalState((current) => ({ ...current, [key]: value }));

  const loadBranchTarget = useCallback(async () => {
    if (!branch) return;
    const normalized = normalizeBranchName(branch) || branch;
    const rows = await safeRows(
      supabase.from('branch_sales_targets').select('*').eq('active', true).order('updated_at', { ascending: false }).limit(50)
    );
    const match = rows.find((row) => (normalizeBranchName(text(row.branch_name || row.branch)) || text(row.branch_name || row.branch)) === normalized);
    const amount = number(match?.target_amount ?? match?.monthly_target ?? match?.target);
    setBranchTargetAmount(amount > 0 ? amount : null);
  }, [branch]);

  const load = useCallback(async () => {
    if (!branch) { setState('error'); setError('الحساب غير مرتبط بفرع واضح.'); return; }
    setState('loading'); setError('');
    try {
      const result = await loadSalesAnalyticsSummary({ startDate: formatCycleDate(cycle.start), endDate: formatCycleDate(cycle.end), branch }, true);
      setSummary(result); setState('success');
    } catch (loadError) { setState('error'); setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل بيانات لوحة الدكتور.'); }
  }, [branch, cycle.end, cycle.start]);

  useEffect(() => {
    if (!branch || !doctorName) return;
    let cancelled = false;
    supabase
      .rpc('get_doctor_invoice_quality_metrics', {
        p_branch: branch, p_doctor_name: doctorName,
        p_cycle_start: formatCycleDate(cycle.start), p_cycle_end: formatCycleDate(cycle.end),
      })
      .then(({ data, error: rpcError }) => {
        if (cancelled || rpcError) return;
        setInvoiceQuality(data as typeof invoiceQuality);
      })
      .catch(() => { if (!cancelled) setInvoiceQuality(null); });
    return () => { cancelled = true; };
  }, [branch, doctorName, cycle.end, cycle.start]);

  const loadReviews = useCallback(async () => {
    setPart('reviews', 'loading');
    const queries: Promise<Row[]>[] = [];
    if (staffId) {
      queries.push(safeRows(supabase.from('conversation_sales_reviews').select('*').eq('staff_id', staffId).order('created_at', { ascending: false }).limit(100)));
      queries.push(safeRows(supabase.from('conversation_sales_reviews').select('*').eq('doctor_id', staffId).order('created_at', { ascending: false }).limit(100)));
    }
    // بعض التقييمات (خصوصًا القديمة) اتسجلت بالاسم بس من غير staff_id/doctor_id،
    // فمينفعش نعتمد على المطابقة بالـ ID لوحدها — لازم fallback بالاسم زي الرواكد واللستة.
    if (doctorName) {
      queries.push(safeRows(supabase.from('conversation_sales_reviews').select('*').eq('doctor_name', doctorName).order('created_at', { ascending: false }).limit(100)));
    }
    const rows = (await Promise.all(queries)).flat();
    const mine = staffId
      ? rows.filter((row) => {
          const hasId = text(row.staff_id) || text(row.doctor_id);
          if (hasId) return text(row.staff_id) === staffId || text(row.doctor_id) === staffId;
          return normalizeName(text(row.doctor_name)) === normalizeName(doctorName);
        })
      : rows;
    const unique = new Map<string, Row>(); mine.forEach((row) => unique.set(text(row.id || `${row.created_at}-${row.doctor_name}`), row));
    setReviews([...unique.values()].sort((a, b) => text(b.created_at).localeCompare(text(a.created_at))).map((row) => ({
      id: text(row.id), createdAt: text(row.created_at || row.conversation_date), kind: text(row.evaluation_kind || row.conversation_type || 'تقييم محادثة'),
      score: number(row.final_score ?? row.total_score), impact: number(row.doctor_points_impact ?? row.point_impact),
      positive: text(row.main_positive_reason), negative: text(row.main_negative_reason), notes: text(row.reviewer_notes),
      training: text(row.training_recommendation), reviewer: text(row.reviewer_name || 'مراجع خدمة العملاء'),
    })));
    setPart('reviews', 'success');
  }, [staffId, doctorName]);

  const loadNotifications = useCallback(async () => {
    setPart('notifications', 'loading');
    try { setNotifications(await listStaffNotifications(staffId, 120)); setPart('notifications', 'success'); }
    catch { setPart('notifications', 'error'); }
  }, [staffId]);

  const loadAssignments = useCallback(async () => {
    setPart('requirements', 'loading');
    // ملاحظة: جدول staff_assignments مش موجود. المصدر الحقيقي المتاح دلوقتي هو stagnant_medicines
    // (الأدوية الراكدة المسندة لدكتور مسؤول)، ومربوط غالبًا بالاسم مش بمعرف staff_id.
    const rows = await safeRows(supabase.from('stagnant_medicines').select('*').order('nearest_expiry_date', { ascending: true }).limit(200));
    const mine = rows.filter((row) => {
      const idMatch = [row.responsible_doctor_id, row.doctor_id].map(text).some((value) => value && (value === staffId));
      const nameMatch = [row.responsible_doctor_name, row.responsible_doctor].map(normalizeName).some((value) => value && value === normalizeName(doctorName));
      return idMatch || nameMatch;
    });
    setAssignments(mine);

    // نفس فكرة الرواكد، بس لـ"اللستة" (incentive_medicines) — كانت مش ظاهرة للدكتور خالص قبل كده.
    const listRows = await safeRows(supabase.from('incentive_medicines').select('*').eq('active', true).order('expiry_date', { ascending: true }).limit(200));
    const myList = listRows.filter((row) => {
      const idMatch = text(row.doctor_id) === staffId;
      const nameMatch = normalizeName(text(row.responsible_doctor)) === normalizeName(doctorName);
      return idMatch || nameMatch;
    });
    setIncentiveAssignments(myList);
    setPart('requirements', 'success');
  }, [staffId, doctorName]);

  const loadPayroll = useCallback(async () => {
    setPart('payroll', 'loading');
    // ملاحظة: جدول employee_monthly_statements القديم مش موجود فعليًا في القاعدة.
    // المصدر الحقيقي هو staff_payroll_summary (view)، ومربوط بـ username مش staff_id.
    // بيفضل فاضي عن قصد لحد ما فريق الرواتب يعتمد دورة فعلية (payroll_month) للحساب ده،
    // عشان منعرضش صفر بدل "لسه معتمدش" على الدكتور.
    const statements = username
      ? await safeRows(
          supabase
            .from('staff_payroll_summary')
            .select('*')
            .ilike('username', username)
            .not('payroll_month', 'is', null)
            .order('payroll_month', { ascending: false })
            .limit(12)
        )
      : [];
    setPayrollRows(statements); setManualPayrollRows([]); setPart('payroll', 'success');
  }, [username]);

  const loadOffers = useCallback(async () => {
    setPart('offers', 'loading');
    const now = new Date().toISOString();
    const [offerRows, storyRows] = await Promise.all([
      safeRows(supabase.from('offers').select('*').or(`end_date.is.null,end_date.gte.${now}`).order('created_at', { ascending: false }).limit(50)),
      safeRows(supabase.from('whatsapp_stories').select('*').order('story_date', { ascending: false }).order('created_at', { ascending: false }).limit(50)),
    ]);
    setOffers(offerRows); setStories(storyRows); setPart('offers', 'success');
  }, []);

  const loadDoctorTrend = useCallback(async () => {
    if (!branch || !doctorName) return;
    try {
      // مش بنستخدم فلتر الدكتور في loadSalesAnalyticsSummary لأنه بيعمل مطابقة حرفية
      // (seller_name = الاسم بالظبط)، وده بيفشل لو اسم الحساب فيه اختلاف بسيط عن اسم
      // البائع في الفاتورة (زي "د/ بسنت" في الحساب مقابل "د بسنت" في الفواتير).
      // بنجيب فواتير الفرع كلها للدورة، وبنطابق بنفس دالة normalizeName المستخدمة
      // في باقي الصفحة (الرواكد واللستة)، اللي بتشيل "د/" والمسافات والرموز.
      const { data, error } = await supabase
        .from('sales_invoices')
        .select('invoice_date,sale_date,net_total,net_amount,discounted_amount,total_amount,amount,branch,seller_name,normalized_seller_name,staff_name')
        .eq('branch', branch)
        .gte('invoice_date', formatCycleDate(cycle.start))
        .lt('invoice_date', formatCycleDate(cycle.end))
        .limit(5000);
      if (error) throw error;
      const target = normalizeName(doctorName);
      const mine = (data || []).filter((row: Row) => {
        const candidates = [row.seller_name, row.normalized_seller_name, row.staff_name].map((v) => normalizeName(text(v)));
        return candidates.includes(target);
      });
      const byDay = new Map<string, number>();
      for (const row of mine) {
        const day = text(row.invoice_date || row.sale_date).slice(0, 10);
        if (!day) continue;
        const amount = number(row.net_total) || number(row.net_amount) || number(row.discounted_amount) || number(row.total_amount) || number(row.amount);
        byDay.set(day, (byDay.get(day) || 0) + amount);
      }
      const trend = [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, netSales]) => ({ date, netSales, invoicesCount: 0, avgInvoice: 0, uniqueCustomers: 0 }));
      setDoctorTrend(trend);
    } catch {
      setDoctorTrend([]);
    }
  }, [branch, cycle.end, cycle.start, doctorName]);

  const loadActivity = useCallback(async () => { setPart('activity', 'loading'); setEvents((await getEmployeeEvents(staffId, 200)) as EmployeeEvent[]); setPart('activity', 'success'); }, [staffId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadBranchTarget(); }, [loadBranchTarget]);
  useEffect(() => { void loadDoctorTrend(); }, [loadDoctorTrend]);
  useEffect(() => subscribeToStaffNotifications(staffId, () => void loadNotifications()), [loadNotifications, staffId]);
  useEffect(() => {
    if (tab === 'reviews' && !personalState.reviews) void loadReviews();
    if (tab === 'notifications' && !personalState.notifications) void loadNotifications();
    if (tab === 'requirements' && !personalState.requirements) void loadAssignments();
    if (tab === 'activity' && !personalState.activity) void loadActivity();
    if (tab === 'payroll' && !personalState.payroll) void loadPayroll();
    if (tab === 'offers' && !personalState.offers) void loadOffers();
  }, [loadActivity, loadAssignments, loadNotifications, loadOffers, loadPayroll, loadReviews, personalState, tab]);

  const doctorRow = useMemo<DoctorRow | null>(() => summary?.doctorRows.find((row) => row.staffId === staffId) || summary?.doctorRows.find((row) => normalizeName(row.doctor) === normalizeName(doctorName)) || null, [doctorName, staffId, summary]);
  const ranking = useMemo(() => summary ? [...summary.doctorRows].sort((a, b) => b.netSales - a.netSales) : [], [summary]);
  const doctorRank = doctorRow ? ranking.findIndex((row) => row.staffId === doctorRow.staffId && row.doctor === doctorRow.doctor) + 1 : 0;
  const branchSales = summary?.kpis.netSales || 0;
  const target = branchTargetAmount ?? branchTargetFallback(branchSales);
  const achievement = target ? branchSales / target * 100 : 0;
  const cycleTotalDays = Math.max(1, Math.round((cycle.end.getTime() - cycle.start.getTime()) / 86400000) + 1);
  const cycleDaysElapsed = Math.min(cycleTotalDays, Math.max(1, Math.floor((Date.now() - cycle.start.getTime()) / 86400000) + 1));
  const dailyAveragePace = branchSales / cycleDaysElapsed;
  const projectedTotal = dailyAveragePace * cycleTotalDays;
  const projectedVsTarget = target ? projectedTotal / target * 100 : 0;
  const unread = notifications.filter((item) => !item.isRead).length;
  const openAssignments = assignments.filter((item) => number(item.remaining_quantity ?? item.quantity_available ?? item.total_quantity) > 0);
  const overdueAssignments = openAssignments.filter((item) => {
    const expiry = text(item.nearest_expiry_date || item.expiry_date);
    if (!expiry) return false;
    const days = (new Date(expiry).getTime() - Date.now()) / 86400000;
    return Number.isFinite(days) && days <= 30;
  });
  const reviewAverage = reviews.length ? reviews.reduce((sum, item) => sum + item.score, 0) / reviews.length : 0;
  const moreHasAttention = openAssignments.length > 0;
  const activeInMore = MORE_TABS.some(([key]) => key === tab);

  return (
    <div dir="rtl" className="space-y-5 pb-28">
      <section className="relative overflow-hidden rounded-3xl border p-5" style={{ background: 'linear-gradient(135deg, #1B2B4B 0%, #243558 100%)', borderColor: 'var(--dawaa-theme-border)' }}>
        <div className="absolute left-4 top-4 flex items-center gap-2">
          <button
            type="button" onClick={() => { void load(); void loadNotifications(); }} disabled={state === 'loading'}
            className="rounded-full p-2 text-teal-300 transition disabled:opacity-50" style={{ background: 'rgba(0,0,0,0.2)' }}
          >
            <RefreshCw size={16} className={state === 'loading' ? 'animate-spin' : ''} />
          </button>
          <button
            type="button" onClick={async () => { await logout(); navigate('/login'); }}
            className="rounded-full p-2 text-red-300 transition" style={{ background: 'rgba(0,0,0,0.2)' }} aria-label="تسجيل الخروج"
          >
            <LogOut size={16} />
          </button>
        </div>
        <div className="flex items-center gap-4">
          <ProgressRing percent={achievement} />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-black uppercase tracking-wide text-teal-300">مساحة الدكتور الشخصية</div>
            <h1 className="mt-0.5 truncate text-xl font-black text-white">{greeting()} يا دكتور {doctorName || 'الزميل'}</h1>
            <p className="mt-1 text-xs font-bold text-slate-300">{branch || 'الفرع غير محدد'} · الدورة {cycle.label}</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl p-3 text-xs font-bold sm:grid-cols-4" style={{ background: 'rgba(0,0,0,0.18)' }}>
          <div>
            <div className="text-slate-400">تارجت الفرع{branchTargetAmount === null ? ' (تقديري)' : ''}</div>
            <div className="mt-0.5 text-sm font-black text-white">{formatCurrency(target)}</div>
          </div>
          <div>
            <div className="text-slate-400">المحقق حتى الآن</div>
            <div className="mt-0.5 text-sm font-black text-teal-300">{formatCurrency(branchSales)}</div>
          </div>
          <div>
            <div className="text-slate-400">المتبقي</div>
            <div className="mt-0.5 text-sm font-black text-amber-200">{formatCurrency(Math.max(0, target - branchSales))}</div>
          </div>
          <div>
            <div className="text-slate-400">لو استمرينا بنفس المعدل</div>
            <div className={`mt-0.5 text-sm font-black ${projectedVsTarget >= 100 ? 'text-emerald-300' : 'text-red-300'}`}>{formatCurrency(projectedTotal)}</div>
          </div>
        </div>
        <p className="mt-2 text-[10px] font-bold text-slate-400">
          بمعدل {formatCurrency(dailyAveragePace)}/يوم على مدار {cycleDaysElapsed} من {cycleTotalDays} يوم في الدورة — {projectedVsTarget >= 100 ? 'في الطريق لتحقيق التارجت 👍' : `أقل من التارجت بـ ${formatCurrency(Math.max(0, target - projectedTotal))} لو استمر نفس المعدل`}
        </p>
      </section>

      {state === 'error' ? <section className="rounded-3xl border border-red-400/25 bg-red-500/10 p-5 text-red-100">{error}</section> : null}

      {tab === 'overview' ? (
        <>
          <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
            <StatChip icon={DollarSign} label="مبيعاتي في الدورة" value={doctorRow ? formatCurrency(doctorRow.netSales) : 'غير مرتبط'} hint={doctorRow ? `${doctorRow.invoicesCount} فاتورة` : 'راجع staff_id'} />
            <StatChip
              icon={TrendingUp}
              label="متوسط فاتورتي"
              value={doctorRow ? formatCurrency(doctorRow.avgInvoice) : '—'}
              hint={`متوسط الفرع ${formatCurrency(summary?.kpis.avgInvoice || 0)}`}
              trend={
                doctorRow && summary?.kpis.avgInvoice
                  ? (() => {
                      const diff = doctorRow.avgInvoice - summary.kpis.avgInvoice;
                      const pct = Math.round((diff / summary.kpis.avgInvoice) * 100);
                      if (Math.abs(pct) < 1) return { direction: 'flat' as const, text: '' };
                      return { direction: diff >= 0 ? ('up' as const) : ('down' as const), text: `${Math.abs(pct)}%` };
                    })()
                  : undefined
              }
            />
            <StatChip icon={Trophy} label="ترتيبي في الفرع" value={doctorRank ? `${doctorRank} من ${ranking.length}` : '—'} />
            <StatChip icon={ClipboardCheck} label="المطلوب المفتوح" value={String(openAssignments.length)} tone={overdueAssignments.length ? 'urgent' : 'primary'} hint={overdueAssignments.length ? `${overdueAssignments.length} قريب من الانتهاء` : 'لا يوجد قريب من الانتهاء'} />
          </div>

          <section className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
            <div className="rounded-3xl border p-4" style={surface}>
              <div className="flex items-center gap-2 font-black text-teal-200"><BarChart3 size={18} /> مبيعاتي اليومية في الدورة</div>
              {doctorTrend.length ? (
                <ResponsiveContainer width="100%" height={170}>
                  <AreaChart data={doctorTrend} margin={{ top: 10, right: 8, left: -22, bottom: 0 }}>
                    <defs>
                      <linearGradient id="myDailySales" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2dd4bf" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="#2dd4bf" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={(v: string) => v?.slice(5)} tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} width={40} />
                    <Tooltip
                      contentStyle={{ background: '#0f1d33', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, fontSize: 12 }}
                      labelStyle={{ color: '#e2e8f0' }}
                      formatter={(value: number) => [formatCurrency(value), 'مبيعاتي']}
                    />
                    <Area type="monotone" dataKey="netSales" stroke="#2dd4bf" strokeWidth={2.5} fill="url(#myDailySales)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <p className="mt-4 text-xs font-bold" style={mutedText}>سيظهر هنا ترند مبيعاتك اليومي بمجرد توفر فواتير كافية في الدورة الحالية.</p>
              )}
            </div>

            <div className="rounded-3xl border p-4 lg:col-span-2" style={surface}>
              <div className="flex items-center gap-2 font-black text-teal-200"><TrendingUp size={18} /> أدائي في الدورة الحالية — مقارنة تحفيزية</div>
              {invoiceQuality || doctorRow ? (
                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  <MiniPerfColumn
                    accent="#38bdf8"
                    label="عملاء تم التعامل معهم"
                    mineValue={invoiceQuality?.my_metrics.unique_customers ?? 0}
                    branchValue={invoiceQuality?.branch_avg.unique_customers ?? 0}
                    topValue={invoiceQuality?.top.customers.value ?? 0}
                    topName={invoiceQuality?.top.customers.name || null}
                    topIsMe={invoiceQuality?.top.customers.is_me}
                    rankLabel={invoiceQuality?.my_metrics.customers_rank ? `ترتيبي: #${invoiceQuality.my_metrics.customers_rank} من ${invoiceQuality.my_metrics.branch_doctor_count}` : null}
                    formatValue={(v) => String(Math.round(v))}
                  />
                  <MiniPerfColumn
                    accent="#a78bfa"
                    label="متوسط عدد الأصناف بالفاتورة"
                    mineValue={invoiceQuality?.my_metrics.avg_items_per_invoice ?? 0}
                    branchValue={invoiceQuality?.branch_avg.avg_items_per_invoice ?? 0}
                    topValue={invoiceQuality?.top.items.value ?? 0}
                    topName={invoiceQuality?.top.items.name || null}
                    topIsMe={invoiceQuality?.top.items.is_me}
                    rankLabel={invoiceQuality?.my_metrics.items_rank ? `ترتيبي: #${invoiceQuality.my_metrics.items_rank} من ${invoiceQuality.my_metrics.branch_doctor_count}` : null}
                    formatValue={(v) => v.toFixed(2)}
                  />
                  <MiniPerfColumn
                    accent="#2dd4bf"
                    label="متوسط الفاتورة"
                    mineValue={doctorRow?.avgInvoice ?? invoiceQuality?.my_metrics.avg_invoice ?? 0}
                    branchValue={summary?.kpis.avgInvoice ?? invoiceQuality?.branch_avg.avg_invoice ?? 0}
                    topValue={(ranking[0]?.avgInvoice) ?? invoiceQuality?.top.invoice.value ?? 0}
                    topName={(ranking[0] && ranking[0].doctor !== doctorRow?.doctor ? ranking[0].doctor : null) ?? invoiceQuality?.top.invoice.name ?? null}
                    topIsMe={invoiceQuality?.top.invoice.is_me}
                    rankLabel={invoiceQuality?.my_metrics.invoice_rank ? `ترتيبي: #${invoiceQuality.my_metrics.invoice_rank} من ${invoiceQuality.my_metrics.branch_doctor_count}` : null}
                    formatValue={(v) => formatCurrency(v)}
                  />
                </div>
              ) : (
                <p className="mt-4 text-xs font-bold" style={mutedText}>ستظهر هنا المقارنة بمجرد توفر بيانات كافية من فواتير الدورة الحالية.</p>
              )}
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-3">
            <button
              onClick={() => selectTab('requirements')} className="rounded-2xl border p-4 text-right transition"
              style={{ borderColor: overdueAssignments.length ? 'rgba(251,191,36,0.4)' : 'var(--dawaa-theme-border)', background: overdueAssignments.length ? 'rgba(251,191,36,0.08)' : 'var(--dawaa-theme-surface)' }}
            >
              <div className="flex items-center gap-2 font-black text-amber-200"><Target size={18} /> المطلوب مني الآن</div>
              <div className="mt-2 text-2xl font-black text-white">{openAssignments.length}</div>
              <p className="mt-1 text-xs" style={mutedText}>الأدوية الراكدة المسندة لك للتصريف.</p>
            </button>
            <button onClick={() => selectTab('reviews')} className="rounded-2xl border p-4 text-right transition" style={surface}>
              <div className="flex items-center gap-2 font-black text-teal-200"><ClipboardCheck size={18} /> متوسط تقييماتي</div>
              <div className="mt-2 text-2xl font-black text-white">{reviews.length ? `${reviewAverage.toFixed(1)}%` : 'افتح التقييمات'}</div>
              <p className="mt-1 text-xs" style={mutedText}>كل تقييم جديد يظهر لك مع نقاط القوة والتحسين.</p>
            </button>
            <button
              onClick={() => selectTab('notifications')} className="rounded-2xl border p-4 text-right transition"
              style={{ borderColor: unread ? 'rgba(248,113,113,0.35)' : 'var(--dawaa-theme-border)', background: unread ? 'rgba(248,113,113,0.08)' : 'var(--dawaa-theme-surface)' }}
            >
              <div className={`flex items-center gap-2 font-black ${unread ? 'text-red-200' : 'text-teal-200'}`}><Bell size={18} /> إشعاراتي غير المقروءة</div>
              <div className="mt-2 text-2xl font-black text-white">{unread}</div>
              <p className="mt-1 text-xs" style={mutedText}>لا تظهر هنا إلا الأحداث الخاصة بك والإعلانات العامة.</p>
            </button>
          </section>
        </>
      ) : null}

      {tab === 'requirements' ? (
        <section className="rounded-3xl border p-5" style={surface}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black text-white">المطلوب مني</h2>
              <p className="mt-1 text-sm" style={mutedText}>الأدوية الراكدة المسندة لك للتصريف قبل انتهاء الصلاحية.</p>
            </div>
            <button className="btn-secondary" onClick={() => void loadAssignments()}>تحديث</button>
          </div>

          {assignments.length ? (() => {
            const totalAssigned = assignments.reduce((sum, item) => sum + number(item.total_quantity ?? item.quantity_available), 0);
            const totalRemaining = assignments.reduce((sum, item) => sum + number(item.remaining_quantity ?? item.quantity_available), 0);
            const dispensed = Math.max(totalAssigned - totalRemaining, 0);
            const efficiency = totalAssigned > 0 ? Math.round((dispensed / totalAssigned) * 100) : 0;
            return (
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border p-4" style={surface}>
                  <div className="flex items-center gap-2 font-black text-teal-200"><Target size={16} /> كفاءة صرف الراكد</div>
                  <div className="mt-2 text-2xl font-black text-white">{efficiency}%</div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-teal-400" style={{ width: `${Math.min(efficiency, 100)}%` }} />
                  </div>
                </div>
                <div className="rounded-2xl border p-4" style={surface}>
                  <div className="text-xs font-bold" style={mutedText}>تم تصريفه</div>
                  <div className="mt-2 text-2xl font-black text-white">{dispensed.toLocaleString('ar-EG')}</div>
                </div>
                <div className="rounded-2xl border p-4" style={surface}>
                  <div className="text-xs font-bold" style={mutedText}>الباقي من إجمالي {totalAssigned.toLocaleString('ar-EG')}</div>
                  <div className="mt-2 text-2xl font-black text-white">{totalRemaining.toLocaleString('ar-EG')}</div>
                </div>
              </div>
            );
          })() : null}

          <div className="mt-4 space-y-3">
            {assignments.map((item) => {
              const expiry = text(item.nearest_expiry_date || item.expiry_date);
              const days = expiry ? Math.round((new Date(expiry).getTime() - Date.now()) / 86400000) : null;
              const urgent = days !== null && Number.isFinite(days) && days <= 30;
              const remaining = number(item.remaining_quantity ?? item.quantity_available);
              const total = number(item.total_quantity ?? item.quantity_available);
              const itemPct = total > 0 ? Math.round(((total - remaining) / total) * 100) : 0;
              return (
                <article key={text(item.id)} className="rounded-2xl border p-4" style={urgent ? { borderColor: 'rgba(248,113,113,0.35)', background: 'rgba(248,113,113,0.06)' } : surface}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="font-black text-white">{text(item.medicine_name || item.product_name || 'صنف راكد')}</div>
                      <p className="mt-1 text-sm" style={mutedText}>{text(item.branch_name || item.branch || 'كل الفروع')}</p>
                    </div>
                    <span className="rounded-full px-3 py-1 text-xs font-black text-teal-200" style={surfaceSoft}>{text(item.status || 'نشط')}</span>
                  </div>
                  {total > 0 ? (
                    <div className="mt-3 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-teal-400" style={{ width: `${Math.min(itemPct, 100)}%` }} />
                      </div>
                      <span className="text-[11px] font-black text-teal-200">{itemPct}%</span>
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-3 text-xs font-bold" style={mutedText}>
                    <span>المتبقي: {remaining}{total ? ` من ${total}` : ''}</span>
                    <span>الأولوية: {text(item.priority || 'متوسطة')}</span>
                    {expiry ? <span className={urgent ? 'text-red-300' : ''}>الصلاحية: {formatDate(expiry)}{days !== null ? ` (${days} يوم)` : ''}</span> : null}
                    {number(item.incentive_per_unit) ? <span>حافز الوحدة: {formatCurrency(number(item.incentive_per_unit))}</span> : null}
                  </div>
                  {text(item.notes) ? <p className="mt-3 rounded-xl p-3 text-sm text-amber-100" style={surfaceSoft}>ملاحظة: {text(item.notes)}</p> : null}
                </article>
              );
            })}
            {personalState.requirements === 'success' && !assignments.length ? <Empty>لا يوجد أصناف راكدة مسندة لك حاليًا.</Empty> : null}
          </div>

          <div className="mt-8 border-t pt-6" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
            <h2 className="text-xl font-black text-white">اللستة</h2>
            <p className="mt-1 text-sm" style={mutedText}>أصناف اللستة ذات الحافز الخاص المسندة لك، ومستهدف بيعها.</p>

            {incentiveAssignments.length ? (() => {
              const totalTarget = incentiveAssignments.reduce((sum, item) => sum + number(item.target_min_quantity), 0);
              const totalSold = incentiveAssignments.reduce((sum, item) => sum + number(item.sold_quantity), 0);
              const efficiency = totalTarget > 0 ? Math.round((Math.min(totalSold, totalTarget) / totalTarget) * 100) : 0;
              return (
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border p-4" style={surface}>
                    <div className="flex items-center gap-2 font-black text-teal-200"><Target size={16} /> كفاءة تحقيق مستهدف اللستة</div>
                    <div className="mt-2 text-2xl font-black text-white">{efficiency}%</div>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-teal-400" style={{ width: `${Math.min(efficiency, 100)}%` }} />
                    </div>
                  </div>
                  <div className="rounded-2xl border p-4" style={surface}>
                    <div className="text-xs font-bold" style={mutedText}>تم بيعه</div>
                    <div className="mt-2 text-2xl font-black text-white">{totalSold.toLocaleString('ar-EG')}</div>
                  </div>
                  <div className="rounded-2xl border p-4" style={surface}>
                    <div className="text-xs font-bold" style={mutedText}>المستهدف الإجمالي</div>
                    <div className="mt-2 text-2xl font-black text-white">{totalTarget.toLocaleString('ar-EG')}</div>
                  </div>
                </div>
              );
            })() : null}

            <div className="mt-4 space-y-3">
              {incentiveAssignments.map((item) => {
                const expiry = text(item.expiry_date);
                const days = expiry ? Math.round((new Date(expiry).getTime() - Date.now()) / 86400000) : null;
                const urgent = days !== null && Number.isFinite(days) && days <= 30;
                const sold = number(item.sold_quantity);
                const target = number(item.target_min_quantity);
                const itemPct = target > 0 ? Math.round((Math.min(sold, target) / target) * 100) : 0;
                return (
                  <article key={text(item.id)} className="rounded-2xl border p-4" style={urgent ? { borderColor: 'rgba(248,113,113,0.35)', background: 'rgba(248,113,113,0.06)' } : surface}>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="font-black text-white">{text(item.product_name || 'صنف لستة')}</div>
                        <p className="mt-1 text-sm" style={mutedText}>{text(item.branch || 'كل الفروع')}</p>
                      </div>
                      <span className="rounded-full px-3 py-1 text-xs font-black text-teal-200" style={surfaceSoft}>{text(item.incentive_type || 'حافز')}</span>
                    </div>
                    {target > 0 ? (
                      <div className="mt-3 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                          <div className="h-full rounded-full bg-teal-400" style={{ width: `${Math.min(itemPct, 100)}%` }} />
                        </div>
                        <span className="text-[11px] font-black text-teal-200">{itemPct}%</span>
                      </div>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-3 text-xs font-bold" style={mutedText}>
                      <span>المباع: {sold}{target ? ` من مستهدف ${target}` : ''}</span>
                      {number(item.current_quantity) ? <span>المتاح بالمخزون: {number(item.current_quantity)}</span> : null}
                      {expiry ? <span className={urgent ? 'text-red-300' : ''}>الصلاحية: {formatDate(expiry)}{days !== null ? ` (${days} يوم)` : ''}</span> : null}
                      {number(item.incentive_value) ? <span>الحافز: {formatCurrency(number(item.incentive_value))}</span> : number(item.incentive_percent) ? <span>الحافز: {number(item.incentive_percent)}%</span> : null}
                    </div>
                    {text(item.notes) ? <p className="mt-3 rounded-xl p-3 text-sm text-amber-100" style={surfaceSoft}>ملاحظة: {text(item.notes)}</p> : null}
                  </article>
                );
              })}
              {personalState.requirements === 'success' && !incentiveAssignments.length ? <Empty>لا يوجد أصناف لستة مسندة لك حاليًا.</Empty> : null}
            </div>
          </div>
        </section>
      ) : null}

      {tab === 'performance' ? (
        <section className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="مبيعاتي" value={formatCurrency(doctorRow?.netSales || 0)} icon={DollarSign} />
            <Metric label="عدد الفواتير" value={String(doctorRow?.invoicesCount || 0)} icon={BarChart3} />
            <Metric label="متوسط البيع" value={formatCurrency(doctorRow?.avgInvoice || 0)} icon={TrendingUp} />
            <Metric label="تقدم الفرع" value={`${achievement.toFixed(1)}%`} hint={`المتبقي ${formatCurrency(Math.max(0, target - branchSales))}`} icon={Target} progress={achievement} />
          </div>
          <section className="rounded-3xl border p-5" style={surface}>
            <h2 className="text-xl font-black text-white">ترتيب دكاترة الفرع</h2>
            <div className="mt-4 space-y-2">
              {ranking.map((row, index) => {
                const isMe = doctorRow && row.doctor === doctorRow.doctor;
                const topSales = ranking[0]?.netSales || 1;
                const pct = Math.max(4, (row.netSales / topSales) * 100);
                return (
                  <div key={row.staffId || row.doctor} className="relative overflow-hidden rounded-xl border p-3" style={isMe ? { borderColor: 'rgba(45,212,191,0.5)', background: 'rgba(45,212,191,0.1)' } : surfaceSoft}>
                    <div className="absolute inset-y-0 right-0" style={{ width: `${pct}%`, background: isMe ? 'rgba(45,212,191,0.15)' : 'rgba(148,211,226,0.06)' }} />
                    <div className="relative flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-black ${index < 3 ? 'bg-amber-400 text-slate-950' : 'bg-slate-700 text-slate-200'}`}>
                          {index < 3 ? <Trophy size={13} /> : index + 1}
                        </span>
                        <span className="font-black text-white">{row.doctor}{isMe ? ' — أنت هنا' : ''}</span>
                      </div>
                      <div className="flex items-center gap-4 text-xs font-bold" style={mutedText}>
                        <span>{row.invoicesCount} فاتورة</span>
                        <span>متوسط {formatCurrency(row.avgInvoice)}</span>
                        <span className="text-sm font-black text-teal-200">{formatCurrency(row.netSales)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </section>
      ) : null}

      {tab === 'followups' ? <DoctorRequestedFollowups /> : null}

      {tab === 'reviews' ? (
        <section className="rounded-3xl border p-5" style={surface}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-black text-white">تقييمات محادثاتي</h2>
              <p className="mt-1 text-sm" style={mutedText}>كل تقييم مرتبط بحسابك فقط.</p>
            </div>
            <button className="btn-secondary" onClick={() => void loadReviews()}>تحديث</button>
          </div>
          {reviews.length ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Metric label="عدد التقييمات" value={String(reviews.length)} icon={ClipboardCheck} />
              <Metric label="متوسط التقييم" value={`${reviewAverage.toFixed(1)}%`} icon={Star} progress={reviewAverage} />
              <Metric label="إجمالي تأثير النقاط" value={String(reviews.reduce((sum, item) => sum + item.impact, 0))} icon={Award} />
            </div>
          ) : null}
          <div className="mt-4 space-y-3">
            {reviews.map((review) => {
              const open = openReviewId === review.id;
              return (
                <article key={review.id} className="rounded-2xl border p-4" style={surfaceSoft}>
                  <button type="button" onClick={() => setOpenReviewId(open ? null : review.id)} className="flex w-full items-start justify-between gap-3 text-right">
                    <div>
                      <div className="font-black text-white">{review.kind}</div>
                      <div className="mt-1 text-xs" style={mutedText}>{formatDate(review.createdAt)} · {review.reviewer} · تأثير النقاط {review.impact}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xl font-black text-teal-200">{review.score}/100</span>
                      <span className="flex items-center gap-1 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1.5 text-xs font-black text-cyan-200"><Eye size={15} /> التفاصيل</span>
                      {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </div>
                  </button>
                  {open ? (
                    <div className="mt-3 border-t pt-3" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                      {review.positive ? <p className="mt-2 text-sm text-teal-200">نقطة قوة: {review.positive}</p> : null}
                      {review.negative ? <p className="mt-1 text-sm text-amber-200">فرصة تحسين: {review.negative}</p> : null}
                      {review.training ? <p className="mt-2 rounded-xl bg-sky-500/10 p-3 text-sm text-sky-100">المطلوب للتطوير: {review.training}</p> : null}
                      {review.notes ? <p className="mt-2 text-sm" style={mutedText}>{review.notes}</p> : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
            {personalState.reviews === 'success' && !reviews.length ? <Empty>لا توجد تقييمات مرتبطة بحسابك حتى الآن.</Empty> : null}
          </div>
        </section>
      ) : null}

      {tab === 'notifications' ? (
        <section className="rounded-3xl border p-5" style={surface}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-black text-white">إشعاراتي الشخصية</h2>
              <p className="mt-1 text-sm" style={mutedText}>تقييم، متابعة، إذن، خصم، مكافأة، مهمة أو إعلان يخصك.</p>
            </div>
            {unread ? <button className="btn-secondary" onClick={async () => { await markAllStaffNotificationsRead(staffId); await loadNotifications(); }}>تحديد الكل كمقروء</button> : null}
          </div>
          <div className="mt-4 space-y-3">
            {notifications.map((item) => (
              <button
                key={item.id} className="block w-full rounded-2xl border p-4 text-right transition"
                style={item.isRead ? surfaceSoft : item.priority === 'urgent' || item.priority === 'high' ? { borderColor: 'rgba(248,113,113,0.4)', background: 'rgba(248,113,113,0.08)' } : { borderColor: 'rgba(45,212,191,0.4)', background: 'rgba(45,212,191,0.08)' }}
                onClick={async () => { if (!item.isRead) { await markStaffNotificationRead(item.id); await loadNotifications(); } if (item.actionUrl) window.location.href = item.actionUrl; }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 font-black text-white">
                      {(() => { const Icon = notificationIcon(item.type); return <Icon size={18} />; })()}
                      {item.title}
                    </div>
                    <p className="mt-2 text-sm" style={mutedText}>{item.message}</p>
                  </div>
                  {item.actionUrl ? <ExternalLink size={17} className="text-teal-300" /> : null}
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold" style={mutedText}>
                  <span>{formatDate(item.createdAt)}</span>
                  <span>النوع: {item.type}</span>
                  <span>الأولوية: {item.priority}</span>
                  {!item.isRead ? <span className="text-teal-200">جديد</span> : null}
                </div>
              </button>
            ))}
            {personalState.notifications === 'success' && !notifications.length ? <Empty>لا توجد إشعارات شخصية أو عامة حاليًا.</Empty> : null}
          </div>
        </section>
      ) : null}

      {tab === 'activity' ? (
        <section className="rounded-3xl border p-5" style={surface}>
          <h2 className="text-xl font-black text-white">سجل نشاطي</h2>
          <div className="relative mt-5 space-y-5 border-r-2 pr-5" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
            {events.map((event) => {
              const Icon = notificationIcon(text(event.category));
              return (
                <article key={event.id} className="relative">
                  <span className="absolute top-1 -right-[27px] flex h-5 w-5 items-center justify-center rounded-full bg-teal-500/20 text-teal-300 ring-4" style={{ ...surface }}>
                    <Icon size={12} />
                  </span>
                  <div className="rounded-2xl border p-4" style={surfaceSoft}>
                    <div className="flex justify-between gap-3">
                      <div className="font-black text-white">{event.title || event.category || 'حدث'}</div>
                      <div className="text-xs" style={mutedText}>{formatDate(event.event_at)}</div>
                    </div>
                    {event.description ? <p className="mt-2 text-sm" style={mutedText}>{event.description}</p> : null}
                    <div className="mt-2 text-xs" style={mutedText}>بواسطة: {event.actor_name || 'النظام'} {number(event.points_delta) ? `· النقاط ${number(event.points_delta)}` : ''}</div>
                  </div>
                </article>
              );
            })}
            {personalState.activity === 'success' && !events.length ? <Empty>لا توجد أحداث شخصية مسجلة بعد.</Empty> : null}
          </div>
        </section>
      ) : null}

      {tab === 'payroll' ? (
        <section className="space-y-4">
          <div className="rounded-3xl border p-5" style={surface}>
            <h2 className="text-xl font-black text-white">تفاصيل القبض والحوافز</h2>
            <p className="mt-1 text-sm" style={mutedText}>تشاهد فقط كشفك المعتمد لكل دورة.</p>
            <div className="mt-4 space-y-3">
              {payrollRows.map((row) => (
                <article key={text(row.payroll_month)} className="rounded-2xl border p-4" style={surfaceSoft}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-black text-white">دورة {formatDate(text(row.payroll_month))}</div>
                    {text(row.status) ? <span className="rounded-full px-3 py-1 text-xs font-black text-teal-200" style={surface}>{text(row.status)}</span> : null}
                  </div>
                  <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4" style={mutedText}>
                    <span className="flex items-center gap-1.5"><WalletCards size={14} /> الأساسي: {formatCurrency(number(row.base_salary))}</span>
                    <span className="flex items-center gap-1.5"><Gift size={14} /> الحوافز: {formatCurrency(number(row.incentives_total))}</span>
                    <span className="flex items-center gap-1.5"><Trophy size={14} /> الحافز الربع سنوي: {formatCurrency(number(row.quarterly_bonus))}</span>
                    <span className="flex items-center gap-1.5 text-rose-300"><TrendingDown size={14} /> الخصومات: {formatCurrency(number(row.deductions_total))}</span>
                  </div>
                  <div className="mt-3 border-t pt-3 text-lg font-black text-teal-200" style={{ borderColor: 'var(--dawaa-theme-border)' }}>الصافي: {formatCurrency(number(row.calculated_net_salary))}</div>
                </article>
              ))}
              {personalState.payroll === 'success' && !payrollRows.length ? <Empty>لسه مفيش كشف شهري معتمد لحسابك — هيظهر هنا أول ما يتم اعتماد دورة راتب فعلية.</Empty> : null}
            </div>
          </div>
        </section>
      ) : null}

      {tab === 'offers' ? (
        <section className="space-y-4">
          <div className="rounded-3xl border p-5" style={surface}>
            <div className="flex items-center gap-2"><Megaphone className="text-teal-300" /><h2 className="text-xl font-black text-white">العروض الحالية</h2></div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {offers.map((item) => (
                <article key={text(item.id)} className="rounded-2xl border p-4" style={surfaceSoft}>
                  <div className="font-black text-white">{text(item.title || item.name || 'عرض جديد')}</div>
                  <p className="mt-2 text-sm" style={mutedText}>{text(item.description || item.details)}</p>
                  <div className="mt-3 text-xs" style={mutedText}>حتى {text(item.end_date || 'إشعار آخر')}</div>
                </article>
              ))}
              {personalState.offers === 'success' && !offers.length ? <Empty>لا توجد عروض نشطة حاليًا.</Empty> : null}
            </div>
          </div>
          <div className="rounded-3xl border p-5" style={surface}>
            <div className="flex items-center gap-2"><Gift className="text-teal-300" /><h2 className="text-xl font-black text-white">الاستوريز والإعلانات</h2></div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {stories.map((item) => (
                <article key={text(item.id)} className="rounded-2xl border p-4" style={surfaceSoft}>
                  <div className="font-black text-white">{text(item.title || 'استوري جديدة')}</div>
                  <p className="mt-2 text-sm" style={mutedText}>{text(item.notes)}</p>
                  <div className="mt-3 text-xs" style={mutedText}>{formatDate(text(item.story_date || item.created_at))}</div>
                </article>
              ))}
              {personalState.offers === 'success' && !stories.length ? <Empty>لا توجد استوريز نشطة حاليًا.</Empty> : null}
            </div>
          </div>
        </section>
      ) : null}

      {tab === 'rules' ? (
        <section className="rounded-3xl border p-5" style={surface}>
          <div className="flex items-center gap-2"><ShieldCheck className="text-amber-300" /><h2 className="text-xl font-black text-white">قواعد الخدمة وتقييم المحادثة</h2></div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {SCORE_RULES.map(([title, score, detail]) => (
              <div key={title} className="rounded-2xl border p-4" style={surfaceSoft}>
                <div className="flex justify-between"><h3 className="font-black text-white">{title}</h3><span className="text-teal-300">{score} درجات</span></div>
                <p className="mt-2 text-sm" style={mutedText}>{detail}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 grid gap-3 lg:grid-cols-3">
            {WORK_RULE_GROUPS.map(([title, Icon, items]) => (
              <div key={title} className="rounded-2xl border p-4" style={surfaceSoft}>
                <div className="flex items-center gap-2 font-black text-white"><Icon className="text-teal-300" />{title}</div>
                <ul className="mt-3 space-y-2 text-sm" style={mutedText}>{items.map((item) => <li key={item}>• {item}</li>)}</ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* شريط تنقل سفلي ثابت — أسهل بكتير على الموبايل من صف 10 تابات أفقي. */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t px-1" style={{ background: 'var(--dawaa-theme-bg-soft)', borderColor: 'var(--dawaa-theme-border)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="mx-auto flex max-w-xl items-stretch justify-between">
          {PRIMARY_TABS.map(([key, label, Icon]) => (
            <button
              key={key} type="button" onClick={() => selectTab(key)}
              className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-black transition-colors ${tab === key ? 'text-teal-300' : 'text-slate-400'}`}
            >
              <span className="relative">
                <Icon size={20} />
                {key === 'notifications' && unread ? <span className="absolute -left-1.5 -top-1 h-2 w-2 rounded-full bg-red-400" /> : null}
              </span>
              {label}
            </button>
          ))}
          <button
            type="button" onClick={() => setMoreOpen(true)}
            className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-black transition-colors ${activeInMore ? 'text-teal-300' : 'text-slate-400'}`}
          >
            <span className="relative">
              <MoreHorizontal size={20} />
              {moreHasAttention ? <span className="absolute -left-1.5 -top-1 h-2 w-2 rounded-full bg-amber-400" /> : null}
            </span>
            المزيد
          </button>
        </div>
      </nav>

      {moreOpen ? (
        <div className="fixed inset-0 z-50 flex items-end" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="relative w-full rounded-t-3xl border-t p-4" onClick={(event) => event.stopPropagation()}
            style={{ background: 'var(--dawaa-theme-surface)', borderColor: 'var(--dawaa-theme-border)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
          >
            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-600" />
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-black text-white">كل الأقسام</h3>
              <button type="button" onClick={() => setMoreOpen(false)} className="rounded-full p-1.5" style={surfaceSoft}><X size={18} className="text-slate-300" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {MORE_TABS.map(([key, label, Icon]) => {
                const count = key === 'requirements' ? openAssignments.length : 0;
                const active = tab === key;
                return (
                  <button
                    key={key} type="button" onClick={() => { selectTab(key); setMoreOpen(false); }}
                    className="flex items-center gap-2 rounded-2xl border p-3 text-sm font-black"
                    style={active ? { borderColor: 'rgba(45,212,191,0.5)', background: 'rgba(45,212,191,0.1)', color: '#5eead4' } : { ...surfaceSoft, color: 'var(--dawaa-theme-text)' }}
                  >
                    <Icon size={18} className="text-teal-300" />
                    <span className="flex-1 text-right">{label}</span>
                    {count ? <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-300">{count}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
