import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Database,
  Loader2,
  Phone,
  RefreshCw,
  Search,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { canSeeAllBranches, rowMatchesUserBranch, scopeDescription } from '@/lib/security/permissionScopes';
import { saveCustomerBranchOverride } from '@/lib/customerBranchOverrides';
import { resolveCustomerBranch } from '@/lib/customerDisplay';

type BranchReviewRow = {
  customer_code: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  current_branch: string | null;
  suggested_branch: string | null;
  invoices_count: number | null;
  total_spent: number | null;
  last_invoice_date: string | null;
  confidence_level: string | null;
  repair_status: string | null;
  review_label: string | null;
  whatsapp_link?: string | null;
};

type BranchSummaryRow = {
  confidence_level: string | null;
  repair_status: string | null;
  customers_count: number | null;
  total_spent: number | null;
  invoices_count: number | null;
};

type InvalidPhoneRow = {
  customer_code: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  branch: string | null;
  source_table: string | null;
  invalid_reason: string | null;
  last_seen_at: string | null;
};

type SectionKey = 'summary' | 'branchQueue' | 'invalidPhones' | 'customersFallback';
type SectionStatus = {
  loading: boolean;
  ok: boolean;
  source: string;
  error?: string | null;
  hint?: string | null;
  rows?: number;
};

type RawRow = Record<string, unknown>;

const money = (value?: number | null) => Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 });
const number = (value?: number | null) => Number(value || 0).toLocaleString('ar-EG');
const date = (value?: string | null) => (value ? new Date(value).toLocaleDateString('ar-EG') : '—');
const str = (value: unknown) => (value == null ? '' : String(value).trim());
const nilIfEmpty = (value: unknown) => {
  const next = str(value);
  return next ? next : null;
};

const labelConfidence = (value?: string | null) => {
  if (value === 'medium') return 'مراجعة سريعة';
  if (value === 'manual_review') return 'مراجعة يدوية';
  if (value === 'high') return 'عالية الثقة';
  if (value === 'fallback_customer') return 'من جدول العملاء';
  return value || '—';
};

function normalizeEgyptPhone(value: string) {
  const digits = value.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('20') && digits.length === 12) return `0${digits.slice(2)}`;
  if (digits.startsWith('1') && digits.length === 10) return `0${digits}`;
  return digits;
}

function isValidEgyptMobile(value?: string | null) {
  const normalized = normalizeEgyptPhone(String(value || ''));
  return /^01[0125][0-9]{8}$/.test(normalized);
}

function readCustomerCode(row: RawRow) {
  return nilIfEmpty(row.customer_code ?? row.code ?? row.customer_id ?? row.final_customer_key ?? row.raw_customer_code);
}

function readCustomerName(row: RawRow) {
  return nilIfEmpty(row.customer_name ?? row.name ?? row.current_name ?? row.raw_customer_name ?? row.client_name);
}

function readCustomerPhone(row: RawRow) {
  return nilIfEmpty(row.customer_phone ?? row.phone ?? row.mobile ?? row.current_phone ?? row.raw_mobile ?? row.raw_phone ?? row.whatsapp);
}

function readCustomerBranch(row: RawRow) {
  const resolved = resolveCustomerBranch(row);
  return resolved.branch === 'غير محدد' ? null : resolved.branch;
}

function isMissingBranch(branch?: string | null) {
  const value = str(branch).toLowerCase();
  return !value || value === 'غير محدد' || value === 'unknown' || value === 'null' || value === 'undefined';
}

function canApproveBranchValue(branch?: string | null) {
  return Boolean(branch && !isMissingBranch(branch));
}

function safeErrorMessage(error: unknown) {
  if (!error) return null;
  if (typeof error === 'string') return error;
  if (typeof error === 'object') {
    const candidate = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    return [candidate.message, candidate.details, candidate.hint, candidate.code].filter(Boolean).map(String).join(' | ') || JSON.stringify(error);
  }
  return String(error);
}

