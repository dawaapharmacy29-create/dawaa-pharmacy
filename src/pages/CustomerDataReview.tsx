import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Database, Loader2, RefreshCw, Search, ShieldCheck, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import {
  decideCustomerReview,
  getCustomerReviews,
  type CustomerReviewQueueRow,
  type ReviewDecision,
} from '@/lib/customers/customerDataFoundationService';

type Filter = 'all' | 'registered_branch_conflict' | 'cross_branch_single_purchase';

const issueLabels: Record<string, string> = {
  registered_branch_conflict: 'تعارض الفرع المسجل',
  cross_branch_single_purchase: 'تعامل عابر مع فرع آخر',
};

const severityLabels: Record<string, string> = {
  critical: 'حرج',
  high: 'مرتفع',
  medium: 'متوسط',
  low: 'منخفض',
};

function text(value: unknown, fallback = '—') {
  const result = value == null ? '' : String(value).trim();
  return result || fallback;
}

function numeric(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: unknown) {
  return numeric(value).toLocaleString('ar-EG', { maximumFractionDigits: 2 });
}

function formatDate(value: unknown) {
  if (!value) return '—';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? text(value) : date.toLocaleDateString('ar-EG');
}

function reviewerName(user: ReturnType<typeof useAuth>['user']) {
  return text(user?.name || user?.username || user?.email, 'مستخدم التطبيق');
}

function canReview(role?: string | null) {
  return ['admin', 'general_manager', 'branches_manager', 'customer_service_manager'].includes(String(role || '').toLowerCase());
}

function StatCard({ title, value, icon }: { title: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-black text-slate-900">{value.toLocaleString('ar-EG')}</p>
        </div>
        <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">{icon}</div>
      </div>
    </div>
  );
}

