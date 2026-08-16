const fs = require('fs');

function replaceRequired(file, from, to) {
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes(from)) throw new Error(`Pattern not found in ${file}: ${from}`);
  fs.writeFileSync(file, text.split(from).join(to));
}

const salesService = 'src/lib/salesAnalyticsSummaryService.ts';
replaceRequired(salesService, ".from('sales_invoices')", ".from('dawaa_sales_invoices_dashboard_v1')");
replaceRequired(salesService, "source: 'sales_invoices_live'", "source: 'dawaa_sales_invoices_dashboard_v1'");

const doctorDashboard = 'src/pages/DoctorDashboardStable.tsx';
replaceRequired(doctorDashboard, ".from('sales_invoices')", ".from('dawaa_sales_invoices_dashboard_v1')");
replaceRequired(
  doctorDashboard,
  ".lt('invoice_date', formatCycleDate(cycle.end))",
  ".lt('invoice_date', formatCycleDate(new Date(cycle.end.getTime() + 86400000)))"
);

console.log('[doctor-clean-truth-v25] applied');
