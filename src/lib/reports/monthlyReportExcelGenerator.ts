import * as XLSX from 'xlsx';
import { UnifiedMonthlyReport } from './monthlyReportPDFGenerator';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';

export function generateMonthlyReportExcel(report: UnifiedMonthlyReport): void {
  const wb = XLSX.utils.book_new();

  // Helper for formatting currency
  const currency = (val: number) => new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP' }).format(val);

  // Sheet 1: الملخص التنفيذي
  const execSummary = [
    ['تقرير الأداء الشهري الشامل 360°'],
    ['اسم الموظف', report.employee.name, 'الفرع', report.employee.branch],
    ['الدور', report.employee.role, 'الدورة', report.cycle.label],
    [],
    ['التقييم العام'],
    ['الدرجة', report.overallScore.score + '%', 'التقدير', report.overallScore.grade],
    [],
    ['الأعمدة الخمسة'],
    ['العمود', 'النقاط المكتسبة', 'الحد الأقصى', 'النسبة المئوية'],
    ...report.pillars.map(p => [p.pillar, p.score, p.maxScore, p.percentage + '%']),
    [],
    ['الماليات'],
    ['حافز النقاط', currency(report.financialSummary.monthlyIncentiveEGP)],
    ['حافز التقييم', currency(report.financialSummary.evaluationIncentiveEGP)],
    ['إجمالي المكافآت', currency(report.financialSummary.totalRewardsEGP)],
    ['إجمالي الخصومات', currency(report.financialSummary.totalDeductionsEGP)],
    ['صافي المستحق', currency(report.financialSummary.netPayableEGP)]
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(execSummary);
  XLSX.utils.book_append_sheet(wb, ws1, 'الملخص التنفيذي');

  // Sheet 2: المبيعات التفصيلية
  const salesDetails = [
    ['تفاصيل المبيعات اليومية'],
    ['التاريخ', 'المبيعات', 'عدد الفواتير']
  ];
  report.sales.dailyBreakdown.forEach(d => {
    salesDetails.push([d.date, d.sales.toString(), d.invoices.toString()]);
  });
  salesDetails.push([]);
  salesDetails.push(['تحليل الشيفتات']);
  salesDetails.push(['الشيفت', 'المبيعات', 'عدد الفواتير']);
  report.sales.shiftBreakdown.forEach(s => {
    salesDetails.push([s.shift, s.sales.toString(), s.invoices.toString()]);
  });
  const ws2 = XLSX.utils.aoa_to_sheet(salesDetails);
  XLSX.utils.book_append_sheet(wb, ws2, 'المبيعات التفصيلية');

  // Sheet 3: العملاء
  const customerDetails = [
    ['تحليل العملاء'],
    ['إجمالي العملاء المميزين', report.customers.totalLinked.toString()],
    ['عملاء جدد هذا الشهر', report.customers.newThisCycle.toString()],
    ['عملاء بدون رقم هاتف', report.customers.withoutPhone.toString()],
    ['معدل الشراء المتكرر', report.customers.repeatPurchaseRate + '%'],
    [],
    ['أفضل العملاء'],
    ['الاسم', 'الإنفاق', 'الزيارات']
  ];
  report.customers.topCustomers.forEach(c => {
    customerDetails.push([c.name, c.spending.toString(), c.visits.toString()]);
  });
  const ws3 = XLSX.utils.aoa_to_sheet(customerDetails);
  XLSX.utils.book_append_sheet(wb, ws3, 'العملاء');

  // Sheet 4: الحوافز والنقاط
  const pointsDetails = [
    ['حركة النقاط'],
    ['الوصف', 'النقاط', 'التاريخ', 'المصدر', 'النوع']
  ];
  report.monthlyIncentive.transactions.forEach(t => {
    pointsDetails.push([
      t.title, 
      t.points.toString(), 
      format(new Date(t.date), 'yyyy-MM-dd', { locale: ar }), 
      t.source, 
      t.type === 'reward' ? 'مكافأة' : 'خصم'
    ]);
  });
  const ws4 = XLSX.utils.aoa_to_sheet(pointsDetails);
  XLSX.utils.book_append_sheet(wb, ws4, 'الحوافز والنقاط');

  // Sheet 5: الحضور
  const attendanceDetails = [
    ['إحصائيات الحضور'],
    ['أيام العمل المجدولة', report.attendance.scheduledDays.toString()],
    ['أيام الحضور', report.attendance.presentDays.toString()],
    ['أيام الغياب', report.attendance.absentDays.toString()],
    ['أيام التأخير', report.attendance.lateDays.toString()],
    ['نسبة الحضور', report.attendance.attendanceRate + '%'],
    ['الأذونات المستخدمة', report.attendance.permissionsUsed.toString()]
  ];
  const ws5 = XLSX.utils.aoa_to_sheet(attendanceDetails);
  XLSX.utils.book_append_sheet(wb, ws5, 'الحضور');

  // Sheet 6: المهام والشيفتات
  const tasksDetails = [
    ['إحصائيات المهام'],
    ['إجمالي المهام', report.dailyTasks.totalTasks.toString()],
    ['المهام المكتملة', report.dailyTasks.completedTasks.toString()],
    ['نسبة الإنجاز', report.dailyTasks.completionRate + '%'],
    [],
    ['أداء الشيفتات (المراجعات)'],
    ['إجمالي المراجعات', report.shiftPerformance.totalReviews.toString()],
    ['مشاكل كقائد', report.shiftPerformance.issuesAsLeader.toString()],
    ['مشاكل كعضو', report.shiftPerformance.issuesAsMember.toString()],
    ['إجمالي نقاط الخصم', report.shiftPerformance.totalDeductionPoints.toString()]
  ];
  const ws6 = XLSX.utils.aoa_to_sheet(tasksDetails);
  XLSX.utils.book_append_sheet(wb, ws6, 'المهام والشيفتات');

  // Sheet 7: التطور التاريخي
  const historyDetails = [
    ['التطور التاريخي للآداء'],
    ['الشهر', 'المبيعات', 'النقاط', 'نسبة الحضور', 'نسبة إنجاز المهام']
  ];
  report.historicalTrend.months.forEach(m => {
    historyDetails.push([
      m.label,
      m.sales.toString(),
      m.points.toString(),
      m.attendanceRate + '%',
      m.taskCompletionRate + '%'
    ]);
  });
  const ws7 = XLSX.utils.aoa_to_sheet(historyDetails);
  XLSX.utils.book_append_sheet(wb, ws7, 'التطور التاريخي');

  const filename = `تقرير_${report.employee.name}_${report.cycle.label}.xlsx`;
  XLSX.writeFile(wb, filename);
}

export function generateAllStaffReportExcel(reports: UnifiedMonthlyReport[]): void {
  const wb = XLSX.utils.book_new();

  reports.forEach(report => {
    const summary = [
      ['اسم الموظف', report.employee.name],
      ['الدور', report.employee.role],
      ['الفرع', report.employee.branch],
      ['الدورة', report.cycle.label],
      [],
      ['التقييم العام', report.overallScore.score + '%', report.overallScore.grade],
      ['إجمالي المبيعات', report.sales.totalSales],
      ['النقاط', report.monthlyIncentive.netPoints],
      ['نسبة الحضور', report.attendance.attendanceRate + '%'],
      ['صافي المستحق', report.financialSummary.netPayableEGP]
    ];
    
    // limit sheet name to 31 chars max
    const sheetName = report.employee.name.substring(0, 31);
    const ws = XLSX.utils.aoa_to_sheet(summary);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });

  const filename = `تقارير_الموظفين_${reports[0]?.cycle.label || 'دورة'}.xlsx`;
  XLSX.writeFile(wb, filename);
}
