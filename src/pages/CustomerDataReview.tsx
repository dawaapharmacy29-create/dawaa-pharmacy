import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { normalizeBranchName } from '@/lib/branch';
import { exportToExcel } from '@/lib/exportExcel';
import {
  decideCustomerReview,
  getCustomerReviews,
  type CustomerReviewQueueRow,
  type ReviewDecision,
} from '@/lib/customers/customerDataFoundationService';

type Filter =
  | 'all'
  | 'followup_data_issue'
  | 'registered_branch_conflict'
  | 'cross_branch_single_purchase';

type FollowupSnapshot = {
  id: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_code: string | null;
  customer_phone: string | null;
  phone: string | null;
  branch: string | null;
  request_type: string | null;
  created_at: string | null;
};

type CustomerProfile = {
  id: string;
  customer_code: string | null;
  name: string | null;
  phone: string | null;
  mobile: string | null;
  whatsapp: string | null;
  branch: string | null;
  address: string | null;
  area: string | null;
  updated_at: string | null;
};

type FollowupDataIssue = FollowupSnapshot & {
  profile_id: string | null;
  current_name: string | null;
  current_code: string | null;
  current_phone: string | null;
  current_branch: string | null;
  current_address: string | null;
  current_area: string | null;
  missing_fields: string[];
};

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
  return ['admin', 'general_manager', 'branches_manager', 'customer_service_manager'].includes(
    String(role || '').toLowerCase()
  );
}

function normalized(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizedPhone(value: unknown) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('20') && digits.length >= 12) return digits.slice(2);
  return digits;
}

