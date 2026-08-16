const fs = require('fs');

function replaceOnce(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`Missing pattern: ${label}`);
  return source.replace(search, replacement);
}

const analyticsPath = 'src/lib/salesAnalyticsSummaryService.ts';
let analytics = fs.readFileSync(analyticsPath, 'utf8');
analytics = replaceOnce(
  analytics,
  "      'sales_daily_summary',\n      'sale_date',",
  "      'dawaa_sales_daily_dashboard_v1',\n      'sale_date',",
  'daily truth source'
);
analytics = replaceOnce(
  analytics,
  "    source: 'sales_daily_summary',",
  "    source: 'dawaa_sales_daily_dashboard_v1',",
  'daily truth health label'
);
fs.writeFileSync(analyticsPath, analytics);

const doctorPath = 'src/pages/DoctorDashboardStable.tsx';
let doctor = fs.readFileSync(doctorPath, 'utf8');
doctor = replaceOnce(
  doctor,
  `      // مش بنستخدم فلتر الدكتور في loadSalesAnalyticsSummary لأنه بيعمل مطابقة حرفية\n      // (seller_name = الاسم بالظبط)، وده بيفشل لو اسم الحساب فيه اختلاف بسيط عن اسم\n      // البائع في الفاتورة (زي \"د/ بسنت\" في الحساب مقابل \"د بسنت\" في الفواتير).\n      // بنجيب فواتير الفرع كلها للدورة، وبنطابق بنفس دالة normalizeName المستخدمة\n      // في باقي الصفحة (الرواكد واللستة)، اللي بتشيل \"د/\" والمسافات والرموز.\n      const { data, error } = await supabase\n        .from('dawaa_sales_invoices_dashboard_v1')\n        .select('invoice_date,sale_date,net_total,net_amount,discounted_amount,total_amount,amount,branch,seller_name,normalized_seller_name,staff_name')\n        .eq('branch', branch)\n        .gte('invoice_date', formatCycleDate(cycle.start))\n        .lt('invoice_date', formatCycleDate(new Date(cycle.end.getTime() + 86400000)))\n        .limit(5000);`,
  `      // الرسم اليومي يعتمد على staff_sales_summary لأنه نفس مصدر مبيعات الدكتور\n      // الذي نجح في بطاقة المبيعات والترتيب، وهو مبني على حقيقة الفواتير النظيفة.\n      // نقرأ كل أسماء الفرع ثم نطابق محليًا بعد التطبيع حتى اختلاف \"د/ بسنت\" / \"د بسنت\"\n      // لا يحذف الرسم أو يحوله إلى صفر.\n      const { data, error } = await supabase\n        .from('staff_sales_summary')\n        .select('sale_date,net_total,branch,seller_name')\n        .eq('branch', branch)\n        .gte('sale_date', formatCycleDate(cycle.start))\n        .lt('sale_date', formatCycleDate(new Date(cycle.end.getTime() + 86400000)))\n        .limit(5000);`,
  'doctor daily trend query'
);

doctor = replaceOnce(
  doctor,
  `        const candidates = [row.seller_name, row.normalized_seller_name, row.staff_name].map((v) => normalizeName(text(v)));`,
  `        const candidates = [row.seller_name].map((v) => normalizeName(text(v)));`,
  'doctor trend seller candidates'
);

doctor = replaceOnce(
  doctor,
  `        const day = text(row.invoice_date || row.sale_date).slice(0, 10);`,
  `        const day = text(row.sale_date).slice(0, 10);`,
  'doctor trend day'
);

doctor = replaceOnce(
  doctor,
  `        const amount = number(row.net_total) || number(row.net_amount) || number(row.discounted_amount) || number(row.total_amount) || number(row.amount);`,
  `        const amount = number(row.net_total);`,
  'doctor trend amount'
);

// Refresh button must reload all sales-dependent pieces, not only the branch summary.
doctor = replaceOnce(
  doctor,
  `            type=\"button\" onClick={() => { void load(); void loadNotifications(); }} disabled={state === 'loading'}`,
  `            type=\"button\" onClick={() => { void load(); void loadDoctorTrend(); void loadBranchTarget(); void loadNotifications(); }} disabled={state === 'loading'}`,
  'refresh sales pieces'
);

fs.writeFileSync(doctorPath, doctor);
console.log('doctor dashboard current-cycle v26 applied');
