import { useEffect, useMemo, useState, type ElementType, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  FileText,
  Loader2,
  Package,
  ReceiptText,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { formatMoney, formatNumber } from '@/lib/dawaa2027';
import { formatCurrency } from '@/lib/utils';
import { formatCycleDate, getCurrentCycle } from '@/lib/pharmacy-cycle';
import { isSupabaseConfigured } from '@/lib/supabase';
import {
  clearStaffPerformanceProfileCache,
  loadStaffPerformanceProfile,
  type StaffPerformanceProfile,
} from '@/lib/staff/staffPerformanceProfileService';
import { STAFF_OPERATING_POLICY_SECTIONS } from '@/lib/performance/ruleDefinitions';
import { getTransactionDetails } from '@/lib/pointsLedger';

type DrilldownKey =
  | 'sales'
  | 'invoices'
  | 'avgInvoice'
  | 'customers'
  | 'followups'
  | 'stagnant'
  | 'list'
  | 'cashRewards'
  | 'deductions'
  | 'payout'
  | 'quarterly'
  | 'attendance'
  | 'dataHealth'
  | 'invoiceDebug';

const sourceLabels: Record<string, string> = {
  staff_id: 'مصدر البيانات: sales_invoices مباشر',
  seller_name: 'مصدر البيانات: sales_invoices مباشر عبر seller aliases',
  invoices_fallback: 'مصدر البيانات: sales_invoices مباشر',
  none: 'مصدر البيانات: غير متاح',
};

function dateText(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function timeText(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
}

function percentText(value?: number | null) {
  if (!Number.isFinite(Number(value))) return '0%';
  return `${Math.round(Number(value))}%`;
}

function sourceText(profile: StaffPerformanceProfile) {
  const diag = profile.sales?.invoiceDiagnostics as
    | (typeof profile.sales.invoiceDiagnostics & {
        salesTableAvailable?: boolean;
        errors?: string[];
        invoiceRowsScanned?: number;
      })
    | undefined;

  if (!profile.sales) return 'مصدر البيانات: جاري التحميل...';

  const source = profile.sales.sourceUsed || 'invoices_fallback';
  const label = sourceLabels[source] || 'مصدر البيانات: sales_invoices';

  if (diag?.salesTableAvailable === false) {
    return 'مصدر البيانات: ❌ جدول الفواتير غير متاح — تحقق من الإعدادات';
  }
  if (diag && diag.invoicesMatchedCount === 0 && (diag.invoiceRowsScanned ?? 0) > 0) {
    return `${label} — لم تُطابق فواتير (${diag.invoiceRowsScanned} صف مفحوص)`;
  }
  if (diag && diag.invoicesMatchedCount !== undefined && diag.invoicesMatchedCount > 0) {
    return `${label} — ${diag.invoicesMatchedCount} فاتورة مطابقة`;
  }
  return label;
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function downloadStaffPdfReport(profile: StaffPerformanceProfile, finalPayout: number) {
  const latest = (profile.sales?.latestInvoices || []).slice(0, 12);
  const topCustomers = (profile.customers?.topCustomers || []).slice(0, 10);
  const recommendations = (profile.recommendations || []).slice(0, 8);
  const sales = profile.sales;
  const attendance = profile.attendance;
  const monthly = profile.monthlyIncentive;
  const quarterly = profile.quarterlyIncentive;
  const cashDeductions = (monthly?.deductionTransactions || []).reduce(
    (sum, row) => sum + Math.abs(Number(row.moneyAmount || 0)),
    0
  );
  const branchAvg = sales?.branchComparison?.branchAvg || 0;
  const avgDiff = sales?.branchComparison?.difference || 0;
  const avgDiffPct = sales?.branchComparison?.percentDifference || 0;
  const branchMessage = branchAvg
    ? `متوسط فاتورة الموظف ${formatMoney(sales?.avgInvoice || 0)} مقابل متوسط الفرع ${formatMoney(branchAvg)}، الفرق ${formatMoney(avgDiff)} (${formatNumber(avgDiffPct)}%).`
    : 'لا توجد بيانات كافية لمقارنة متوسط الفاتورة بمتوسط الفرع.';
  const mainAdvice = [
    (sales?.avgInvoice || 0) < branchAvg
      ? 'رفع متوسط الفاتورة عن طريق البيع الإضافي المناسب لكل روشتة.'
      : 'متوسط الفاتورة جيد مقارنة بالفرع، حافظ على نفس جودة البيع.',
    (profile.customers?.repeatCustomers?.length || 0) < 5
      ? 'زيادة إعادة الشراء عبر تسجيل ملاحظات متابعة للعميل بعد الفاتورة.'
      : 'يوجد عملاء متكررون؛ ركّز على تحويلهم لعملاء دائمين بعروض ومتابعات.',
    (attendance?.attendanceCompliance || 0) < 90
      ? 'مراجعة الالتزام بالحضور والتأخيرات لأن الالتزام يؤثر مباشرة على التقييم.'
      : 'الالتزام جيد حسب البيانات المتاحة.',
  ];

  const row = (label: string, value: unknown) =>
    `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`;
  const rowsHtml =
    latest
      .map(
        (invoice) =>
          `<tr><td>${escapeHtml(invoice.date || '-')}</td><td>${escapeHtml(invoice.invoiceNumber || '-')}</td><td>${escapeHtml(formatMoney(invoice.amount || 0))}</td><td>${escapeHtml(invoice.customer || '-')}</td><td>${escapeHtml(invoice.customerCode || '-')}</td><td>${escapeHtml(invoice.customerSegment || 'غير مصنف')}</td></tr>`
      )
      .join('') || `<tr><td colspan="6">لا توجد فواتير في الدورة الحالية</td></tr>`;
  const customerRows =
    topCustomers
      .map(
        (customer) =>
          `<tr><td>${escapeHtml(customer.name || '-')}</td><td>${escapeHtml(customer.code || '-')}</td><td>${escapeHtml(customer.phone || '-')}</td><td>${escapeHtml(customer.segment || 'غير مصنف')}</td><td>${escapeHtml(customer.invoicesCount)}</td><td>${escapeHtml(formatMoney(customer.totalSpent || 0))}</td></tr>`
      )
      .join('') || `<tr><td colspan="6">لا توجد بيانات عملاء مرتبطة</td></tr>`;
  const recRows =
    recommendations
      .map(
        (rec, i) =>
          `<li><strong>${i + 1}.</strong> ${escapeHtml((rec as any).title || (rec as any).message || (rec as any).reason || 'توصية تحسين')} <span>${escapeHtml((rec as any).suggestedAction || (rec as any).action || '')}</span></li>`
      )
      .join('') ||
    mainAdvice.map((text, i) => `<li><strong>${i + 1}.</strong> ${escapeHtml(text)}</li>`).join('');
  const transactionDetailsHtml = (record: any) => {
    const tx = getTransactionDetails(record);
    const meta =
      record?.metadata && typeof record.metadata === 'object'
        ? (record.metadata as Record<string, unknown>)
        : {};
    const date = tx.approvedAt !== 'غير محدد' ? tx.approvedAt : tx.createdAt;
    const reference = String(
      record?.source_id || meta.source_id || meta.invoice_no || meta.invoice_id || record?.id || ''
    ).trim();
    const createdBy = String(
      record?.created_by_name ||
        record?.created_by ||
        record?.manager_name ||
        record?.executor_name ||
        'غير محدد'
    ).trim();
    const approvedBy = String(
      record?.approved_by_name || record?.approved_by || record?.manager_name || 'غير محدد'
    ).trim();
    const status = String(record?.status || 'approved').trim();
    const details = [
      tx.fullDescription,
      meta.customer_name ? `العميل: ${meta.customer_name}` : '',
      meta.invoice_no ? `فاتورة: ${meta.invoice_no}` : '',
      meta.rule_title ? `البند: ${meta.rule_title}` : '',
      meta.violation_date ? `تاريخ الواقعة: ${meta.violation_date}` : '',
      reference ? `مرجع: ${reference}` : '',
      createdBy ? `أُضيف بواسطة: ${createdBy}` : '',
      approvedBy ? `اعتمد بواسطة: ${approvedBy}` : '',
      status ? `الحالة: ${status}` : '',
    ]
      .map((x) => String(x || '').trim())
      .filter(Boolean);
    return {
      tx,
      date,
      reference,
      createdBy,
      approvedBy,
      status,
      details: Array.from(new Set(details)).join(' | '),
    };
  };

  const rewardRows =
    (monthly?.cashRewardTransactions || [])
      .slice(0, 12)
      .map((r) => {
        const detail = transactionDetailsHtml(r);
        return `<tr><td>${escapeHtml(r.shortReason || r.reason || 'مكافأة مالية')}</td><td>${escapeHtml(detail.date)}</td><td>${escapeHtml(r.sourceLabel || r.source_type || detail.tx.source || '-')}</td><td>${escapeHtml(formatMoney(r.moneyAmount || 0))}</td><td>${escapeHtml(detail.details || '-')}</td></tr>`;
      })
      .join('') || `<tr><td colspan="5">لا توجد مكافآت مالية مسجلة</td></tr>`;

  const pointRewardRows =
    (monthly?.rewardTransactions || [])
      .slice(0, 12)
      .map((r) => {
        const detail = transactionDetailsHtml(r);
        return `<tr><td>${escapeHtml(r.shortReason || r.reason || 'مكافأة نقاط')}</td><td>${escapeHtml(detail.date)}</td><td>${escapeHtml(r.sourceLabel || r.source_type || detail.tx.source || '-')}</td><td>+${escapeHtml(formatNumber(r.absPoints || 0))} نقطة</td><td>${escapeHtml(detail.details || '-')}</td></tr>`;
      })
      .join('') || `<tr><td colspan="5">لا توجد مكافآت نقاط مسجلة</td></tr>`;

  const deductionRows =
    (monthly?.deductionTransactions || [])
      .slice(0, 20)
      .map((r) => {
        const detail = transactionDetailsHtml(r);
        return `<tr><td>${escapeHtml(r.shortReason || r.reason || 'خصم')}</td><td>${escapeHtml(detail.date)}</td><td>${escapeHtml(r.sourceLabel || r.source_type || detail.tx.source || '-')}</td><td>-${escapeHtml(formatNumber(r.absPoints || 0))} نقطة</td><td>${escapeHtml(detail.details || '-')}</td></tr>`;
      })
      .join('') || `<tr><td colspan="5">لا توجد خصومات مسجلة</td></tr>`;

  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" />
  <style>
    *{box-sizing:border-box} body{font-family:Tahoma,Arial,sans-serif;direction:rtl;color:#0f172a;background:#fff;margin:0;padding:24px;line-height:1.65;width:1120px}.header{border-bottom:4px solid #0f766e;padding-bottom:14px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:flex-start}.brand{color:#0f766e;font-weight:900}.muted{color:#64748b;font-size:12px}h1{font-size:28px;margin:0 0 4px}h2{font-size:18px;margin:22px 0 10px;color:#0f766e}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.card{border:1px solid #cbd5e1;border-radius:14px;padding:10px;background:#f8fafc}.label{font-size:12px;color:#64748b;font-weight:800}.value{font-size:19px;font-weight:900;margin-top:4px}.note{border:1px solid #99f6e4;background:#ecfdf5;border-radius:14px;padding:12px;margin:12px 0}.warn{border:1px solid #fde68a;background:#fffbeb;border-radius:14px;padding:12px;margin:12px 0}table{width:100%;border-collapse:collapse;margin-top:8px;font-size:12px}th,td{border:1px solid #d8e0ea;padding:7px;text-align:right;vertical-align:top}th{background:#ecfeff;color:#0f766e;font-weight:900}ul{margin:0;padding:0 20px}li{margin:5px 0}.footer{margin-top:22px;border-top:1px solid #cbd5e1;padding-top:8px;color:#64748b;font-size:11px}
  </style></head><body>
  <div class="header"><div><h1>تقرير الأداء الشهري للموظف</h1><div class="brand">صيدليات دواء - Dawaa Pharmacy 2027</div></div><div class="muted">تم الإنشاء: ${escapeHtml(new Date().toLocaleString('ar-EG'))}<br/>الدورة: ${escapeHtml(formatCycleDate(getCurrentCycle().start))} إلى ${escapeHtml(formatCycleDate(getCurrentCycle().end))}</div></div>
  <h2>بيانات الموظف</h2><div class="grid">${row('الموظف', profile.staff.name)}${row('الدور', profile.staff.role || '-')}${row('الفرع', profile.staff.branch || '-')}</div>
  <h2>ملخص الدورة</h2><div class="grid4">${row('مبيعات الدورة', formatMoney(sales?.cycleNetSales || 0))}${row('عدد الفواتير', formatNumber(sales?.cycleInvoicesCount || 0))}${row('متوسط الفاتورة', formatMoney(sales?.avgInvoice || 0))}${row('عملاء مختلفون', formatNumber(sales?.uniqueCustomers || 0))}${row('أكبر فاتورة', sales?.topInvoice ? `${sales.topInvoice.invoiceNumber} - ${formatMoney(sales.topInvoice.amount)}` : 'غير متاح')}${row('الحافز الأساسي', formatMoney(monthly?.incentiveValue || 0))}${row('المكافآت المالية', formatMoney(profile.cashRewards || 0))}${row('صافي المستحق', formatMoney(finalPayout))}</div>
  <div class="note"><strong>قراءة الأداء:</strong> ${escapeHtml(branchMessage)}</div>
  <h2>ماذا يحتاج الموظف في الفترة القادمة؟</h2><ul>${recRows}</ul>
  <h2>آخر الفواتير</h2><table><thead><tr><th>التاريخ</th><th>رقم الفاتورة</th><th>القيمة</th><th>العميل</th><th>الكود</th><th>التصنيف</th></tr></thead><tbody>${rowsHtml}</tbody></table>
  <h2>أفضل العملاء المرتبطين بالموظف</h2><table><thead><tr><th>العميل</th><th>الكود</th><th>الهاتف</th><th>التصنيف</th><th>عدد الفواتير</th><th>الإجمالي</th></tr></thead><tbody>${customerRows}</tbody></table>
  <h2>الحوافز والخصومات</h2><div class="grid">${row('نقاط البداية', formatNumber(monthly?.startingPoints || 500))}${row('النقاط النهائية', formatNumber(monthly?.finalPoints || 0))}${row('خصومات مالية', formatMoney(cashDeductions))}${row('درجة الربع', `${formatNumber(quarterly?.quarterlyScore || 0)}/100`)}${row('قيمة الربع النهائية', formatMoney(quarterly?.quarterlyFinalValue || 0))}${row('التزام الحضور', `${formatNumber(attendance?.attendanceCompliance || 0)}%`)}</div>
  <h2>مكافآت النقاط بالتفصيل</h2><table><thead><tr><th>البند</th><th>التاريخ</th><th>المصدر</th><th>النقاط</th><th>التفاصيل / المرجع / الاعتماد</th></tr></thead><tbody>${pointRewardRows}</tbody></table>
  <h2>المكافآت المالية بالتفصيل</h2><table><thead><tr><th>البند</th><th>التاريخ</th><th>المصدر</th><th>القيمة</th><th>التفاصيل / المرجع / الاعتماد</th></tr></thead><tbody>${rewardRows}</tbody></table>
  <h2>الخصومات بالتفصيل</h2><table><thead><tr><th>البند</th><th>التاريخ</th><th>المصدر</th><th>النقاط</th><th>التفاصيل / المرجع / الاعتماد</th></tr></thead><tbody>${deductionRows}</tbody></table>
  <h2>الرواكد واللستة والحضور</h2><div class="grid4">${row('رواكد مسندة', formatNumber(profile.stagnantMedicines?.assignedStagnantItems || 0))}${row('إنجاز الرواكد', percentText(profile.stagnantMedicines?.stagnantCompletionPercent))}${row('أصناف لستة', formatNumber(profile.listItems?.assignedListItems || 0))}${row('إنجاز اللستة', percentText(profile.listItems?.listCompletionPercent))}${row('أيام مجدولة', formatNumber(attendance?.scheduledDays || 0))}${row('حضور', formatNumber(attendance?.attendedDays || 0))}${row('غياب', formatNumber(attendance?.absences || 0))}${row('إذونات', formatNumber(attendance?.permissionsUsed || 0))}</div>
  <div class="footer">تم إنشاء هذا التقرير من بيانات التطبيق الحية. راجع صفحة الموظف للتفاصيل القابلة للضغط.</div>
  </body></html>`;

  try {
    const wrapper = document.createElement('div');
    wrapper.style.position = 'fixed';
    wrapper.style.left = '-20000px';
    wrapper.style.top = '0';
    wrapper.innerHTML = html;
    document.body.appendChild(wrapper);
    const reportNode = wrapper.firstElementChild as HTMLElement;
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import('html2canvas'),
      import('jspdf'),
    ]);
    const canvas = await html2canvas(reportNode, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
    });
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let heightLeft = imgHeight;
    let position = 0;
    const imgData = canvas.toDataURL('image/png');
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }
    pdf.save(`تقرير-${(profile.staff.name || 'staff').replace(/[\\/:*?"<>|]+/g, '-')}.pdf`);
    document.body.removeChild(wrapper);
  } catch (error) {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `staff-report-${(profile.staff.name || 'staff').replace(/[\\/:*?"<>|]+/g, '-')}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

function isOptionalSchemaWarning(value: string) {
  return /Could not find the table 'public\.(time_off|staff_attendance|staff_permissions)' in the schema cache/i.test(
    value
  );
}

function visibleDataWarnings(profile: StaffPerformanceProfile) {
  return profile.dataHealth.warnings
    .concat(Object.values(profile.errorsBySection))
    .filter(Boolean)
    .filter((warning) => !isOptionalSchemaWarning(String(warning)));
}

function drilldownRoute(
  profile: StaffPerformanceProfile,
  target: 'invoices' | 'customers' | 'points' | 'customer-service' | 'quarterly'
) {
  const cycle = getCurrentCycle();
  const from = formatCycleDate(cycle.start);
  const to = formatCycleDate(cycle.end);
  const sellerNames = profile.sales?.rawSellerNamesMatched?.length
    ? profile.sales.rawSellerNamesMatched
    : profile.identity.rawSellerNames;
  const seller = sellerNames?.[0] || profile.identity.displayName;
  const params = new URLSearchParams({
    staffId: profile.staff.id,
    from,
    to,
    branch: profile.staff.branch,
  });
  if (seller) params.set('seller_name', seller);

  if (target === 'points') {
    return `/points?staffId=${encodeURIComponent(profile.staff.id)}&cycle=${encodeURIComponent(from)}`;
  }
  if (target === 'customer-service') {
    return `/customer-service?staffId=${encodeURIComponent(profile.staff.id)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  }
  if (target === 'quarterly') {
    return `/quarterly-incentives?staffId=${encodeURIComponent(profile.staff.id)}&quarter=${encodeURIComponent(from)}`;
  }
  return `/${target}?${params.toString()}`;
}

export default function StaffDetail() {
  const { id } = useParams<{ id: string }>();
  const [profile, setProfile] = useState<StaffPerformanceProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drilldown, setDrilldown] = useState<DrilldownKey | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const cycle = useMemo(() => getCurrentCycle(), []);
  const cycleStart = formatCycleDate(cycle.start);
  const cycleEnd = formatCycleDate(cycle.end);

  useEffect(() => {
    if (!id || !isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    loadStaffPerformanceProfile({
      staffId: id,
      cycleStart,
      cycleEnd,
      signal: controller.signal,
      forceRefresh: true,
    })
      .then(setProfile)
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'تعذر تحميل ملف الموظف');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [cycleEnd, cycleStart, id, refreshNonce]);

  useEffect(() => {
    const handleImportRefresh = (event: StorageEvent) => {
      if (event.key !== 'dawaa_invoice_import_refresh' || !event.newValue) return;
      clearStaffPerformanceProfileCache();
      setRefreshNonce((value) => value + 1);
    };

    window.addEventListener('storage', handleImportRefresh);
    return () => window.removeEventListener('storage', handleImportRefresh);
  }, []);

  if (!isSupabaseConfigured) {
    return <CenteredMessage text="فعل Supabase لعرض ملف الموظف." />;
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-slate-400">
        <Loader2 className="animate-spin text-teal-400" />
        جاري تحميل ملف الموظف الموحد...
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="stat-card space-y-4 py-16 text-center">
        <div className="text-slate-300">{error || 'لم يتم العثور على الموظف.'}</div>
        <Link to="/team" className="btn-secondary inline-flex items-center gap-2">
          <ArrowRight size={14} /> العودة للفريق
        </Link>
      </div>
    );
  }

  const monthly = profile.monthlyIncentive;
  const quarterly = profile.quarterlyIncentive;
  const baseMonthlyIncentive = monthly?.incentiveValue || 0;
  const cashRewards = profile.cashRewards || 0;
  const cashDeductions = quarterly?.quarterlyCashDeductions || 0;
  const finalPayout = Math.max(0, baseMonthlyIncentive + cashRewards - cashDeductions);
  const warnings = visibleDataWarnings(profile);
  const hasDataWarnings = warnings.length > 0;

  return (
    <div className="staff-detail-page mx-auto max-w-7xl space-y-5" dir="rtl">
      <div className="flex items-center gap-3 text-sm">
        <Link to="/team" className="text-slate-400 transition hover:text-teal-300">
          الفريق
        </Link>
        <span className="text-slate-600">/</span>
        <span className="font-bold text-white">{profile.staff.name}</span>
      </div>

      <section className="staff-panel rounded-2xl border border-teal-500/20 bg-slate-900/85 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-500/15 text-2xl font-black text-teal-300">
              {profile.staff.name?.[0] || 'د'}
            </div>
            <div>
              <h1 className="text-2xl font-black text-white">{profile.staff.name}</h1>
              <div className="mt-1 text-sm text-slate-400">
                {profile.staff.role || 'موظف'} - {profile.staff.branch}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <Badge tone={profile.staff.is_active ? 'ready' : 'warning'}>
                  {profile.staff.is_active ? 'نشط' : 'غير نشط / تاريخي'}
                </Badge>
                <Badge tone={hasDataWarnings ? 'warning' : 'ready'}>
                  {hasDataWarnings ? 'يوجد تنبيهات ربط' : 'الربط مستقر'}
                </Badge>
                <Badge tone="info">
                  الدورة: {cycleStart} إلى {cycleEnd}
                </Badge>
              </div>
              <div className="mt-3 text-xs font-bold text-slate-500">{sourceText(profile)}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setDrilldown('invoiceDebug')}
              className="btn-secondary inline-flex items-center gap-2 text-sm"
            >
              <ReceiptText size={15} /> تشخيص ربط الفواتير
            </button>
            <button
              type="button"
              onClick={() => void downloadStaffPdfReport(profile, finalPayout)}
              className="btn-secondary inline-flex items-center gap-2 text-sm"
            >
              <FileText size={15} /> تصدير PDF
            </button>
            <Link
              to="/data-health"
              className="btn-secondary inline-flex items-center gap-2 text-sm"
            >
              <AlertTriangle size={15} /> صحة البيانات
            </Link>
          </div>
        </div>
      </section>

      <Section title="الملخص التنفيذي">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <MetricCard
            icon={TrendingUp}
            label="مبيعات الدورة"
            value={formatMoney(profile.sales?.cycleNetSales || 0)}
            onClick={() => setDrilldown('sales')}
          />
          <MetricCard
            icon={ReceiptText}
            label="عدد الفواتير"
            value={formatNumber(profile.sales?.cycleInvoicesCount || 0)}
            onClick={() => setDrilldown('invoices')}
          />
          <MetricCard
            icon={BarChart3}
            label="متوسط الفاتورة"
            value={formatCurrency(profile.sales?.avgInvoice || 0)}
            onClick={() => setDrilldown('avgInvoice')}
          />
          <MetricCard
            icon={Users}
            label="عملاء مختلفون"
            value={formatNumber(profile.sales?.uniqueCustomers || 0)}
            onClick={() => setDrilldown('customers')}
          />
          <MetricCard
            icon={CheckCircle2}
            label="متابعات مغلقة"
            value={`${formatNumber(profile.customerService?.followupsCompleted || 0)}/${formatNumber(profile.customerService?.followupsAssigned || 0)}`}
            onClick={() => setDrilldown('followups')}
          />
          <MetricCard
            icon={Wallet}
            label="الحافز الأساسي"
            value={formatMoney(baseMonthlyIncentive)}
            onClick={() => setDrilldown('payout')}
          />
          <MetricCard
            icon={Sparkles}
            label="المكافآت المالية"
            value={formatMoney(cashRewards)}
            onClick={() => setDrilldown('cashRewards')}
          />
          <MetricCard
            icon={AlertTriangle}
            label="الخصومات المالية"
            value={formatMoney(cashDeductions)}
            onClick={() => setDrilldown('deductions')}
          />
          <MetricCard
            icon={Wallet}
            label="صافي المستحق النهائي"
            value={formatMoney(finalPayout)}
            onClick={() => setDrilldown('payout')}
            highlight
          />
          <MetricCard
            icon={BarChart3}
            label="درجة الربع الحالي"
            value={`${formatNumber(quarterly?.quarterlyScore || 0)}/100`}
            onClick={() => setDrilldown('quarterly')}
          />
        </div>
      </Section>

      <div className="grid gap-5 xl:grid-cols-[1.25fr_.75fr]">
        <Section title="المبيعات والفواتير">
          <div className="grid gap-3 md:grid-cols-3">
            <MiniPanel label="أفضل يوم" value={profile.sales?.bestDay || 'غير متاح'} />
            <MiniPanel label="أضعف يوم" value={profile.sales?.weakestDay || 'غير متاح'} />
            <MiniPanel label="أعلى شيفت" value={profile.sales?.topShift || 'غير متاح'} />
          </div>
          <SimpleBars
            rows={(profile.sales?.weeklyDistribution || [])
              .slice(-6)
              .map((row) => ({ label: row.week, value: row.sales }))}
          />
          <TableShell empty="لا توجد فواتير تفصيلية في هذا المصدر. افتح الفواتير المفلترة من الزر بالأسفل.">
            {(profile.sales?.latestInvoices || []).slice(0, 8).map((invoice) => (
              <DataRow
                key={`${invoice.invoiceNumber}-${invoice.date}`}
                title={`فاتورة ${invoice.invoiceNumber || '-'}`}
                subtitle={`${dateText(invoice.date)} - ${invoice.customer || 'عميل غير محدد'}`}
                value={formatMoney(invoice.amount)}
              />
            ))}
          </TableShell>
          <button
            type="button"
            className="btn-secondary inline-flex w-fit text-sm"
            onClick={() => setDrilldown('invoices')}
          >
            عرض كل فواتير الموظف
          </button>
        </Section>

        <Section title="الحوافز والخصومات">
          <FormulaBox
            rows={[
              ['الحافز الأساسي حسب النقاط', baseMonthlyIncentive],
              ['إجمالي المكافآت المالية', cashRewards],
              ['إجمالي الخصومات المالية', -cashDeductions],
              ['صافي المستحق النهائي', finalPayout],
            ]}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <MiniPanel label="نقاط البداية" value={formatNumber(monthly?.startingPoints || 500)} />
            <MiniPanel label="النقاط النهائية" value={formatNumber(monthly?.finalPoints || 0)} />
            <MiniPanel
              label="مكافآت نقاط معتمدة"
              value={formatNumber(monthly?.approvedRewardPoints || 0)}
            />
            <MiniPanel
              label="خصومات نقاط معتمدة"
              value={formatNumber(monthly?.approvedDeductionPoints || 0)}
            />
          </div>
        </Section>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Section title="العملاء">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MiniPanel
              label="عملاء جدد"
              value={formatNumber(profile.customers?.newCustomers || 0)}
            />
            <MiniPanel
              label="عملاء متكررون"
              value={formatNumber(profile.customers?.repeatCustomers.length || 0)}
            />
            <MiniPanel
              label="يحتاجون متابعة"
              value={formatNumber(profile.customers?.customersNeedingFollowupCount || 0)}
            />
            <MiniPanel
              label="بدون هاتف"
              value={formatNumber(profile.customers?.customersWithMissingPhone || 0)}
            />
          </div>
          <TableShell empty="لا توجد بيانات عملاء مرتبطة بهذا الموظف في الدورة.">
            {(profile.customers?.topCustomers || []).slice(0, 8).map((customer) => (
              <DataRow
                key={`${customer.name}-${customer.phone}`}
                title={customer.name || 'عميل غير محدد'}
                subtitle={`${customer.phone && customer.phone !== customer.code ? customer.phone : 'بدون هاتف صالح'} - ${customer.segment || 'غير مصنف'} - ${customer.invoicesCount} فواتير`}
                value={formatMoney(customer.totalSpent)}
              />
            ))}
          </TableShell>
          <button
            type="button"
            className="btn-secondary inline-flex w-fit text-sm"
            onClick={() => setDrilldown('customers')}
          >
            عرض العملاء المرتبطين
          </button>
        </Section>

        <Section title="الرواكد واللستة">
          <div className="grid gap-3 sm:grid-cols-2">
            <MetricCard
              icon={Package}
              label="رواكد مسندة"
              value={formatNumber(profile.stagnantMedicines?.assignedStagnantItems || 0)}
              onClick={() => setDrilldown('stagnant')}
            />
            <MetricCard
              icon={Package}
              label="أصناف لستة"
              value={formatNumber(profile.listItems?.assignedListItems || 0)}
              onClick={() => setDrilldown('list')}
            />
            <MiniPanel
              label="إنجاز الرواكد"
              value={percentText(profile.stagnantMedicines?.stagnantCompletionPercent)}
            />
            <MiniPanel
              label="إنجاز اللستة"
              value={percentText(profile.listItems?.listCompletionPercent)}
            />
          </div>
          <TableShell empty="لا توجد أصناف متبقية مهمة للعرض.">
            {(
              profile.stagnantMedicines?.topRemainingItems ||
              profile.listItems?.topRemainingItems ||
              []
            )
              .slice(0, 6)
              .map((item) => (
                <DataRow
                  key={`${item.name}-${item.expiryDate}`}
                  title={item.name}
                  subtitle={`متبقي ${formatNumber(item.remaining)} - صلاحية ${dateText(item.expiryDate)}`}
                  value=""
                />
              ))}
          </TableShell>
        </Section>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Section title="الربع سنوي">
          <div className="grid gap-3 sm:grid-cols-2">
            <MiniPanel
              label="الدرجة"
              value={`${formatNumber(quarterly?.quarterlyScore || 0)}/100`}
            />
            <MiniPanel
              label="قاعدة الربع"
              value={formatMoney(quarterly?.baseQuarterlyIncentive || 2000)}
            />
            <MiniPanel
              label="مكافآت الربع"
              value={formatMoney(quarterly?.quarterlyCashRewards || 0)}
            />
            <MiniPanel
              label="القيمة النهائية"
              value={formatMoney(quarterly?.quarterlyFinalValue || 0)}
            />
          </div>
          <SimpleBars
            rows={Object.entries(quarterly?.scoreBreakdown || {}).map(([label, value]) => ({
              label,
              value: Number(value),
            }))}
          />
        </Section>

        <Section title="الحضور والالتزام">
          {profile.attendance ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <MetricCard
                icon={CheckCircle2}
                label="أيام مجدولة"
                value={formatNumber(profile.attendance.scheduledDays)}
                onClick={() => setDrilldown('attendance')}
              />
              <MetricCard
                icon={CheckCircle2}
                label="أيام حضور"
                value={formatNumber(profile.attendance.attendedDays)}
                onClick={() => setDrilldown('attendance')}
              />
              <MetricCard
                icon={AlertTriangle}
                label="غياب"
                value={formatNumber(profile.attendance.absences)}
                onClick={() => setDrilldown('attendance')}
              />
              <MetricCard
                icon={AlertTriangle}
                label="تأخيرات"
                value={formatNumber(profile.attendance.delays)}
                onClick={() => setDrilldown('attendance')}
              />
              <MetricCard
                icon={FileText}
                label="إذونات مستخدمة"
                value={formatNumber(profile.attendance.permissionsUsed)}
                onClick={() => setDrilldown('attendance')}
              />
              <MetricCard
                icon={BarChart3}
                label="نسبة الالتزام"
                value={percentText(profile.attendance.attendanceCompliance)}
                onClick={() => setDrilldown('attendance')}
              />
            </div>
          ) : (
            <Unavailable text="بيانات الإذونات والحضور غير متاحة حاليًا، ولا تؤثر على تحميل ملف الموظف." />
          )}
        </Section>
      </div>

      <Section title="التوصيات الذكية">
        <div className="grid gap-3 lg:grid-cols-2">
          {STAFF_OPERATING_POLICY_SECTIONS.length > 0 && (
            <div className="lg:col-span-2 mb-4 grid gap-3 lg:grid-cols-2">
              {STAFF_OPERATING_POLICY_SECTIONS.map((section) => (
                <div
                  key={section.title}
                  className="rounded-2xl border border-teal-500/20 bg-teal-500/5 p-4"
                >
                  <h3 className="text-sm font-black text-teal-200">{section.title}</h3>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-300">
                    {section.items.map((item) => (
                      <li key={item} className="flex gap-2">
                        <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-teal-300" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          {profile.recommendations.slice(0, 8).map((rec, index) => (
            <div
              key={`${rec.category}-${index}`}
              className="rounded-2xl border border-slate-700 bg-slate-950/35 p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="font-black text-white">{rec.category}</div>
                <Badge
                  tone={
                    rec.priority === 'high'
                      ? 'danger'
                      : rec.priority === 'medium'
                        ? 'warning'
                        : 'info'
                  }
                >
                  {rec.priority}
                </Badge>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-300">{rec.reason}</p>
              <p className="mt-2 text-sm leading-6 text-teal-100">{rec.suggestedAction}</p>
            </div>
          ))}
          {!profile.recommendations.length && <Unavailable text="لا توجد توصيات حرجة حاليًا." />}
        </div>
      </Section>

      <Section title="صحة البيانات والربط">
        <div className="grid gap-3 md:grid-cols-3">
          <MiniPanel
            label="الأسماء البديلة المستخدمة"
            value={
              profile.identity.aliases.length
                ? profile.identity.aliases.join('، ')
                : profile.identity.displayName
            }
          />
          <MiniPanel
            label="أسماء البائع المطابقة"
            value={
              profile.identity.rawSellerNames.length
                ? profile.identity.rawSellerNames.slice(0, 3).join('، ')
                : 'غير متاح'
            }
          />
          <MiniPanel label="المصدر المستخدم" value={sourceText(profile)} />
        </div>
        <div className="space-y-2">
          {warnings.slice(0, 8).map((warning, index) => (
            <div
              key={`${warning}-${index}`}
              className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-sm leading-6 text-amber-100"
            >
              {warning}
            </div>
          ))}
          {!hasDataWarnings && <Unavailable text="لا توجد تحذيرات ربط مهمة في هذا الملف." />}
        </div>
      </Section>

      {drilldown && (
        <DrilldownDrawer
          profile={profile}
          type={drilldown}
          onClose={() => setDrilldown(null)}
          finalPayout={finalPayout}
          cashDeductions={cashDeductions}
        />
      )}
    </div>
  );
}

function CenteredMessage({ text }: { text: string }) {
  return <div className="stat-card py-16 text-center text-sm text-slate-400">{text}</div>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="staff-panel rounded-2xl border border-slate-700/80 bg-slate-900/80 p-4 shadow-xl shadow-black/10">
      <h2 className="mb-4 text-base font-black text-white">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: 'ready' | 'warning' | 'danger' | 'info';
  children: ReactNode;
}) {
  const classes = {
    ready: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
    warning: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
    danger: 'border-red-400/30 bg-red-400/10 text-red-200',
    info: 'border-sky-400/30 bg-sky-400/10 text-sky-200',
  };
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${classes[tone]}`}>
      {children}
    </span>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  onClick,
  highlight = false,
}: {
  icon: ElementType;
  label: string;
  value: string;
  onClick?: () => void;
  highlight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-[118px] rounded-2xl border p-4 text-right transition hover:-translate-y-0.5 hover:border-teal-400/50 ${highlight ? 'border-teal-400/35 bg-teal-500/15' : 'border-slate-700 bg-slate-950/35'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold text-slate-400">{label}</div>
          <div className="mt-3 text-xl font-black text-white">{value}</div>
        </div>
        <div className="rounded-xl bg-teal-500/15 p-2 text-teal-300">
          <Icon size={18} />
        </div>
      </div>
      <div className="mt-3 text-xs font-bold text-teal-300">اضغط للتفاصيل</div>
    </button>
  );
}

function MiniPanel({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-950/30 p-3">
      <div className="text-xs font-bold text-slate-400">{label}</div>
      <div className="mt-2 text-sm font-black text-white">{value}</div>
    </div>
  );
}

function TableShell({ children, empty }: { children: ReactNode; empty: string }) {
  const list = Array.isArray(children) ? children.filter(Boolean) : children;
  if (Array.isArray(list) && list.length === 0) return <Unavailable text={empty} />;
  return <div className="space-y-2">{list}</div>;
}

function DataRow({ title, subtitle, value }: { title: string; subtitle: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/35 p-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-bold text-white">{title}</div>
        <div className="mt-1 text-xs text-slate-500">{subtitle}</div>
      </div>
      {value && <div className="shrink-0 text-sm font-black text-teal-300">{value}</div>}
    </div>
  );
}

function Unavailable({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-950/25 p-4 text-sm leading-6 text-slate-400">
      {text}
    </div>
  );
}

function SimpleBars({ rows }: { rows: Array<{ label: string; value: number }> }) {
  const valid = rows.filter((row) => Number.isFinite(row.value));
  const max = Math.max(1, ...valid.map((row) => row.value));
  if (!valid.length) return <Unavailable text="لا توجد بيانات كافية للرسم المختصر." />;

  return (
    <div className="space-y-2">
      {valid.map((row) => (
        <div key={row.label} className="grid grid-cols-[110px_1fr_90px] items-center gap-3 text-xs">
          <div className="truncate text-slate-400">{row.label}</div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-teal-400"
              style={{ width: `${Math.max(4, (row.value / max) * 100)}%` }}
            />
          </div>
          <div className="text-left font-bold text-slate-300">{formatNumber(row.value)}</div>
        </div>
      ))}
    </div>
  );
}

function FormulaBox({ rows }: { rows: Array<[string, number]> }) {
  return (
    <div className="rounded-2xl border border-teal-500/20 bg-teal-500/10 p-4">
      {rows.map(([label, value], index) => (
        <div
          key={label}
          className={`flex items-center justify-between gap-3 py-2 ${index === rows.length - 1 ? 'border-t border-teal-300/20 pt-3 font-black text-white' : 'text-slate-200'}`}
        >
          <span>{label}</span>
          <span className={value < 0 ? 'text-red-300' : 'text-teal-200'}>{formatMoney(value)}</span>
        </div>
      ))}
    </div>
  );
}

function DrilldownDrawer({
  profile,
  type,
  onClose,
  finalPayout,
  cashDeductions,
}: {
  profile: StaffPerformanceProfile;
  type: DrilldownKey;
  onClose: () => void;
  finalPayout: number;
  cashDeductions: number;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const title = {
    sales: 'تفاصيل مبيعات الدورة',
    invoices: 'آخر فواتير الموظف',
    avgInvoice: 'تحليل متوسط الفاتورة',
    customers: 'العملاء المرتبطون بالموظف',
    followups: 'متابعات الموظف',
    stagnant: 'تفاصيل الرواكد',
    list: 'تفاصيل اللستة',
    cashRewards: 'المكافآت المالية',
    deductions: 'الخصومات',
    payout: 'معادلة صافي المستحق',
    quarterly: 'تفاصيل الربع سنوي',
    attendance: 'الحضور والالتزام',
    dataHealth: 'صحة البيانات',
    invoiceDebug: 'تشخيص ربط الفواتير',
  }[type];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/65" dir="rtl">
      <aside className="h-full w-full max-w-3xl overflow-y-auto border-r border-slate-700 bg-slate-950 p-5 shadow-2xl">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="text-xl font-black text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-white/10 p-2 text-slate-300 transition hover:bg-white/15 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>
        <DrilldownContent
          profile={profile}
          type={type}
          finalPayout={finalPayout}
          cashDeductions={cashDeductions}
        />
      </aside>
    </div>
  );
}

function DrilldownContent({
  profile,
  type,
  finalPayout,
  cashDeductions,
}: {
  profile: StaffPerformanceProfile;
  type: DrilldownKey;
  finalPayout: number;
  cashDeductions: number;
}) {
  if (type === 'invoices') {
    const diagnostics = profile.sales?.invoiceDiagnostics;
    return (
      <div className="space-y-3">
        <TableShell
          empty={
            profile.sales?.cycleInvoicesCount
              ? 'يوجد عدد فواتير في الملخص لكن تفاصيل الفواتير لم تصل، افتح تشخيص ربط الفواتير.'
              : 'لا توجد فواتير مرتبطة بهذا الموظف في الدورة الحالية. افتح تشخيص ربط الفواتير لمعرفة أسماء البائعين الموجودة في نفس الفرع والفترة.'
          }
        >
          {(profile.sales?.latestInvoices || []).slice(0, 30).map((invoice) => (
            <DataRow
              key={`${invoice.invoiceNumber}-${invoice.date}-${invoice.customerCode || invoice.customerPhone}`}
              title={`فاتورة ${invoice.invoiceNumber || '-'}`}
              subtitle={[
                dateText(invoice.date),
                invoice.customer || 'عميل غير محدد',
                invoice.customerCode ? `كود ${invoice.customerCode}` : '',
                invoice.customerPhone || '',
                invoice.customerAddress || '',
                invoice.branch || '',
                invoice.sellerName ? `البائع: ${invoice.sellerName}` : '',
              ]
                .filter(Boolean)
                .join(' - ')}
              value={formatMoney(invoice.amount)}
            />
          ))}
        </TableShell>
        {!profile.sales?.latestInvoices?.length && diagnostics ? (
          <InvoiceDiagnostics diagnostics={diagnostics} profile={profile} />
        ) : null}
      </div>
    );
  }

  if (type === 'customers') {
    return (
      <div className="space-y-3">
        <TableShell empty="لا توجد بيانات عملاء تفصيلية لهذا الموظف في الدورة الحالية.">
          {(profile.customers?.topCustomers || []).slice(0, 30).map((customer) => (
            <DataRow
              key={`${customer.name}-${customer.phone}-${customer.code || ''}`}
              title={customer.name || 'عميل غير محدد'}
              subtitle={[
                customer.code ? `كود ${customer.code}` : '',
                customer.phone && customer.phone !== customer.code
                  ? customer.phone
                  : 'بدون هاتف صالح',
                customer.address || '',
                customer.segment || 'غير مصنف',
                `${customer.invoicesCount} فواتير`,
                `متوسط ${formatMoney(customer.avgInvoice || 0)}`,
                `آخر شراء ${dateText(customer.lastPurchase)}`,
              ]
                .filter(Boolean)
                .join(' - ')}
              value={`إجمالي من الموظف: ${formatMoney(customer.totalSpent)}`}
            />
          ))}
        </TableShell>
      </div>
    );
  }

  if (type === 'payout') {
    return (
      <FormulaBox
        rows={[
          ['الحافز الأساسي حسب النقاط', profile.monthlyIncentive?.incentiveValue || 0],
          ['المكافآت المالية', profile.cashRewards || 0],
          ['الخصومات المالية', -cashDeductions],
          ['صافي المستحق النهائي', finalPayout],
        ]}
      />
    );
  }

  if (type === 'cashRewards') {
    return (
      <TableShell empty="لا توجد مكافآت مالية معتمدة في البروفايل.">
        {(profile.monthlyIncentive?.cashRewardTransactions || []).slice(0, 20).map((row) => (
          <DataRow
            key={row.id}
            title={row.shortReason || row.reason || 'مكافأة مالية'}
            subtitle={`${row.sourceLabel || row.source_type || '-'} - ${dateText(row.created_at)}`}
            value={formatMoney(row.moneyAmount || 0)}
          />
        ))}
      </TableShell>
    );
  }

  if (type === 'deductions') {
    return (
      <div className="space-y-3">
        <MiniPanel label="إجمالي الخصومات المالية" value={formatMoney(cashDeductions)} />
        <TableShell empty="لا توجد خصومات نقاط معتمدة في الدورة.">
          {(profile.monthlyIncentive?.deductionTransactions || []).slice(0, 20).map((row) => (
            <DataRow
              key={row.id}
              title={row.shortReason || row.reason || 'خصم نقاط'}
              subtitle={`${row.sourceLabel || row.source_type || '-'} - ${dateText(row.created_at)}`}
              value={`-${formatNumber(row.absPoints)} نقطة`}
            />
          ))}
        </TableShell>
      </div>
    );
  }

  if (type === 'stagnant' || type === 'list') {
    const data = type === 'stagnant' ? profile.stagnantMedicines : profile.listItems;
    return (
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <MiniPanel
            label="المسند"
            value={formatNumber(
              type === 'stagnant' ? data?.assignedStagnantItems || 0 : data?.assignedListItems || 0
            )}
          />
          <MiniPanel
            label="المباع"
            value={formatNumber(
              type === 'stagnant' ? data?.stagnantSoldQuantity || 0 : data?.listSoldQuantity || 0
            )}
          />
          <MiniPanel
            label="المتبقي"
            value={formatNumber(
              type === 'stagnant'
                ? data?.stagnantRemainingQuantity || 0
                : data?.listRemainingQuantity || 0
            )}
          />
        </div>
        <TableShell empty="لا توجد أصناف متبقية للعرض.">
          {(data?.topRemainingItems || []).slice(0, 20).map((item) => (
            <DataRow
              key={`${item.name}-${item.expiryDate}`}
              title={item.name}
              subtitle={`الصلاحية ${dateText(item.expiryDate)}`}
              value={`متبقي ${formatNumber(item.remaining)}`}
            />
          ))}
        </TableShell>
      </div>
    );
  }

  if (type === 'quarterly') {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <MiniPanel
            label="الدرجة"
            value={`${formatNumber(profile.quarterlyIncentive?.quarterlyScore || 0)}/100`}
          />
          <MiniPanel
            label="القيمة النهائية"
            value={formatMoney(profile.quarterlyIncentive?.quarterlyFinalValue || 0)}
          />
        </div>
        <SimpleBars
          rows={Object.entries(profile.quarterlyIncentive?.scoreBreakdown || {}).map(
            ([label, value]) => ({ label, value: Number(value) })
          )}
        />
        <Link className="btn-primary inline-flex text-sm" to={drilldownRoute(profile, 'quarterly')}>
          فتح الربع سنوي
        </Link>
      </div>
    );
  }

  if (type === 'dataHealth') {
    const warnings = visibleDataWarnings(profile);
    return (
      <div className="space-y-2">
        {warnings.map((warning, index) => (
          <div
            key={`${warning}-${index}`}
            className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-sm leading-6 text-amber-100"
          >
            {warning}
          </div>
        ))}
        {!warnings.length && <Unavailable text="لا توجد تحذيرات ربط مهمة في هذا الملف." />}
      </div>
    );
  }

  if (type === 'avgInvoice') {
    return (
      <div className="space-y-3">
        <MiniPanel label="متوسط الفاتورة" value={formatCurrency(profile.sales?.avgInvoice || 0)} />
        <MiniPanel
          label="أكبر فاتورة"
          value={
            profile.sales?.topInvoice
              ? `${profile.sales.topInvoice.invoiceNumber} - ${profile.sales.topInvoice.customer || 'عميل غير محدد'} - ${dateText(profile.sales.topInvoice.date)} - ${formatMoney(profile.sales.topInvoice.amount)}`
              : 'غير متاح'
          }
        />
        <MiniPanel
          label="أقل فاتورة"
          value={
            profile.sales?.minInvoice
              ? `${profile.sales.minInvoice.invoiceNumber} - ${profile.sales.minInvoice.customer || 'عميل غير محدد'} - ${dateText(profile.sales.minInvoice.date)} - ${formatMoney(profile.sales.minInvoice.amount)}`
              : 'غير متاح'
          }
        />
        <MiniPanel
          label="متوسط فاتورة الفرع"
          value={formatCurrency(profile.sales?.branchComparison.branchAvg || 0)}
        />
        <MiniPanel
          label="الفرق بالجنيه"
          value={formatMoney(profile.sales?.branchComparison.difference || 0)}
        />
        <MiniPanel
          label="الفرق بالنسبة"
          value={percentText(profile.sales?.branchComparison.percentDifference || 0)}
        />
      </div>
    );
  }

  if (type === 'invoiceDebug') {
    return (
      <InvoiceDiagnostics
        diagnostics={profile.sales?.invoiceDiagnostics || null}
        profile={profile}
      />
    );
  }

  if (type === 'followups') {
    return (
      <div className="space-y-3">
        <TableShell empty="لا توجد متابعات مسندة لهذا الموظف في الدورة الحالية.">
          {(profile.followups || []).slice(0, 30).map((row, index) => {
            const customerName = String(row.customer_name || row.name || 'عميل غير محدد');
            const customerPhone = String(row.customer_phone || row.phone || '');
            const status = String(
              row.followup_status || row.status || row.contact_status || 'معلقة'
            );
            const date = String(row.followup_datetime || row.followup_date || row.created_at || '');
            const reason = String(
              row.followup_reason || row.reason || row.notes || row.followup_notes || ''
            );
            const params = new URLSearchParams({
              staffId: profile.staff.id,
              responsible: profile.identity.displayName,
              search: customerPhone || customerName,
            });
            return (
              <Link
                key={String(row.id || `${customerName}-${index}`)}
                to={`/customer-service?${params.toString()}`}
                className="block"
              >
                <DataRow
                  title={customerName}
                  subtitle={`${customerPhone || 'بدون هاتف'} - ${status} - ${dateText(date)}${reason ? ` - ${reason}` : ''}`}
                  value="فتح المتابعة"
                />
              </Link>
            );
          })}
        </TableShell>
        <div className="grid gap-3 sm:grid-cols-3">
          <MiniPanel
            label="مسند"
            value={formatNumber(profile.customerService?.followupsAssigned || 0)}
          />
          <MiniPanel
            label="مغلق"
            value={formatNumber(profile.customerService?.followupsCompleted || 0)}
          />
          <MiniPanel
            label="فائت"
            value={formatNumber(profile.customerService?.followupsMissed || 0)}
          />
        </div>
        <Link
          className="btn-primary inline-flex text-sm"
          to={drilldownRoute(profile, 'customer-service')}
        >
          فتح خدمة العملاء
        </Link>
      </div>
    );
  }

  if (type === 'attendance') {
    return profile.attendance ? (
      <>
        <div className="mb-3 space-y-3">
          <TableShell empty="لا توجد جداول أو شيفتات مسجلة لهذا الموظف.">
            {(profile.schedule || []).slice(0, 20).map((row, index) => {
              const date = String(row.date || row.shift_date || row.work_date || row.day || '');
              const start = String(row.shift_start || row.start_time || row.from || '');
              const end = String(row.shift_end || row.end_time || row.to || '');
              const status = String(row.status || (row.is_off ? 'إجازة' : 'شيفت'));
              return (
                <DataRow
                  key={String(row.id || index)}
                  title={date || status}
                  subtitle={`${start || '-'} إلى ${end || '-'} - ${status}`}
                  value=""
                />
              );
            })}
          </TableShell>
          <TableShell empty="لا توجد إذونات مسجلة في الدورة.">
            {(profile.attendance.permissionsUsage || []).slice(0, 20).map((row, index) => (
              <DataRow
                key={`${row.date}-${index}`}
                title={dateText(row.date)}
                subtitle={row.reason || 'إذن'}
                value=""
              />
            ))}
          </TableShell>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <MiniPanel label="أيام حضور" value={formatNumber(profile.attendance.attendedDays)} />
          <MiniPanel label="غياب" value={formatNumber(profile.attendance.absences)} />
          <MiniPanel label="تأخيرات" value={formatNumber(profile.attendance.delays)} />
          <MiniPanel label="إذونات" value={formatNumber(profile.attendance.permissionsUsed)} />
        </div>
      </>
    ) : (
      <Unavailable text="بيانات الإذونات غير متاحة حاليًا." />
    );
  }

  return (
    <div className="space-y-3">
      <MiniPanel label="مبيعات الدورة" value={formatMoney(profile.sales?.cycleNetSales || 0)} />
      <SimpleBars
        rows={(profile.sales?.weeklyDistribution || [])
          .slice(-8)
          .map((row) => ({ label: row.week, value: row.sales }))}
      />
    </div>
  );
}

function InvoiceDiagnostics({
  diagnostics,
  profile,
}: {
  diagnostics: StaffPerformanceProfile['sales'] extends infer S
    ? S extends { invoiceDiagnostics?: infer D }
      ? D | null
      : null
    : null;
  profile: StaffPerformanceProfile;
}) {
  // Always render — even if diagnostics is null, show staff info + error context
  const diag = diagnostics as
    | (typeof diagnostics & {
        salesTableAvailable?: boolean;
        errors?: string[];
        aliasesUsed?: string[];
        normalizedAliasesUsed?: string[];
        branchSellerNamesSample?: string[];
        globalSellerNamesSample?: string[];
        roleDetected?: string;
        roleAllowedForMatching?: boolean;
        suggestedAliases?: string[];
        matchedSellerNames?: string[];
      })
    | null;

  return (
    <div className="space-y-3">
      {/* Staff + Period header — always shown */}
      <div className="grid gap-3 sm:grid-cols-2">
        <MiniPanel label="الموظف" value={`${profile.staff.name} — ${profile.staff.id}`} />
        <MiniPanel label="الفرع" value={profile.staff.branch || 'غير محدد'} />
        <MiniPanel label="مصدر البيانات" value={diag?.sourceTable ?? 'sales_invoices'} />
        <MiniPanel
          label="جدول الفواتير متاح؟"
          value={
            diag?.salesTableAvailable === false
              ? '❌ لا'
              : diag?.salesTableAvailable
                ? '✅ نعم'
                : 'غير محدد'
          }
        />
        <MiniPanel label="صفوف مفحوصة" value={formatNumber(diag?.invoiceRowsScanned ?? 0)} />
        <MiniPanel label="فواتير مطابقة" value={formatNumber(diag?.invoicesMatchedCount ?? 0)} />
        <MiniPanel
          label="إجمالي المبيعات المطابقة"
          value={formatMoney(diag?.totalMatchedSales ?? 0)}
        />
        <MiniPanel label="الدور" value={diag?.roleDetected ?? profile.staff.role ?? 'غير محدد'} />
        <MiniPanel
          label="مسموح بالمطابقة؟"
          value={diag?.roleAllowedForMatching === false ? '❌ دور غير بيعي' : '✅ نعم'}
        />
      </div>

      {/* Aliases used */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-3 space-y-1">
        <p className="text-xs font-bold text-slate-400 mb-2">
          الأسماء البديلة المستخدمة في المطابقة
        </p>
        <div className="flex flex-wrap gap-1">
          {(
            diag?.aliasesUsed ??
            profile.sales?.aliasesUsed ??
            profile.identity?.aliases ?? [profile.staff.name]
          )
            .filter(Boolean)
            .map((alias, i) => (
              <span
                key={`alias-${i}`}
                className="rounded-full bg-blue-500/20 px-2 py-0.5 text-xs text-blue-300"
              >
                {alias}
              </span>
            ))}
        </div>
      </div>

      {/* Matched seller names */}
      {(diag?.matchedSellerNames ?? profile.sales?.rawSellerNamesMatched ?? []).length > 0 && (
        <div className="rounded-xl border border-emerald-700/50 bg-emerald-900/20 p-3 space-y-1">
          <p className="text-xs font-bold text-emerald-400 mb-2">أسماء البائعين المطابقة فعلياً</p>
          <div className="flex flex-wrap gap-1">
            {(diag?.matchedSellerNames ?? profile.sales?.rawSellerNamesMatched ?? []).map(
              (name, i) => (
                <span
                  key={`matched-${i}`}
                  className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-300"
                >
                  {name}
                </span>
              )
            )}
          </div>
        </div>
      )}

      {/* Suggested aliases when no match */}
      {(diag?.invoicesMatchedCount ?? 0) === 0 && (diag?.suggestedAliases ?? []).length > 0 && (
        <div className="rounded-xl border border-purple-700/50 bg-purple-900/20 p-3 space-y-1">
          <p className="text-xs font-bold text-purple-300 mb-2">
            ⚡ أسماء بائعين مقترحة للربط (تشابه قوي)
          </p>
          <div className="flex flex-wrap gap-1">
            {(diag?.suggestedAliases ?? []).map((name, i) => (
              <span
                key={`sug-${i}`}
                className="rounded-full bg-purple-500/20 px-2 py-0.5 text-xs text-purple-200"
              >
                {name}
              </span>
            ))}
          </div>
          <p className="text-xs text-purple-400 mt-1">
            أضف هذه الأسماء كـ aliases في جدول staff_identity_aliases لتفعيل الربط التلقائي.
          </p>
        </div>
      )}

      {/* Top seller names in branch */}
      <TableShell empty="لا توجد أسماء بائعين في نفس الفرع والفترة — تحقق من فلتر الفرع أو الفترة.">
        {(diag?.topSellerNamesInBranch ?? []).slice(0, 20).map((seller) => (
          <DataRow
            key={seller.sellerName}
            title={seller.sellerName || 'غير محدد'}
            subtitle={`${formatNumber(seller.invoices)} فواتير في نفس الفرع والفترة`}
            value={formatMoney(seller.sales)}
          />
        ))}
      </TableShell>

      {/* Global seller sample when branch sample is empty */}
      {(diag?.topSellerNamesInBranch ?? []).length === 0 &&
        (diag?.globalSellerNamesSample ?? []).length > 0 && (
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-3">
            <p className="text-xs font-bold text-slate-400 mb-2">
              أسماء بائعين في كل الفروع (عينة عامة)
            </p>
            <div className="flex flex-wrap gap-1">
              {(diag?.globalSellerNamesSample ?? []).map((name, i) => (
                <span
                  key={`global-${i}`}
                  className="rounded-full bg-slate-600/40 px-2 py-0.5 text-xs text-slate-300"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        )}

      {/* No diagnostics available at all */}
      {!diag && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-900/20 p-4 text-sm text-rose-300">
          <p className="font-bold mb-1">⚠️ لم يتم تحميل بيانات التشخيص بعد</p>
          <p>
            قد يكون بسبب: خطأ في الاتصال بـ Supabase، أو الموظف غير موجود، أو Supabase غير مُهيأ.
          </p>
          <p className="mt-1 text-xs opacity-70">
            الموظف: {profile.staff.name} — {profile.staff.id} | الفرع:{' '}
            {profile.staff.branch || 'غير محدد'}
          </p>
        </div>
      )}

      {/* Warnings */}
      {(diag?.warnings ?? []).length > 0 && (
        <div className="space-y-2">
          {(diag?.warnings ?? []).map((warning, index) => (
            <div
              key={`warn-${index}`}
              className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-sm leading-6 text-amber-100"
            >
              ⚠️ {warning}
            </div>
          ))}
        </div>
      )}

      {/* Errors */}
      {(diag?.errors ?? []).length > 0 && (
        <div className="space-y-2">
          {(diag?.errors ?? []).map((err, index) => (
            <div
              key={`err-${index}`}
              className="rounded-xl border border-rose-500/25 bg-rose-500/10 p-3 text-sm leading-6 text-rose-200"
            >
              ❌ {err}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