export default function CustomerDataReview() {
  const { user } = useAuth();
  const [rows, setRows] = useState<CustomerReviewQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [savingId, setSavingId] = useState<string | null>(null);
  const reviewerAllowed = canReview(user?.role);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getCustomerReviews({ status: 'pending', limit: 1000 });
      setRows(data);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'تعذر تحميل قائمة المراجعة';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter !== 'all' && row.issue_type !== filter) return false;
      if (!query) return true;
      const current = row.current_value || {};
      const suggested = row.suggested_value || {};
      return [row.customer_code, current.customer_name, current.registered_branch, suggested.suggested_branch]
        .map((value) => text(value, '').toLowerCase())
        .some((value) => value.includes(query));
    });
  }, [filter, rows, search]);

  const stats = useMemo(() => ({
    total: rows.length,
    conflicts: rows.filter((row) => row.issue_type === 'registered_branch_conflict').length,
    transient: rows.filter((row) => row.issue_type === 'cross_branch_single_purchase').length,
    high: rows.filter((row) => row.severity === 'high' || row.severity === 'critical').length,
  }), [rows]);

  const decide = async (row: CustomerReviewQueueRow, decision: ReviewDecision) => {
    if (!reviewerAllowed) {
      toast.error('هذه العملية متاحة للإدارة ومديري الفروع وخدمة العملاء فقط');
      return;
    }
    const action = decision === 'approve' ? 'اعتماد الاقتراح' : 'رفض الاقتراح';
    if (!window.confirm(`${action} للعميل ${text(row.customer_code)}؟`)) return;
    setSavingId(row.id);
    try {
      await decideCustomerReview({
        reviewId: row.id,
        decision,
        reviewer: reviewerName(user),
        note: decision === 'approve' ? 'تم الاعتماد من شاشة مراجعة بيانات العملاء' : 'تم الرفض من شاشة مراجعة بيانات العملاء',
      });
      setRows((current) => current.filter((item) => item.id !== row.id));
      toast.success(decision === 'approve' ? 'تم اعتماد التصحيح وتسجيله' : 'تم رفض الاقتراح وتسجيل القرار');
    } catch (decisionError) {
      toast.error(decisionError instanceof Error ? decisionError.message : 'تعذر حفظ القرار');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div dir="rtl" className="min-h-screen bg-slate-50 p-4 text-slate-900 md:p-6">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-teal-50 p-3 text-teal-700"><Database size={26} /></div>
                <div>
                  <h1 className="text-2xl font-black">مراجعة جودة بيانات العملاء</h1>
                  <p className="mt-1 text-sm text-slate-500">مراجعة التعارضات بدون تعديل صامت، مع تسجيل كل قرار في سجل التغييرات.</p>
                </div>
              </div>
            </div>
            <button onClick={() => void load()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw size={18} className={loading ? 'animate-spin' : ''} /> تحديث البيانات
            </button>
          </div>
          {!reviewerAllowed && (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
              يمكنك مشاهدة الحالات، لكن اعتماد أو رفض التصحيحات متاح للإدارة المختصة فقط.
            </div>
          )}
        </header>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard title="إجمالي المراجعات المعلقة" value={stats.total} icon={<Clock3 size={22} />} />
          <StatCard title="تعارضات حقيقية" value={stats.conflicts} icon={<AlertTriangle size={22} />} />
          <StatCard title="تعاملات عابرة" value={stats.transient} icon={<ShieldCheck size={22} />} />
          <StatCard title="أولوية مرتفعة" value={stats.high} icon={<CheckCircle2 size={22} />} />
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row">
            <label className="relative flex-1">
              <Search size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث بالكود أو الاسم أو الفرع" className="w-full rounded-2xl border border-slate-200 py-3 pr-11 pl-4 text-sm outline-none focus:border-teal-500" />
            </label>
            <select value={filter} onChange={(event) => setFilter(event.target.value as Filter)} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-teal-500">
              <option value="all">كل الحالات</option>
              <option value="registered_branch_conflict">تعارضات الفرع</option>
              <option value="cross_branch_single_purchase">تعامل عابر</option>
            </select>
          </div>
        </section>

        {error && <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-sm font-bold text-red-800">تعذر تحميل البيانات: {error}</div>}

        {loading ? (
          <div className="flex min-h-64 items-center justify-center rounded-3xl border border-slate-200 bg-white"><Loader2 className="animate-spin text-teal-600" size={34} /></div>
        ) : filteredRows.length === 0 ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-12 text-center"><CheckCircle2 className="mx-auto text-emerald-600" size={42} /><h2 className="mt-4 text-xl font-black">لا توجد حالات مطابقة</h2></div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {filteredRows.map((row) => {
              const current = row.current_value || {};
              const suggested = row.suggested_value || {};
              const isTransient = row.issue_type === 'cross_branch_single_purchase';
              return (
                <article key={row.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold text-slate-500">كود العميل: {text(row.customer_code)}</p>
                      <h2 className="mt-1 text-lg font-black">{text(current.customer_name, 'عميل بدون اسم')}</h2>
                    </div>
                    <div className="flex gap-2">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black">{issueLabels[row.issue_type] || row.issue_type}</span>
                      <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-800">{severityLabels[row.severity] || row.severity}</span>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold text-slate-500">الفرع المسجل</p><p className="mt-1 font-black">{text(current.registered_branch)}</p></div>
                    <div className="rounded-2xl bg-teal-50 p-4"><p className="text-xs font-bold text-teal-700">الفرع المقترح</p><p className="mt-1 font-black text-teal-900">{text(suggested.suggested_branch)}</p></div>
                    <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold text-slate-500">فواتير شكري</p><p className="mt-1 font-black">{numeric(current.shokry_invoices).toLocaleString('ar-EG')} — {formatMoney(current.shokry_sales)} ج</p></div>
                    <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold text-slate-500">فواتير الشامي</p><p className="mt-1 font-black">{numeric(current.shamy_invoices).toLocaleString('ar-EG')} — {formatMoney(current.shamy_sales)} ج</p></div>
                    <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold text-slate-500">نسبة الثقة</p><p className="mt-1 font-black">{numeric(suggested.confidence_percent).toLocaleString('ar-EG')}%</p></div>
                    <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold text-slate-500">آخر شراء</p><p className="mt-1 font-black">{formatDate(current.last_purchase)}</p></div>
                  </div>

                  <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                    {!isTransient && (
                      <button onClick={() => void decide(row, 'approve')} disabled={!reviewerAllowed || savingId === row.id} className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white hover:bg-emerald-500 disabled:opacity-50">
                        {savingId === row.id ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />} اعتماد الفرع المقترح
                      </button>
                    )}
                    <button onClick={() => void decide(row, 'reject')} disabled={!reviewerAllowed || savingId === row.id} className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border border-red-200 px-4 py-3 text-sm font-black text-red-700 hover:bg-red-50 disabled:opacity-50">
                      <XCircle size={18} /> {isTransient ? 'تأكيد الاحتفاظ بالفرع الحالي' : 'رفض الاقتراح'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
