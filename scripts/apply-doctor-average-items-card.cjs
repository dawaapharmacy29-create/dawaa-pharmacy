const fs = require('node:fs');
const path = require('node:path');

const filePath = path.join(process.cwd(), 'src/pages/DoctorDashboard.tsx');
let source = fs.readFileSync(filePath, 'utf8');
let changed = false;

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  if (!source.includes(before)) {
    console.warn(`[doctor-average-items] skipped ${label}: anchor not found`);
    return;
  }
  source = source.replace(before, after);
  changed = true;
}

replaceOnce(
`    avgInvoice: number;
    branchAvg: number;`,
`    avgInvoice: number;
    avgItemsPerInvoice: number;
    branchAvg: number;`,
'sales summary type'
);

replaceOnce(
`        const branchAvg = summary.branchRows.find((row) => row.branch === effectiveBranch)?.avgInvoice || 0;
        setSalesSummary({`,
`        const branchAvg = summary.branchRows.find((row) => row.branch === effectiveBranch)?.avgInvoice || 0;

        // متوسط عدد الأصناف داخل الفاتورة للدكتور خلال الدورة الحالية.
        // line_items_count يتم حفظه أثناء استيراد ملف الفواتير من عمود "ع.أصناف".
        const cycleEndExclusive = new Date(\`${'${formatCycleDate(cycle.end)}'}T12:00:00\`);
        cycleEndExclusive.setDate(cycleEndExclusive.getDate() + 1);
        let itemsQuery = supabase
          .from('sales_invoices')
          .select('line_items_count')
          .gte('invoice_date', formatCycleDate(cycle.start))
          .lt('invoice_date', cycleEndExclusive.toISOString().slice(0, 10))
          .range(0, 4999);
        if (effectiveBranch) itemsQuery = itemsQuery.eq('branch', effectiveBranch);
        if (effectiveName) itemsQuery = itemsQuery.eq('seller_name', effectiveName);
        const { data: invoiceItemRows, error: invoiceItemsError } = await itemsQuery;
        const validItemRows = invoiceItemsError
          ? []
          : (invoiceItemRows || []).map((row) => Number(row.line_items_count || 0)).filter((value) => Number.isFinite(value) && value >= 0);
        const avgItemsPerInvoice = validItemRows.length
          ? validItemRows.reduce((sum, value) => sum + value, 0) / validItemRows.length
          : 0;

        setSalesSummary({`,
'load average items'
);

replaceOnce(
`          avgInvoice: doctorRow?.avgInvoice || summary.kpis.avgInvoice,
          branchAvg,`,
`          avgInvoice: doctorRow?.avgInvoice || summary.kpis.avgInvoice,
          avgItemsPerInvoice,
          branchAvg,`,
'set average items'
);

const metricPattern = /<MetricCard icon=\{TrendingUp\} label="متوسط فاتورتي" value=\{salesSummary \? formatCurrency\(salesSummary\.avgInvoice\) : '—'\} status=\{salesStatus\} sub=\{salesSummary\?\.branchAvg \? `متوسط الفرع \$\{formatCurrency\(salesSummary\.branchAvg\)\}[^`]*` : 'مقارنة الفرع عند توفرها'\} \/>/;
if (!source.includes('label="متوسط الأصناف / فاتورة"')) {
  const match = source.match(metricPattern);
  if (match) {
    source = source.replace(
      metricPattern,
`<MetricCard
          icon={TrendingUp}
          label="متوسط الفاتورة"
          value={salesSummary ? formatCurrency(salesSummary.avgInvoice) : '—'}
          status={salesStatus}
          sub={salesSummary?.branchAvg ? \`متوسط الفرع: \${formatCurrency(salesSummary.branchAvg)}\` : 'يُحسب من فواتير الدورة الحالية'}
        />
        <MetricCard
          icon={Package}
          label="متوسط الأصناف / فاتورة"
          value={salesSummary ? \`\${salesSummary.avgItemsPerInvoice.toLocaleString('ar-EG', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} صنف\` : '—'}
          status={salesStatus}
          sub="متوسط عدد الأصناف المسجلة في كل فاتورة"
        />`
    );
    changed = true;
  } else {
    console.warn('[doctor-average-items] skipped metric cards: matching card not found');
  }
}

if (changed) {
  fs.writeFileSync(filePath, source);
  console.log('[doctor-average-items] applied');
} else {
  console.log('[doctor-average-items] already applied or no compatible anchors found');
}