function classifySupabaseError(message?: string | null) {
  const value = String(message || '').toLowerCase();
  if (!value) return null;
  if (value.includes('does not exist') || value.includes('relation') || value.includes('table')) return 'المصدر غير موجود أو اسم الجدول/الـ view غير صحيح.';
  if (value.includes('column')) return 'يوجد عمود غير موجود في الاستعلام ويحتاج مطابقة مع schema.';
  if (value.includes('permission') || value.includes('rls') || value.includes('row-level')) return 'غالبًا المشكلة من صلاحيات RLS أو نطاق المستخدم.';
  if (value.includes('timeout') || value.includes('canceling statement')) return 'الاستعلام بطيء جدًا أو تم إلغاؤه بسبب timeout.';
  return 'خطأ تحميل يحتاج مراجعة من Supabase أو أسماء الأعمدة.';
}

function createInitialStatus(source: string): SectionStatus {
  return { loading: true, ok: false, source, error: null, hint: null, rows: 0 };
}

function mapCustomerToBranchReview(row: RawRow): BranchReviewRow {
  const branch = readCustomerBranch(row);
  return {
    customer_code: readCustomerCode(row),
    customer_name: readCustomerName(row),
    customer_phone: readCustomerPhone(row),
    current_branch: branch,
    suggested_branch: isMissingBranch(branch) ? null : branch,
    invoices_count: Number(row.invoices_count ?? row.total_invoices ?? 0) || 0,
    total_spent: Number(row.total_spent ?? row.total_sales ?? row.total_purchases ?? 0) || 0,
    last_invoice_date: nilIfEmpty(row.last_invoice_date ?? row.last_purchase_date ?? row.updated_at ?? row.created_at),
    confidence_level: 'fallback_customer',
    repair_status: 'customers_fallback',
    review_label: isMissingBranch(branch) ? 'فرع غير محدد في جدول العملاء' : 'مراجعة من جدول العملاء',
  };
}

function mapCustomerToInvalidPhone(row: RawRow): InvalidPhoneRow {
  return {
    customer_code: readCustomerCode(row),
    customer_name: readCustomerName(row),
    customer_phone: readCustomerPhone(row),
    branch: readCustomerBranch(row),
    source_table: 'customers',
    invalid_reason: 'رقم غير صالح أو غير موجود في جدول العملاء',
    last_seen_at: nilIfEmpty(row.updated_at ?? row.created_at),
  };
}

function rowVisibleForUser(user: ReturnType<typeof useAuth>['user'], branch?: string | null) {
  if (!user) return false;
  const username = String(user.username || '').toLowerCase();
  if (username === 'cs.doha') return str(branch) === 'فرع الشامي' || isMissingBranch(branch);
  if (username === 'cs.donia') return str(branch) === 'فرع شكري' || isMissingBranch(branch);
  if (canSeeAllBranches(user.role)) return true;
  return rowMatchesUserBranch(user, branch);
}

async function safeMarkBranchRepairReviewed(customerCode: string, reviewer: string) {
  const result = await supabase.rpc('mark_customer_branch_repair_reviewed_v14', {
    p_customer_code: customerCode,
    p_reviewed_by: reviewer,
  });
  if (result.error) console.warn('branch repair review status update failed', result.error);
}

