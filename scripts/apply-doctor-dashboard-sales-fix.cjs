const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'src/pages/DoctorDashboard.tsx');
let source = fs.readFileSync(filePath, 'utf8');

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`Doctor dashboard patch failed: ${label}`);
  source = source.replace(before, after);
}

replaceOnce(
`function safeNumber(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}`,
`function safeNumber(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function normalizeDoctorSalesName(value: unknown) {
  return String(value ?? '')
    .replace(/[\u064B-\u065F\u0640]/g, '')
    .replace(/[\u0623\u0625\u0622]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/^(?:\\s*(?:دكتور|الدكتور|دكتوره|د\\.?|د\\/)\\s*)+/i, '')
    .replace(/[.,،;:()[\\]{}_\\-/\\\\|]+/g, ' ')
    .replace(/\\s+/g, ' ')
    .trim()
    .toLowerCase();
}`,
'normalizer helper'
);

replaceOnce(
`  const [salesSummary, setSalesSummary] = useState<{
    dailySales: number;
    cycleSales: number;
    invoices: number;
    avgInvoice: number;
    branchAvg: number;
  } | null>(null);`,
`  const [salesSummary, setSalesSummary] = useState<{
    cycleSales: number;
    invoices: number;
    avgInvoice: number;
    branchAvg: number;
    lastSalesDate: string | null;
  } | null>(null);`,
'sales state'
);

replaceOnce(
`        const summary = await loadSalesAnalyticsSummary({
          startDate: formatCycleDate(cycle.start),
          endDate: formatCycleDate(cycle.end),
          branch: effectiveBranch || undefined,
          doctor: effectiveName,
        });
        const todaySummary = await loadSalesAnalyticsSummary({
          startDate: todayIso,
          endDate: todayIso,
          branch: effectiveBranch || undefined,
          doctor: effectiveName,
        });
        if (cancelled) return;
        const doctorRow = summary.doctorRows.find((row) => row.doctor === effectiveName || row.staffId === effectiveId);
        const branchAvg = summary.branchRows.find((row) => row.branch === effectiveBranch)?.avgInvoice || 0;
        setSalesSummary({
          dailySales: todaySummary.kpis.netSales,
          cycleSales: doctorRow?.netSales || summary.kpis.netSales,
          invoices: doctorRow?.invoicesCount || summary.kpis.invoicesCount,
          avgInvoice: doctorRow?.avgInvoice || summary.kpis.avgInvoice,
          branchAvg,
        });`,
`        const summary = await loadSalesAnalyticsSummary({
          startDate: formatCycleDate(cycle.start),
          endDate: formatCycleDate(cycle.end),
          branch: effectiveBranch || undefined,
        });
        if (cancelled) return;
        const effectiveNameKey = normalizeDoctorSalesName(effectiveName);
        const doctorRow = summary.doctorRows.find(
          (row) =>
            (row.staffId && row.staffId === effectiveId) ||
            normalizeDoctorSalesName(row.doctor) === effectiveNameKey
        );
        if (!doctorRow) {
          setSalesSummary(null);
          setSalesError('تعذر ربط مبيعات الدكتور بالحساب. راجع اسم البائع في ملف المبيعات أو ربط staff_id.');
          return;
        }
        const lastSalesDate = summary.dailyTrend
          .filter((row) => row.invoicesCount > 0)
          .map((row) => row.date)
          .sort()
          .at(-1) || null;
        const branchAvg = summary.branchRows.find((row) => row.branch === effectiveBranch)?.avgInvoice || 0;
        setSalesSummary({
          cycleSales: doctorRow.netSales,
          invoices: doctorRow.invoicesCount,
          avgInvoice: doctorRow.avgInvoice,
          branchAvg,
          lastSalesDate,
        });`,
'sales loader'
);

replaceOnce(
`        <MetricCard icon={DollarSign} label="مبيعاتي اليوم" value={salesSummary ? formatCurrency(salesSummary.dailySales) : '—'} status={salesStatus} sub="لا تظهر أصفارًا أثناء التحميل" />
        <MetricCard icon={FileText} label="عدد الفواتير" value={salesSummary ? salesSummary.invoices.toLocaleString('ar-EG') : '—'} status={salesStatus} sub="الدورة الحالية" />
        <MetricCard icon={TrendingUp} label="متوسط الفاتورة" value={salesSummary ? formatCurrency(salesSummary.avgInvoice) : '—'} status={salesStatus} sub={salesSummary?.branchAvg ? \`متوسط الفرع \${formatCurrency(salesSummary.branchAvg)}\` : 'مقارنة الفرع عند توفرها'} />
        <MetricCard icon={Target} label="مبيعات الدورة" value={salesSummary ? formatCurrency(salesSummary.cycleSales) : '—'} status={salesStatus} sub={cycle.label} />`,
`        <MetricCard icon={DollarSign} label="مبيعاتي في الدورة الحالية" value={salesSummary ? formatCurrency(salesSummary.cycleSales) : '—'} status={salesStatus} sub={salesSummary?.lastSalesDate ? \`حتى آخر رفع: \${new Date(\`\${salesSummary.lastSalesDate}T12:00:00\`).toLocaleDateString('ar-EG')}\` : 'لا توجد مبيعات مرفوعة للدكتور'} />
        <MetricCard icon={FileText} label="عدد فواتيري" value={salesSummary ? salesSummary.invoices.toLocaleString('ar-EG') : '—'} status={salesStatus} sub="من بداية الدورة حتى آخر رفع" />
        <MetricCard icon={TrendingUp} label="متوسط فاتورتي" value={salesSummary ? formatCurrency(salesSummary.avgInvoice) : '—'} status={salesStatus} sub={salesSummary?.branchAvg ? \`متوسط الفرع \${formatCurrency(salesSummary.branchAvg)}\` : 'مقارنة الفرع عند توفرها'} />
        <MetricCard icon={Calendar} label="آخر يوم مبيعات مرفوع" value={salesSummary?.lastSalesDate ? new Date(\`\${salesSummary.lastSalesDate}T12:00:00\`).toLocaleDateString('ar-EG') : '—'} status={salesStatus} sub="لا يعتمد على رفع يومي" />`,
'sales cards'
);

fs.writeFileSync(filePath, source);
console.log('[doctor-dashboard-sales-fix] applied');