function bestPhone(profile?: CustomerProfile | null) {
  return profile?.phone || profile?.mobile || profile?.whatsapp || null;
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function fetchMatchingCustomers(followups: FollowupSnapshot[]) {
  const ids = unique(followups.map((row) => row.customer_id)).filter(isUuid);
  const codes = unique(followups.map((row) => row.customer_code));
  const phones = unique(
    followups.flatMap((row) => [row.customer_phone, row.phone]).map(normalizedPhone)
  );
  const select = 'id,customer_code,name,phone,mobile,whatsapp,branch,address,area,updated_at';
  const queries: PromiseLike<{ data: unknown; error: { message?: string } | null }>[] = [];
  if (ids.length) queries.push(supabase.from('customers').select(select).in('id', ids));
  if (codes.length) queries.push(supabase.from('customers').select(select).in('customer_code', codes));
  if (phones.length) {
    queries.push(supabase.from('customers').select(select).in('phone', phones));
    queries.push(supabase.from('customers').select(select).in('mobile', phones));
    queries.push(supabase.from('customers').select(select).in('whatsapp', phones));
  }
  if (!queries.length) return [] as CustomerProfile[];
  const settled = await Promise.all(queries);
  const profiles = new Map<string, CustomerProfile>();
  for (const result of settled) {
    if (result.error) throw new Error(result.error.message || 'تعذر مطابقة بيانات العملاء');
    for (const row of (result.data || []) as CustomerProfile[]) profiles.set(row.id, row);
  }
  return [...profiles.values()];
}

function resolveFollowupIssues(followups: FollowupSnapshot[], profiles: CustomerProfile[]) {
  const byId = new Map(profiles.map((row) => [row.id, row]));
  const byCode = new Map(
    profiles.filter((row) => row.customer_code).map((row) => [normalized(row.customer_code), row])
  );
  const byPhone = new Map<string, CustomerProfile>();
  profiles.forEach((row) => {
    [row.phone, row.mobile, row.whatsapp].forEach((phone) => {
      const key = normalizedPhone(phone);
      if (key) byPhone.set(key, row);
    });
  });

  return followups.flatMap((row): FollowupDataIssue[] => {
    const profile =
      (row.customer_id ? byId.get(row.customer_id) : undefined) ||
      (row.customer_code ? byCode.get(normalized(row.customer_code)) : undefined) ||
      byPhone.get(normalizedPhone(row.customer_phone || row.phone));
    const currentCode = profile?.customer_code || row.customer_code;
    const currentPhone = bestPhone(profile) || row.customer_phone || row.phone;
    const currentBranch = profile?.branch || row.branch;
    const missing = [
      !currentCode ? 'الكود غير موجود' : '',
      !currentPhone ? 'الهاتف غير موجود' : '',
      !currentBranch ? 'الفرع غير محدد' : '',
    ].filter(Boolean);
    if (!missing.length) return [];
    return [{
      ...row,
      profile_id: profile?.id || null,
      current_name: profile?.name || row.customer_name,
      current_code: currentCode || null,
      current_phone: currentPhone || null,
      current_branch: currentBranch || null,
      current_address: profile?.address || null,
      current_area: profile?.area || null,
      missing_fields: missing,
    }];
  });
}

function StatCard({ title, value, icon }: { title: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div><p className="text-xs font-bold text-slate-500">{title}</p><p className="mt-2 text-3xl font-black text-slate-900">{value.toLocaleString('ar-EG')}</p></div>
        <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">{icon}</div>
      </div>
    </div>
  );
}

export default function CustomerDataReview() {
  const { user } = useAuth();
  const [rows, setRows] = useState<CustomerReviewQueueRow[]>([]);
  const [followupIssues, setFollowupIssues] = useState<FollowupDataIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [savingId, setSavingId] = useState<string | null>(null);
  const reviewerAllowed = canReview(user?.role);
  const queryBranch = normalizeBranchName(new URLSearchParams(window.location.search).get('branch') || '');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      let issuesQuery = supabase
        .from('daily_followups')
        .select('id,customer_id,customer_name,customer_code,customer_phone,phone,branch,request_type,created_at')
        .eq('is_hidden', false)
        .order('created_at', { ascending: false })
        .limit(1000);
      if (queryBranch) issuesQuery = issuesQuery.eq('branch', queryBranch);
      const [reviewData, issuesResult] = await Promise.all([
        getCustomerReviews({ status: 'pending', limit: 1000 }),
        issuesQuery,
      ]);
      if (issuesResult.error) throw new Error(issuesResult.error.message);
      const snapshots = (issuesResult.data || []) as FollowupSnapshot[];
      const incompleteSnapshots = snapshots.filter(
        (row) => !row.customer_code || !(row.customer_phone || row.phone) || !row.branch
      );
      const profiles = await fetchMatchingCustomers(incompleteSnapshots);
      setRows(reviewData);
      setFollowupIssues(resolveFollowupIssues(incompleteSnapshots, profiles));
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'تعذر تحميل قائمة المراجعة';
      setError(message);
      if (!silent) toast.error(message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [queryBranch]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => void load(true);
    window.addEventListener('focus', refresh);
    window.addEventListener('customer-data-changed', refresh);
    window.addEventListener('customer-service-followups-changed', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('customer-data-changed', refresh);
      window.removeEventListener('customer-service-followups-changed', refresh);
    };
  }, [load]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter === 'followup_data_issue') return false;
      if (filter !== 'all' && row.issue_type !== filter) return false;
      if (!query) return true;
      const current = row.current_value || {};
      const suggested = row.suggested_value || {};
      return [row.customer_code, current.customer_name, current.registered_branch, suggested.suggested_branch]
        .map((value) => text(value, '').toLowerCase()).some((value) => value.includes(query));
    });
  }, [filter, rows, search]);

  const filteredFollowupIssues = useMemo(() => {
    const query = search.trim().toLowerCase();
    return followupIssues.filter((row) => {
      if (filter !== 'all' && filter !== 'followup_data_issue') return false;
      if (!query) return true;
      return `${row.current_name || ''} ${row.current_code || ''} ${row.current_phone || ''} ${row.current_branch || ''} ${row.missing_fields.join(' ')}`.toLowerCase().includes(query);
    });
  }, [filter, followupIssues, search]);

  const stats = useMemo(() => ({
    total: rows.length + followupIssues.length,
    conflicts: rows.filter((row) => row.issue_type === 'registered_branch_conflict').length,
    transient: rows.filter((row) => row.issue_type === 'cross_branch_single_purchase').length,
    high: rows.filter((row) => row.severity === 'high' || row.severity === 'critical').length + followupIssues.length,
  }), [followupIssues, rows]);

  const decide = async (row: CustomerReviewQueueRow, decision: ReviewDecision) => {
    if (!reviewerAllowed) return toast.error('هذه العملية متاحة للإدارة ومديري الفروع وخدمة العملاء فقط');
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
      toast.success(decision === 'approve' ? 'تم اعتماد التصحيح واختفت الحالة من القائمة' : 'تم رفض الاقتراح وتسجيل القرار');
    } catch (decisionError) {
      toast.error(decisionError instanceof Error ? decisionError.message : 'تعذر حفظ القرار');
    } finally { setSavingId(null); }
  };

  const exportReview = async () => {
    const exportRows = [
      ...filteredFollowupIssues.map((row) => ({
        'نوع الحالة': 'بيانات متابعة ناقصة',
        'رقم المتابعة': row.id,
        'معرف ملف العميل': row.profile_id || row.customer_id || '',
        'اسم العميل الحالي': row.current_name || '',
        'كود العميل الحالي': row.current_code || '',
        'هاتف العميل الحالي': row.current_phone || '',
        'الفرع الحالي': row.current_branch || '',
        'العنوان الحالي': row.current_address || '',
        'المنطقة الحالية': row.current_area || '',
        'البيانات الناقصة': row.missing_fields.join('، '),
        'الكود داخل المتابعة': row.customer_code || '',
        'الهاتف داخل المتابعة': row.customer_phone || row.phone || '',
        'الفرع داخل المتابعة': row.branch || '',
        'تاريخ إنشاء المتابعة': row.created_at || '',
        'الكود المصحح': '',
        'الهاتف المصحح': '',
        'الفرع المصحح': '',
        'العنوان المصحح': '',
        'ملاحظات التصحيح': '',
      })),
      ...filteredRows.map((row) => {
        const current = row.current_value || {};
        const suggested = row.suggested_value || {};
        return {
          'نوع الحالة': issueLabels[row.issue_type] || row.issue_type,
          'رقم المتابعة': '',
          'معرف ملف العميل': '',
          'اسم العميل الحالي': text(current.customer_name, ''),
          'كود العميل الحالي': row.customer_code || '',
          'هاتف العميل الحالي': '',
          'الفرع الحالي': text(current.registered_branch, ''),
          'العنوان الحالي': '',
          'المنطقة الحالية': '',
          'البيانات الناقصة': '',
          'الكود داخل المتابعة': '',
          'الهاتف داخل المتابعة': '',
          'الفرع داخل المتابعة': '',
          'تاريخ إنشاء المتابعة': '',
          'الفرع المقترح': text(suggested.suggested_branch, ''),
          'نسبة الثقة': numeric(suggested.confidence_percent),
          'الكود المصحح': '',
          'الهاتف المصحح': '',
          'الفرع المصحح': '',
          'العنوان المصحح': '',
          'ملاحظات التصحيح': '',
        };
      }),
    ];
    if (!exportRows.length) return toast.info('لا توجد حالات حالية للتصدير');
    setExporting(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await exportToExcel(exportRows, `مراجعة_بيانات_العملاء_${queryBranch || 'كل_الفروع'}_${today}`, 'حالات تحتاج إصلاح');
      toast.success(`تم تصدير ${exportRows.length} حالة إلى Excel`);
    } catch (exportError) {
      toast.error(exportError instanceof Error ? exportError.message : 'تعذر تصدير الملف');
    } finally { setExporting(false); }
  };

  return (
    <div dir="rtl" className="min-h-screen bg-slate-50 p-4 text-slate-900 md:p-6">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-teal-50 p-3 text-teal-700"><Database size={26} /></div>
              <div><h1 className="text-2xl font-black">مراجعة جودة بيانات العملاء</h1><p className="mt-1 text-sm text-slate-500">تعرض النواقص الحالية بعد مطابقتها بملف العميل؛ العميل الذي يتم إصلاحه يختفي تلقائيًا بعد التحديث.</p></div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button onClick={() => void exportReview()} disabled={loading || exporting} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white hover:bg-emerald-500 disabled:opacity-50">
                {exporting ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />} تصدير Excel
              </button>
              <button onClick={() => void load()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black hover:bg-slate-50 disabled:opacity-50"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /> تحديث ومطابقة</button>
            </div>
          </div>
          <div className="mt-4 rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-bold text-teal-900"><FileSpreadsheet className="ml-2 inline" size={17} /> ملف Excel يحتوي خانات فارغة للكود والهاتف والفرع والعنوان المصحح، ليستخدم في دورة تنظيف دورية.</div>
          {!reviewerAllowed && <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">يمكنك مشاهدة وتصدير الحالات، لكن اعتماد أو رفض التصحيحات متاح للإدارة المختصة فقط.</div>}
        </header>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard title="إجمالي الحالات الحالية" value={stats.total} icon={<Clock3 size={22} />} />
          <StatCard title="تعارضات حقيقية" value={stats.conflicts} icon={<AlertTriangle size={22} />} />
          <StatCard title="تعاملات عابرة" value={stats.transient} icon={<ShieldCheck size={22} />} />
          <StatCard title="أولوية مرتفعة" value={stats.high} icon={<CheckCircle2 size={22} />} />
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row">
            <label className="relative flex-1"><Search size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث بالكود أو الاسم أو الهاتف أو الفرع" className="w-full rounded-2xl border border-slate-200 py-3 pr-11 pl-4 text-sm outline-none focus:border-teal-500" /></label>
            <select value={filter} onChange={(event) => setFilter(event.target.value as Filter)} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-teal-500"><option value="all">كل الحالات</option><option value="followup_data_issue">بيانات متابعة ناقصة</option><option value="registered_branch_conflict">تعارضات الفرع</option><option value="cross_branch_single_purchase">تعامل عابر</option></select>
          </div>
        </section>

        {error && <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-sm font-bold text-red-800">تعذر تحميل البيانات: {error}</div>}
        {loading ? <div className="flex min-h-64 items-center justify-center rounded-3xl border border-slate-200 bg-white"><Loader2 className="animate-spin text-teal-600" size={34} /></div> : filteredRows.length === 0 && filteredFollowupIssues.length === 0 ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-12 text-center"><CheckCircle2 className="mx-auto text-emerald-600" size={42} /><h2 className="mt-4 text-xl font-black">لا توجد حالات تحتاج إصلاح</h2><p className="mt-2 text-sm text-slate-500">تمت مطابقة المتابعات مع ملفات العملاء الحالية.</p></div>
        ) : <div className="space-y-6">
          {filteredFollowupIssues.length > 0 && <section><div className="mb-3"><h2 className="text-xl font-black">بيانات ناقصة داخل المتابعات</h2><p className="text-sm font-semibold text-slate-500">لا تظهر هنا إلا الحالات التي ما زالت ناقصة بعد الرجوع إلى ملف العميل الحالي.</p></div><div className="grid gap-4 xl:grid-cols-2">{filteredFollowupIssues.map((row) => (
            <article key={row.id} className="rounded-3xl border border-amber-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3"><div><h3 className="text-lg font-black">{text(row.current_name, 'عميل بدون اسم')}</h3><p className="mt-1 text-xs font-bold text-slate-500">{text(row.current_code, 'بدون كود')} · {text(row.current_phone, 'بدون هاتف')} · {text(row.current_branch, 'بدون فرع')}</p></div><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-800">تحتاج استكمال</span></div>
              <div className="mt-4 flex flex-wrap gap-2">{row.missing_fields.map((issue) => <span key={issue} className="rounded-xl bg-red-50 px-3 py-2 text-xs font-black text-red-700">{issue}</span>)}</div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <a className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-xs font-black text-white" href={row.profile_id ? `/customers/${encodeURIComponent(row.profile_id)}` : `/customer-360?code=${encodeURIComponent(row.current_code || '')}&phone=${encodeURIComponent(row.current_phone || '')}&name=${encodeURIComponent(row.current_name || '')}`}><ExternalLink size={15} /> فتح ملف العميل وإصلاحه</a>
                <a className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-xs font-black" href={`/customer-service?branch=${encodeURIComponent(row.current_branch || queryBranch)}&followupId=${encodeURIComponent(row.id)}`}>فتح المتابعة</a>
              </div>
            </article>
          ))}</div></section>}
          {filteredRows.length > 0 && <div className="grid gap-4 xl:grid-cols-2">{filteredRows.map((row) => { const current = row.current_value || {}; const suggested = row.suggested_value || {}; const isTransient = row.issue_type === 'cross_branch_single_purchase'; return (
            <article key={row.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold text-slate-500">كود العميل: {text(row.customer_code)}</p><h2 className="mt-1 text-lg font-black">{text(current.customer_name, 'عميل بدون اسم')}</h2></div><div className="flex gap-2"><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black">{issueLabels[row.issue_type] || row.issue_type}</span><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-800">{severityLabels[row.severity] || row.severity}</span></div></div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2"><div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold text-slate-500">الفرع المسجل</p><p className="mt-1 font-black">{text(current.registered_branch)}</p></div><div className="rounded-2xl bg-teal-50 p-4"><p className="text-xs font-bold text-teal-700">الفرع المقترح</p><p className="mt-1 font-black text-teal-900">{text(suggested.suggested_branch)}</p></div><div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold text-slate-500">فواتير شكري</p><p className="mt-1 font-black">{numeric(current.shokry_invoices).toLocaleString('ar-EG')} — {formatMoney(current.shokry_sales)} ج</p></div><div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold text-slate-500">فواتير الشامي</p><p className="mt-1 font-black">{numeric(current.shamy_invoices).toLocaleString('ar-EG')} — {formatMoney(current.shamy_sales)} ج</p></div><div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold text-slate-500">نسبة الثقة</p><p className="mt-1 font-black">{numeric(suggested.confidence_percent).toLocaleString('ar-EG')}%</p></div><div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold text-slate-500">آخر شراء</p><p className="mt-1 font-black">{formatDate(current.last_purchase)}</p></div></div>
              <div className="mt-5 flex flex-col gap-2 sm:flex-row">{!isTransient && <button onClick={() => void decide(row, 'approve')} disabled={!reviewerAllowed || savingId === row.id} className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white hover:bg-emerald-500 disabled:opacity-50">{savingId === row.id ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />} اعتماد الفرع المقترح</button>}<button onClick={() => void decide(row, 'reject')} disabled={!reviewerAllowed || savingId === row.id} className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border border-red-200 px-4 py-3 text-sm font-black text-red-700 hover:bg-red-50 disabled:opacity-50"><XCircle size={18} /> {isTransient ? 'تأكيد الاحتفاظ بالفرع الحالي' : 'رفض الاقتراح'}</button></div>
            </article>
          ); })}</div>}
        </div>}
      </div>
    </div>
  );
}
