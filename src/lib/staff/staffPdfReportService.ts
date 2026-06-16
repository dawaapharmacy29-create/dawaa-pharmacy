/**
 * PDF Report Generation Service for Staff Performance Profile
 * 
 * This service generates comprehensive PDF reports for staff performance profiles.
 * It uses the staff performance profile data to create detailed reports.
 */

import type { StaffPerformanceProfile } from "./staffPerformanceProfileService";

export interface StaffPdfReportOptions {
  includeCharts: boolean;
  includeRecommendations: boolean;
  includeDetailedTables: boolean;
  language: "ar" | "en";
}

export interface StaffPdfReportData {
  profile: StaffPerformanceProfile;
  generatedAt: string;
  reportPeriod: string;
}

export function generateStaffPdfReport(
  profile: StaffPerformanceProfile,
  options: Partial<StaffPdfReportOptions> = {}
): StaffPdfReportData {
  const opts: StaffPdfReportOptions = {
    includeCharts: true,
    includeRecommendations: true,
    includeDetailedTables: true,
    language: "ar",
    ...options,
  };

  const reportData: StaffPdfReportData = {
    profile,
    generatedAt: new Date().toISOString(),
    reportPeriod: getCurrentCycleLabel(),
  };

  return reportData;
}

function getCurrentCycleLabel(): string {
  // This should match the cycle label from the pharmacy cycle service
  const now = new Date();
  const month = now.toLocaleDateString("ar-EG", { month: "long" });
  const year = now.getFullYear();
  return `${month} ${year}`;
}

/**
 * Generate PDF report structure for rendering
 */
