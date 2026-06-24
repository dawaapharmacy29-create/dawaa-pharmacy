import { useSearchParams, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  getCustomerFullProfile,
  type CustomerFullProfile,
  formatCurrencyEGP,
  formatDateArabic,
} from '@/lib/customerProfileService';
import { buildCustomerTimeline } from '@/lib/customerTimeline';
import {
  addCustomerSpecialItem,
  deleteCustomerSpecialItem,
  fetchCustomerSpecialItems,
  type CustomerSpecialItem,
} from '@/lib/customers/customerSpecialItemsService';
import { safeRows } from '@/lib/safeSupabase';
import { normalizeBranchName } from '@/lib/branch';
import {
  ArrowRight,
  Phone,
  MessageCircle,
  RefreshCw,
  AlertCircle,
  ShoppingBag,
  TrendingUp,
  Calendar,
  Clock,
  Star,
  FileText,
  Users,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
/* recharts will be dynamically imported inside the component to reduce initial bundle size */

// ─── helpers ────────────────────────────────────────────────────────────────

function seg(segment: string | null | undefined) {
  const map: Record<string, { label: string; color: string }> = {
    'مهم جداً': {
      label: 'مهم جداً ⭐',
      color: 'bg-yellow-500/20 text-yellow-200 border-yellow-500/40',
    },
    مهم: { label: 'مهم', color: 'bg-teal-500/20 text-teal-200 border-teal-500/40' },
    متوسط: { label: 'متوسط', color: 'bg-blue-500/20 text-blue-200 border-blue-500/40' },
    عادي: { label: 'عادي', color: 'bg-slate-500/20 text-slate-300 border-slate-500/40' },
    جديد: { label: 'جديد 🆕', color: 'bg-purple-500/20 text-purple-200 border-purple-500/40' },
  };
  const s = segment ?? 'عادي';
  return map[s] ?? { label: s, color: 'bg-slate-500/20 text-slate-300 border-slate-500/40' };
}

function statusColor(status: string | null | undefined) {
  if (!status) return 'bg-slate-500/20 text-slate-300 border-slate-500/30';
  if (status.includes('نشط') || status.includes('active'))
    return 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40';
  if (status.includes('خطر') || status.includes('risk'))
    return 'bg-red-500/20 text-red-200 border-red-500/40';
  if (status.includes('توقف') || status.includes('stop'))
    return 'bg-orange-500/20 text-orange-200 border-orange-500/40';
  return 'bg-slate-500/20 text-slate-300 border-slate-500/30';
}

function timelineIcon(type: string) {
  if (type === 'invoice') return <ShoppingBag size={14} className="text-teal-300" />;
  if (type === 'followup') return <Users size={14} className="text-purple-300" />;
  if (type === 'request') return <FileText size={14} className="text-blue-300" />;
  return <MessageSquare size={14} className="text-slate-300" />;
}

function timelineColor(type: string) {
  if (type === 'invoice') return 'border-teal-500/50 bg-teal-500/10';
  if (type === 'followup') return 'border-purple-500/50 bg-purple-500/10';
  if (type === 'request') return 'border-blue-500/50 bg-blue-500/10';
  return 'border-slate-500/50 bg-slate-500/10';
}

// ─── subcomponents ───────────────────────────────────────────────────────────

function KpiCard({
  icon,
  label,
  value,
  sub,
  accent = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 flex flex-col gap-2 ${accent ? 'border-teal-500/50 bg-teal-500/10' : 'border-[var(--theme-border)] bg-[var(--theme-surface)]'}`}
    >
      <div className="flex items-center gap-2 text-xs font-bold text-[var(--theme-muted)]">
        {icon}
        <span>{label}</span>
      </div>
      <div
        className={`text-xl font-black num ${accent ? 'text-teal-300' : 'text-[var(--theme-heading)]'}`}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-[var(--theme-muted)] font-semibold">{sub}</div>}
    </div>
  );
}

function NoteBox({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-4">
      <div className="text-xs font-bold text-[var(--theme-muted)] mb-2">{label}</div>
      <div className="text-sm text-[var(--theme-heading)] leading-relaxed whitespace-pre-line">
        {value}
      </div>
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-amber-400/20 bg-slate-950/30 px-3 py-2">
      <div className="text-xs font-bold text-amber-200/80">{label}</div>
      <div className="mt-1 font-black text-white">{value}</div>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-right hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2 text-base font-black text-[var(--theme-heading)]">
          {icon}
          <span>{title}</span>
        </div>
        {open ? (
          <ChevronUp size={18} className="text-[var(--theme-muted)]" />
        ) : (
          <ChevronDown size={18} className="text-[var(--theme-muted)]" />
        )}
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
}

const ARABIC_MONTH: Record<string, string> = {
  '01': 'يناير',
  '02': 'فبراير',
  '03': 'مارس',
  '04': 'أبريل',
  '05': 'مايو',
  '06': 'يونيو',
  '07': 'يوليو',
  '08': 'أغسطس',
  '09': 'سبتمبر',
  '10': 'أكتوبر',
  '11': 'نوفمبر',
  '12': 'ديسمبر',
};
function arabicMonth(m: string) {
  const [, mm] = m.split('-');
  return ARABIC_MONTH[mm] ?? m;
}

function invoiceBranch(invoice: Record<string, unknown>) {
  return normalizeBranchName(String(invoice.branch ?? invoice.branch_name ?? invoice.store_branch ?? ''));
}

function invoiceAmount(invoice: Record<string, unknown>) {
  const amount = Number(invoice.amount ?? invoice.net_total ?? invoice.total_amount ?? invoice.total ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function branchAudit(
  registeredBranch: string,
  invoices: Array<Record<string, unknown>>
) {
  const registered = normalizeBranchName(registeredBranch);
  const latestInvoice = invoices.find((invoice) => invoiceBranch(invoice));
  const latestBranch = latestInvoice ? invoiceBranch(latestInvoice) : '';
  const branchStats = new Map<string, { count: number; value: number }>();

  invoices.forEach((invoice) => {
    const branch = invoiceBranch(invoice);
    if (!branch) return;
    const current = branchStats.get(branch) || { count: 0, value: 0 };
    current.count += 1;
    current.value += invoiceAmount(invoice);
    branchStats.set(branch, current);
  });

  const dominantByCount = [...branchStats.entries()].sort((a, b) => b[1].count - a[1].count)[0];
  const dominantByValue = [...branchStats.entries()].sort((a, b) => b[1].value - a[1].value)[0];
  const mismatch =
    Boolean(registered) &&
    ((latestBranch && latestBranch !== registered) ||
      (dominantByCount?.[0] && dominantByCount[0] !== registered) ||
      (dominantByValue?.[0] && dominantByValue[0] !== registered));

  return {
    registered,
    latestBranch,
    dominantByCount,
    dominantByValue,
    mismatch,
  };
}

// ─── main page ───────────────────────────────────────────────────────────────

export default function Customer360() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const customerCode = params.get('code') ?? undefined;
  const customerId = params.get('id') ?? undefined;
  const customerPhone = params.get('phone') ?? undefined;
  const customerName = params.get('name') ?? undefined;

  const [profile, setProfile] = useState<CustomerFullProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'timeline' | 'invoices' | 'followups'>('timeline');
  const [specialItemName, setSpecialItemName] = useState('');
  const [specialItemNotes, setSpecialItemNotes] = useState('');
  const [specialItems, setSpecialItems] = useState<CustomerSpecialItem[]>([]);
  const [specialItemsSource, setSpecialItemsSource] = useState<'supabase' | 'local'>('local');
  const [specialItemsWarning, setSpecialItemsWarning] = useState<string | null>(null);
  const [evaluationHistory, setEvaluationHistory] = useState<Array<Record<string, unknown>>>([]);
  const [evaluationWarning, setEvaluationWarning] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (forceRefresh = false) => {
      if (!customerCode && !customerId && !customerPhone && !customerName) {
        setError('لم يتم تحديد بيانات العميل.');
        setLoading(false);
        return;
      }
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      setLoading(true);
      setError(null);
      try {
        const data = await getCustomerFullProfile({
          customer_code: customerCode,
          customer_id: customerId,
          customer_phone: customerPhone,
          customer_name: customerName,
          signal: abortRef.current.signal,
          forceRefresh,
        });
        setProfile(data);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError(err instanceof Error ? err.message : 'حدث خطأ أثناء تحميل بيانات العميل');
        }
      } finally {
        setLoading(false);
      }
    },
    [customerCode, customerId, customerPhone, customerName]
  );

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  const [R, setR] = useState<any>(null);
  useEffect(() => {
    let mounted = true;
    import('recharts').then((m) => {
      if (mounted) setR(m);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const AreaChart = R?.AreaChart ?? ((props: any) => <div className="h-40 rounded-2xl bg-slate-100 animate-pulse" />);
  const Area = R?.Area ?? ((props: any) => null);
  const XAxis = R?.XAxis ?? ((props: any) => null);
  const YAxis = R?.YAxis ?? ((props: any) => null);
  const CartesianGrid = R?.CartesianGrid ?? ((props: any) => null);
  const Tooltip = R?.Tooltip ?? ((props: any) => null);
  const ResponsiveContainer = R?.ResponsiveContainer ?? (({ children }: any) => <div>{children}</div>);
  const BarChart = R?.BarChart ?? AreaChart;
  const Bar = R?.Bar ?? ((props: any) => null);

  // ── derived display values ──
  const m = profile?.metrics;
  const p = profile?.profile;
  const notes = profile?.notes;
  const displayName = m?.customer_name || (p?.name as string) || customerName || 'عميل';
  const displayCode = m?.customer_code || (p?.customer_code as string) || customerCode || '';
  const displayPhone2 = profile?.displayPhone || customerPhone || '';
  const displayBranch = normalizeBranchName(m?.branch || (p?.branch as string) || '');
  const segInfo = seg(m?.segment);
  const trend = profile?.monthlyPurchaseTrend ?? [];
  const analysis = profile?.purchaseAnalysis;

  const timeline = profile
    ? buildCustomerTimeline(
        { ...(p ?? {}), customer_code: displayCode, phone: displayPhone2 } as Record<
          string,
          unknown
        >,
        { invoices: [], followups: profile.latestFollowups as unknown as Record<string, unknown>[] }
      )
    : [];

  // combine timeline invoices with latestInvoices
  const allInvoices = profile?.latestInvoices ?? [];
  const allFollowups = profile?.latestFollowups ?? [];
  const branchReview = branchAudit(
    displayBranch,
    allInvoices as unknown as Array<Record<string, unknown>>
  );

  const specialIdentity = useMemo(
    () => ({
      customer_id: customerId || (p?.id as string | undefined) || null,
      customer_code: displayCode || null,
      customer_phone: displayPhone2 || null,
      customer_name: displayName || null,
    }),
    [customerId, displayCode, displayPhone2, displayName, p]
  );

  const loadSpecialItems = useCallback(async () => {
    const result = await fetchCustomerSpecialItems(specialIdentity);
    setSpecialItems(result.rows);
    setSpecialItemsSource(result.source);
    setSpecialItemsWarning(result.warning || null);
  }, [specialIdentity]);

  useEffect(() => {
    void loadSpecialItems();
  }, [loadSpecialItems]);

  const loadEvaluationHistory = useCallback(async () => {
    const identity = {
      code: displayCode,
      phone: displayPhone2,
      name: displayName,
    };
    if (!identity.code && !identity.phone && !identity.name) return;
    const result = await safeRows<Record<string, unknown>>(
      'conversation_sales_reviews',
      (query) => query.order('created_at', { ascending: false }),
      300
    );
    if (result.error) {
      setEvaluationWarning(`تعذر تحميل سجل تقييمات المحادثة: ${result.error}`);
      setEvaluationHistory([]);
      return;
    }
    setEvaluationWarning(null);
    setEvaluationHistory(
      result.rows
        .filter((row) => {
          const code = String(row.customer_code || '').trim();
          const phone = String(row.customer_phone || row.phone || '').trim();
          const name = String(row.customer_name || '').trim();
          return (
            (identity.code && code === identity.code) ||
            (identity.phone && phone === identity.phone) ||
            (identity.name && name === identity.name)
          );
        })
        .slice(0, 20)
    );
  }, [displayCode, displayName, displayPhone2]);

  useEffect(() => {
    void loadEvaluationHistory();
  }, [loadEvaluationHistory]);

  async function addSpecialItem() {
    const name = specialItemName.trim();
    if (!name) return;
    const result = await addCustomerSpecialItem(specialIdentity, {
      item_name: name,
      notes: specialItemNotes.trim() || null,
      importance_reason: specialItemNotes.trim() || null,
      repeats_monthly: false,
    });
    setSpecialItems((current) => [
      result.row,
      ...current.filter((row) => row.id !== result.row.id),
    ]);
    setSpecialItemsSource(result.source);
    setSpecialItemName('');
    setSpecialItemNotes('');
  }

  async function removeSpecialItem(id: string) {
    await deleteCustomerSpecialItem(specialIdentity, id);
    setSpecialItems((current) => current.filter((row) => row.id !== id));
  }

  // ── loading & error states ──
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" dir="rtl">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <div className="text-[var(--theme-muted)] font-bold">جارٍ تحميل بيانات العميل...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" dir="rtl">
        <div className="text-center space-y-4 max-w-sm">
          <AlertCircle size={48} className="text-red-400 mx-auto" />
          <div className="text-lg font-black text-red-300">{error}</div>
          <button type="button" onClick={() => void load(true)} className="btn-primary">
            إعادة المحاولة
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="btn-secondary block mx-auto mt-2"
          >
            رجوع
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" dir="rtl">
      <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
        {/* ── header ── */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex items-center gap-1 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 py-2 text-sm font-bold text-[var(--theme-muted)] hover:text-[var(--theme-heading)] transition-colors"
          >
            <ArrowRight size={16} />
            رجوع
          </button>
          <div className="text-sm text-[var(--theme-muted)] font-bold">ملف العميل الشامل</div>
        </div>

        {/* ── customer hero card ── */}
        <div className="rounded-3xl border border-[var(--theme-border)] bg-gradient-to-l from-teal-950/40 via-[var(--theme-card)] to-[var(--theme-card)] p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-teal-500/20 text-2xl font-black text-teal-200 border border-teal-500/30">
                {displayName[0] ?? 'ع'}
              </div>
              <div className="space-y-2">
                <div className="text-2xl font-black text-[var(--theme-heading)]">{displayName}</div>
                <div className="flex flex-wrap gap-2 text-sm font-bold text-[var(--theme-muted)]">
                  {displayCode && (
                    <span className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] px-2 py-0.5">
                      كود: {displayCode}
                    </span>
                  )}
                  {displayBranch && (
                    <span className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] px-2 py-0.5">
                      {displayBranch}
                    </span>
                  )}
                  {displayPhone2 && (
                    <span className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] px-2 py-0.5 dir-ltr">
                      {displayPhone2}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {m?.segment && (
                    <span
                      className={`rounded-full border px-3 py-1 text-xs font-black ${segInfo.color}`}
                    >
                      {segInfo.label}
                    </span>
                  )}
                  {m?.customer_status && (
                    <span
                      className={`rounded-full border px-3 py-1 text-xs font-black ${statusColor(m.customer_status)}`}
                    >
                      {m.customer_status}
                    </span>
                  )}
                  {m?.retention_status && m.retention_status !== m.customer_status && (
                    <span className="rounded-full border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 py-1 text-xs font-bold text-[var(--theme-muted)]">
                      {m.retention_status}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* quick actions */}
            <div className="flex flex-wrap gap-2">
              {displayPhone2 && (
                <a
                  href={`tel:${displayPhone2}`}
                  className="flex items-center gap-2 rounded-xl border border-teal-500/40 bg-teal-500/15 px-4 py-2 text-sm font-bold text-teal-200 hover:bg-teal-500/25 transition-colors"
                >
                  <Phone size={16} />
                  اتصال
                </a>
              )}
              {(notes?.whatsappPhone || displayPhone2) && (
                <a
                  href={`https://wa.me/${(notes?.whatsappPhone || displayPhone2).replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-4 py-2 text-sm font-bold text-emerald-200 hover:bg-emerald-500/25 transition-colors"
                >
                  <MessageCircle size={16} />
                  واتساب
                </a>
              )}
              <button
                type="button"
                onClick={() => void load(true)}
                className="flex items-center gap-2 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] px-4 py-2 text-sm font-bold text-[var(--theme-muted)] hover:text-[var(--theme-heading)] transition-colors"
              >
                <RefreshCw size={16} />
                تحديث
              </button>
            </div>
          </div>
        </div>

        {branchReview.mismatch && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle size={20} className="mt-1 shrink-0 text-amber-300" />
              <div className="space-y-2 text-sm leading-7">
                <div className="font-black text-amber-100">
                  تنبيه مراجعة فرع العميل — بدون أي تعديل تلقائي
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <InfoPill label="الفرع المسجل" value={branchReview.registered || 'غير محدد'} />
                  <InfoPill label="آخر فاتورة" value={branchReview.latestBranch || 'غير محدد'} />
                  <InfoPill
                    label="الأغلب بالعدد"
                    value={
                      branchReview.dominantByCount
                        ? `${branchReview.dominantByCount[0]} (${branchReview.dominantByCount[1].count})`
                        : 'غير محدد'
                    }
                  />
                  <InfoPill
                    label="الأغلب بالقيمة"
                    value={
                      branchReview.dominantByValue
                        ? `${branchReview.dominantByValue[0]} (${formatCurrencyEGP(branchReview.dominantByValue[1].value)})`
                        : 'غير محدد'
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── KPI strip ── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <KpiCard
            icon={<TrendingUp size={15} className="text-teal-400" />}
            label="إجمالي المشتريات"
            value={formatCurrencyEGP(m?.total_spent ?? m?.total_purchases ?? 0)}
            accent
          />
          <KpiCard
            icon={<ShoppingBag size={15} className="text-blue-400" />}
            label="عدد الفواتير"
            value={String(m?.invoices_count ?? 0)}
          />
          <KpiCard
            icon={<Star size={15} className="text-yellow-400" />}
            label="متوسط الفاتورة"
            value={formatCurrencyEGP(m?.avg_invoice ?? 0)}
          />
          <KpiCard
            icon={<Calendar size={15} className="text-purple-400" />}
            label="أشهر النشاط"
            value={String(m?.active_months ?? 0)}
            sub={m?.avg_monthly ? `${formatCurrencyEGP(m.avg_monthly)} / شهر` : undefined}
          />
          <KpiCard
            icon={<Clock size={15} className="text-orange-400" />}
            label="آخر شراء"
            value={m?.last_purchase ? formatDateArabic(m.last_purchase) : 'غير محدد'}
            sub={m?.first_purchase ? `أول شراء: ${formatDateArabic(m.first_purchase)}` : undefined}
          />
        </div>

        {/* ── purchase analysis ── */}
        {analysis && (
          <div className="grid grid-cols-3 gap-3 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
            <div className="text-center">
              <div className="text-xs font-bold text-[var(--theme-muted)] mb-1">الشهر الحالي</div>
              <div className="text-2xl font-black text-teal-300 num">
                {analysis.purchaseCountCurrentMonth}
              </div>
              <div className="text-xs text-[var(--theme-muted)]">فاتورة</div>
            </div>
            <div className="text-center border-x border-[var(--theme-border)]">
              <div className="text-xs font-bold text-[var(--theme-muted)] mb-1">الشهر الماضي</div>
              <div className="text-2xl font-black text-slate-300 num">
                {analysis.purchaseCountPreviousMonth}
              </div>
              <div className="text-xs text-[var(--theme-muted)]">فاتورة</div>
            </div>
            <div className="text-center">
              <div className="text-xs font-bold text-[var(--theme-muted)] mb-1">المتوسط الشهري</div>
              <div className="text-2xl font-black text-purple-300 num">
                {analysis.averageMonthlyPurchaseCount.toFixed(1)}
              </div>
              <div className="text-xs text-[var(--theme-muted)]">فاتورة</div>
            </div>
            {analysis.recommendation && (
              <div className="col-span-3 mt-2 rounded-xl border border-teal-500/20 bg-teal-500/8 px-4 py-2 text-sm font-bold text-teal-200">
                💡 {analysis.recommendation}
              </div>
            )}
          </div>
        )}

        {/* ── monthly trend chart ── */}
        {trend.length > 0 && (
          <Section
            title="مسار الشراء الشهري"
            icon={<TrendingUp size={18} className="text-teal-400" />}
          >
            <div className="h-56 mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="cg360" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis
                    dataKey="month"
                    tickFormatter={arabicMonth}
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(v: number) => v.toLocaleString('ar-EG')}
                    tick={{ fill: '#94a3b8', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    width={60}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#0f172a',
                      border: '1px solid rgba(20,184,166,0.3)',
                      borderRadius: 12,
                      color: '#e2e8f0',
                      fontFamily: 'Cairo, sans-serif',
                      direction: 'rtl',
                    }}
                    formatter={(val: number) => [formatCurrencyEGP(val), 'إجمالي الشراء']}
                    labelFormatter={arabicMonth}
                  />
                  <Area
                    type="monotone"
                    dataKey="netTotal"
                    stroke="#14b8a6"
                    strokeWidth={2.5}
                    fill="url(#cg360)"
                    dot={{ fill: '#14b8a6', r: 4, strokeWidth: 0 }}
                    activeDot={{ r: 6 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {/* invoice count bars */}
            <div className="h-28 mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(255,255,255,0.06)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="month"
                    tickFormatter={arabicMonth}
                    tick={{ fill: '#94a3b8', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{
                      background: '#0f172a',
                      border: '1px solid rgba(139,92,246,0.3)',
                      borderRadius: 12,
                      color: '#e2e8f0',
                      fontFamily: 'Cairo, sans-serif',
                      direction: 'rtl',
                    }}
                    formatter={(val: number) => [val, 'عدد الفواتير']}
                    labelFormatter={arabicMonth}
                  />
                  <Bar dataKey="invoicesCount" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Section>
        )}

        {/* ── timeline / invoices / followups tabs ── */}
        <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] overflow-hidden">
          <div className="flex border-b border-[var(--theme-border)]">
            {(['timeline', 'invoices', 'followups'] as const).map((tab) => {
              const labels = {
                timeline: 'السجل الزمني',
                invoices: `الفواتير (${allInvoices.length})`,
                followups: `المتابعات (${allFollowups.length})`,
              };
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-3 text-sm font-black transition-colors ${activeTab === tab ? 'bg-teal-500/15 text-teal-300 border-b-2 border-teal-500' : 'text-[var(--theme-muted)] hover:text-[var(--theme-heading)]'}`}
                >
                  {labels[tab]}
                </button>
              );
            })}
          </div>

          <div className="p-5">
            {/* timeline tab */}
            {activeTab === 'timeline' && (
              <div className="space-y-3">
                {timeline.length === 0 && allInvoices.length === 0 && allFollowups.length === 0 && (
                  <div className="text-center py-8 text-[var(--theme-muted)] font-bold">
                    لا توجد أحداث مسجلة
                  </div>
                )}
                {/* show latest invoices as timeline items if timeline is empty */}
                {(timeline.length > 0
                  ? timeline
                  : allInvoices.map((inv, i) => ({
                      id: `inv-${i}`,
                      type: 'invoice' as const,
                      title: `فاتورة ${inv.invoice_number ?? ''}`.trim(),
                      date: inv.invoice_date ?? null,
                      description: `${formatCurrencyEGP(inv.amount)} — ${inv.seller_name ?? 'غير محدد'}`,
                    }))
                )
                  .slice(0, 30)
                  .map((item) => (
                    <div
                      key={item.id}
                      className={`flex gap-3 rounded-xl border p-3 ${timelineColor(item.type)}`}
                    >
                      <div className="mt-0.5 shrink-0">{timelineIcon(item.type)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-sm text-[var(--theme-heading)]">
                          {item.title}
                        </div>
                        {item.description && (
                          <div className="text-xs text-[var(--theme-muted)] mt-0.5">
                            {item.description}
                          </div>
                        )}
                      </div>
                      {item.date && (
                        <div className="shrink-0 text-xs text-[var(--theme-muted)] font-bold num">
                          {formatDateArabic(item.date)}
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            )}

            {/* invoices tab */}
            {activeTab === 'invoices' && (
              <div className="space-y-2">
                {allInvoices.length === 0 && (
                  <div className="text-center py-8 text-[var(--theme-muted)] font-bold">
                    لا توجد فواتير
                  </div>
                )}
                {allInvoices.map((inv, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-3 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-3"
                  >
                    <div className="flex items-center gap-3">
                      <ShoppingBag size={16} className="text-teal-400 shrink-0" />
                      <div>
                        <div className="font-bold text-sm text-[var(--theme-heading)]">
                          فاتورة {inv.invoice_number ?? ''}
                        </div>
                        <div className="text-xs text-[var(--theme-muted)]">
                          {inv.seller_name ?? 'غير محدد'} — {normalizeBranchName(inv.branch ?? '')}
                        </div>
                      </div>
                    </div>
                    <div className="text-left shrink-0">
                      <div className="font-black text-teal-300 text-sm num">
                        {formatCurrencyEGP(inv.amount)}
                      </div>
                      {inv.invoice_date && (
                        <div className="text-xs text-[var(--theme-muted)] num">
                          {formatDateArabic(inv.invoice_date)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* followups tab */}
            {activeTab === 'followups' && (
              <div className="space-y-2">
                {allFollowups.length === 0 && (
                  <div className="text-center py-8 text-[var(--theme-muted)] font-bold">
                    لا توجد متابعات
                  </div>
                )}
                {allFollowups.map((fu) => (
                  <div
                    key={fu.id}
                    className="rounded-xl border border-purple-500/20 bg-purple-500/8 p-3 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Users size={14} className="text-purple-300" />
                        <span className="font-bold text-sm text-purple-200">
                          {fu.status ?? 'متابعة'}
                        </span>
                      </div>
                      <span className="text-xs text-[var(--theme-muted)] num">
                        {formatDateArabic(fu.followup_date ?? fu.created_at ?? '')}
                      </span>
                    </div>
                    {fu.responsible_name && (
                      <div className="text-xs text-[var(--theme-muted)]">
                        مسؤول: {fu.responsible_name}
                      </div>
                    )}
                    {fu.notes && (
                      <div className="text-sm text-[var(--theme-heading)]">{fu.notes}</div>
                    )}
                    {fu.followup_result && (
                      <div className="text-xs font-bold text-teal-300">
                        النتيجة: {fu.followup_result}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <Section
          title="سجل تقييمات المحادثة"
          icon={<ShieldCheck size={18} className="text-cyan-400" />}
          defaultOpen={false}
        >
          {evaluationWarning && (
            <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3 text-sm font-bold text-amber-100">
              {evaluationWarning}
            </div>
          )}
          {!evaluationWarning && evaluationHistory.length === 0 && (
            <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-4 text-center text-sm font-bold text-[var(--theme-muted)]">
              لا توجد تقييمات محادثة مرتبطة بهذا العميل في المصدر المتاح.
            </div>
          )}
          <div className="grid gap-2">
            {evaluationHistory.map((row, index) => {
              const score = Number(row.final_score ?? row.total_score ?? 0);
              return (
                <div
                  key={String(row.id || index)}
                  className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-black text-[var(--theme-heading)]">
                      {String(row.staff_name || row.doctor_name || 'موظف غير محدد')}
                    </div>
                    <span
                      className={
                        score >= 90
                          ? 'badge-success'
                          : score >= 70
                            ? 'badge-warning'
                            : 'badge-danger'
                      }
                    >
                      {Number.isFinite(score) ? score : 0}/100
                    </span>
                  </div>
                  <div className="mt-2 text-xs font-bold text-[var(--theme-muted)]">
                    {formatDateArabic(String(row.conversation_date || row.created_at || ''))}
                  </div>
                  {(row.main_negative_reason || row.training_recommendation || row.reviewer_notes) && (
                    <div className="mt-2 text-sm leading-7 text-[var(--theme-heading)]">
                      {String(row.main_negative_reason || row.training_recommendation || row.reviewer_notes)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>

        {/* ── notes section ── */}
        {notes &&
          (notes.customerNotes ||
            notes.whatsappNotes ||
            notes.serviceNotes ||
            notes.teamNotes ||
            notes.handlingNotes ||
            notes.notes ||
            notes.address) && (
            <Section
              title="الملاحظات والمعلومات"
              icon={<MessageSquare size={18} className="text-blue-400" />}
              defaultOpen={false}
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <NoteBox label="ملاحظات العميل" value={notes.customerNotes} />
                <NoteBox label="ملاحظات واتساب" value={notes.whatsappNotes} />
                <NoteBox label="ملاحظات الخدمة" value={notes.serviceNotes} />
                <NoteBox label="ملاحظات الفريق" value={notes.teamNotes} />
                <NoteBox label="ملاحظات التعامل" value={notes.handlingNotes} />
                <NoteBox label="ملاحظات عامة" value={notes.notes} />
                {notes.address && (
                  <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-4 sm:col-span-2">
                    <div className="text-xs font-bold text-[var(--theme-muted)] mb-2">العنوان</div>
                    <div className="text-sm text-[var(--theme-heading)]">{notes.address}</div>
                  </div>
                )}
                {(notes.phoneAlt || notes.whatsappPhone) && (
                  <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-4">
                    <div className="text-xs font-bold text-[var(--theme-muted)] mb-2">
                      أرقام إضافية
                    </div>
                    {notes.phoneAlt && (
                      <div className="text-sm font-bold text-[var(--theme-heading)] dir-ltr">
                        {notes.phoneAlt}
                      </div>
                    )}
                    {notes.whatsappPhone && (
                      <div className="text-sm text-emerald-300 dir-ltr">
                        {notes.whatsappPhone} (واتساب)
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Section>
          )}

        <Section
          title="أصناف وملاحظات مميزة للعميل"
          icon={<Star size={18} className="text-yellow-400" />}
          defaultOpen={false}
        >
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
            <input
              value={specialItemName}
              onChange={(e) => setSpecialItemName(e.target.value)}
              placeholder="اسم الصنف المميز للعميل"
              className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] px-4 py-3 text-sm font-bold text-[var(--theme-heading)] outline-none"
            />
            <input
              value={specialItemNotes}
              onChange={(e) => setSpecialItemNotes(e.target.value)}
              placeholder="سبب الأهمية أو ملاحظة"
              className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] px-4 py-3 text-sm font-bold text-[var(--theme-heading)] outline-none"
            />
            <button
              type="button"
              onClick={addSpecialItem}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-teal-600 px-4 py-3 text-sm font-black text-white"
            >
              <Plus size={16} /> إضافة
            </button>
          </div>
          <div className="mt-4 grid gap-2">
            {specialItems.length === 0 && (
              <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-4 text-center text-sm font-bold text-[var(--theme-muted)]">
                لا توجد أصناف مميزة مسجلة لهذا العميل بعد.
              </div>
            )}
            {specialItems.map((item) => (
              <div
                key={item.id}
                className="flex items-start justify-between gap-3 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-4"
              >
                <div>
                  <div className="font-black text-[var(--theme-heading)]">{item.item_name}</div>
                  {(item.importance_reason || item.notes) && (
                    <div className="mt-1 text-sm text-[var(--theme-muted)]">
                      {item.importance_reason || item.notes}
                    </div>
                  )}
                  <div className="mt-1 text-[11px] font-bold text-[var(--theme-muted)]">
                    تمت الإضافة: {formatDateArabic(item.created_at)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void removeSpecialItem(item.id)}
                  className="rounded-xl border border-red-500/30 p-2 text-red-300"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs font-bold text-amber-200">
            مصدر الأصناف المميزة:{' '}
            {specialItemsSource === 'supabase' ? 'Supabase' : 'تخزين محلي مؤقت'}
            {specialItemsWarning ? ` — ${specialItemsWarning}` : ''}
          </div>
        </Section>

        {/* ── recommendations ── */}
        {(profile?.recommendations ?? []).length > 0 && (
          <Section
            title="التوصيات والتنبيهات"
            icon={<Lightbulb size={18} className="text-yellow-400" />}
            defaultOpen={false}
          >
            <ul className="space-y-2">
              {profile!.recommendations.map((rec, i) => (
                <li
                  key={i}
                  className="flex gap-3 rounded-xl border border-yellow-500/20 bg-yellow-500/8 px-4 py-3 text-sm font-bold text-yellow-200"
                >
                  <Lightbulb size={16} className="shrink-0 mt-0.5 text-yellow-400" />
                  <span>{rec}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* ── data health footer ── */}
        {profile?.dataHealth && (
          <div className="flex flex-wrap gap-2 text-xs font-bold text-[var(--theme-muted)]">
            {Object.entries(profile.dataHealth).map(([k, v]) => (
              <span
                key={k}
                className={`rounded-full border px-2 py-0.5 ${v ? 'border-teal-500/30 text-teal-400' : 'border-red-500/30 text-red-400'}`}
              >
                {k === 'hasMetrics'
                  ? 'المقاييس'
                  : k === 'hasCustomerRecord'
                    ? 'السجل'
                    : k === 'hasValidPhone'
                      ? 'هاتف صحيح'
                      : k === 'isPseudoCustomer'
                        ? 'عميل وهمي'
                        : k === 'invoicesLoaded'
                          ? 'الفواتير'
                          : k === 'followupsLoaded'
                            ? 'المتابعات'
                            : k === 'missingCustomerCode'
                              ? 'بدون كود'
                              : k}
                : {v ? '✓' : '✗'}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