export default function CustomerDataReview() {
  const { user } = useAuth();
  const canUseAllBranches = canSeeAllBranches(user?.role);
  const userScopeLabel = scopeDescription(user?.role);
  const [activeTab, setActiveTab] = useState<'branch' | 'phones' | 'invoice-analysis'>('branch');
  const [summary, setSummary] = useState<BranchSummaryRow[]>([]);
  const [branchRows, setBranchRows] = useState<BranchReviewRow[]>([]);
  const [phoneRows, setPhoneRows] = useState<InvalidPhoneRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [phoneInputs, setPhoneInputs] = useState<Record<string, string>>({});
  const [sectionStatus, setSectionStatus] = useState<Record<SectionKey, SectionStatus>>({
    summary: createInitialStatus('dawaa_customer_branch_review_summary_v14'),
    branchQueue: createInitialStatus('dawaa_customer_branch_review_queue_v14'),
    invalidPhones: createInitialStatus('dawaa_customer_invalid_phone_review_v14_6'),
    customersFallback: createInitialStatus('customers'),
  });

  const updateSection = useCallback((key: SectionKey, patch: Partial<SectionStatus>) => {
    setSectionStatus((prev) => ({
      ...prev,
      [key]: { ...prev[key], ...patch, loading: false },
    }));
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setSectionStatus({
      summary: createInitialStatus('dawaa_customer_branch_review_summary_v14'),
      branchQueue: createInitialStatus('dawaa_customer_branch_review_queue_v14'),
      invalidPhones: createInitialStatus('dawaa_customer_invalid_phone_review_v14_6'),
      customersFallback: createInitialStatus('customers'),
    });

    let loadedBranchRows: BranchReviewRow[] = [];
    let loadedPhoneRows: InvalidPhoneRow[] = [];

    const summaryResult = await supabase.from('dawaa_customer_branch_review_summary_v14').select('*');
    if (summaryResult.error) {
      const error = safeErrorMessage(summaryResult.error);
      updateSection('summary', { ok: false, error, hint: classifySupabaseError(error), rows: 0 });
      setSummary([]);
    } else {
      const rows = (summaryResult.data || []) as BranchSummaryRow[];
      setSummary(rows);
      updateSection('summary', { ok: true, error: null, hint: null, rows: rows.length });
    }

    const queueResult = await supabase.from('dawaa_customer_branch_review_queue_v14').select('*').limit(800);
    if (queueResult.error) {
      const error = safeErrorMessage(queueResult.error);
      updateSection('branchQueue', { ok: false, error, hint: classifySupabaseError(error), rows: 0 });
    } else {
      loadedBranchRows = ((queueResult.data || []) as BranchReviewRow[]).filter((row) => {
        if (canUseAllBranches) return true;
        return rowVisibleForUser(user, row.current_branch) || rowVisibleForUser(user, row.suggested_branch);
      });
      updateSection('branchQueue', { ok: true, error: null, hint: null, rows: loadedBranchRows.length });
    }

    const phoneResult = await supabase.from('dawaa_customer_invalid_phone_review_v14_6').select('*').limit(800);
    if (phoneResult.error) {
      const error = safeErrorMessage(phoneResult.error);
      updateSection('invalidPhones', { ok: false, error, hint: classifySupabaseError(error), rows: 0 });
    } else {
      loadedPhoneRows = ((phoneResult.data || []) as InvalidPhoneRow[]).filter((row) => rowVisibleForUser(user, row.branch));
      updateSection('invalidPhones', { ok: true, error: null, hint: null, rows: loadedPhoneRows.length });
    }

    // Fallback آمن من جدول customers حتى لا تبقى الصفحة فارغة إذا كانت views/RPC غير موجودة أو ممنوعة بـ RLS.
    const needsFallback = queueResult.error || phoneResult.error || (!loadedBranchRows.length && !loadedPhoneRows.length);
    if (needsFallback) {
      const customersResult = await supabase.from('customers').select('*').limit(1200);
      if (customersResult.error) {
        const error = safeErrorMessage(customersResult.error);
        updateSection('customersFallback', { ok: false, error, hint: classifySupabaseError(error), rows: 0 });
      } else {
        const customerRows = ((customersResult.data || []) as RawRow[]).filter((row) => rowVisibleForUser(user, readCustomerBranch(row)));
        const fallbackBranchRows = customerRows
          .map(mapCustomerToBranchReview)
          .filter((row) => isMissingBranch(row.current_branch) || !isValidEgyptMobile(row.customer_phone));
        const fallbackPhoneRows = customerRows.map(mapCustomerToInvalidPhone).filter((row) => !isValidEgyptMobile(row.customer_phone));

        if (!loadedBranchRows.length) loadedBranchRows = fallbackBranchRows;
        if (!loadedPhoneRows.length) loadedPhoneRows = fallbackPhoneRows;
        updateSection('customersFallback', {
          ok: true,
          error: null,
          hint: needsFallback ? 'تم استخدام customers كمصدر بديل لأن مصدر المراجعة الأساسي غير متاح أو لا يحتوي نتائج.' : null,
          rows: customerRows.length,
        });
      }
    } else {
      updateSection('customersFallback', { ok: true, error: null, hint: 'لم نحتج إلى fallback لأن مصادر المراجعة الأساسية تعمل.', rows: 0 });
    }

    setBranchRows(loadedBranchRows);
    setPhoneRows(loadedPhoneRows);
    setLoading(false);

    const hardErrors = [summaryResult.error, queueResult.error, phoneResult.error].filter(Boolean).length;
    if (hardErrors > 0) {
      toast.warning('تم تحميل الصفحة مع استخدام مصادر بديلة لبعض الأقسام');
    }
  }, [canUseAllBranches, updateSection, user]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredBranchRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return branchRows.filter((row) => {
      if (!q) return true;
      return [row.customer_code, row.customer_name, row.customer_phone, row.current_branch, row.suggested_branch]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [branchRows, search]);

  const filteredPhoneRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return phoneRows.filter((row) => {
      if (!q) return true;
      return [row.customer_code, row.customer_name, row.customer_phone, row.branch, row.invalid_reason]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [phoneRows, search]);

  const approveBranch = async (row: BranchReviewRow) => {
    const customerCode = row.customer_code;
    if (!customerCode) return;
    if (!canApproveBranchValue(row.suggested_branch)) {
      toast.error('لا يوجد فرع مقترح يمكن اعتماده لهذا العميل');
      return;
    }
    setSavingCode(customerCode);
    try {
      const reviewer = user?.username || user?.name || 'app';
      await saveCustomerBranchOverride({
        customer_code: customerCode,
        customer_phone: row.customer_phone,
        customer_name: row.customer_name,
        old_branch: row.current_branch,
        new_branch: row.suggested_branch,
        suggested_branch: row.suggested_branch,
        reason: 'اعتماد تصحيح الفرع من مراجعة العملاء حسب الفواتير',
        created_by: user?.id || reviewer,
        created_by_name: reviewer,
      });
      await safeMarkBranchRepairReviewed(customerCode, reviewer);
      toast.success('تم اعتماد تصحيح الفرع كـ override آمن');
      await loadData();
    } catch (error) {
      console.error(error);
      toast.error(`تعذر اعتماد التصحيح: ${safeErrorMessage(error) || 'خطأ غير معروف'}`);
    } finally {
      setSavingCode(null);
    }
  };

  const ignoreBranch = async (customerCode?: string | null) => {
    if (!customerCode) return;
    setSavingCode(customerCode);
    try {
      const { error } = await supabase.rpc('ignore_customer_branch_repair_v14', {
        p_customer_code: customerCode,
        p_reviewed_by: user?.username || user?.name || 'app',
        p_reason: 'تم التجاهل من صفحة مراجعة بيانات العملاء',
      });
      if (error) throw error;
      toast.success('تم تجاهل العميل من قائمة تصحيح الفرع');
      await loadData();
    } catch (error) {
      console.error(error);
      toast.error(`تعذر تجاهل العميل: ${safeErrorMessage(error) || 'المصدر غير متاح'}`);
    } finally {
      setSavingCode(null);
    }
  };

  const updatePhone = async (customerCode?: string | null) => {
    if (!customerCode) return;
    const phone = normalizeEgyptPhone(phoneInputs[customerCode] || '');
    if (!isValidEgyptMobile(phone)) {
      toast.error('اكتب رقم موبايل مصري صحيح يبدأ بـ 01');
      return;
    }
    setSavingCode(customerCode);
    try {
      const rpc = await supabase.rpc('update_customer_phone_v14_6', {
        p_customer_code: customerCode,
        p_new_phone: phone,
        p_reviewed_by: user?.username || user?.name || 'app',
      });
      if (rpc.error) {
        const update = await supabase.from('customers').update({ phone, mobile: phone, updated_at: new Date().toISOString() }).eq('customer_code', customerCode);
        if (update.error) throw rpc.error;
      }
      toast.success('تم تحديث رقم العميل');
      setPhoneInputs((prev) => ({ ...prev, [customerCode]: '' }));
      await loadData();
    } catch (error) {
      console.error(error);
      toast.error(`تعذر تحديث رقم العميل: ${safeErrorMessage(error) || 'تحقق من صلاحيات التعديل'}`);
    } finally {
      setSavingCode(null);
    }
  };

  const derivedSummary = useMemo(() => {
    if (summary.length) return summary;
    return [
      { confidence_level: 'medium', repair_status: 'pending', customers_count: branchRows.length, total_spent: 0, invoices_count: 0 },
      { confidence_level: 'manual_review', repair_status: 'pending', customers_count: branchRows.filter((row) => isMissingBranch(row.current_branch)).length, total_spent: 0, invoices_count: 0 },
      { confidence_level: 'high', repair_status: 'manual_approved', customers_count: 0, total_spent: 0, invoices_count: 0 },
    ] as BranchSummaryRow[];
  }, [branchRows, summary]);

  const pendingManual = derivedSummary.find((row) => row.confidence_level === 'manual_review' && row.repair_status === 'pending')?.customers_count || 0;
  const pendingMedium = derivedSummary.find((row) => row.confidence_level === 'medium' && row.repair_status === 'pending')?.customers_count || 0;
  const approved = derivedSummary
    .filter((row) => String(row.repair_status || '').includes('approved') || String(row.repair_status || '').includes('auto_repaired'))
    .reduce((sum, row) => sum + Number(row.customers_count || 0), 0);
  const branchMismatchCount = branchRows.filter((row) => row.current_branch && row.suggested_branch && row.current_branch !== row.suggested_branch).length;
  const invoiceReviewCount = branchRows.filter((row) => Number(row.invoices_count || 0) > 0).length;
  const missingPhoneCount = branchRows.filter((row) => !isValidEgyptMobile(row.customer_phone)).length;
  const missingCodeCount = branchRows.filter((row) => !row.customer_code).length;

  return (
    <div className="space-y-6" dir="rtl">
      <section className="dawaa-hero rounded-3xl border border-slate-800 bg-slate-950/80 p-6 shadow-2xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-bold text-teal-300">مراجعة بيانات العملاء</p>
            <h1 className="mt-2 text-3xl font-black text-white">تصحيح الفروع والأرقام قبل التشغيل مع الفريق</h1>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-400">
              الصفحة دي مخصصة للمراجعة الآمنة: اعتماد فرع العميل بعد مراجعة نمط الشراء، ومراجعة العملاء الذين يظهر بجانبهم بدون رقم صالح.
              <span className="mt-2 block font-bold text-teal-200">نطاق عرض حسابك الحالي: {userScopeLabel}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadData()}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-sm font-black text-teal-200 hover:bg-teal-500/20"
          >
            <RefreshCw className="h-4 w-4" /> تحديث البيانات
          </button>
        </div>
      </section>

      <DiagnosticsPanel statuses={sectionStatus} />

      <section className="grid gap-4 md:grid-cols-4">
        <MetricCard label="مراجعة سريعة" value={loading ? null : pendingMedium} tone="amber" />
        <MetricCard label="مراجعة يدوية" value={loading ? null : pendingManual} tone="red" />
        <MetricCard label="تم اعتمادهم" value={loading ? null : approved} tone="emerald" />
        <MetricCard label="بدون رقم صالح" value={loading ? null : phoneRows.length} tone="blue" />
      </section>

      <section className="rounded-3xl border border-slate-800 bg-slate-950/70 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            <TabButton active={activeTab === 'branch'} onClick={() => setActiveTab('branch')}>مراجعة فروع العملاء</TabButton>
            <TabButton active={activeTab === 'phones'} onClick={() => setActiveTab('phones')}>بدون رقم صالح</TabButton>
            <TabButton active={activeTab === 'invoice-analysis'} onClick={() => setActiveTab('invoice-analysis')}>إعادة تحليل العملاء من الفواتير</TabButton>
          </div>
          <label className="relative block w-full lg:w-96">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="بحث بالاسم / الكود / الرقم / الفرع"
              className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-10 py-3 text-sm text-white outline-none focus:border-teal-400"
            />
          </label>
        </div>
      </section>

      {loading ? (
        <div className="flex items-center justify-center rounded-3xl border border-slate-800 bg-slate-950/70 p-10 text-slate-300">
          <Loader2 className="ml-2 h-5 w-5 animate-spin" /> جارٍ التحميل...
        </div>
      ) : activeTab === 'invoice-analysis' ? (
        <section className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-5">
            <MiniReport label="فرعهم مختلف عن الفواتير" value={branchMismatchCount} />
            <MiniReport label="لهم فواتير للمراجعة" value={invoiceReviewCount} />
            <MiniReport label="بدون هاتف" value={missingPhoneCount} />
            <MiniReport label="بدون كود" value={missingCodeCount} />
            <MiniReport label="أكثر من فرع" value={branchMismatchCount} />
          </div>
          <div className="rounded-3xl border border-blue-500/20 bg-blue-500/10 p-5 text-sm leading-7 text-blue-100">
            هذا التقرير لا يغير بيانات العملاء تلقائيًا. زر الاعتماد يحفظ التصحيح في customer_branch_overrides فقط.
          </div>
          {filteredBranchRows.slice(0, 80).map((row) => <BranchAnalysisCard key={`analysis-${row.customer_code}-${row.suggested_branch}`} row={row} saving={savingCode === row.customer_code} onApprove={approveBranch} />)}
          {!filteredBranchRows.length ? <EmptyState title="لا توجد حالات تحليل مطابقة للبحث أو نطاق صلاحياتك" /> : null}
        </section>
      ) : activeTab === 'branch' ? (
        <section className="grid gap-4">
          {filteredBranchRows.map((row) => <BranchReviewCard key={`${row.customer_code}-${row.suggested_branch}-${row.current_branch}`} row={row} saving={savingCode === row.customer_code} onApprove={approveBranch} onIgnore={ignoreBranch} />)}
          {!filteredBranchRows.length ? <EmptyState title="لا توجد حالات فروع مطابقة للبحث أو نطاق صلاحياتك" /> : null}
        </section>
      ) : (
        <section className="grid gap-4">
          {filteredPhoneRows.map((row) => {
            const code = row.customer_code || '';
            return <PhoneReviewCard key={`${code}-${row.source_table}`} row={row} saving={savingCode === code} value={phoneInputs[code] || ''} onChange={(value) => setPhoneInputs((prev) => ({ ...prev, [code]: value }))} onSave={() => updatePhone(code)} />;
          })}
          {!filteredPhoneRows.length ? <EmptyState title="لا توجد أرقام غير صالحة ظاهرة الآن أو لا توجد صلاحية لفرعها" /> : null}
        </section>
      )}

      <section className="rounded-3xl border border-blue-500/20 bg-blue-500/10 p-5 text-sm leading-7 text-blue-100">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-1 h-5 w-5 shrink-0" />
          <div>
            <p className="font-black text-white">ملاحظة تشغيل مهمة</p>
            <p>
              هذه الصفحة تعرض تشخيص مصادر البيانات بدل الاكتفاء برسالة خطأ عامة. لا يتم تغيير فرع أي عميل إلا عند الضغط على اعتماد، ولا يتم تغيير رقم أي عميل إلا عند إدخال رقم صحيح والضغط على حفظ.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function DiagnosticsPanel({ statuses }: { statuses: Record<SectionKey, SectionStatus> }) {
  const entries = Object.entries(statuses) as [SectionKey, SectionStatus][];
  const hasErrors = entries.some(([, status]) => status.error);
  return (
    <section className={`rounded-3xl border p-4 ${hasErrors ? 'border-amber-500/30 bg-amber-500/10' : 'border-emerald-500/20 bg-emerald-500/10'}`}>
      <div className="flex items-center gap-2 text-sm font-black text-white">
        {hasErrors ? <AlertTriangle className="h-5 w-5 text-amber-300" /> : <Database className="h-5 w-5 text-emerald-300" />}
        حالة تحميل مصادر مراجعة العملاء
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {entries.map(([key, status]) => (
          <div key={key} className="rounded-2xl border border-slate-700 bg-slate-950/70 p-3 text-xs leading-6">
            <div className="font-black text-slate-100">{status.source}</div>
            <div className={status.ok ? 'text-emerald-300' : status.error ? 'text-amber-300' : 'text-slate-400'}>
              {status.loading ? 'جارٍ التحميل...' : status.ok ? `تم التحميل (${number(status.rows || 0)} صف)` : 'تعذر التحميل'}
            </div>
            {status.error ? <div className="mt-2 rounded-xl bg-red-500/10 p-2 text-red-100">{status.error}</div> : null}
            {status.hint ? <div className="mt-2 rounded-xl bg-slate-800 p-2 text-slate-300">{status.hint}</div> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: number | null; tone: 'amber' | 'red' | 'emerald' | 'blue' }) {
  const classes = {
    amber: 'border-amber-500/20 bg-amber-500/10 text-amber-200',
    red: 'border-red-500/20 bg-red-500/10 text-red-200',
    emerald: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
    blue: 'border-blue-500/20 bg-blue-500/10 text-blue-200',
  }[tone];
  return <div className={`rounded-3xl border p-5 ${classes}`}><p className="text-sm">{label}</p><p className="mt-2 text-3xl font-black text-white">{value == null ? '...' : number(value)}</p></div>;
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={`rounded-2xl px-4 py-2 text-sm font-black ${active ? 'bg-teal-500 text-slate-950' : 'bg-slate-900 text-slate-300'}`}>{children}</button>;
}

function BranchAnalysisCard({ row, saving, onApprove }: { row: BranchReviewRow; saving: boolean; onApprove: (row: BranchReviewRow) => void }) {
  const branchReview = resolveCustomerBranch(row as unknown as Record<string, unknown>);
  return (
    <article className="rounded-3xl border border-slate-800 bg-slate-950/80 p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-xl font-black text-white">{row.customer_name || 'عميل بدون اسم'}</h2>
          <p className="mt-2 text-sm text-slate-300">الكود: {row.customer_code || '—'} · الهاتف: {row.customer_phone || '—'} · الحالي: {row.current_branch || '—'} · المقترح: {row.suggested_branch || '—'}</p>
          <p className="mt-1 text-xs text-slate-500">الفواتير: {number(row.invoices_count)} · إجمالي الشراء: {money(row.total_spent)} · آخر فاتورة: {date(row.last_invoice_date)}</p>
          {branchReview.needsReview ? (
            <p className="mt-2 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-100">
              فرع غير مؤكد: لا يمكن اعتماد التصحيح قبل وجود فرع واضح من الفواتير أو المتابعات.
            </p>
          ) : null}
        </div>
        <button className="btn-primary" type="button" onClick={() => onApprove(row)} disabled={saving || !canApproveBranchValue(row.suggested_branch)}>اعتماد تصحيح الفرع المحدد</button>
      </div>
    </article>
  );
}

function BranchReviewCard({ row, saving, onApprove, onIgnore }: { row: BranchReviewRow; saving: boolean; onApprove: (row: BranchReviewRow) => void; onIgnore: (code?: string | null) => void }) {
  const code = row.customer_code || '';
  const branchReview = resolveCustomerBranch(row as unknown as Record<string, unknown>);
  return (
    <article className="rounded-3xl border border-slate-800 bg-slate-950/80 p-5 shadow-xl">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-black text-slate-200">كود {code || '—'}</span>
            <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-black text-amber-200">{labelConfidence(row.confidence_level)}</span>
            {!isValidEgyptMobile(row.customer_phone) ? <span className="rounded-full bg-red-500/10 px-3 py-1 text-xs font-black text-red-200">بدون رقم صالح</span> : null}
            {branchReview.needsReview ? <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-black text-amber-200">فرع غير مؤكد</span> : null}
          </div>
          <h2 className="text-xl font-black text-white">{row.customer_name || 'عميل بدون اسم'}</h2>
          <div className="grid gap-2 text-sm text-slate-300 md:grid-cols-2 lg:grid-cols-4">
            <span>الهاتف: {row.customer_phone || '—'}</span>
            <span>الفرع الحالي: {row.current_branch || '—'}</span>
            <span>الفرع المقترح: {row.suggested_branch || '—'}</span>
            <span>آخر فاتورة: {date(row.last_invoice_date)}</span>
          </div>
          <div className="grid gap-2 text-sm text-slate-400 md:grid-cols-2"><span>عدد الفواتير: {number(row.invoices_count)}</span><span>إجمالي الشراء: {money(row.total_spent)} جنيه</span></div>
          {row.review_label ? <p className="text-xs text-slate-500">{row.review_label}</p> : null}
          {branchReview.needsReview ? <p className="text-xs font-bold text-amber-200">لا يوجد فرع واضح يمكن اعتماده لهذا العميل حاليًا.</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={saving || !canApproveBranchValue(row.suggested_branch)} onClick={() => onApprove(row)} className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-black text-slate-950 disabled:opacity-50"><CheckCircle2 className="h-4 w-4" /> اعتماد</button>
          <button type="button" disabled={saving} onClick={() => onIgnore(code)} className="inline-flex items-center gap-2 rounded-2xl bg-slate-800 px-4 py-2 text-sm font-black text-slate-200 disabled:opacity-50"><XCircle className="h-4 w-4" /> تجاهل</button>
        </div>
      </div>
    </article>
  );
}

function PhoneReviewCard({ row, saving, value, onChange, onSave }: { row: InvalidPhoneRow; saving: boolean; value: string; onChange: (value: string) => void; onSave: () => void }) {
  return (
    <article className="rounded-3xl border border-slate-800 bg-slate-950/80 p-5 shadow-xl">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-black text-slate-200">كود {row.customer_code || '—'}</span><span className="rounded-full bg-red-500/10 px-3 py-1 text-xs font-black text-red-200">{row.invalid_reason || 'بدون رقم صالح'}</span></div>
          <h2 className="text-xl font-black text-white">{row.customer_name || 'عميل بدون اسم'}</h2>
          <div className="grid gap-2 text-sm text-slate-300 md:grid-cols-3"><span>الرقم الحالي: {row.customer_phone || '—'}</span><span>الفرع: {row.branch || '—'}</span><span>آخر ظهور: {date(row.last_seen_at)}</span></div>
        </div>
        <div className="flex w-full flex-col gap-2 lg:w-96">
          <div className="flex gap-2"><input value={value} onChange={(event) => onChange(event.target.value)} placeholder="اكتب الرقم الصحيح 01xxxxxxxxx" className="min-w-0 flex-1 rounded-2xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-white outline-none focus:border-teal-400" /><button type="button" disabled={saving} onClick={onSave} className="inline-flex items-center gap-2 rounded-2xl bg-teal-500 px-4 py-2 text-sm font-black text-slate-950 disabled:opacity-50"><Phone className="h-4 w-4" /> حفظ</button></div>
          <p className="text-xs text-slate-500">سيتم تحديث رقم العميل من RPC إن كان متاحًا، أو من جدول customers كـ fallback.</p>
        </div>
      </div>
    </article>
  );
}

function EmptyState({ title }: { title: string }) {
  return <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-10 text-center text-slate-400"><ClipboardCheck className="mx-auto mb-3 h-10 w-10 text-slate-600" /><p className="font-bold">{title}</p></div>;
}

function MiniReport({ label, value }: { label: string; value: number }) {
  return <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-5"><p className="text-sm text-slate-400">{label}</p><p className="mt-2 text-3xl font-black text-white">{number(value)}</p></div>;
}