export function getPdfReportStructure(
  reportData: StaffPdfReportData,
  options: StaffPdfReportOptions
): PdfReportSection[] {
  const sections: PdfReportSection[] = [];

  // 1. Header Section
  sections.push({
    title: "ملف الأداء الموظف",
    type: "header",
    data: {
      staffName: reportData.profile.staff.name,
      staffRole: reportData.profile.staff.role,
      staffBranch: reportData.profile.staff.branch,
      reportDate: new Date(reportData.generatedAt).toLocaleDateString("ar-EG"),
      reportPeriod: reportData.reportPeriod,
    },
  });

  // 2. Executive Summary
  sections.push({
    title: "الملخص التنفيذي",
    type: "summary",
    data: {
      finalPoints: reportData.profile.monthlyIncentive?.finalPoints || 0,
      incentiveValue: reportData.profile.monthlyIncentive?.incentiveValue || 0,
      cycleNetSales: reportData.profile.sales?.cycleNetSales || 0,
      cycleInvoicesCount: reportData.profile.sales?.cycleInvoicesCount || 0,
      uniqueCustomers: reportData.profile.sales?.uniqueCustomers || 0,
      quarterlyScore: reportData.profile.quarterlyIncentive?.quarterlyScore || 0,
      quarterlyFinalValue: reportData.profile.quarterlyIncentive?.quarterlyFinalValue || 0,
    },
  });

  // 3. Sales Performance
  if (reportData.profile.sales) {
    sections.push({
      title: "أداء المبيعات",
      type: "sales",
      data: {
        cycleNetSales: reportData.profile.sales.cycleNetSales,
        cycleInvoicesCount: reportData.profile.sales.cycleInvoicesCount,
        avgInvoice: reportData.profile.sales.avgInvoice,
        uniqueCustomers: reportData.profile.sales.uniqueCustomers,
        bestDay: reportData.profile.sales.bestDay,
        weakestDay: reportData.profile.sales.weakestDay,
        topShift: reportData.profile.sales.topShift,
        monthlyTrend: reportData.profile.sales.monthlyTrend,
        topInvoices: reportData.profile.sales.latestInvoices.slice(0, 10),
      },
    });
  }

  // 4. Customer Intelligence
  if (reportData.profile.customers) {
    sections.push({
      title: "ذكاء العملاء",
      type: "customers",
      data: {
        newCustomers: reportData.profile.customers.newCustomers,
        repeatCustomers: reportData.profile.customers.repeatCustomers.length,
        customersNeedingFollowup: reportData.profile.customers.customersNeedingFollowupCount,
        customersWithMissingPhone: reportData.profile.customers.customersWithMissingPhone,
        topCustomers: reportData.profile.customers.topCustomers.slice(0, 20),
        segmentDistribution: reportData.profile.customers.segmentDistribution,
      },
    });
  }

  // 5. Stagnant and List Items
  if (reportData.profile.stagnantMedicines || reportData.profile.listItems) {
    sections.push({
      title: "الرواكد وأصناف اللستة",
      type: "stagnant_list",
      data: {
        stagnantMedicines: reportData.profile.stagnantMedicines,
        listItems: reportData.profile.listItems,
      },
    });
  }

  // 6. Monthly Incentives
  if (reportData.profile.monthlyIncentive) {
    sections.push({
      title: "الحوافز الشهرية",
      type: "incentives",
      data: {
        finalPoints: reportData.profile.monthlyIncentive.finalPoints,
        startingPoints: reportData.profile.monthlyIncentive.startingPoints,
        approvedRewardPoints: reportData.profile.monthlyIncentive.approvedRewardPoints,
        approvedDeductionPoints: reportData.profile.monthlyIncentive.approvedDeductionPoints,
        incentiveValue: reportData.profile.monthlyIncentive.incentiveValue,
        distinctionPointsAbove500: reportData.profile.monthlyIncentive.distinctionPointsAbove500,
        rewardTransactions: reportData.profile.monthlyIncentive.rewardTransactions,
        deductionTransactions: reportData.profile.monthlyIncentive.deductionTransactions,
      },
    });
  }

  // 7. Quarterly Performance
  if (reportData.profile.quarterlyIncentive) {
    sections.push({
      title: "الأداء الربع سنوي",
      type: "quarterly",
      data: {
        quarterlyScore: reportData.profile.quarterlyIncentive.quarterlyScore,
        baseQuarterlyIncentive: reportData.profile.quarterlyIncentive.baseQuarterlyIncentive,
        quarterlyCashRewards: reportData.profile.quarterlyIncentive.quarterlyCashRewards,
        quarterlyCashDeductions: reportData.profile.quarterlyIncentive.quarterlyCashDeductions,
        quarterlyFinalValue: reportData.profile.quarterlyIncentive.quarterlyFinalValue,
        scoreBreakdown: reportData.profile.quarterlyIncentive.scoreBreakdown,
        weeklySalesTrend: reportData.profile.quarterlyIncentive.weeklySalesTrend,
      },
    });
  }

  // 8. Attendance
  if (reportData.profile.attendance) {
    sections.push({
      title: "الحضور",
      type: "attendance",
      data: {
        scheduledDays: reportData.profile.attendance.scheduledDays,
        attendedDays: reportData.profile.attendance.attendedDays,
        absences: reportData.profile.attendance.absences,
        delays: reportData.profile.attendance.delays,
        delaysOver20Minutes: reportData.profile.attendance.delaysOver20Minutes,
        permissionsUsed: reportData.profile.attendance.permissionsUsed,
        attendanceCompliance: reportData.profile.attendance.attendanceCompliance,
        delayTrend: reportData.profile.attendance.delayTrend,
      },
    });
  }

  // 9. Customer Service
  if (reportData.profile.customerService) {
    sections.push({
      title: "خدمة العملاء",
      type: "customer_service",
      data: {
        followupsAssigned: reportData.profile.customerService.followupsAssigned,
        followupsCompleted: reportData.profile.customerService.followupsCompleted,
        followupsMissed: reportData.profile.customerService.followupsMissed,
        complaintCount: reportData.profile.customerService.complaintCount,
        resolvedComplaints: reportData.profile.customerService.resolvedComplaints,
        conversationEvaluationAverage: reportData.profile.customerService.conversationEvaluationAverage,
        missingCustomerClassification: reportData.profile.customerService.missingCustomerClassification,
        missingInvoiceClassification: reportData.profile.customerService.missingInvoiceClassification,
      },
    });
  }

  // 10. Recommendations
  if (options.includeRecommendations && reportData.profile.recommendations.length > 0) {
    sections.push({
      title: "التوصيات",
      type: "recommendations",
      data: {
        recommendations: reportData.profile.recommendations,
      },
    });
  }

  // 11. Data Health
  sections.push({
    title: "صحة البيانات",
    type: "data_health",
    data: {
      warnings: reportData.profile.dataHealth.warnings,
      unresolvedSellerNames: reportData.profile.dataHealth.unresolvedSellerNames,
      duplicateStaff: reportData.profile.dataHealth.duplicateStaff,
      salesLinked: reportData.profile.dataHealth.salesLinked,
      customersLinked: reportData.profile.dataHealth.customersLinked,
    },
  });

  return sections;
}

export interface PdfReportSection {
  title: string;
  type: "header" | "summary" | "sales" | "customers" | "stagnant_list" | "incentives" | "quarterly" | "attendance" | "customer_service" | "recommendations" | "data_health";
  data: any;
}

/**
 * Export report data as JSON for external PDF generation
 */
export function exportReportAsJson(reportData: StaffPdfReportData): string {
  return JSON.stringify(reportData, null, 2);
}

/**
 * Export report data as CSV for spreadsheet applications
 */
