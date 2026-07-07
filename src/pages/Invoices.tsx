import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import {
  Upload,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle,
  Download,
  Loader2,
  XCircle,
  FileCheck,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Pencil,
  Save,
  BarChart3,
  X,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { BRANCHES } from '@/lib/constants';
import { formatCurrency, formatDate } from '@/lib/utils';
import { useAuth, getCurrentUserProfile } from '@/hooks/useAuth';
import { logActivity } from '@/hooks/useSupabaseQuery';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { getInvoiceKey } from '@/lib/dawaa2027';
import { clearCustomersCache } from '@/lib/api/customers';
import { clearCustomerServiceCommandCenterCache } from '@/lib/api/customerServiceCommandCenter';
import { clearCustomerProfileCache } from '@/lib/customerProfileService';
import { clearExecutiveDashboardCache } from '@/lib/executiveDashboardDataService';
import { clearSalesAnalyticsSummaryCache } from '@/lib/salesAnalyticsSummaryService';
import { clearStaffPerformanceProfileCache } from '@/lib/staff/staffPerformanceProfileService';
import { invalidateInvoiceCache } from '@/lib/salesInvoiceSource';
import { getInvoiceNetValue } from '@/lib/analyticsService';
import {
  canAccessInvoiceImportPage,
  canDeleteInvoiceImportBatch,
  canManageInvoiceImportBatches,
} from '@/lib/invoices/invoiceAccess';
import {
  generateTemplateFile,
  importCustomersToDB,
  importInvoicesToDB,
  parseCustomerFile,
  parseInvoiceFile,
  type CustomerParseResult,
  type ImportSummary,
  type ParseResult,
} from '@/lib/invoiceImporter';
import {
  applyCustomerPhoneUpdate,
  CUSTOMER_PHONE_CONFIRMATION,
  parseCustomerPhoneFile,
  previewCustomerPhoneUpdate,
  type CustomerPhoneParseResult,
  type CustomerPhoneCsvRow,
  type CustomerPhoneUpdateResult,
} from '@/lib/customerPhoneUpdateService';

type Step = 'idle' | 'parsing' | 'preview' | 'importing' | 'done';
type ImportKind = 'sales' | 'customers';

interface ManagedInvoiceRow {
  id: string;
  import_batch: string | null;
  branch: string | null;
  invoice_no: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  invoice_type: string | null;
  customer_code: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  amount: number | null;
  net_amount: number | null;
  discounted_amount?: number | null;
  gross_amount: number | null;
  seller_name: string | null;
}

interface DuplicateInvoiceGroup {
  invoice_number: string;
  branch: string;
  sale_date: string;
  count: number;
  latest_created_at: string | null;
}

const INVOICE_PAGE_SIZE = 200;

function dayAfter(date: string) {
  const next = new Date(`${date}T12:00:00`);
  next.setDate(next.getDate() + 1);
  return next.toISOString().slice(0, 10);
}

function clearInvoiceLinkedViews() {
  invalidateInvoiceCache();
  clearExecutiveDashboardCache();
  clearSalesAnalyticsSummaryCache();
  clearCustomersCache();
  clearCustomerServiceCommandCenterCache();
  clearCustomerProfileCache();
  clearStaffPerformanceProfileCache();
  try {
    window.localStorage.setItem('dawaa_invoice_import_refresh', String(Date.now()));
  } catch {
    // Local storage can be blocked in private/restricted browser contexts.
  }
}

function invoiceSalesValue(
  invoice: Pick<ManagedInvoiceRow, 'net_amount' | 'discounted_amount' | 'amount' | 'gross_amount'>
) {
  return getInvoiceNetValue(invoice as Record<string, unknown>);
}

function salesImportSuccessMessage(summary: ImportSummary) {
  const existingCount = summary.confirmedExistingInvoices ?? summary.updatedInvoices ?? 0;
  const existingNet = summary.confirmedExistingNetSales ?? summary.updatedNetSales ?? 0;
  const processedNet = summary.processedNetSales ?? summary.savedNetSales ?? summary.importedNetSales ?? 0;

  return [
    `تم قراءة ${(summary.distinctInvoicesInFile || summary.validRows || summary.totalRows).toLocaleString('ar-EG')} فاتورة.`,
    `صافي الملف: ${formatCurrency(summary.fileNetSales || 0)}.`,
    `تم إضافة ${summary.insertedRows.toLocaleString('ar-EG')} فاتورة جديدة بصافي ${formatCurrency(summary.insertedNetSales || 0)}.`,
    `تم تأكيد/تحديث ${existingCount.toLocaleString('ar-EG')} فاتورة موجودة مسبقًا بصافي ${formatCurrency(existingNet)}.`,
    `تم تخطي ${summary.skippedDuplicates.toLocaleString('ar-EG')} فاتورة.`,
    `تحتاج مراجعة: ${summary.needsReviewRows.toLocaleString('ar-EG')} بصافي ${formatCurrency(summary.reviewNetSales || 0)}.`,
    `صافي الجديد + الموجود المؤكد: ${formatCurrency(processedNet)}.`,
    `صافي ما تم حفظه/تحديثه فعليًا: ${formatCurrency(summary.savedNetSales ?? summary.importedNetSales ?? 0)}.`,
  ].join('\n');
}

function isSummaryRefreshNotice(message: string) {
  return (
    message.includes('تحديث الملخصات غير مفعل') ||
    message.includes('سيتم الاعتماد على الفواتير المباشرة') ||
    message.includes('تحديث ثقيل') ||
    message.includes('RPC مخصص') ||
    message.includes('لوحة الإدارة')
  );
}

function customerImportStatusLabel(status: string) {
  const labels: Record<string, string> = {
    existing_customer: 'عميل موجود',
    new_customer: 'عميل جديد',
    already_valid: 'بيانات صالحة',
    ready_to_update: 'جاهز للتحديث',
    unmatched: 'غير مطابق',
    invalid_phone: 'رقم غير صالح',
    invalid_row: 'صف غير صالح',
    duplicate_in_file: 'مكرر في الملف',
    needs_review_existing_phone: 'مراجعة: هاتف مختلف',
    needs_review_phone_used_by_other: 'مراجعة: الرقم مستخدم لعميل آخر',
    needs_review_existing_whatsapp: 'مراجعة: واتساب مختلف',
    needs_review_existing_address: 'مراجعة: عنوان مختلف',
    needs_review_multiple_matches: 'مراجعة: أكثر من تطابق',
  };
  return labels[status] || status;
}

function dayMatchStatusLabel(status: ImportSummary['dayDatabaseComparison'] extends Array<infer Row>
  ? Row extends { status: infer Status }
    ? Status
    : string
  : string) {
  const labels: Record<string, string> = {
    matched: 'مطابق',
    missing_in_database: 'غير موجود في القاعدة',
    partial: 'فرق يحتاج مراجعة',
    extra_in_database: 'موجود في القاعدة فقط',
  };
  return labels[String(status)] || String(status);
}

function dayMatchStatusClass(status: string) {
  if (status === 'matched') return 'bg-emerald-400/15 text-emerald-100';
  if (status === 'missing_in_database') return 'bg-red-400/15 text-red-100';
  if (status === 'partial') return 'bg-amber-400/15 text-amber-100';
  return 'bg-slate-400/15 text-slate-100';
}

type DaySalesChartRow = {
  date: string;
  label: string;
  shokryTotal: number;
  shamyTotal: number;
  otherTotal: number;
  fileTotal: number;
  databaseTotal: number;
  fileCount: number;
  databaseCount: number;
  countDifference: number;
  difference: number;
  status: NonNullable<ImportSummary['dayDatabaseComparison']>[number]['status'];
};

function shortDayLabel(date: string) {
  const [, month, day] = date.split('-');
  return month && day ? `${Number(day)}/${Number(month)}` : date;
}

function isEmptyComparisonDay(row: Pick<DaySalesChartRow, 'fileCount' | 'databaseCount' | 'fileTotal' | 'databaseTotal'>) {
  return row.fileCount === 0 && row.databaseCount === 0 && row.fileTotal === 0 && row.databaseTotal === 0;
}

function normalizeBranchBucket(branch: string) {
  const normalized = branch.trim();
  if (normalized === BRANCHES[0]) return 'shokryTotal' as const;
  if (normalized === BRANCHES[1]) return 'shamyTotal' as const;
  return 'otherTotal' as const;
}

function buildDaySalesChartRows(summary: ImportSummary): DaySalesChartRow[] {
  const byDate = new Map<string, DaySalesChartRow>();

  for (const row of summary.dayDatabaseComparison || []) {
    byDate.set(row.date, {
      date: row.date,
      label: shortDayLabel(row.date),
      shokryTotal: 0,
      shamyTotal: 0,
      otherTotal: 0,
      fileTotal: row.fileTotal,
      databaseTotal: row.databaseTotal,
      fileCount: row.fileCount,
      databaseCount: row.databaseCount,
      countDifference: row.countDifference,
      difference: row.difference,
      status: row.status,
    });
  }

  for (const trace of summary.rowSaveTrace || []) {
    if (!trace.parsed_date) continue;
    const current =
      byDate.get(trace.parsed_date) ||
      ({
        date: trace.parsed_date,
        label: shortDayLabel(trace.parsed_date),
        shokryTotal: 0,
        shamyTotal: 0,
        otherTotal: 0,
        fileTotal: 0,
        databaseTotal: 0,
        fileCount: 0,
        databaseCount: 0,
        countDifference: 0,
        difference: 0,
        status: 'matched',
      } satisfies DaySalesChartRow);
    const branchKey = normalizeBranchBucket(trace.branch || '');
    current[branchKey] += Number(trace.amount || 0);
    byDate.set(trace.parsed_date, current);
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function chartBarColor(status: string) {
  if (status === 'matched') return 'bg-emerald-400';
  if (status === 'missing_in_database') return 'bg-red-400';
  if (status === 'partial') return 'bg-amber-400';
  return 'bg-slate-400';
}

function MetricMiniCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
      <div className="text-[11px] font-bold text-slate-400">{label}</div>
      <div className="mt-1 text-sm font-bold text-white">{value}</div>
    </div>
  );
}

function importCompletion(summary: ImportSummary) {
  const missingDays = summary.dayDatabaseComparison?.some(
    (row) => row.status === 'missing_in_database'
  );
  const savedButNotFound = summary.rowSaveTrace?.some(
    (row) => row.finalStatus === 'saved_but_not_found_after_verification'
  );
  const hasDifferences = summary.dayDatabaseComparison?.some(
    (row) => row.status === 'partial' || Math.abs(row.difference) >= 0.01 || row.countDifference !== 0
  );
  if (missingDays || savedButNotFound) {
    return {
      label: 'غير مكتمل',
      tone: 'border-red-300/35 bg-red-400/10 text-red-50',
      message: 'توجد أيام كاملة من الملف لم تظهر في قاعدة البيانات. راجع جدول المطابقة وأسباب التخطي.',
    };
  }
  if (hasDifferences || (summary.conflictReviewRows || 0) > 0) {
    return {
      label: 'يحتاج مراجعة',
      tone: 'border-amber-300/35 bg-amber-400/10 text-amber-50',
      message: 'يوجد فرق بين الملف وقاعدة البيانات أو فواتير متعارضة تحتاج مراجعة.',
    };
  }
  return {
    label: 'مكتمل',
    tone: 'border-emerald-300/35 bg-emerald-400/10 text-emerald-50',
    message: 'كل أيام الملف ظهرت في قاعدة البيانات داخل مدى الملف بدون فروق مؤثرة.',
  };
}

function downloadImportReviewCsv(summary: ImportSummary) {
  const query = summary.databaseComparisonQuery;
  const dayComparison = summary.dayDatabaseComparison || [];
  const databaseByDay = summary.databaseByDay || [];
  const statusCounts = dayComparison.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});

  const traceRows = summary.rowSaveTrace || [];
  const rows = traceRows.length > 0
    ? traceRows.map((row) => ({
      invoice_number: row.invoice_number,
      row_number: row.rowNumber,
      date: row.parsed_date,
      branch: row.branch,
      invoice_date: row.parsed_date,
      amount: row.amount,
      status: row.finalStatus,
      reason: row.skipReason || row.saveError || row.finalStatus,
      duplicate_key: '',
      validation_status: row.validationStatus,
      intended_action: row.intendedAction,
      actual_action: row.actualAction,
      save_attempted: row.saveAttempted ? 'true' : 'false',
      save_succeeded: row.saveSucceeded ? 'true' : 'false',
      save_error: row.saveError || '',
      original_skip_reason: row.skipReason || '',
      post_import_status: row.postImportStatus || '',
      matched_existing_id: row.matchedExistingId || '',
      matched_existing_invoice_date: row.matchedExistingInvoiceDate || '',
      matched_existing_branch: row.matchedExistingBranch || '',
      post_save_found: row.postSaveFound ? 'true' : 'false',
    }))
    : [
    ...(summary.missingInvoicesSample || []).map((row) => ({
      invoice_number: row.invoiceNumber,
      row_number: '',
      date: row.date,
      branch: row.branch,
      invoice_date: '',
      amount: row.amount,
      status: 'missing_or_conflict',
      reason: row.reason,
      duplicate_key: '',
      validation_status: '',
      intended_action: '',
      actual_action: '',
      save_attempted: '',
      save_succeeded: '',
      save_error: '',
      original_skip_reason: row.reason,
      post_import_status: '',
      matched_existing_id: '',
      matched_existing_invoice_date: '',
      matched_existing_branch: '',
      post_save_found: '',
    })),
    ...(summary.skippedRowsSample || []).slice(0, 500).map((row) => ({
      invoice_number: row.invoiceNumber,
      row_number: '',
      date: row.originalDate,
      branch: row.branch,
      invoice_date: row.parsedDate,
      amount: '',
      status: 'skipped',
      reason: row.reason,
      duplicate_key: '',
      validation_status: '',
      intended_action: '',
      actual_action: 'skipped_before_save',
      save_attempted: 'false',
      save_succeeded: 'false',
      save_error: '',
      original_skip_reason: row.reason,
      post_import_status: '',
      matched_existing_id: '',
      matched_existing_invoice_date: '',
      matched_existing_branch: '',
      post_save_found: '',
    })),
    ...(summary.savedRowsSample || []).slice(0, 500).map((row) => ({
      invoice_number: row.invoiceNumber,
      row_number: '',
      date: row.originalDate,
      branch: row.branch,
      invoice_date: row.invoiceDate,
      amount: row.netTotal,
      status: 'saved',
      reason: 'saved',
      duplicate_key: row.duplicateKey,
      validation_status: '',
      intended_action: '',
      actual_action: 'saved',
      save_attempted: 'true',
      save_succeeded: 'true',
      save_error: '',
      original_skip_reason: '',
      post_import_status: '',
      matched_existing_id: '',
      matched_existing_invoice_date: '',
      matched_existing_branch: '',
      post_save_found: '',
    })),
  ];

  const headers = [
    'invoice_number',
    'row_number',
    'date',
    'branch',
    'invoice_date',
    'amount',
    'status',
    'reason',
    'duplicate_key',
    'validation_status',
    'intended_action',
    'actual_action',
    'save_attempted',
    'save_succeeded',
    'save_error',
    'original_skip_reason',
    'post_import_status',
    'matched_existing_id',
    'matched_existing_invoice_date',
    'matched_existing_branch',
    'post_save_found',
  ];

  const escapeCsv = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

  const metadataLines = [
    ['SECTION', 'FIELD', 'VALUE'],
    ['IMPORT_RANGE', 'fileMinDate', query?.fileMinDate || ''],
    ['IMPORT_RANGE', 'fileMaxDate', query?.fileMaxDate || ''],
    ['DB_QUERY_RANGE', 'gte', query?.gte || ''],
    ['DB_QUERY_RANGE', 'lt', query?.lt || ''],
    ['DB_QUERY_RANGE', 'startDate', query?.startDate || ''],
    ['DB_QUERY_RANGE', 'endDate', query?.endDate || ''],
    ['DB_QUERY_RANGE', 'endExclusive', query?.endExclusive || ''],
    ['DB_QUERY_META', 'table', query?.table || ''],
    ['DB_QUERY_META', 'dateColumn', query?.dateColumn || ''],
    ['DB_QUERY_META', 'select', query?.select || ''],
    ['DB_QUERY_META', 'error', query?.error || ''],
    ['DB_STATE', 'databaseMinDateAfterImport', summary.databaseMinDateAfterImport || ''],
    ['DB_STATE', 'databaseMaxDateAfterImport', summary.databaseMaxDateAfterImport || ''],
    ['DB_STATE', 'databaseByDayCount', String(databaseByDay.length)],
    ['DB_STATE', 'dayDatabaseComparisonCount', String(dayComparison.length)],
    ['DB_STATE', 'matchedDays', String(statusCounts.matched || 0)],
    ['DB_STATE', 'missingDays', String(statusCounts.missing_in_database || 0)],
    ['DB_STATE', 'partialDays', String(statusCounts.partial || 0)],
    ['DB_STATE', 'extraDays', String(statusCounts.extra_in_database || 0)],
    ['SAVE_DIAG', 'rowsPreparedForSaveCount', String(summary.rowsPreparedForSaveCount || 0)],
    ['SAVE_DIAG', 'rowsActuallySentToSupabaseCount', String(summary.rowsActuallySentToSupabaseCount || 0)],
    ['SAVE_DIAG', 'rowsSavedSuccessfullyCount', String(summary.rowsSavedSuccessfullyCount || 0)],
    ['SAVE_DIAG', 'rowsFailedToSaveCount', String(summary.rowsFailedToSaveCount || 0)],
    ['SAVE_DIAG', 'rowsSaveNotAttemptedCount', String(summary.rowsSaveNotAttemptedCount || 0)],
  ];

  const databaseByDayLines = [
    ['DB_BY_DAY', 'date', 'count', 'total'],
    ...databaseByDay.map((row) => [row.date, String(row.count), String(row.total)]),
  ];

  const dayComparisonLines = [
    ['DAY_COMPARISON', 'date', 'fileCount', 'databaseCount', 'countDifference', 'difference', 'status'],
    ...dayComparison.map((row) => [
      row.date,
      String(row.fileCount),
      String(row.databaseCount),
      String(row.countDifference),
      String(row.difference),
      row.status,
    ]),
  ];

  const lines = [
    ...metadataLines.map((row) => row.map(escapeCsv).join(',')),
    [''].map(escapeCsv).join(','),
    ...databaseByDayLines.map((row) => row.map(escapeCsv).join(',')),
    [''].map(escapeCsv).join(','),
    ...dayComparisonLines.map((row) => row.map(escapeCsv).join(',')),
    [''].map(escapeCsv).join(','),
    headers.join(','),
    ...rows.map((row) => headers.map((key) => escapeCsv((row as Record<string, unknown>)[key])).join(',')),
  ];

  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `invoice-import-review-${summary.importBatch || new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

interface InvoiceEditForm {
  branch: string;
  invoice_number: string;
  invoice_date: string;
  invoice_type: string;
  customer_code: string;
  customer_name: string;
  customer_phone: string;
  seller_name: string;
  amount: string;
  net_amount: string;
  gross_amount: string;
}

export default function Invoices() {
  const { user, isAdmin } = useAuth();
  const canAccessInvoices = canAccessInvoiceImportPage(user) || isAdmin;
  const canDeleteBatches = canDeleteInvoiceImportBatch(user) || isAdmin;
  const canManageBatches = canManageInvoiceImportBatches(user) || isAdmin;

  if (!canAccessInvoices) {
    return (
      <div className="flex min-h-[400px] items-center justify-center p-6" dir="rtl">
        <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-6 py-5 text-center text-amber-100">
          ليس لديك صلاحية للوصول إلى صفحة استيراد الفواتير.
        </div>
      </div>
    );
  }

  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const sellerNameFilter = searchParams.get('seller_name') || '';
  const fromDateFilter = searchParams.get('from') || '';
  const toDateFilter = searchParams.get('to') || '';
  const [step, setStep] = useState<Step>('idle');
  const [importKind, setImportKind] = useState<ImportKind>('sales');
  const [branch, setBranch] = useState<string>(BRANCHES[0]);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const [parseResult, setParseResult] = useState<ParseResult | CustomerParseResult | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [managedInvoices, setManagedInvoices] = useState<ManagedInvoiceRow[]>([]);
  const [managedLoading, setManagedLoading] = useState(false);
  const [adminBusy, setAdminBusy] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [editInvoice, setEditInvoice] = useState<ManagedInvoiceRow | null>(null);
  const [editForm, setEditForm] = useState<InvoiceEditForm | null>(null);
  const [duplicateAudit, setDuplicateAudit] = useState<DuplicateInvoiceGroup[]>([]);
  const [duplicateAuditLoading, setDuplicateAuditLoading] = useState(false);
  const [summaryRefreshBusy, setSummaryRefreshBusy] = useState(false);
  const [summaryRefreshPhase, setSummaryRefreshPhase] = useState<'idle' | 'imported' | 'refreshing' | 'updated' | 'failed'>('idle');
  const [summaryRangeStart, setSummaryRangeStart] = useState('');
  const [summaryRangeEnd, setSummaryRangeEnd] = useState('');
  const [summarySnapshot, setSummarySnapshot] = useState<{
    totalInvoices: number;
    totalSales: number;
    latestUpdatedAt: string | null;
    latestBatchStatus: string | null;
    branchRows: Array<{ branch_name: string; invoices_count: number; net_total: number; updated_at: string | null }>;
    dailyRows: Array<{ summary_date: string; invoices_count: number; net_total: number; updated_at: string | null }>;
  } | null>(null);
  const [summarySnapshotBusy, setSummarySnapshotBusy] = useState(false);
  const [summarySnapshotMessage, setSummarySnapshotMessage] = useState<string | null>(null);
  const [showEmptyChartDays, setShowEmptyChartDays] = useState(false);
  const [phoneUpdateRows, setPhoneUpdateRows] = useState<CustomerPhoneCsvRow[]>([]);
  const [phoneUpdateResult, setPhoneUpdateResult] = useState<CustomerPhoneUpdateResult | null>(
    null
  );
  const [phoneUpdateParseResult, setPhoneUpdateParseResult] =
    useState<CustomerPhoneParseResult | null>(null);
  const [phoneUpdateBusy, setPhoneUpdateBusy] = useState(false);
  const [phoneUpdateFileName, setPhoneUpdateFileName] = useState('');
  const [phoneUpdateConfirmText, setPhoneUpdateConfirmText] = useState('');
  const [copyPhoneToWhatsapp, setCopyPhoneToWhatsapp] = useState(false);
  useEscapeKey(
    () => {
      setEditInvoice(null);
      setEditForm(null);
    },
    Boolean(editInvoice && editForm)
  );

  const loadManagedInvoices = useCallback(async () => {
    if (!canManageBatches) return;
    setManagedLoading(true);
    let query = supabase
      .from('sales_invoices')
      .select(
        'id,import_batch,branch,invoice_no,invoice_number,invoice_date,invoice_type,customer_code,customer_name,customer_phone,amount,net_amount,discounted_amount,gross_amount,seller_name'
      )
      .order('invoice_date', { ascending: false })
      .limit(INVOICE_PAGE_SIZE);

    if (sellerNameFilter) {
      query = query.ilike('seller_name', `%${sellerNameFilter}%`);
    }
    if (fromDateFilter) {
      query = query.gte('invoice_date', fromDateFilter);
    }
    if (toDateFilter) {
      query = query.lt('invoice_date', dayAfter(toDateFilter));
    }

    const { data, error } = await query;

    if (error) {
      toast.error(`تعذر تحميل أحدث الفواتير: ${error.message}`);
      setManagedInvoices([]);
    } else {
      setManagedInvoices((data || []) as ManagedInvoiceRow[]);
    }
    setManagedLoading(false);
  }, [canManageBatches, sellerNameFilter, fromDateFilter, toDateFilter]);

  const loadInvoiceSummarySnapshot = useCallback(async () => {
    setSummarySnapshotBusy(true);
    setSummarySnapshotMessage(null);
    try {
      const { data, error } = await supabase
        .from('sales_invoices')
        .select('invoice_date,branch,net_amount,net_total,amount')
        .order('invoice_date', { ascending: false })
        .limit(5000);

      if (error) throw error;

      const rows = ((data || []) as Array<Record<string, unknown>>)
        .map((row) => {
          const invoiceDate = String(row.invoice_date || '').slice(0, 10);
          const branchName = String(row.branch || 'غير محدد').trim() || 'غير محدد';
          const netValue = Number(row.net_amount ?? row.net_total ?? row.amount ?? 0);
          return { invoiceDate, branchName, netValue };
        })
        .filter((row) => row.invoiceDate);

      const dailyMap = new Map<string, { summary_date: string; invoices_count: number; net_total: number; updated_at: string | null }>();
      const branchMap = new Map<string, { branch_name: string; invoices_count: number; net_total: number; updated_at: string | null }>();

      for (const row of rows) {
        const daily = dailyMap.get(row.invoiceDate) || {
          summary_date: row.invoiceDate,
          invoices_count: 0,
          net_total: 0,
          updated_at: row.invoiceDate,
        };
        daily.invoices_count += 1;
        daily.net_total += row.netValue;
        dailyMap.set(row.invoiceDate, daily);

        const branch = branchMap.get(row.branchName) || {
          branch_name: row.branchName,
          invoices_count: 0,
          net_total: 0,
          updated_at: row.invoiceDate,
        };
        branch.invoices_count += 1;
        branch.net_total += row.netValue;
        branchMap.set(row.branchName, branch);
      }

      const dailyRows = [...dailyMap.values()]
        .sort((a, b) => b.summary_date.localeCompare(a.summary_date))
        .slice(0, 8);
      const branchRows = [...branchMap.values()]
        .sort((a, b) => b.net_total - a.net_total)
        .slice(0, 8);

      setSummarySnapshot({
        totalInvoices: rows.length,
        totalSales: rows.reduce((sum, row) => sum + row.netValue, 0),
        latestUpdatedAt: rows[0]?.invoiceDate || null,
        latestBatchStatus: null,
        branchRows,
        dailyRows,
      });
      setSummarySnapshotMessage('تحديث الملخصات غير مفعل حاليًا، سيتم الاعتماد على الفواتير المباشرة.');
    } catch (error) {
      setSummarySnapshotMessage(`تعذر تحميل ملخصات الفواتير: ${(error as Error).message}`);
      setSummarySnapshot(null);
    } finally {
      setSummarySnapshotBusy(false);
    }
  }, []);

  const loadDuplicateAudit = useCallback(async () => {
    if (!canManageBatches) return;
    setDuplicateAuditLoading(true);
    const { data, error } = await supabase
      .from('sales_invoices')
      .select('id,invoice_no,invoice_number,branch,invoice_date,created_at')
      .order('created_at', { ascending: false })
      .limit(3000);

    if (error) {
      toast.error(`تعذر فحص التكرارات: ${error.message}`);
      setDuplicateAudit([]);
      setDuplicateAuditLoading(false);
      return;
    }

    const groups = new Map<string, DuplicateInvoiceGroup>();
    for (const row of data || []) {
      const invoiceNumber = getInvoiceKey(row as Record<string, unknown>);
      const branchName = String(row.branch || 'غير محدد').trim() || 'غير محدد';
      const saleDate = String(row.invoice_date || '').slice(0, 10);
      if (!invoiceNumber || !saleDate) continue;
      const key = `${branchName}|${saleDate}|${invoiceNumber}`;
      const current = groups.get(key) || {
        invoice_number: invoiceNumber,
        branch: branchName,
        sale_date: saleDate,
        count: 0,
        latest_created_at: null,
      };
      current.count += 1;
      const createdAt = String(row.created_at || '');
      if (createdAt && (!current.latest_created_at || createdAt > current.latest_created_at)) {
        current.latest_created_at = createdAt;
      }
      groups.set(key, current);
    }

    setDuplicateAudit(
      [...groups.values()]
        .filter((group) => group.count > 1)
        .sort((a, b) =>
          String(b.latest_created_at || '').localeCompare(String(a.latest_created_at || ''))
        )
        .slice(0, 30)
    );
    setDuplicateAuditLoading(false);
  }, [isAdmin]);

  useEffect(() => {
    void loadManagedInvoices();
    void loadInvoiceSummarySnapshot();
  }, [loadManagedInvoices, loadInvoiceSummarySnapshot]);

  const readFile = (file: File): Promise<ArrayBuffer> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => resolve(event.target?.result as ArrayBuffer);
      reader.onerror = () => reject(new Error('تعذر قراءة الملف'));
      reader.readAsArrayBuffer(file);
    });

  const processFile = useCallback(
    async (file: File) => {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      if (!['csv', 'xlsx', 'xls'].includes(ext)) {
        toast.error('نوع الملف غير مدعوم. استخدم Excel أو CSV');
        return;
      }

      setFileName(file.name);
      setStep('parsing');
      setParseResult(null);
      setImportSummary(null);
      setProgress(0);

      try {
        const buffer = await readFile(file);
        const result =
          importKind === 'sales'
            ? parseInvoiceFile(buffer, file.name, branch)
            : parseCustomerFile(buffer, file.name);

        setParseResult(result);
        setStep('preview');

        if (result.rows.length === 0) toast.error('لم يتم العثور على صفوف صالحة في الملف');
        else toast.success(`تم تحليل الملف: ${result.rows.length.toLocaleString('ar-EG')} صف صالح`);
      } catch (error) {
        toast.error(`فشل قراءة الملف: ${(error as Error).message}`);
        setStep('idle');
      }
    },
    [branch, importKind]
  );

  const handleConfirmImport = async () => {
    if (!parseResult || parseResult.rows.length === 0) return;

    setStep('importing');
    setProgress(0);
    const batch = `import-${importKind}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}`;

    try {
      const summary =
        importKind === 'sales'
          ? await importInvoicesToDB(
              (parseResult as ParseResult).rows,
              branch,
              batch,
              (done, total) => setProgress(total > 0 ? Math.round((done / total) * 100) : 0),
              {
                fileName,
                importedBy: user?.id || null,
                importedAt: new Date().toISOString(),
                invalidDateRowsCount: (parseResult.errors || []).filter(
                  (error) =>
                    error.field.includes('التاريخ') ||
                    error.message.includes('تاريخ') ||
                    error.field.toLowerCase().includes('date')
                ).length,
                invalidDateRowsSample: (parseResult.errors || [])
                  .filter(
                    (error) =>
                      error.field.includes('التاريخ') ||
                      error.message.includes('تاريخ') ||
                      error.field.toLowerCase().includes('date')
                  )
                  .slice(0, 8)
                  .map((error) => ({ row: error.row, value: error.message })),
                parseErrors: parseResult.errors,
              }
            )
          : await importCustomersToDB((parseResult as CustomerParseResult).rows, batch);

      setImportSummary(summary);
      setSummaryRangeStart(summary.firstInvoiceDate || '');
      setSummaryRangeEnd(summary.lastInvoiceDate || '');
      setStep('done');
      setSummaryRefreshPhase('imported');
      if (importKind === 'sales') {
        const preparedForSave = summary.rowsPreparedForSaveCount || 0;
        const savedSuccessfully = summary.rowsSavedSuccessfullyCount || 0;
        const inserted = summary.insertedRows || 0;
        const confirmed = summary.confirmedExistingInvoices ?? summary.updatedInvoices ?? 0;
        const duplicates = summary.skippedDuplicates || 0;
        if (preparedForSave > 0 && savedSuccessfully < preparedForSave) {
          toast.warning(
            `تم حفظ ${savedSuccessfully.toLocaleString('ar-EG')} من ${preparedForSave.toLocaleString('ar-EG')} فاتورة فقط. راجع تشخيص الحفظ وتقرير المراجعة.`
          );
        } else if (inserted === 0 && confirmed === 0) {
          if (duplicates > 0) {
            toast.info(`لا توجد فواتير جديدة. تم تجاهل ${duplicates} فاتورة مكررة.`);
          } else {
            toast.info('لا توجد فواتير جديدة');
          }
        } else if (duplicates > 0) {
          toast.success(`تم الاستيراد بنجاح. تم تجاهل ${duplicates} فاتورة مكررة.`);
        } else {
          toast.success('تم الاستيراد بنجاح');
        }
      } else {
        toast.success('تم استيراد بيانات العملاء');
      }

      const currentUserProfile = getCurrentUserProfile();
      await logActivity(
        currentUserProfile.id,
        currentUserProfile.name,
        importKind === 'sales' ? 'استيراد مبيعات يومية' : 'استيراد بيانات عملاء',
        importKind === 'sales' ? 'الفواتير' : 'العملاء',
        importKind === 'sales'
          ? `قراءة ${summary.distinctInvoicesInFile || summary.totalRows} فاتورة - إضافة ${summary.insertedRows} - موجود/محدث ${summary.confirmedExistingInvoices ?? summary.updatedInvoices ?? 0} - صافي الملف ${formatCurrency(summary.fileNetSales || 0)} - صافي المؤكد ${formatCurrency(summary.processedNetSales ?? summary.savedNetSales ?? summary.importedNetSales ?? 0)} - مراجعة ${summary.needsReviewRows}`
          : `استيراد ${summary.insertedRows} صف - تحديث ${summary.updatedCustomers} عميل - إضافة ${summary.newCustomers} عميل`,
        branch
      );
      if (importKind === 'sales') {
        await queryClient.invalidateQueries({ queryKey: ['supabase'] });
        await loadManagedInvoices();
        await loadInvoiceSummarySnapshot();
        await supabase.from('notifications').insert({
          title: 'استيراد ملف فواتير جديد',
          message: `تم قراءة ${summary.distinctInvoicesInFile || summary.totalRows} فاتورة من ${fileName}. تمت إضافة ${summary.insertedRows} وتأكيد/تحديث ${summary.confirmedExistingInvoices ?? summary.updatedInvoices ?? 0}. صافي الملف ${formatCurrency(summary.fileNetSales || 0)}، وصافي الجديد + الموجود المؤكد ${formatCurrency(summary.processedNetSales ?? summary.savedNetSales ?? summary.importedNetSales ?? 0)}.`,
          type: 'sales_import',
          severity: summary.errors.length ? 'medium' : 'info',
          entity_type: 'sales_invoices',
          entity_id: summary.importBatch,
          route_path: '/analytics',
          is_read: false,
          created_at: new Date().toISOString(),
        });
      }
    } catch (error) {
      toast.error(`فشل حفظ بعض الصفوف: ${(error as Error).message}`);
      setStep('preview');
    }
  };

  const handleReset = () => {
    setStep('idle');
    setFileName('');
    setParseResult(null);
    setImportSummary(null);
    setProgress(0);
    setSummaryRefreshPhase('idle');
    setPhoneUpdateParseResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const rebuildSalesSummaries = async () => {
    setSummaryRefreshBusy(true);
    setSummaryRefreshPhase('failed');
    try {
      await loadInvoiceSummarySnapshot();
      toast.info('تحديث الملخصات غير مفعل حاليًا، سيتم الاعتماد على الفواتير المباشرة.');
    } finally {
      setSummaryRefreshBusy(false);
    }
  };

  const handlePhoneUpdateFile = async (file: File) => {
    if (!/\.(csv|xlsx|xls)$/i.test(file.name)) {
      toast.error('ملف تحديث أرقام العملاء يجب أن يكون CSV أو Excel');
      return;
    }

    setPhoneUpdateBusy(true);
    setPhoneUpdateFileName(file.name);
    setPhoneUpdateResult(null);
    setPhoneUpdateParseResult(null);
    setPhoneUpdateConfirmText('');
    try {
      const parsed = await parseCustomerPhoneFile(file, {
        copyPhoneToWhatsappWhenMissing: copyPhoneToWhatsapp,
      });
      const rows = parsed.rows;
      setPhoneUpdateParseResult(parsed);
      setPhoneUpdateRows(rows);
      if (rows.length === 0) {
        toast.error('لم يتم العثور على صفوف صالحة في ملف تحديث الأرقام');
        return;
      }
      const preview = await previewCustomerPhoneUpdate(rows);
      setPhoneUpdateResult(preview);
      toast.success(`تمت معاينة ${preview.rowsInFile.toLocaleString('ar-EG')} صف بدون كتابة`);
    } catch (error) {
      toast.error(`تعذر معاينة ملف الأرقام: ${(error as Error).message}`);
    } finally {
      setPhoneUpdateBusy(false);
    }
  };

  const handleApplyPhoneUpdate = async () => {
    if (phoneUpdateConfirmText.trim() !== CUSTOMER_PHONE_CONFIRMATION) {
      toast.error(`اكتب عبارة التأكيد: ${CUSTOMER_PHONE_CONFIRMATION}`);
      return;
    }
    if (phoneUpdateRows.length === 0) {
      toast.error('لا توجد صفوف جاهزة للتطبيق');
      return;
    }

    setPhoneUpdateBusy(true);
    try {
      const result = await applyCustomerPhoneUpdate(phoneUpdateRows, {
        id: user?.id,
        name: user?.name,
        role: user?.role,
      });
      setPhoneUpdateResult(result);
      setPhoneUpdateConfirmText('');
      toast.success('تم تحديث أرقام العملاء وإعادة بناء ملخص العملاء');
    } catch (error) {
      toast.error(`تعذر تحديث أرقام العملاء: ${(error as Error).message}`);
    } finally {
      setPhoneUpdateBusy(false);
    }
  };

  const downloadPhoneUpdatePreviewReport = (
    kind: 'all' | 'repair' | 'review' | 'invalid' | 'unmatched' = 'all'
  ) => {
    if (!phoneUpdateResult) return;
    const headers = [
      'row_no',
      'customer_code',
      'customer_name',
      'branch',
      'address',
      'new_phone',
      'new_whatsapp_phone',
      'phone_alt',
      'status',
      'match_method',
      'would_update_phone',
      'would_update_whatsapp',
      'would_update_phone_alt',
      'would_update_address',
      'would_update_name',
      'would_update_branch',
    ];
    const filteredRows = phoneUpdateResult.rows.filter((row) => {
      if (kind === 'repair')
        return (
          row.status === 'new_customer' ||
          row.would_update_phone ||
          row.would_update_whatsapp ||
          row.would_update_phone_alt ||
          row.would_update_address ||
          row.would_update_name ||
          row.would_update_branch
        );
      if (kind === 'review')
        return row.status.includes('review') || row.status === 'duplicate_in_file';
      if (kind === 'invalid') return row.status === 'invalid_phone' || row.status === 'invalid_row';
      if (kind === 'unmatched') return row.status === 'unmatched';
      return true;
    });
    const escapeCsv = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [
      headers.join(','),
      ...filteredRows.map((row) =>
        headers.map((key) => escapeCsv((row as Record<string, unknown>)[key])).join(',')
      ),
    ];
    const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `daily-customer-import-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const invoiceBatches = useMemo(() => {
    const map = new Map<
      string,
      {
        batch: string;
        count: number;
        total: number;
        firstDate: string;
        lastDate: string;
        branches: Set<string>;
      }
    >();
    for (const invoice of managedInvoices) {
      const batch = invoice.import_batch || 'بدون رقم دفعة';
      const date = String(invoice.invoice_date || '').slice(0, 10);
      const current = map.get(batch) || {
        batch,
        count: 0,
        total: 0,
        firstDate: date || '-',
        lastDate: date || '-',
        branches: new Set<string>(),
      };
      current.count += 1;
      current.total += invoiceSalesValue(invoice);
      if (date && (current.firstDate === '-' || date < current.firstDate)) current.firstDate = date;
      if (date && (current.lastDate === '-' || date > current.lastDate)) current.lastDate = date;
      if (invoice.branch) current.branches.add(invoice.branch);
      map.set(batch, current);
    }
    return [...map.values()].sort((a, b) => b.lastDate.localeCompare(a.lastDate));
  }, [managedInvoices]);

  const logInvoiceAdminAction = async (
    action: string,
    description: string,
    details?: Record<string, unknown>
  ) => {
    const currentUserProfile = getCurrentUserProfile();
    await logActivity(
      currentUserProfile.id,
      currentUserProfile.name,
      action,
      'الفواتير',
      description,
      'كل الفروع',
      details
    );
  };

  const deleteInvoiceBatch = async (batch: string) => {
    if (!canDeleteBatches || adminBusy) return;
    if (!window.confirm(`تأكيد مسح دفعة الفواتير: ${batch}`)) return;

    setAdminBusy(true);
    const affectedIdentifiers = Array.from(
      new Set(
        managedInvoices
          .filter((invoice) =>
            batch === 'بدون رقم دفعة' ? !invoice.import_batch : invoice.import_batch === batch
          )
          .map((invoice) => invoice.customer_code || invoice.customer_phone)
          .filter(Boolean)
      )
    );
    const query = supabase.from('sales_invoices').delete();
    const { error } =
      batch === 'بدون رقم دفعة'
        ? await query.is('import_batch', null)
        : await query.eq('import_batch', batch);

    if (error) {
      toast.error(`تعذر مسح الدفعة: ${error.message}`);
    } else {
      toast.success('تم مسح دفعة الفواتير');
      if (affectedIdentifiers.length > 0) {
        await supabase.from('customer_analysis').delete().in('customer_code', affectedIdentifiers);
      }
      await logInvoiceAdminAction('مسح دفعة فواتير', `مسح دفعة ${batch}`, { import_batch: batch });
      await loadManagedInvoices();
    }
    setAdminBusy(false);
  };

  const deleteTableRowsInChunks = async (table: string, batchSize = 400) => {
    let deleted = 0;
    for (let round = 0; round < 1000; round += 1) {
      const { data, error: selectError } = await supabase.from(table).select('id').limit(batchSize);
      if (selectError) {
        if (
          selectError.message.includes('does not exist') ||
          selectError.message.includes('schema cache')
        )
          return deleted;
        throw new Error(selectError.message);
      }

      const ids = (data || []).map((row) => row.id).filter(Boolean);
      if (ids.length === 0) return deleted;

      const { error: deleteError } = await supabase.from(table).delete().in('id', ids);
      if (deleteError) throw new Error(deleteError.message);

      deleted += ids.length;
      if (ids.length < batchSize) return deleted;
    }
    return deleted;
  };

  const deleteAllInvoices = async () => {
    if (!canDeleteBatches || adminBusy) return;
    if (deleteConfirmText.trim() !== 'مسح الفواتير') {
      toast.error('اكتب عبارة التأكيد كما هي: مسح الفواتير');
      return;
    }

    setAdminBusy(true);
    const loadingToast = toast.loading('جاري مسح الفواتير على دفعات...');
    try {
      const deletedInvoices = await deleteTableRowsInChunks('sales_invoices');
      await deleteTableRowsInChunks('customer_analysis');
      await logInvoiceAdminAction(
        'مسح كل الفواتير',
        'مسح كل فواتير التجربة وتحليل العملاء المرتبط بها',
        {
          deleted_invoice_count: deletedInvoices,
        }
      );
      setDeleteConfirmText('');
      setManagedInvoices([]);
      toast.success('تم مسح كل الفواتير التجريبية. يمكنك رفع الفواتير من البداية الآن.', {
        id: loadingToast,
      });
    } catch (error) {
      toast.error(`تعذر مسح الفواتير: ${(error as Error).message}`, { id: loadingToast });
    } finally {
      setAdminBusy(false);
    }
  };

  const startEditInvoice = (invoice: ManagedInvoiceRow) => {
    setEditInvoice(invoice);
    setEditForm({
      branch: invoice.branch || branch,
      invoice_number: getInvoiceKey(invoice as unknown as Record<string, unknown>),
      invoice_date: String(invoice.invoice_date || '').slice(0, 10),
      invoice_type: invoice.invoice_type || '',
      customer_code: invoice.customer_code || '',
      customer_name: invoice.customer_name || '',
      customer_phone: invoice.customer_phone || '',
      seller_name: invoice.seller_name || '',
      amount: String(invoice.amount ?? ''),
      net_amount: String(invoice.net_amount ?? ''),
      gross_amount: String(invoice.gross_amount ?? ''),
    });
  };

  const saveInvoiceEdit = async () => {
    if (!canManageBatches || !editInvoice || !editForm || adminBusy) return;
    const amount = Number(editForm.amount);
    const netAmount = editForm.net_amount.trim() ? Number(editForm.net_amount) : amount;
    const grossAmount = editForm.gross_amount.trim() ? Number(editForm.gross_amount) : amount;
    if (!editForm.invoice_date || !Number.isFinite(amount)) {
      toast.error('راجع التاريخ وقيمة الفاتورة قبل الحفظ');
      return;
    }

    setAdminBusy(true);
    const payload = {
      branch: editForm.branch,
      invoice_no: editForm.invoice_number,
      invoice_number: editForm.invoice_number,
      invoice_date: editForm.invoice_date,
      invoice_type: editForm.invoice_type,
      customer_code: editForm.customer_code,
      customer_name: editForm.customer_name,
      customer_phone: editForm.customer_phone,
      seller_name: editForm.seller_name,
      amount,
      net_amount: Number.isFinite(netAmount) ? netAmount : amount,
      gross_amount: Number.isFinite(grossAmount) ? grossAmount : amount,
    };
    const { error } = await supabase
      .from('sales_invoices')
      .update(payload)
      .eq('id', editInvoice.id);
    if (error) {
      toast.error(`تعذر تعديل الفاتورة: ${error.message}`);
    } else {
      toast.success('تم حفظ تعديل الفاتورة');
      await logInvoiceAdminAction(
        'تعديل فاتورة',
        `تعديل فاتورة ${editForm.invoice_number || getInvoiceKey(editInvoice as unknown as Record<string, unknown>) || editInvoice.id}`,
        {
          invoice_id: editInvoice.id,
          new_value: payload,
        }
      );
      setEditInvoice(null);
      setEditForm(null);
      await loadManagedInvoices();
    }
    setAdminBusy(false);
  };

  const validCount = parseResult?.rows.length ?? 0;
  const errorCount = parseResult?.errors.length ?? 0;
  const totalAmount =
    importKind === 'sales' && parseResult
      ? (parseResult as ParseResult).rows.reduce((sum, row) => sum + row.amount, 0)
      : 0;

  const daySalesChartRows = useMemo(
    () => (importSummary ? buildDaySalesChartRows(importSummary) : []),
    [importSummary]
  );
  const visibleDaySalesChartRows = useMemo(
    () =>
      showEmptyChartDays
        ? daySalesChartRows
        : daySalesChartRows.filter((row) => !isEmptyComparisonDay(row)),
    [daySalesChartRows, showEmptyChartDays]
  );
  const hiddenEmptyChartDaysCount = daySalesChartRows.length - visibleDaySalesChartRows.length;
  const chartMaxTotal = Math.max(
    1,
    ...visibleDaySalesChartRows.map((row) =>
      Math.max(row.shokryTotal, row.shamyTotal, row.otherTotal, row.databaseTotal)
    )
  );
  const chartTickStep = Math.max(1, Math.ceil(visibleDaySalesChartRows.length / 10));
  const chartSummary = useMemo(
    () =>
      daySalesChartRows.reduce(
        (acc, row) => {
          acc.total += row.fileTotal;
          acc.shokry += row.shokryTotal;
          acc.shamy += row.shamyTotal;
          acc.salesDays += row.fileCount > 0 || row.databaseCount > 0 ? 1 : 0;
          acc.missingOrZeroDays +=
            row.status === 'missing_in_database' || row.status === 'partial' || isEmptyComparisonDay(row)
              ? 1
              : 0;
          return acc;
        },
        { total: 0, shokry: 0, shamy: 0, salesDays: 0, missingOrZeroDays: 0 }
      ),
    [daySalesChartRows]
  );

  const rowsForPreview = parseResult?.rows.slice(0, 120) ?? [];
  const importWarningGroups = useMemo(() => {
    const messages = Array.from(
      new Set((importSummary?.errors || []).map((error) => error.message).filter(Boolean))
    );
    const missingDatabaseDays = (importSummary?.dayDatabaseComparison || []).filter(
      (row) => row.status === 'missing_in_database'
    );
    const critical = messages.filter(
      (message) =>
        !isSummaryRefreshNotice(message) &&
        !message.includes('مكررة') &&
        !message.includes('schema cache') &&
        !message.includes('staff_id')
    );
    const dataWarnings = [
      ...(importSummary && (importSummary.conflictReviewRows || 0) > 0
        ? [
            'يوجد أرقام فواتير موجودة سابقًا بتاريخ أو فرع مختلف وتحتاج مراجعة يدوية، وتم منع إدخالها لتجنب التكرار.',
          ]
        : []),
      ...(missingDatabaseDays.length > 0
        ? ['يوجد أيام في الملف لم تظهر في قاعدة البيانات بعد الاستيراد']
        : []),
      ...messages.filter((message) => message.includes('مكررة')),
    ];
    const recommendations = [
      ...(importSummary?.schemaWarnings || []),
      ...(importSummary?.summaryRefreshStatus === 'unavailable' &&
      importSummary.summaryRefreshMessage
        ? ['تحديث الملخصات غير مفعل حاليًا، سيتم الاعتماد على الفواتير المباشرة.']
        : []),
    ];

    return {
      critical: Array.from(new Set(critical)),
      dataWarnings: Array.from(new Set(dataWarnings)),
      recommendations: Array.from(new Set(recommendations)),
    };
  }, [importSummary]);

  const summaryRefreshState =
    summaryRefreshPhase === 'updated'
      ? 'refreshed'
      : summaryRefreshPhase === 'failed' || summaryRefreshPhase === 'imported' || summaryRefreshPhase === 'idle'
        ? 'unavailable'
        : importSummary?.summaryRefreshStatus || 'unavailable';
  const summaryRefreshLabel =
    summaryRefreshState === 'refreshed'
      ? 'تم'
      : summaryRefreshState === 'manual_required' || summaryRefreshState === 'unavailable'
        ? 'غير مفعل'
        : 'تم التخطي';
  const summaryRefreshTone =
    summaryRefreshState === 'refreshed'
      ? 'border-emerald-300/30 bg-emerald-400/10 text-emerald-50'
      : summaryRefreshState === 'manual_required' || summaryRefreshState === 'unavailable'
        ? 'border-amber-300/35 bg-amber-400/10 text-amber-50'
        : 'border-sky-300/30 bg-sky-400/10 text-sky-50';

  return (
    <div className="space-y-5 max-w-5xl">
      {sellerNameFilter && (
        <div className="bg-teal-500/10 border border-teal-500/30 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-teal-300">
              عرض فواتير: <span className="font-bold text-white">{sellerNameFilter}</span>
            </div>
          </div>
          <button
            onClick={() => {
              setSearchParams({});
            }}
            className="rounded-lg border border-teal-400/30 bg-teal-500/10 px-3 py-1.5 text-teal-200 hover:bg-teal-500/20 flex items-center gap-2 text-sm"
          >
            <X size={14} />
            مسح التصفية
          </button>
        </div>
      )}

      <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-5">
        <div className="section-title mb-3">استيراد يومي ثابت</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <InfoBox
            title="ملف المبيعات"
            items={[
              'الهيدر في الصف الثاني',
              'يعتمد الكود والعميل وقيمة الصافي',
              'يحفظ المستخدم داخل بيانات الفاتورة لتحليل الدكاترة',
            ]}
          />
          <InfoBox
            title="ملف العملاء"
            items={[
              'الكود هو مفتاح الربط',
              'الموبايل/التليفون لتحديث العميل',
              'العنوان محفوظ مع بيانات العميل إن كان العمود موجودًا',
            ]}
          />
          <InfoBox
            title="تصنيف العملاء"
            items={[
              'مهم جدًا: 8000+',
              'مهم: 4000 إلى 8000',
              'متوسط: 1500 إلى 4000',
              'عادي: أقل من 1500',
            ]}
          />
        </div>
        <button
          onClick={generateTemplateFile}
          className="btn-secondary mt-4 flex items-center gap-2"
        >
          <Download size={15} /> تحميل نموذج مبيعات
        </button>
      </div>

      <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-5 space-y-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="section-title">استيراد وتحديث العملاء من CSV / Excel</div>
            <div className="text-sm text-slate-400">
              يضيف العملاء الجدد ويصلح بيانات العملاء الموجودين في public.customers فقط، ولا يلمس
              sales_invoices أو customer_metrics_summary مباشرة.
            </div>
          </div>
          <div className="flex flex-col items-start gap-2">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-200">
              <input
                type="checkbox"
                checked={copyPhoneToWhatsapp}
                onChange={(event) => setCopyPhoneToWhatsapp(event.target.checked)}
                disabled={phoneUpdateBusy}
              />
              استخدم نفس الرقم للواتساب إذا كان واتساب فارغًا
            </label>
            <label className="btn-secondary flex w-fit cursor-pointer items-center gap-2">
              <Upload size={15} /> اختيار ملف العملاء
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                disabled={phoneUpdateBusy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handlePhoneUpdateFile(file);
                  event.currentTarget.value = '';
                }}
              />
            </label>
          </div>
        </div>

        {phoneUpdateBusy && (
          <div className="flex items-center gap-2 rounded-xl border border-teal-300/25 bg-teal-400/10 px-4 py-3 text-sm text-teal-50">
            <Loader2 size={16} className="animate-spin" /> جاري فحص ملف العملاء وإنشاء معاينة
            آمنة...
          </div>
        )}

        {phoneUpdateResult && (
          <div className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
              الملف:{' '}
              <span className="font-bold text-white">{phoneUpdateFileName || 'ملف العملاء'}</span>
              <span className="mx-2 text-slate-500">|</span>
              الحالة:{' '}
              <span className="font-bold text-teal-300">
                {phoneUpdateResult.apply ? 'تم التطبيق' : 'معاينة فقط بدون كتابة'}
              </span>
            </div>
            {phoneUpdateParseResult && (
              <div className="rounded-xl border border-teal-300/20 bg-teal-400/10 px-4 py-3 text-sm text-teal-50">
                <div className="font-black">خريطة الأعمدة المكتشفة</div>
                <div className="mt-2 grid gap-2 md:grid-cols-3">
                  <span>
                    كود العميل: {phoneUpdateParseResult.mapping.customerCodeColumn || 'غير موجود'}
                  </span>
                  <span>
                    اسم العميل: {phoneUpdateParseResult.mapping.customerNameColumn || 'غير موجود'}
                  </span>
                  <span>
                    الفرع/العنوان: {phoneUpdateParseResult.mapping.branchColumn || 'غير موجود'}
                  </span>
                  <span>
                    الهاتف الأساسي: {phoneUpdateParseResult.mapping.phoneColumn || 'غير موجود'}
                  </span>
                  <span>
                    واتساب: {phoneUpdateParseResult.mapping.whatsappColumn || 'غير موجود'}
                  </span>
                  <span>
                    إصلاح صفر البداية:{' '}
                    {phoneUpdateParseResult.stats.normalizedLeadingZero.toLocaleString('ar-EG')}
                  </span>
                  <span>
                    تحويل من +20/0020:{' '}
                    {phoneUpdateParseResult.stats.normalizedInternational.toLocaleString('ar-EG')}
                  </span>
                  <span>
                    أرقام غير صالحة في الملف:{' '}
                    {phoneUpdateParseResult.stats.invalidPhones.toLocaleString('ar-EG')}
                  </span>
                </div>
                {(phoneUpdateParseResult.mapping.ambiguousPhoneColumns.length > 1 ||
                  phoneUpdateParseResult.mapping.ambiguousWhatsappColumns.length > 1) && (
                  <div className="mt-2 rounded-lg border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-amber-50">
                    يوجد أكثر من عمود رقم. تم اختيار أول عمود للهاتف والثاني للواتساب عند توفره.
                    راجع أول 200 صف قبل التطبيق.
                  </div>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <ResultTile value={phoneUpdateResult.rowsInFile} label="صف في الملف" />
              <ResultTile value={phoneUpdateResult.matchedCustomers} label="عملاء مطابقون" />
              <ResultTile value={phoneUpdateResult.validPhones} label="أرقام صالحة" />
              <ResultTile value={phoneUpdateResult.invalidPhones} label="أرقام مرفوضة" />
              <ResultTile value={phoneUpdateResult.wouldUpdatePhone} label="سيحدث الهاتف" />
              <ResultTile value={phoneUpdateResult.wouldUpdateWhatsapp} label="سيحدث واتساب" />
              <ResultTile value={phoneUpdateResult.repairedPhoneAlt} label="سيحدث هاتف إضافي" />
              <ResultTile value={phoneUpdateResult.repairedAddresses} label="سيحدث العنوان" />
              <ResultTile value={phoneUpdateResult.repairedNames} label="سيحدث الاسم" />
              <ResultTile value={phoneUpdateResult.repairedBranches} label="سيحدث الفرع" />
              <ResultTile value={phoneUpdateResult.insertedCustomers} label="عملاء جدد" />
              <ResultTile value={phoneUpdateResult.skippedExistingValid} label="رقم صالح موجود" />
              <ResultTile value={phoneUpdateResult.needsReviewRows} label="تحتاج مراجعة" />
              <ResultTile value={phoneUpdateResult.unmatchedRows} label="غير مطابق" />
              <ResultTile value={phoneUpdateResult.customersUpdated} label="عملاء تم تحديثهم" />
              <ResultTile
                value={phoneUpdateResult.invalidSummaryPhoneCountBefore}
                label="غير صالح قبل"
              />
              <ResultTile
                value={phoneUpdateResult.invalidSummaryPhoneCountAfter}
                label="غير صالح بعد"
              />
            </div>

            {!phoneUpdateResult.apply && (
              <div className="rounded-xl border border-amber-300/30 bg-amber-400/10 p-4">
                <div className="font-bold text-amber-100">تأكيد الكتابة</div>
                <div className="mt-1 text-sm text-amber-50/85">
                  لن يتم تحديث أي عميل إلا بعد كتابة العبارة التالية حرفيًا:{' '}
                  {CUSTOMER_PHONE_CONFIRMATION}
                </div>
                <div className="mt-3 flex flex-col gap-3 md:flex-row">
                  <input
                    className="input-dark flex-1"
                    value={phoneUpdateConfirmText}
                    onChange={(event) => setPhoneUpdateConfirmText(event.target.value)}
                    placeholder={CUSTOMER_PHONE_CONFIRMATION}
                    disabled={phoneUpdateBusy}
                  />
                  <button
                    type="button"
                    onClick={handleApplyPhoneUpdate}
                    disabled={
                      phoneUpdateBusy ||
                      phoneUpdateConfirmText.trim() !== CUSTOMER_PHONE_CONFIRMATION
                    }
                    className="btn-primary disabled:opacity-50"
                  >
                    تطبيق استيراد العملاء
                  </button>
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3 text-sm font-bold text-white">
                <span>أول 200 صف من نتيجة الفحص</span>
                <button
                  type="button"
                  onClick={() => downloadPhoneUpdatePreviewReport('all')}
                  className="btn-secondary px-3 py-1 text-xs"
                >
                  كل المعاينة
                </button>
                <button
                  type="button"
                  onClick={() => downloadPhoneUpdatePreviewReport('repair')}
                  className="btn-secondary px-3 py-1 text-xs"
                >
                  سيتم إصلاحهم
                </button>
                <button
                  type="button"
                  onClick={() => downloadPhoneUpdatePreviewReport('review')}
                  className="btn-secondary px-3 py-1 text-xs"
                >
                  تحتاج مراجعة
                </button>
                <button
                  type="button"
                  onClick={() => downloadPhoneUpdatePreviewReport('invalid')}
                  className="btn-secondary px-3 py-1 text-xs"
                >
                  أرقام مرفوضة
                </button>
                <button
                  type="button"
                  onClick={() => downloadPhoneUpdatePreviewReport('unmatched')}
                  className="btn-secondary px-3 py-1 text-xs"
                >
                  غير مطابق
                </button>
              </div>
              <div className="max-h-72 overflow-auto">
                <table className="data-table">
                  <thead className="sticky top-0 z-10 bg-[#1B2B4B]">
                    <tr>
                      <th>#</th>
                      <th>الكود</th>
                      <th>العميل</th>
                      <th>الفرع</th>
                      <th>العنوان</th>
                      <th>الهاتف الجديد</th>
                      <th>واتساب جديد</th>
                      <th>هاتف إضافي</th>
                      <th>الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {phoneUpdateResult.rows.map((row) => (
                      <tr key={row.row_no}>
                        <td className="text-slate-500 text-xs">{row.row_no}</td>
                        <td className="num">{row.customer_code || '-'}</td>
                        <td className="text-white font-medium">{row.customer_name || '-'}</td>
                        <td>{row.branch || '-'}</td>
                        <td className="max-w-[220px] truncate">{row.address || '-'}</td>
                        <td className="num text-teal-300">{row.new_phone || '-'}</td>
                        <td className="num text-teal-300">{row.new_whatsapp_phone || '-'}</td>
                        <td className="num text-teal-300">{row.phone_alt || '-'}</td>
                        <td>
                          <span
                            className={`rounded-full px-2 py-1 text-xs font-bold ${
                              row.status === 'ready_to_update'
                                ? 'bg-emerald-400/15 text-emerald-100'
                                : row.status.includes('review')
                                  ? 'bg-amber-400/15 text-amber-100'
                                  : row.status === 'unmatched' || row.status === 'invalid_phone'
                                    ? 'bg-rose-400/15 text-rose-100'
                                    : 'bg-slate-400/15 text-slate-100'
                            }`}
                          >
                            {customerImportStatusLabel(row.status)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="bg-[#1B2B4B] border border-red-500/25 rounded-2xl p-5 space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <div className="section-title flex items-center gap-2">
                <ShieldAlert size={18} className="text-red-300" />
                إدارة الفواتير المستوردة
              </div>
              <div className="text-slate-400 text-xs mt-1">
                هذا القسم ظاهر للمدير العام فقط. استخدمه لمسح بيانات التجربة أو تعديل فاتورة قبل
                إعادة الرفع المنظم.
              </div>
            </div>
            <button
              type="button"
              onClick={loadManagedInvoices}
              disabled={managedLoading || adminBusy}
              className="btn-secondary px-4 py-2 text-sm flex items-center gap-2"
            >
              <RefreshCw size={15} className={managedLoading ? 'animate-spin' : ''} />
              تحديث القائمة
            </button>
          </div>

          <div className="grid md:grid-cols-[1fr_auto] gap-3 items-end rounded-xl border border-red-500/20 bg-red-500/5 p-4">
            <label className="block text-xs text-slate-300 space-y-1">
              <span>لمسح كل الفواتير التجريبية اكتب: مسح الفواتير</span>
              <input
                className="input-dark"
                value={deleteConfirmText}
                onChange={(event) => setDeleteConfirmText(event.target.value)}
                placeholder="مسح الفواتير"
              />
            </label>
            <button
              type="button"
              onClick={deleteAllInvoices}
              disabled={adminBusy || deleteConfirmText.trim() !== 'مسح الفواتير'}
              className="rounded-xl bg-red-500/20 border border-red-400/30 px-4 py-2 text-sm font-bold text-red-200 hover:bg-red-500/30 disabled:opacity-50 flex items-center gap-2"
            >
              <Trash2 size={15} />
              مسح كل الفواتير
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile value={managedInvoices.length} label="فواتير محملة" color="text-white" />
            <StatTile value={invoiceBatches.length} label="دفعات ظاهرة" color="text-teal-400" />
            <StatTile
              value={managedInvoices.reduce((sum, row) => sum + invoiceSalesValue(row), 0)}
              label="إجمالي الظاهر"
              color="text-amber-400"
              isCurrency
            />
            <StatTile
              value={
                new Set(
                  managedInvoices
                    .map((row) => row.customer_code || row.customer_phone || row.customer_name)
                    .filter(Boolean)
                ).size
              }
              label="عملاء ظاهرين"
              color="text-purple-300"
            />
          </div>

          <div className="rounded-2xl border border-amber-300/30 bg-amber-400/10 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="font-bold text-amber-100">فحص الفواتير المكررة</div>
                <div className="mt-1 text-xs text-amber-50/80">
                  فحص محدود وآمن لأحدث الفواتير حسب رقم الفاتورة + الفرع + التاريخ، بدون تحميل كل
                  جدول المبيعات.
                </div>
              </div>
              <button
                type="button"
                onClick={loadDuplicateAudit}
                disabled={duplicateAuditLoading}
                className="rounded-xl border border-amber-200/40 bg-amber-300/15 px-4 py-2 text-sm font-bold text-amber-50 hover:bg-amber-300/25 disabled:opacity-50"
              >
                {duplicateAuditLoading ? 'جاري الفحص...' : 'عرض الفواتير المكررة'}
              </button>
            </div>
            {duplicateAudit.length > 0 && (
              <div className="mt-4 rounded-xl border border-amber-200/30 bg-slate-950/25 p-3">
                <div className="mb-2 text-sm font-bold text-amber-100">
                  يوجد فواتير مكررة قديمة تحتاج مراجعة
                </div>
                <div className="max-h-56 space-y-2 overflow-auto">
                  {duplicateAudit.map((group) => (
                    <div
                      key={`${group.invoice_number}-${group.branch}-${group.sale_date}`}
                      className="grid grid-cols-4 gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs text-slate-100"
                    >
                      <span className="font-bold">#{group.invoice_number}</span>
                      <span>{group.branch}</span>
                      <span>{group.sale_date}</span>
                      <span className="text-amber-100">
                        {group.count.toLocaleString('ar-EG')} مرات
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!duplicateAuditLoading && duplicateAudit.length === 0 && (
              <div className="mt-3 text-xs text-amber-50/70">
                اضغط زر الفحص لعرض أحدث مجموعات التكرار إن وجدت.
              </div>
            )}
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 text-white font-semibold text-sm">
              آخر دفعات الرفع
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead className="sticky top-0 z-10 bg-[#1B2B4B]">
                  <tr>
                    <th>الدفعة</th>
                    <th>الفترة</th>
                    <th>الفروع</th>
                    <th>عدد الفواتير</th>
                    <th>الإجمالي</th>
                    <th>إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {invoiceBatches.map((batchRow) => (
                    <tr key={batchRow.batch}>
                      <td className="text-white font-medium max-w-xs truncate">{batchRow.batch}</td>
                      <td className="text-slate-300">
                        {batchRow.firstDate} إلى {batchRow.lastDate}
                      </td>
                      <td className="text-slate-300">{[...batchRow.branches].join('، ') || '-'}</td>
                      <td className="num">{batchRow.count.toLocaleString('ar-EG')}</td>
                      <td className="text-amber-300 font-bold">{formatCurrency(batchRow.total)}</td>
                      <td>
                        <div className="flex gap-2">
                          <Link
                            to={`/analytics?start=${batchRow.firstDate}&end=${batchRow.lastDate}`}
                            className="rounded-lg border border-teal-400/30 bg-teal-500/10 p-2 text-teal-200 hover:bg-teal-500/20 disabled:opacity-50"
                            title="فتح في التحليلات"
                          >
                            <BarChart3 size={15} />
                          </Link>
                          <button
                            type="button"
                            onClick={() => deleteInvoiceBatch(batchRow.batch)}
                            disabled={adminBusy}
                            className="rounded-lg border border-red-400/30 bg-red-500/10 p-2 text-red-200 hover:bg-red-500/20 disabled:opacity-50"
                            title="مسح هذه الدفعة"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {invoiceBatches.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center text-slate-400 py-6">
                        لا توجد فواتير مستوردة حاليا.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 text-white font-semibold text-sm">
              آخر الفواتير للتعديل السريع
            </div>
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="data-table">
                <thead className="sticky top-0 z-10 bg-[#1B2B4B]">
                  <tr>
                    <th>رقم الفاتورة</th>
                    <th>التاريخ</th>
                    <th>الفرع</th>
                    <th>العميل</th>
                    <th>الدكتور</th>
                    <th>القيمة</th>
                    <th>تعديل</th>
                  </tr>
                </thead>
                <tbody>
                  {managedInvoices.slice(0, 120).map((invoice) => (
                    <tr key={invoice.id}>
                      <td className="num">
                        {getInvoiceKey(invoice as unknown as Record<string, unknown>) || '-'}
                      </td>
                      <td>{invoice.invoice_date ? formatDate(invoice.invoice_date) : '-'}</td>
                      <td>{invoice.branch || '-'}</td>
                      <td>{invoice.customer_name || invoice.customer_code || '-'}</td>
                      <td>{invoice.seller_name || '-'}</td>
                      <td className="text-teal-300 font-bold">
                        {formatCurrency(invoiceSalesValue(invoice))}
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => startEditInvoice(invoice)}
                          disabled={adminBusy}
                          className="rounded-lg border border-teal-400/30 bg-teal-500/10 p-2 text-teal-200 hover:bg-teal-500/20 disabled:opacity-50"
                          title="تعديل الفاتورة"
                        >
                          <Pencil size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {managedInvoices.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center text-slate-400 py-6">
                        لا توجد فواتير للتعديل.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-5 space-y-4">
        <div className="flex flex-col md:flex-row gap-3 md:items-center">
          <span className="text-slate-300 text-sm font-medium w-24">نوع الملف</span>
          <div className="flex gap-2 bg-white/5 border border-[#2d4063] p-1 rounded-xl w-fit">
            <button
              onClick={() => setImportKind('sales')}
              disabled={step === 'importing'}
              className={kindButton(importKind === 'sales')}
            >
              مبيعات يومية
            </button>
            <button
              onClick={() => setImportKind('customers')}
              disabled={step === 'importing'}
              className={kindButton(importKind === 'customers')}
            >
              بيانات العملاء
            </button>
          </div>
        </div>

        {importKind === 'sales' && (
          <div className="flex items-center gap-3">
            <label className="text-slate-300 text-sm font-medium w-24">الفرع</label>
            <select
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              disabled={step === 'importing'}
              className="input-dark max-w-xs"
            >
              {BRANCHES.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
        )}

        {(step === 'idle' || step === 'parsing') && (
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const file = event.dataTransfer.files[0];
              if (file) processFile(file);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-10 text-center transition-all cursor-pointer ${
              dragging
                ? 'border-teal-400 bg-teal-500/5'
                : 'border-[#2d4063] hover:border-teal-500/50'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) processFile(file);
              }}
            />
            {step === 'parsing' ? (
              <div className="flex flex-col items-center gap-3">
                <Loader2 size={34} className="animate-spin text-teal-400" />
                <div className="text-slate-300 font-medium">جاري تحليل الملف...</div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="w-14 h-14 rounded-2xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center">
                  <Upload size={26} className="text-teal-400" />
                </div>
                <div className="text-white font-bold">اسحب الملف هنا أو اضغط للاختيار</div>
                <div className="text-slate-400 text-sm">
                  {importKind === 'sales' ? 'ملف مبيعات الفرعين اليومي' : 'ملف بيانات العملاء'}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {(step === 'preview' || step === 'importing' || step === 'done') && parseResult && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 bg-[#1B2B4B] border border-[#2d4063] rounded-2xl px-5 py-3">
            <FileSpreadsheet size={20} className="text-teal-400" />
            <div className="flex-1 min-w-0">
              <div className="text-white text-sm font-medium truncate">{fileName}</div>
              <div className="text-slate-400 text-xs">
                {importKind === 'sales' ? 'مبيعات يومية' : 'بيانات العملاء'}
              </div>
            </div>
            {step === 'preview' && (
              <button onClick={handleReset} className="text-slate-500 hover:text-slate-300">
                <XCircle size={18} />
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile value={validCount + errorCount} label="إجمالي الصفوف" color="text-white" />
            <StatTile value={validCount} label="صفوف صالحة" color="text-teal-400" />
            <StatTile
              value={errorCount}
              label="أخطاء"
              color={errorCount ? 'text-red-400' : 'text-slate-400'}
            />
            <StatTile
              value={importKind === 'sales' ? totalAmount : validCount}
              label={importKind === 'sales' ? 'إجمالي المبالغ' : 'عملاء جاهزون'}
              color="text-amber-400"
              isCurrency={importKind === 'sales'}
            />
          </div>

          {errorCount > 0 && (
            <div className="rounded-2xl border border-red-300/35 bg-red-500/15 p-4">
              <div className="text-red-100 font-semibold text-sm flex items-center gap-2 mb-3">
                <AlertCircle size={16} /> أخطاء القراءة
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {parseResult.errors.slice(0, 80).map((error, index) => (
                  <div
                    key={index}
                    className="text-red-50 text-xs bg-slate-950/25 rounded-lg px-3 py-2"
                  >
                    {error.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          {validCount > 0 && (
            <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b border-[#2d4063] flex items-center gap-2 text-white font-semibold text-sm">
                <FileCheck size={16} className="text-teal-400" /> معاينة أول الصفوف
              </div>
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="data-table">
                  <thead className="sticky top-0 z-10 bg-[#1B2B4B]">
                    <tr>
                      <th>#</th>
                      <th>العميل</th>
                      <th>{importKind === 'sales' ? 'الكود' : 'كود العميل'}</th>
                      <th>{importKind === 'sales' ? 'المبلغ' : 'الهاتف'}</th>
                      <th>{importKind === 'sales' ? 'التاريخ' : 'العنوان'}</th>
                      {importKind === 'sales' && <th>المستخدم</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rowsForPreview.map((row, index) => (
                      <tr key={index}>
                        <td className="text-slate-500 text-xs">{row.rowIndex}</td>
                        <td className="text-white font-medium">{row.name}</td>
                        <td className="num">
                          {importKind === 'sales'
                            ? (row as ParseResult['rows'][number]).customerCode
                            : (row as CustomerParseResult['rows'][number]).code}
                        </td>
                        <td className="text-teal-400 font-bold num">
                          {importKind === 'sales'
                            ? formatCurrency((row as ParseResult['rows'][number]).amount)
                            : (row as CustomerParseResult['rows'][number]).phone || '-'}
                        </td>
                        <td className="text-slate-400">
                          {importKind === 'sales'
                            ? formatDate((row as ParseResult['rows'][number]).date)
                            : (row as CustomerParseResult['rows'][number]).address || '-'}
                        </td>
                        {importKind === 'sales' && (
                          <td className="text-slate-300">
                            {(row as ParseResult['rows'][number]).seller || '-'}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {step === 'importing' && (
            <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="text-white font-semibold text-sm flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin text-teal-400" /> جاري الاستيراد...
                </div>
                <span className="text-teal-400 font-bold text-sm num">{progress}%</span>
              </div>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {step === 'preview' && validCount > 0 && (
            <div className="flex gap-3">
              <button onClick={handleConfirmImport} className="btn-primary flex items-center gap-2">
                <CheckCircle size={16} /> تأكيد استيراد {validCount.toLocaleString('ar-EG')}{' '}
                {importKind === 'sales' ? 'فاتورة' : 'عميل'}
              </button>
              <button onClick={handleReset} className="btn-secondary flex items-center gap-2">
                <XCircle size={16} /> إلغاء
              </button>
            </div>
          )}
        </div>
      )}

      {step === 'done' && importSummary && (
        <div className="bg-[#1B2B4B] border border-teal-500/20 rounded-2xl p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-teal-500/15 flex items-center justify-center">
              <CheckCircle size={24} className="text-teal-400" />
            </div>
            <div>
              <div className="text-white font-bold text-lg">اكتمل الاستيراد</div>
              <div className="text-slate-400 text-sm">
                {importKind === 'sales' ? 'تم تحديث الفواتير والعملاء' : 'تم تحديث بيانات العملاء'}
              </div>
            </div>
          </div>
          {importKind === 'sales' && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-emerald-300/30 bg-emerald-400/10 p-4 text-emerald-50">
                <div className="text-xs font-bold uppercase tracking-wide text-emerald-100/80">
                  الاستيراد
                </div>
                <div className="mt-1 text-lg font-bold">نجح</div>
                <div className="mt-1 text-sm text-emerald-50/80">
                  تم حفظ/تأكيد الفواتير، وأي ملاحظات بيانات تظهر منفصلة أدناه.
                </div>
              </div>
              <div className={`rounded-xl border p-4 ${summaryRefreshTone}`}>
                <div className="text-xs font-bold uppercase tracking-wide opacity-80">
                  تحديث الملخصات
                </div>
                <div className="mt-1 text-lg font-bold">{summaryRefreshLabel}</div>
                <div className="mt-1 text-sm opacity-85">
                  {importSummary.summaryRefreshMessage || 'لم يتم طلب تحديث ملخصات إضافي.'}
                </div>
              </div>
            </div>
          )}
          {importKind === 'sales' && (
            <div className={`rounded-xl border p-4 ${importCompletion(importSummary).tone}`}>
              <div className="text-xs font-bold uppercase tracking-wide opacity-80">
                هل الاستيراد مكتمل؟
              </div>
              <div className="mt-1 text-lg font-bold">{importCompletion(importSummary).label}</div>
              <div className="mt-1 text-sm opacity-85">{importCompletion(importSummary).message}</div>
              <div className="mt-3 grid gap-2 text-sm md:grid-cols-4">
                <span>صافي القاعدة بعد الاستيراد: {formatCurrency(importSummary.databaseTotalNet || 0)}</span>
                <span>
                  فرق الملف والقاعدة:{' '}
                  {formatCurrency((importSummary.fileNetSales || 0) - (importSummary.databaseTotalNet || 0))}
                </span>
                <span>فواتير لم تحفظ: {(importSummary.missingInvoicesCount || 0).toLocaleString('ar-EG')}</span>
                <span>أيام مفقودة: {(importSummary.missingDaysInDatabase || []).length.toLocaleString('ar-EG')}</span>
              </div>
              <button
                type="button"
                onClick={() => downloadImportReviewCsv(importSummary)}
                className="btn-secondary mt-3 px-3 py-2 text-sm"
              >
                تحميل تقرير المراجعة CSV
              </button>
            </div>
          )}
          {importKind === 'sales' && (
            <div className="rounded-xl border border-fuchsia-300/25 bg-fuchsia-400/10 p-4 text-fuchsia-50">
              <div className="text-xs font-bold uppercase tracking-wide text-fuchsia-100/80">
                تشخيص الحفظ
              </div>
              <div className="mt-3 grid gap-2 text-sm md:grid-cols-5">
                <span>تم تجهيز: {(importSummary.rowsPreparedForSaveCount || 0).toLocaleString('ar-EG')}</span>
                <span>تم إرسال: {(importSummary.rowsActuallySentToSupabaseCount || 0).toLocaleString('ar-EG')}</span>
                <span>تم حفظه: {(importSummary.rowsSavedSuccessfullyCount || 0).toLocaleString('ar-EG')}</span>
                <span>فشل حفظه: {(importSummary.rowsFailedToSaveCount || 0).toLocaleString('ar-EG')}</span>
                <span>لم يتم محاولة حفظه: {(importSummary.rowsSaveNotAttemptedCount || 0).toLocaleString('ar-EG')}</span>
              </div>
              <div className="mt-2 text-sm text-fuchsia-50/85">
                صافي المجهز للحفظ: {formatCurrency(importSummary.rowsPreparedForSaveNet || 0)} | صافي المرسل:
                {' '}{formatCurrency(importSummary.rowsActuallySentToSupabaseNet || 0)}
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {Object.entries(
                  (importSummary.rowSaveTrace || []).reduce<Record<string, number>>((acc, row) => {
                    const reason = row.skipReason || row.saveError || row.finalStatus || 'unknown';
                    if (row.finalStatus === 'saved') return acc;
                    acc[reason] = (acc[reason] || 0) + 1;
                    return acc;
                  }, {})
                )
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 6)
                  .map(([reason, count]) => (
                    <span key={reason} className="rounded-full bg-white/15 px-2 py-1 font-bold">
                      {reason}: {count.toLocaleString('ar-EG')}
                    </span>
                  ))}
              </div>
              {(importSummary.supabaseInsertErrorsSample || []).length > 0 && (
                <div className="mt-3 rounded-lg border border-red-300/25 bg-red-400/10 p-3 text-sm text-red-50">
                  أول خطأ Supabase: {importSummary.supabaseInsertErrorsSample?.[0]?.error}
                </div>
              )}
              {(importSummary.saveBatchReports || []).length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className="data-table text-xs">
                    <thead>
                      <tr>
                        <th>Batch</th>
                        <th>الحجم</th>
                        <th>تم حفظه</th>
                        <th>فشل</th>
                        <th>الخطأ</th>
                        <th>أرقام الفواتير</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(importSummary.saveBatchReports || []).slice(0, 6).map((batch) => (
                        <tr key={batch.batchNumber}>
                          <td>{batch.batchNumber}</td>
                          <td>{batch.batchSize.toLocaleString('ar-EG')}</td>
                          <td>{batch.batchInsertedCount.toLocaleString('ar-EG')}</td>
                          <td>{batch.batchFailedCount.toLocaleString('ar-EG')}</td>
                          <td className="max-w-xs truncate">{batch.batchError || '-'}</td>
                          <td className="max-w-sm truncate">
                            {(batch.affectedInvoiceNumbers || []).slice(0, 12).join(', ')}
                            {(batch.affectedInvoiceNumbers || []).length > 12 ? ' ...' : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {(importSummary.saveBatchReports || []).length > 6 && (
                    <div className="mt-2 text-xs text-fuchsia-50/75">
                      تم عرض أول 6 batches فقط. التقرير CSV يحتوي تفاصيل الصفوف.
                    </div>
                  )}
                </div>
              )}
              {(importSummary.postSaveVerificationRows || []).length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <div className="mb-2 text-xs font-bold text-fuchsia-100/80">
                    أول 20 صف من تشخيص المطابقة بعد الحفظ
                  </div>
                  <table className="data-table text-xs">
                    <thead>
                      <tr>
                        <th>invoice_number</th>
                        <th>branch</th>
                        <th>invoice_date</th>
                        <th>actual_action</th>
                        <th>matched_existing_id</th>
                        <th>matched_existing_invoice_date</th>
                        <th>matched_existing_branch</th>
                        <th>post_save_found</th>
                        <th>post_import_status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(importSummary.postSaveVerificationRows || []).map((row, index) => (
                        <tr key={`${row.invoice_number}-${row.invoice_date}-${row.branch}-${index}`}>
                          <td>{row.invoice_number}</td>
                          <td>{row.branch}</td>
                          <td>{row.invoice_date}</td>
                          <td>{row.actual_action}</td>
                          <td>{row.matched_existing_id || '-'}</td>
                          <td>{row.matched_existing_invoice_date || '-'}</td>
                          <td>{row.matched_existing_branch || '-'}</td>
                          <td>{row.post_save_found ? 'true' : 'false'}</td>
                          <td>{row.post_import_status || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          <div
            className={`grid gap-3 ${importKind === 'sales' ? 'grid-cols-2 md:grid-cols-6' : 'grid-cols-2 md:grid-cols-4'}`}
          >
            <ResultTile
              value={importKind === 'sales' ? importSummary.totalRows : importSummary.insertedRows}
              label={importKind === 'sales' ? 'صفوف مقروءة من الملف' : 'صفوف أضيفت'}
            />
            {importKind === 'sales' && (
              <ResultTile value={importSummary.validRows} label="صفوف صالحة" />
            )}
            {importKind === 'sales' && (
              <ResultTile
                value={importSummary.distinctInvoicesInFile || 0}
                label="فواتير مميزة بالملف"
              />
            )}
            {importKind === 'sales' && (
              <ResultTile value={importSummary.insertedRows} label="فواتير جديدة" />
            )}
            {importKind === 'sales' && (
              <ResultTile
                value={importSummary.confirmedExistingInvoices ?? importSummary.updatedInvoices ?? 0}
                label="موجودة/محدثة"
              />
            )}
            {importKind === 'sales' && (
              <ResultTile value={importSummary.valueChangedUpdates || 0} label="قيم اتعدلت" />
            )}
            <ResultTile
              value={importSummary.skippedDuplicates}
              label={importKind === 'sales' ? 'فواتير متخطاة' : 'مكرر تخطى'}
            />
            <ResultTile value={importSummary.updatedCustomers} label="عميل محدث" />
            <ResultTile value={importSummary.newCustomers} label="عميل جديد" />
            {importKind === 'sales' && (
              <>
                <ResultTile value={importSummary.needsReviewRows} label="تحتاج مراجعة" />
                <ResultTile
                  value={importSummary.conflictReviewRows || 0}
                  label="تعارض رقم فاتورة"
                />
                <ResultTile value={importSummary.unlinkedCustomersEstimate} label="ربط عميل ضعيف" />
                <ResultTile
                  value={importSummary.unmatchedCustomerRows || 0}
                  label="عميل غير مسجل"
                />
                <ResultTile value={importSummary.zeroAmountRows || 0} label="فواتير صفرية" />
                <ResultTile value={errorCount} label="صفوف غير صالحة" />
                <ResultTile value={importSummary.invoicesWithoutCustomer || 0} label="بدون عميل" />
                <ResultTile value={importSummary.invoicesWithoutDoctor || 0} label="بدون دكتور" />
                <ResultTile value={importSummary.invoicesWithoutBranch || 0} label="بدون فرع" />
                <ResultTile value={importSummary.fileNetSales} label="صافي الملف" isCurrency />
                <ResultTile
                  value={importSummary.insertedNetSales || 0}
                  label="صافي الفواتير الجديدة"
                  isCurrency
                />
                <ResultTile
                  value={importSummary.confirmedExistingNetSales ?? importSummary.updatedNetSales ?? 0}
                  label="صافي الفواتير الموجودة"
                  isCurrency
                />
                <ResultTile
                  value={importSummary.processedNetSales ?? importSummary.savedNetSales ?? importSummary.importedNetSales}
                  label="صافي الجديد + الموجود"
                  isCurrency
                />
                <ResultTile
                  value={importSummary.savedNetSales ?? importSummary.importedNetSales}
                  label="صافي المحفوظ/المحدث فعليًا"
                  isCurrency
                />
                <ResultTile
                  value={importSummary.reviewNetSales || 0}
                  label="صافي يحتاج مراجعة"
                  isCurrency
                />
              </>
            )}
          </div>
          {importKind === 'sales' && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-sky-300/25 bg-sky-400/10 p-4">
                <div className="font-bold text-sky-100">حالة الملخصات الخفيفة</div>
                <div className="mt-2 text-sm text-sky-50/85">
                  {summarySnapshotMessage || (summarySnapshot?.latestUpdatedAt ? `آخر تحديث: ${formatDate(summarySnapshot.latestUpdatedAt)}` : 'لم يتم تسجيل تحديث بعد الاستيراد.')}
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <div className="space-y-2 text-xs text-sky-50/80">
                    <div className="font-semibold text-sky-100">حسب اليوم</div>
                    {(summarySnapshot?.dailyRows || []).slice(0, 4).map((row) => (
                      <div key={row.summary_date} className="flex justify-between rounded-lg bg-slate-950/20 px-3 py-2">
                        <span>{row.summary_date}</span>
                        <span>{row.invoices_count.toLocaleString('ar-EG')} | {formatCurrency(row.net_total)}</span>
                      </div>
                    ))}
                    {!summarySnapshot?.dailyRows?.length && <div className="rounded-lg bg-slate-950/20 px-3 py-2">لا توجد بيانات يومية حتى الآن</div>}
                  </div>
                  <div className="space-y-2 text-xs text-sky-50/80">
                    <div className="font-semibold text-sky-100">حسب الفرع</div>
                    {(summarySnapshot?.branchRows || []).slice(0, 4).map((row) => (
                      <div key={row.branch_name} className="flex justify-between rounded-lg bg-slate-950/20 px-3 py-2">
                        <span>{row.branch_name}</span>
                        <span>{row.invoices_count.toLocaleString('ar-EG')} | {formatCurrency(row.net_total)}</span>
                      </div>
                    ))}
                    {!summarySnapshot?.branchRows?.length && <div className="rounded-lg bg-slate-950/20 px-3 py-2">لا توجد بيانات فرعية حتى الآن</div>}
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-teal-300/25 bg-teal-400/10 p-4">
                <div className="font-bold text-teal-100">تفاصيل تحديث الملخصات</div>
                <div className="mt-2 text-sm text-teal-50/85">
                  {importSummary.summaryRefreshMessage || 'لم يتم طلب تحديث ملخصات إضافي.'}
                </div>
                <div className="mt-4 space-y-2">
                  {(importSummary.postImportRefreshSteps || []).map((refreshStep) => {
                    const isSuccess = refreshStep.status === 'success';
                    const isFailed = refreshStep.status === 'failed';
                    return (
                      <div
                        key={refreshStep.key}
                        className={`rounded-xl border px-3 py-2 text-sm ${
                          isSuccess
                            ? 'border-emerald-300/35 bg-emerald-300/15 text-emerald-50'
                            : isFailed
                              ? 'border-amber-300/35 bg-amber-300/15 text-amber-50'
                              : 'border-amber-300/35 bg-amber-300/15 text-amber-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-bold">{refreshStep.label}</span>
                          <span className="shrink-0 rounded-full bg-white/15 px-2 py-0.5 text-xs">
                            {isSuccess ? 'تم' : isFailed ? 'يحتاج تحديث يدوي' : 'تخطي'}
                          </span>
                        </div>
                        <div className="mt-1 opacity-90">{refreshStep.message}</div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="text-xs text-slate-300">
                    <span>من</span>
                    <input
                      type="date"
                      value={summaryRangeStart}
                      onChange={(event) => setSummaryRangeStart(event.target.value)}
                      className="input-dark mt-1"
                    />
                  </label>
                  <label className="text-xs text-slate-300">
                    <span>إلى</span>
                    <input
                      type="date"
                      value={summaryRangeEnd}
                      onChange={(event) => setSummaryRangeEnd(event.target.value)}
                      className="input-dark mt-1"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => rebuildSalesSummaries()}
                  disabled={true}
                  title="تحديث الملخصات غير مفعل حاليًا، سيتم الاعتماد على الفواتير المباشرة"
                  className="mt-3 rounded-xl border border-teal-200/40 bg-teal-300/15 px-4 py-2 text-sm font-bold text-teal-50 hover:bg-teal-300/25 disabled:opacity-50"
                >
                  {summaryRefreshBusy ? 'جاري تحديث الملخصات...' : 'تحديث الملخصات غير مفعل'}
                </button>
              </div>
              <div className="rounded-xl border border-sky-300/25 bg-sky-400/10 p-4">
                <div className="font-bold text-sky-100">ربط الدكاترة</div>
                <div className="mt-2 text-sm text-sky-50/85">
                  {importSummary.staffLinkingMode === 'staff_id'
                    ? 'تم الربط عبر staff_id عندما كان متاحًا، مع الاحتفاظ باسم الدكتور.'
                    : 'staff_id غير متاح أو غير مطابق، يتم الربط مؤقتًا بالاسم بعد التطبيع والفرع.'}
                </div>
              </div>
            </div>
          )}
          {importKind === 'sales' && (
            <>
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="mb-1 font-bold text-white">فواتير مفهومة من الملف حسب اليوم</div>
                <div className="mb-3 text-xs text-slate-400">
                  عدد وقيمة الفواتير التي تم استخراجها من الملف قبل الحفظ.
                </div>
                <div className="max-h-48 space-y-2 overflow-auto">
                  {(importSummary.parsedRowsByDate || []).map((row) => (
                    <div
                      key={row.date}
                      className="flex items-center justify-between rounded-lg bg-slate-950/20 px-3 py-2 text-sm text-slate-200"
                    >
                      <span>{row.date}</span>
                      <span>
                        {row.count.toLocaleString('ar-EG')} | {formatCurrency(row.total)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="mb-1 font-bold text-white">عدد الفواتير المحفوظة حسب اليوم</div>
                <div className="mb-3 text-xs text-slate-400">
                  عدد وقيمة الفواتير التي وصلت للحفظ أو التحديث في قاعدة البيانات.
                </div>
                <div className="max-h-48 space-y-2 overflow-auto">
                  {(importSummary.savedRowsByDate || []).map((row) => (
                    <div
                      key={row.date}
                      className="flex items-center justify-between rounded-lg bg-slate-950/20 px-3 py-2 text-sm text-slate-200"
                    >
                      <span>{row.date}</span>
                      <span>
                        {row.count.toLocaleString('ar-EG')} | {formatCurrency(row.total)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="mb-1 font-bold text-white">استعلام قاعدة البيانات</div>
                <div className="mb-3 text-xs text-slate-400">
                  معلومات حول استعلام يومية فواتير `sales_invoices`.
                </div>
                <div className="space-y-2 text-sm text-slate-200">
                  <div>الجدول: {importSummary.databaseComparisonQuery?.table || '-'}</div>
                  <div>العمود: {importSummary.databaseComparisonQuery?.dateColumn || '-'}</div>
                  <div>gte: {importSummary.databaseComparisonQuery?.gte || '-'}</div>
                  <div>lt: {importSummary.databaseComparisonQuery?.lt || '-'}</div>
                  <div>fileMinDate: {importSummary.databaseComparisonQuery?.fileMinDate || '-'}</div>
                  <div>fileMaxDate: {importSummary.databaseComparisonQuery?.fileMaxDate || '-'}</div>
                  <div>startDate: {importSummary.databaseComparisonQuery?.startDate || '-'}</div>
                  <div>endDate: {importSummary.databaseComparisonQuery?.endDate || '-'}</div>
                  <div>endExclusive: {importSummary.databaseComparisonQuery?.endExclusive || '-'}</div>
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="mb-1 font-bold text-white">عدد الفواتير في القاعدة حسب اليوم</div>
                <div className="mb-3 text-xs text-slate-400">
                  عدد وقيمة الفواتير التي تم قراءتها من `sales_invoices` لكل يوم.
                </div>
                <div className="max-h-48 space-y-2 overflow-auto">
                  {(importSummary.databaseByDay || []).map((row) => (
                    <div
                      key={row.date}
                      className="flex items-center justify-between rounded-lg bg-slate-950/20 px-3 py-2 text-sm text-slate-200"
                    >
                      <span>{row.date}</span>
                      <span>
                        {row.count.toLocaleString('ar-EG')} | {formatCurrency(row.total)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="mb-1 font-bold text-white">أول 10 صفوف تم تخطيها</div>
              <div className="mb-3 text-xs text-slate-400">
                عرض عينة من الصفوف التي لم تدخل لسبب تخطي.
              </div>
              <div className="mb-4 rounded-xl border border-white/10 bg-slate-950/20 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-bold text-white">مبيعات الفترة حسب الأيام والفروع</div>
                    <div className="text-xs text-slate-400">
                      الرسم يعرض الأيام التي لها فواتير في الملف أو القاعدة افتراضيًا لتجنب هبوط الصفر المضلل.
                    </div>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-slate-100">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-teal-400"
                      checked={showEmptyChartDays}
                      onChange={(event) => setShowEmptyChartDays(event.target.checked)}
                    />
                    إظهار الأيام الفارغة
                  </label>
                </div>

                {(importSummary.dayDatabaseComparison || []).some(
                  (row) => row.status === 'missing_in_database' || row.status === 'partial'
                ) && (
                  <div className="mb-3 rounded-lg border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-sm font-bold text-amber-50">
                    يوجد أيام في الفترة لا تحتوي فواتير في قاعدة البيانات أو بها فرق يحتاج مراجعة.
                  </div>
                )}

                <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-5">
                  <MetricMiniCard label="إجمالي الفترة" value={formatCurrency(chartSummary.total)} />
                  <MetricMiniCard label={BRANCHES[0]} value={formatCurrency(chartSummary.shokry)} />
                  <MetricMiniCard label={BRANCHES[1]} value={formatCurrency(chartSummary.shamy)} />
                  <MetricMiniCard
                    label="أيام بها مبيعات"
                    value={chartSummary.salesDays.toLocaleString('ar-EG')}
                  />
                  <MetricMiniCard
                    label="أيام مفقودة/صفرية"
                    value={chartSummary.missingOrZeroDays.toLocaleString('ar-EG')}
                  />
                </div>

                <div className="mb-3 flex flex-wrap gap-3 text-xs text-slate-300">
                  <span className="flex items-center gap-1">
                    <span className="h-3 w-3 rounded-sm bg-cyan-400" />
                    {BRANCHES[0]}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-3 w-3 rounded-sm bg-violet-400" />
                    {BRANCHES[1]}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-3 w-3 rounded-sm bg-slate-400" />
                    فروع أخرى
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-3 w-3 rounded-sm bg-teal-300" />
                    إجمالي القاعدة
                  </span>
                </div>

                {visibleDaySalesChartRows.length === 0 ? (
                  <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-6 text-center text-sm text-slate-300">
                    لا توجد أيام كافية لعرض الرسم.
                  </div>
                ) : (
                  <div className="overflow-x-auto pb-2">
                    <div
                      className="flex min-h-[250px] items-end gap-3 border-b border-l border-white/10 px-3 pt-8"
                      style={{ minWidth: Math.max(680, visibleDaySalesChartRows.length * 74) }}
                    >
                      {visibleDaySalesChartRows.map((row, index) => {
                        const bars = [
                          { key: 'shokry', value: row.shokryTotal, className: 'bg-cyan-400' },
                          { key: 'shamy', value: row.shamyTotal, className: 'bg-violet-400' },
                          { key: 'other', value: row.otherTotal, className: 'bg-slate-400' },
                          { key: 'database', value: row.databaseTotal, className: 'bg-teal-300' },
                        ];
                        return (
                          <div
                            key={row.date}
                            className="group relative flex w-16 shrink-0 flex-col items-center justify-end gap-2"
                          >
                            <div className="absolute bottom-full left-1/2 z-20 mb-3 hidden w-64 -translate-x-1/2 rounded-xl border border-white/10 bg-slate-950 p-3 text-right text-xs shadow-xl group-hover:block">
                              <div className="mb-2 flex items-center justify-between gap-2">
                                <span className={`rounded-full px-2 py-1 ${dayMatchStatusClass(row.status)}`}>
                                  {dayMatchStatusLabel(row.status)}
                                </span>
                                <span className="font-bold text-white">{row.date}</span>
                              </div>
                              <div className="space-y-1 text-slate-200">
                                <div>إجمالي اليوم: {formatCurrency(row.fileTotal)}</div>
                                <div>{BRANCHES[0]}: {formatCurrency(row.shokryTotal)}</div>
                                <div>{BRANCHES[1]}: {formatCurrency(row.shamyTotal)}</div>
                                {row.otherTotal > 0 && <div>فروع أخرى: {formatCurrency(row.otherTotal)}</div>}
                                <div>إجمالي القاعدة: {formatCurrency(row.databaseTotal)}</div>
                                <div>عدد فواتير الملف: {row.fileCount.toLocaleString('ar-EG')}</div>
                                <div>عدد فواتير القاعدة: {row.databaseCount.toLocaleString('ar-EG')}</div>
                                <div>فرق القيمة: {formatCurrency(row.difference)}</div>
                              </div>
                            </div>
                            <div className="flex h-40 items-end gap-1">
                              {bars.map((bar) => (
                                <div
                                  key={bar.key}
                                  className={`w-2.5 rounded-t ${bar.value > 0 ? bar.className : 'bg-white/10'}`}
                                  style={{
                                    height: bar.value > 0 ? Math.max(6, (bar.value / chartMaxTotal) * 160) : 2,
                                  }}
                                />
                              ))}
                            </div>
                            <div className={`h-1.5 w-12 rounded-full ${chartBarColor(row.status)}`} />
                            <div className="h-8 text-center text-[11px] font-bold text-slate-300">
                              {index % chartTickStep === 0 || index === visibleDaySalesChartRows.length - 1
                                ? row.label
                                : ''}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {!showEmptyChartDays && hiddenEmptyChartDaysCount > 0 && (
                  <div className="mt-3 rounded-lg border border-sky-300/20 bg-sky-400/10 px-3 py-2 text-xs text-sky-100">
                    تم إخفاء الأيام الفارغة من الرسم لتوضيح الاتجاه. يمكن إظهارها من خيار إظهار الأيام الفارغة.
                  </div>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>رقم الفاتورة</th>
                      <th>الفرع</th>
                      <th>التاريخ الأصلي</th>
                      <th>التاريخ بعد التحليل</th>
                      <th>السبب</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(importSummary.skippedRowsSample || []).map((row, index) => (
                      <tr key={`${row.invoiceNumber}-${row.branch}-${index}`}>
                        <td>{row.invoiceNumber}</td>
                        <td>{row.branch}</td>
                        <td>{row.originalDate}</td>
                        <td>{row.parsedDate}</td>
                        <td>{row.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="mb-1 font-bold text-white">أول 10 صفوف تم حفظها أو إرسالها للحفظ</div>
              <div className="mb-3 text-xs text-slate-400">
                عرض عينة من الصفوف التي تم حفظها أو تحديثها بنجاح.
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>رقم الفاتورة</th>
                      <th>الفرع</th>
                      <th>التاريخ الأصلي</th>
                      <th>invoice_date</th>
                      <th>صافي الفاتورة</th>
                      <th>duplicate key</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(importSummary.savedRowsSample || []).map((row, index) => (
                      <tr key={`${row.invoiceNumber}-${row.branch}-${index}`}>
                        <td>{row.invoiceNumber}</td>
                        <td>{row.branch}</td>
                        <td>{row.originalDate}</td>
                        <td>{row.invoiceDate}</td>
                        <td className="text-amber-300">{formatCurrency(row.netTotal)}</td>
                        <td>{row.duplicateKey}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="mb-1 font-bold text-white">مقارنة الملف مع القاعدة لكل يوم</div>
              <div className="mb-3 text-xs text-slate-400">
                يظهر هنا نتيجة المقارنة اليومية لكل يوم ملف.
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>اليوم</th>
                      <th>عدد فواتير الملف</th>
                      <th>صافي الملف</th>
                      <th>عدد فواتير قاعدة البيانات</th>
                      <th>صافي قاعدة البيانات</th>
                      <th>فرق العدد</th>
                      <th>فرق القيمة</th>
                      <th>الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(importSummary.dayDatabaseComparison || []).map((row) => (
                      <tr key={row.date}>
                        <td className="num">{row.date}</td>
                        <td className="num">{row.fileCount.toLocaleString('ar-EG')}</td>
                        <td className="text-amber-300 font-bold">{formatCurrency(row.fileTotal)}</td>
                        <td className="num">{row.databaseCount.toLocaleString('ar-EG')}</td>
                        <td className="text-teal-300 font-bold">{formatCurrency(row.databaseTotal)}</td>
                        <td className={
                            row.countDifference !== 0 ? 'text-red-200 font-bold' : 'text-slate-300'
                          }>
                          {row.countDifference.toLocaleString('ar-EG')}
                        </td>
                        <td className={
                            Math.abs(row.difference) >= 0.01 ? 'text-red-200 font-bold' : 'text-slate-300'
                          }>
                          {formatCurrency(row.difference)}
                        </td>
                        <td>
                          <span
                            className={`rounded-full px-2 py-1 text-xs font-bold ${dayMatchStatusClass(
                              row.status
                            )}`}
                          >
                            {dayMatchStatusLabel(row.status)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
          )}
          {importKind === 'sales' && (importSummary.dayDatabaseComparison?.length || 0) > 0 && (
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="mb-1 font-bold text-white">مطابقة أيام الملف مع قاعدة البيانات</div>
              <div className="mb-3 text-xs text-slate-400">
                مدى الملف: {importSummary.fileMinDate || '-'} إلى {importSummary.fileMaxDate || '-'} | مدى القاعدة بعد الاستيراد: {importSummary.databaseMinDateAfterImport || '-'} إلى{' '}
                {importSummary.databaseMaxDateAfterImport || '-'}
              </div>
              {(importSummary.dayDatabaseComparison || []).some(
                (row) => row.status === 'missing_in_database'
              ) && (
                <div className="mb-3 rounded-lg border border-red-300/30 bg-red-400/10 px-3 py-2 text-sm font-bold text-red-100">
                  يوجد أيام في الملف لم تظهر في قاعدة البيانات بعد الاستيراد
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>اليوم</th>
                      <th>عدد فواتير الملف</th>
                      <th>صافي الملف</th>
                      <th>عدد فواتير قاعدة البيانات</th>
                      <th>صافي قاعدة البيانات</th>
                      <th>فرق العدد</th>
                      <th>فرق القيمة</th>
                      <th>الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(importSummary.dayDatabaseComparison || []).map((row) => (
                      <tr key={row.date}>
                        <td className="num">{row.date}</td>
                        <td className="num">{row.fileCount.toLocaleString('ar-EG')}</td>
                        <td className="text-amber-300 font-bold">{formatCurrency(row.fileTotal)}</td>
                        <td className="num">{row.databaseCount.toLocaleString('ar-EG')}</td>
                        <td className="text-teal-300 font-bold">
                          {formatCurrency(row.databaseTotal)}
                        </td>
                        <td
                          className={
                            row.countDifference !== 0 ? 'text-red-200 font-bold' : 'text-slate-300'
                          }
                        >
                          {row.countDifference.toLocaleString('ar-EG')}
                        </td>
                        <td
                          className={
                            Math.abs(row.difference) >= 0.01
                              ? 'text-red-200 font-bold'
                              : 'text-slate-300'
                          }
                        >
                          {formatCurrency(row.difference)}
                        </td>
                        <td>
                          <span
                            className={`rounded-full px-2 py-1 text-xs font-bold ${dayMatchStatusClass(
                              row.status
                            )}`}
                          >
                            {dayMatchStatusLabel(row.status)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {importKind === 'sales' && (importSummary.skippedDuplicateInvoices?.length || 0) > 0 && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
              <div className="mb-3 font-bold text-amber-200">فواتير مكررة تم تخطيها</div>
              <div className="max-h-44 space-y-2 overflow-auto">
                {(importSummary.skippedDuplicateInvoices || []).slice(0, 30).map((row, index) => (
                  <div
                    key={`${row.branch}-${row.date}-${row.invoiceNumber}-${index}`}
                    className="flex items-center justify-between rounded-lg bg-slate-950/20 px-3 py-2 text-sm text-slate-200"
                  >
                    <span>{row.invoiceNumber}</span>
                    <span>
                      {row.branch} | {row.date}
                    </span>
                  </div>
                ))}
              </div>
              {(importSummary.skippedDuplicateInvoices?.length || 0) > 30 && (
                <div className="mt-2 text-xs text-amber-100/80">
                  تم عرض أول 30 فقط من التكرارات.
                </div>
              )}
            </div>
          )}
          {(importWarningGroups.critical.length > 0 ||
            importWarningGroups.dataWarnings.length > 0 ||
            importWarningGroups.recommendations.length > 0) && (
            <div className="grid gap-3 lg:grid-cols-3">
              {importWarningGroups.critical.length > 0 && (
                <WarningGroup
                  title="أخطاء حرجة"
                  tone="danger"
                  items={importWarningGroups.critical}
                  emptyText="لا توجد أخطاء حرجة"
                />
              )}
              {importWarningGroups.dataWarnings.length > 0 && (
                <WarningGroup
                  title="تحذيرات بيانات"
                  tone="warning"
                  items={importWarningGroups.dataWarnings}
                  emptyText="لا توجد تحذيرات بيانات"
                />
              )}
              {importWarningGroups.recommendations.length > 0 && (
                <WarningGroup
                  title="توصيات"
                  tone="info"
                  items={importWarningGroups.recommendations}
                  emptyText="لا توجد توصيات إضافية"
                />
              )}
            </div>
          )}
          <button onClick={handleReset} className="btn-primary flex items-center gap-2">
            <RefreshCw size={16} /> استيراد ملف آخر
          </button>
        </div>
      )}

      {isAdmin && editInvoice && editForm && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setEditInvoice(null);
            setEditForm(null);
          }}
        >
          <div className="modal-panel max-w-3xl p-6" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-5">
              <div>
                <div className="section-title">تعديل فاتورة</div>
                <div className="text-slate-400 text-xs mt-1">
                  أي تعديل هنا ينعكس على التحليلات بعد تحديث الصفحة.
                </div>
              </div>
              <button
                type="button"
                className="text-slate-400 hover:text-white"
                onClick={() => {
                  setEditInvoice(null);
                  setEditForm(null);
                }}
              >
                <XCircle size={20} />
              </button>
            </div>

            <div className="grid md:grid-cols-3 gap-3">
              <EditField
                label="الفرع"
                value={editForm.branch}
                onChange={(value) => setEditForm({ ...editForm, branch: value })}
              />
              <EditField
                label="رقم الفاتورة"
                value={editForm.invoice_number}
                onChange={(value) => setEditForm({ ...editForm, invoice_number: value })}
              />
              <label className="text-slate-300 text-xs space-y-1 block">
                <span>تاريخ الفاتورة</span>
                <input
                  className="input-dark"
                  type="date"
                  value={editForm.invoice_date}
                  onChange={(event) =>
                    setEditForm({ ...editForm, invoice_date: event.target.value })
                  }
                />
              </label>
              <EditField
                label="نوع الفاتورة"
                value={editForm.invoice_type}
                onChange={(value) => setEditForm({ ...editForm, invoice_type: value })}
              />
              <EditField
                label="كود العميل"
                value={editForm.customer_code}
                onChange={(value) => setEditForm({ ...editForm, customer_code: value })}
              />
              <EditField
                label="اسم العميل"
                value={editForm.customer_name}
                onChange={(value) => setEditForm({ ...editForm, customer_name: value })}
              />
              <EditField
                label="هاتف العميل"
                value={editForm.customer_phone}
                onChange={(value) => setEditForm({ ...editForm, customer_phone: value })}
              />
              <EditField
                label="الدكتور/المستخدم"
                value={editForm.seller_name}
                onChange={(value) => setEditForm({ ...editForm, seller_name: value })}
              />
              <EditField
                label="صافي الفاتورة"
                value={editForm.amount}
                type="number"
                onChange={(value) => setEditForm({ ...editForm, amount: value })}
              />
              <EditField
                label="بعد الخصم"
                value={editForm.net_amount}
                type="number"
                onChange={(value) => setEditForm({ ...editForm, net_amount: value })}
              />
              <EditField
                label="قيمة الفاتورة قبل الخصم"
                value={editForm.gross_amount}
                type="number"
                onChange={(value) => setEditForm({ ...editForm, gross_amount: value })}
              />
            </div>

            <div className="flex gap-3 mt-6">
              <button
                type="button"
                className="btn-primary flex items-center gap-2"
                onClick={saveInvoiceEdit}
                disabled={adminBusy}
              >
                <Save size={16} />
                حفظ التعديل
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setEditInvoice(null);
                  setEditForm(null);
                }}
                disabled={adminBusy}
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function kindButton(active: boolean) {
  return `px-4 py-2 rounded-lg text-sm font-semibold transition-all ${active ? 'bg-teal-500 text-navy-900' : 'text-slate-400 hover:text-white hover:bg-white/5'}`;
}

function InfoBox({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="bg-teal-500/10 rounded-xl p-3 border border-white/5">
      <div className="text-slate-300 font-semibold mb-2 text-xs">{title}</div>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item} className="text-slate-400 text-xs flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-teal-400 flex-shrink-0" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatTile({
  value,
  label,
  color,
  isCurrency = false,
}: {
  value: number;
  label: string;
  color: string;
  isCurrency?: boolean;
}) {
  return (
    <div className="stat-card text-center">
      <div className={`text-xl font-bold ${color} num`}>
        {isCurrency ? formatCurrency(value) : value.toLocaleString('ar-EG')}
      </div>
      <div className="text-slate-400 text-xs mt-1">{label}</div>
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="text-slate-300 text-xs space-y-1 block">
      <span>{label}</span>
      <input
        className="input-dark"
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function ResultTile({
  value,
  label,
  isCurrency = false,
}: {
  value: number | null | undefined;
  label: string;
  isCurrency?: boolean;
}) {
  const safeValue = Number(value);
  const displayValue = Number.isFinite(safeValue) ? safeValue : 0;
  return (
    <div className="bg-teal-500/10 border border-white/5 rounded-2xl p-4">
      <div className="text-xl font-bold text-teal-400 num">
        {isCurrency ? formatCurrency(displayValue) : displayValue.toLocaleString('ar-EG')}
      </div>
      <div className="text-slate-400 text-xs mt-1">{label}</div>
    </div>
  );
}

function WarningGroup({
  title,
  items,
  emptyText,
  tone,
}: {
  title: string;
  items: string[];
  emptyText: string;
  tone: 'danger' | 'warning' | 'info';
}) {
  const styles = {
    danger: 'border-red-300/35 bg-red-500/15 text-red-50',
    warning: 'border-amber-300/35 bg-amber-400/10 text-amber-50',
    info: 'border-sky-300/35 bg-sky-400/10 text-sky-50',
  }[tone];

  return (
    <div className={`rounded-xl border p-4 ${styles}`}>
      <div className="mb-3 font-bold">{title}</div>
      <div className="space-y-2">
        {(items.length > 0 ? items : [emptyText]).slice(0, 8).map((item, index) => (
          <div key={`${title}-${index}`} className="rounded-lg bg-slate-950/25 px-3 py-2 text-sm">
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}
