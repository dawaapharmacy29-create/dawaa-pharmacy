/**
 * Advanced Data Export Service for Staff Performance
 * 
 * This service provides advanced export capabilities for staff performance data,
 * including Excel, CSV, JSON, and other formats.
 */

import type { StaffPerformanceProfile } from "./staffPerformanceProfileService";

export type ExportFormat = "csv" | "json" | "excel" | "pdf";

export interface ExportOptions {
  format: ExportFormat;
  includeCharts: boolean;
  includeRecommendations: boolean;
  includeDetailedTables: boolean;
  language: "ar" | "en";
  dateRange?: {
    start: string;
    end: string;
  };
}

export interface ExportResult {
  success: boolean;
  data: string | Blob;
  filename: string;
  mimeType: string;
  error?: string;
}

/**
 * Export staff performance profile data
 */
export function exportStaffProfile(
  profile: StaffPerformanceProfile,
  options: ExportOptions
): ExportResult {
  try {
    switch (options.format) {
      case "csv":
        return exportToCsv(profile, options);
      case "json":
        return exportToJson(profile, options);
      case "excel":
        return exportToExcel(profile, options);
      case "pdf":
        return exportToPdf(profile, options);
      default:
        return {
          success: false,
          data: "",
          filename: "",
          mimeType: "",
          error: "Unsupported export format",
        };
    }
  } catch (error) {
    return {
      success: false,
      data: "",
      filename: "",
      mimeType: "",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Export to CSV format
 */
function exportToCsv(profile: StaffPerformanceProfile, options: ExportOptions): ExportResult {
  const lines: string[] = [];
  
  // Header
  lines.push("Section,Metric,Value,Notes");
  
  // Staff Information
  lines.push("Staff,Name," + escapeCsv(profile.staff.name));
  lines.push("Staff,Role," + escapeCsv(profile.staff.role));
  lines.push("Staff,Branch," + escapeCsv(profile.staff.branch));
  lines.push("Staff,Active," + (profile.staff.is_active ? "Yes" : "No"));
  
  // Monthly Incentive
  if (profile.monthlyIncentive) {
    lines.push("Monthly Incentive,Final Points," + profile.monthlyIncentive.finalPoints);
    lines.push("Monthly Incentive,Starting Points," + profile.monthlyIncentive.startingPoints);
    lines.push("Monthly Incentive,Approved Rewards," + profile.monthlyIncentive.approvedRewardPoints);
    lines.push("Monthly Incentive,Approved Deductions," + profile.monthlyIncentive.approvedDeductionPoints);
    lines.push("Monthly Incentive,Incentive Value," + profile.monthlyIncentive.incentiveValue);
  }
  
  // Sales Metrics
  if (profile.sales) {
    lines.push("Sales,Cycle Net Sales," + profile.sales.cycleNetSales);
    lines.push("Sales,Cycle Invoices," + profile.sales.cycleInvoicesCount);
    lines.push("Sales,Average Invoice," + profile.sales.avgInvoice);
    lines.push("Sales,Unique Customers," + profile.sales.uniqueCustomers);
    lines.push("Sales,Delivery Invoices," + profile.sales.deliveryInvoices);
    lines.push("Sales,Branch Contribution," + profile.sales.branchContribution + "%");
  }
  
  // Customer Metrics
  if (profile.customers) {
    lines.push("Customers,New Customers," + profile.customers.newCustomers);
    lines.push("Customers,Repeat Customers," + profile.customers.repeatCustomers.length);
    lines.push("Customers,Needing Followup," + profile.customers.customersNeedingFollowupCount);
    lines.push("Customers,Missing Phone," + profile.customers.customersWithMissingPhone);
  }
  
  // Stagnant Medicines
  if (profile.stagnantMedicines) {
    lines.push("Stagnant,Assigned Items," + profile.stagnantMedicines.assignedStagnantItems);
    lines.push("Stagnant,Target Quantity," + profile.stagnantMedicines.stagnantTargetQuantity);
    lines.push("Stagnant,Sold Quantity," + profile.stagnantMedicines.stagnantSoldQuantity);
    lines.push("Stagnant,Completion %," + profile.stagnantMedicines.stagnantCompletionPercent.toFixed(2));
    lines.push("Stagnant,Cash Rewards," + profile.stagnantMedicines.stagnantCashRewards);
  }
  
  // List Items
  if (profile.listItems) {
    lines.push("List,Assigned Items," + profile.listItems.assignedListItems);
    lines.push("List,Target Quantity," + profile.listItems.listTargetQuantity);
    lines.push("List,Sold Quantity," + profile.listItems.listSoldQuantity);
    lines.push("List,Completion %," + profile.listItems.listCompletionPercent.toFixed(2));
    lines.push("List,Cash Rewards," + profile.listItems.listCashRewards);
  }
  
  // Quarterly Metrics
  if (profile.quarterlyIncentive) {
    lines.push("Quarterly,Quarterly Score," + profile.quarterlyIncentive.quarterlyScore);
    lines.push("Quarterly,Base Incentive," + profile.quarterlyIncentive.baseQuarterlyIncentive);
    lines.push("Quarterly,Cash Rewards," + profile.quarterlyIncentive.quarterlyCashRewards);
    lines.push("Quarterly,Cash Deductions," + profile.quarterlyIncentive.quarterlyCashDeductions);
    lines.push("Quarterly,Final Value," + profile.quarterlyIncentive.quarterlyFinalValue);
  }
  
  // Attendance
  if (profile.attendance) {
    lines.push("Attendance,Scheduled Days," + profile.attendance.scheduledDays);
    lines.push("Attendance,Attended Days," + profile.attendance.attendedDays);
    lines.push("Attendance,Absences," + profile.attendance.absences);
    lines.push("Attendance,Delays," + profile.attendance.delays);
    lines.push("Attendance,Delays > 20min," + profile.attendance.delaysOver20Minutes);
    lines.push("Attendance,Permissions Used," + profile.attendance.permissionsUsed);
    lines.push("Attendance,Attendance Compliance %," + profile.attendance.attendanceCompliance.toFixed(2));
  }
  
  // Customer Service
  if (profile.customerService) {
    lines.push("Customer Service,Followups Assigned," + profile.customerService.followupsAssigned);
    lines.push("Customer Service,Followups Completed," + profile.customerService.followupsCompleted);
    lines.push("Customer Service,Followups Missed," + profile.customerService.followupsMissed);
    lines.push("Customer Service,Complaint Count," + profile.customerService.complaintCount);
    lines.push("Customer Service,Resolved Complaints," + profile.customerService.resolvedComplaints);
    lines.push("Customer Service,Evaluation Average," + profile.customerService.conversationEvaluationAverage.toFixed(2));
  }
  
  // Recommendations
  if (options.includeRecommendations && profile.recommendations.length > 0) {
    lines.push("Recommendations,Total," + profile.recommendations.length);
    profile.recommendations.forEach((rec, idx) => {
      lines.push(`Recommendation ${idx + 1},Category,"${rec.category}"`);
      lines.push(`Recommendation ${idx + 1},Priority,"${rec.priority}"`);
      lines.push(`Recommendation ${idx + 1},Reason,"${escapeCsv(rec.reason)}"`);
      lines.push(`Recommendation ${idx + 1},Action,"${escapeCsv(rec.suggestedAction)}"`);
    });
  }
  
  // Data Health
  lines.push("Data Health,Warnings," + profile.dataHealth.warnings.length);
  profile.dataHealth.warnings.forEach((warning, idx) => {
    lines.push(`Data Health Warning ${idx + 1},,"${escapeCsv(warning)}"`);
  });
  
  const csvContent = lines.join("\n");
  const filename = `staff_profile_${profile.staff.name.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.csv`;
  
  return {
    success: true,
    data: csvContent,
    filename,
    mimeType: "text/csv",
  };
}

/**
 * Export to JSON format
 */
function exportToJson(profile: StaffPerformanceProfile, options: ExportOptions): ExportResult {
  const exportData = {
    staff: profile.staff,
    identity: profile.identity,
    dataHealth: profile.dataHealth,
    monthlyIncentive: profile.monthlyIncentive,
    sales: profile.sales,
    customers: profile.customers,
    stagnantMedicines: profile.stagnantMedicines,
    listItems: profile.listItems,
    quarterlyIncentive: profile.quarterlyIncentive,
    attendance: profile.attendance,
    customerService: options.includeDetailedTables ? profile.customerService : null,
    recommendations: options.includeRecommendations ? profile.recommendations : [],
    charts: options.includeCharts ? profile.charts : null,
    exportedAt: new Date().toISOString(),
    exportOptions: options,
  };
  
  const jsonContent = JSON.stringify(exportData, null, 2);
  const filename = `staff_profile_${profile.staff.name.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.json`;
  
  return {
    success: true,
    data: jsonContent,
    filename,
    mimeType: "application/json",
  };
}

/**
 * Export to Excel format (simplified CSV with multiple sheets)
 */
function exportToExcel(profile: StaffPerformanceProfile, options: ExportOptions): ExportResult {
  // For now, we'll use CSV format with multiple sections
  // In a real implementation, you would use a library like xlsx or exceljs
  const csvResult = exportToCsv(profile, options);
  const filename = csvResult.filename.replace(".csv", ".xlsx");
  
  return {
    success: true,
    data: csvResult.data,
    filename,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

/**
 * Export to PDF format
 */
function exportToPdf(profile: StaffPerformanceProfile, options: ExportOptions): ExportResult {
  // For now, we'll return HTML content that can be converted to PDF
  // In a real implementation, you would use a library like jsPDF or puppeteer
  const htmlContent = generateHtmlReport(profile, options);
  const filename = `staff_profile_${profile.staff.name.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.html`;
  
  return {
    success: true,
    data: htmlContent,
    filename,
    mimeType: "text/html",
  };
}

/**
 * Generate HTML report for PDF export
 */
function generateHtmlReport(profile: StaffPerformanceProfile, options: ExportOptions): string {
  return `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>Staff Performance Report - ${profile.staff.name}</title>
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
  </style>
</head>
<body>
  <div class="header">
    <h1>Staff Performance Report</h1>
    <p><strong>Name:</strong> ${profile.staff.name}</p>
    <p><strong>Role:</strong> ${profile.staff.role}</p>
    <p><strong>Branch:</strong> ${profile.staff.branch}</p>
    <p><strong>Export Date:</strong> ${new Date().toLocaleDateString("ar-EG")}</p>
  </div>

  <div class="section">
    <div class="section-title">Monthly Incentive</div>
    <div class="grid">
      <div class="metric">
        <div class="metric-label">Final Points</div>
        <div class="metric-value">${profile.monthlyIncentive?.finalPoints || 0}</div>
      </div>
      <div class="metric">
        <div class="metric-label">Incentive Value</div>
        <div class="metric-value">${profile.monthlyIncentive?.incentiveValue || 0} EGP</div>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Sales Performance</div>
    <div class="grid">
      <div class="metric">
        <div class="metric-label">Cycle Net Sales</div>
        <div class="metric-value">${profile.sales?.cycleNetSales || 0} EGP</div>
      </div>
      <div class="metric">
        <div class="metric-label">Cycle Invoices</div>
        <div class="metric-value">${profile.sales?.cycleInvoicesCount || 0}</div>
      </div>
      <div class="metric">
        <div class="metric-label">Average Invoice</div>
        <div class="metric-value">${profile.sales?.avgInvoice || 0} EGP</div>
      </div>
      <div class="metric">
        <div class="metric-label">Unique Customers</div>
        <div class="metric-value">${profile.sales?.uniqueCustomers || 0}</div>
      </div>
    </div>
  </div>

  ${options.includeRecommendations && profile.recommendations.length > 0 ? `
  <div class="section">
    <div class="section-title">Recommendations</div>
    ${profile.recommendations.map(rec => `
      <div class="recommendation">
        <strong>${rec.category}</strong> (${rec.priority})<br>
        ${rec.reason}<br>
        <em>${rec.suggestedAction}</em>
      </div>
    `).join('')}
  </div>
  ` : ''}

  <div class="section">
    <div class="section-title">Data Health</div>
    ${profile.dataHealth.warnings.length > 0 ? profile.dataHealth.warnings.map(warning => `
      <div class="warning">${warning}</div>
    `).join('') : '<p>No data health warnings</p>'}
  </div>
</body>
</html>
  `;
}

/**
 * Escape CSV values
 */
function escapeCsv(value: string): string {
  const stringValue = String(value);
  if (stringValue.includes(",") || stringValue.includes('"') || stringValue.includes("\n")) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

/**
 * Export multiple staff profiles
 */
export function exportBatchProfiles(
  profiles: StaffPerformanceProfile[],
  options: ExportOptions
): ExportResult {
  try {
    switch (options.format) {
      case "csv":
        return exportBatchToCsv(profiles, options);
      case "json":
        return exportBatchToJson(profiles, options);
      default:
        return exportBatchToCsv(profiles, options);
    }
  } catch (error) {
    return {
      success: false,
      data: "",
      filename: "",
      mimeType: "",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Export multiple profiles to CSV
 */
function exportBatchToCsv(profiles: StaffPerformanceProfile[], options: ExportOptions): ExportResult {
  const lines: string[] = [];
  
  // Header
  lines.push("Staff ID,Name,Role,Branch,Points,Incentive,Sales,Invoices,Customers,Quarterly Score,Quarterly Value");
  
  // Data rows
  profiles.forEach((profile) => {
    lines.push([
      profile.staff.id,
      escapeCsv(profile.staff.name),
      escapeCsv(profile.staff.role),
      escapeCsv(profile.staff.branch),
      profile.monthlyIncentive?.finalPoints || 0,
      profile.monthlyIncentive?.incentiveValue || 0,
      profile.sales?.cycleNetSales || 0,
      profile.sales?.cycleInvoicesCount || 0,
      profile.sales?.uniqueCustomers || 0,
      profile.quarterlyIncentive?.quarterlyScore || 0,
      profile.quarterlyIncentive?.quarterlyFinalValue || 0,
    ].join(","));
  });
  
  const csvContent = lines.join("\n");
  const filename = `staff_profiles_batch_${new Date().toISOString().slice(0, 10)}.csv`;
  
  return {
    success: true,
    data: csvContent,
    filename,
    mimeType: "text/csv",
  };
}

/**
 * Export multiple profiles to JSON
 */
function exportBatchToJson(profiles: StaffPerformanceProfile[], options: ExportOptions): ExportResult {
  const exportData = {
    profiles: profiles.map((profile) => ({
      staff: profile.staff,
      monthlyIncentive: profile.monthlyIncentive,
      sales: profile.sales,
      quarterlyIncentive: profile.quarterlyIncentive,
      dataHealth: profile.dataHealth,
    })),
    exportedAt: new Date().toISOString(),
    exportOptions: options,
  };
  
  const jsonContent = JSON.stringify(exportData, null, 2);
  const filename = `staff_profiles_batch_${new Date().toISOString().slice(0, 10)}.json`;
  
  return {
    success: true,
    data: jsonContent,
    filename,
    mimeType: "application/json",
  };
}

/**
 * Download file helper
 */
export function downloadFile(result: ExportResult): void {
  if (!result.success) {
    console.error("Export failed:", result.error);
    return;
  }
  
  const blob = result.data instanceof Blob ? result.data : new Blob([result.data], { type: result.mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = result.filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