export function exportReportAsCsv(reportData: StaffPdfReportData): string {
  const lines: string[] = [];
  
  // Header
  lines.push("Section,Metric,Value");
  
  // Executive Summary
  lines.push("Summary,Staff Name," + reportData.profile.staff.name);
  lines.push("Summary,Role," + reportData.profile.staff.role);
  lines.push("Summary,Branch," + reportData.profile.staff.branch);
  lines.push("Summary,Final Points," + (reportData.profile.monthlyIncentive?.finalPoints || 0));
  lines.push("Summary,Incentive Value," + (reportData.profile.monthlyIncentive?.incentiveValue || 0));
  
  // Sales
  if (reportData.profile.sales) {
    lines.push("Sales,Cycle Net Sales," + reportData.profile.sales.cycleNetSales);
    lines.push("Sales,Cycle Invoices," + reportData.profile.sales.cycleInvoicesCount);
    lines.push("Sales,Average Invoice," + reportData.profile.sales.avgInvoice);
    lines.push("Sales,Unique Customers," + reportData.profile.sales.uniqueCustomers);
  }
  
  // Customers
  if (reportData.profile.customers) {
    lines.push("Customers,New Customers," + reportData.profile.customers.newCustomers);
    lines.push("Customers,Repeat Customers," + reportData.profile.customers.repeatCustomers.length);
    lines.push("Customers,Customers Needing Followup," + reportData.profile.customers.customersNeedingFollowupCount);
  }
  
  // Quarterly
  if (reportData.profile.quarterlyIncentive) {
    lines.push("Quarterly,Quarterly Score," + reportData.profile.quarterlyIncentive.quarterlyScore);
    lines.push("Quarterly,Quarterly Final Value," + reportData.profile.quarterlyIncentive.quarterlyFinalValue);
  }
  
  return lines.join("\n");
}

/**
 * Generate a printable HTML version of the report
 */
export function generatePrintableHtml(reportData: StaffPdfReportData): string {
  const sections = getPdfReportStructure(reportData, {
    includeCharts: true,
    includeRecommendations: true,
    includeDetailedTables: true,
    language: "ar",
  });

  let html = `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>تقرير أداء الموظف - ${reportData.profile.staff.name}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; direction: rtl; }
    .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 20px; }
    .section { margin-bottom: 30px; }
    .section-title { font-size: 18px; font-weight: bold; margin-bottom: 15px; color: #333; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; }
    .metric { background: #f5f5f5; padding: 10px; border-radius: 5px; }
    .metric-label { font-size: 12px; color: #666; }
    .metric-value { font-size: 20px; font-weight: bold; color: #333; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: right; }
    th { background: #f0f0f0; }
    .recommendation { background: #fff3cd; padding: 10px; margin-bottom: 10px; border-radius: 5px; }
    .warning { background: #f8d7da; padding: 10px; margin-bottom: 10px; border-radius: 5px; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>
`;

  // Header
  html += `
  <div class="header">
    <h1>ملف أداء الموظف</h1>
    <p><strong>الاسم:</strong> ${reportData.profile.staff.name}</p>
    <p><strong>الوظيفة:</strong> ${reportData.profile.staff.role}</p>
    <p><strong>الفرع:</strong> ${reportData.profile.staff.branch}</p>
    <p><strong>تاريخ التقرير:</strong> ${new Date(reportData.generatedAt).toLocaleDateString("ar-EG")}</p>
    <p><strong>فترة التقرير:</strong> ${reportData.reportPeriod}</p>
  </div>
`;

  // Sections
  sections.forEach((section) => {
    html += `<div class="section">`;
    html += `<div class="section-title">${section.title}</div>`;

    if (section.type === "summary") {
      html += `
        <div class="grid">
          <div class="metric">
            <div class="metric-label">النقاط النهائية</div>
            <div class="metric-value">${section.data.finalPoints}</div>
          </div>
          <div class="metric">
            <div class="metric-label">قيمة الحافز</div>
            <div class="metric-value">${section.data.incentiveValue} ج</div>
          </div>
          <div class="metric">
            <div class="metric-label">مبيعات الدورة</div>
            <div class="metric-value">${section.data.cycleNetSales} ج</div>
          </div>
          <div class="metric">
            <div class="metric-label">عدد الفواتير</div>
            <div class="metric-value">${section.data.cycleInvoicesCount}</div>
          </div>
          <div class="metric">
            <div class="metric-label">العملاء المختلفون</div>
            <div class="metric-value">${section.data.uniqueCustomers}</div>
          </div>
          <div class="metric">
            <div class="metric-label">النتيجة الربع سنوية</div>
            <div class="metric-value">${section.data.quarterlyScore}/100</div>
          </div>
        </div>
      `;
    } else if (section.type === "recommendations") {
      section.data.recommendations.forEach((rec: any) => {
        html += `
          <div class="recommendation">
            <strong>${rec.category}</strong> (${rec.priority})<br>
            ${rec.reason}<br>
            <em>${rec.suggestedAction}</em>
          </div>
        `;
      });
    } else if (section.type === "data_health") {
      if (section.data.warnings.length > 0) {
        section.data.warnings.forEach((warning: string) => {
          html += `<div class="warning">${warning}</div>`;
        });
      } else {
        html += `<p>لا توجد تحذيرات</p>`;
      }
    }

    html += `</div>`;
  });

  html += `
</body>
</html>
`;

  return html;
}
