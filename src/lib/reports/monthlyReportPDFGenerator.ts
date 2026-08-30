import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

export interface UnifiedMonthlyReport {
  employee: { id: string; name: string; role: string; branch: string; joinDate?: string };
  cycle: { start: Date; end: Date; label: string };
  sales: {
    totalSales: number; invoicesCount: number; avgInvoice: number;
    basketSize: number; branchAvgInvoice: number; diffPercent: number;
    uniqueCustomers: number; newCustomers: number;
    returnsCount: number; returnsRate: number;
    peakHours: { hour: number; count: number }[];
    dailyBreakdown: { date: string; sales: number; invoices: number }[];
    shiftBreakdown: { shift: string; sales: number; invoices: number }[];
    bestDay: { date: string; sales: number };
    worstDay: { date: string; sales: number };
  };
  customers: {
    totalLinked: number; newThisCycle: number; repeatPurchaseRate: number;
    withoutPhone: number; withoutPhonePercent: number;
    topCustomers: { name: string; spending: number; visits: number }[];
  };
  monthlyIncentive: {
    startingPoints: number; totalRewards: number; totalDeductions: number;
    netPoints: number; excelPoints: number;
    incentiveEGP: number; maxIncentiveEGP: number; progressPercent: number;
    transactions: { title: string; points: number; date: string; source: string; type: 'reward' | 'deduction'; createdBy?: string; approvedBy?: string }[];
  };
  pillars: { pillar: string; score: number; maxScore: number; percentage: number; details: string[]; breakdown: { label: string; earned: number; max: number }[] }[];
  attendance: {
    scheduledDays: number; presentDays: number; absentDays: number;
    lateDays: number; attendanceRate: number;
    permissionsUsed: number; freePermissionsLeft: number;
  };
  dailyTasks: { totalTasks: number; completedTasks: number; lateTasks: number; completionRate: number };
  shiftPerformance: {
    totalReviews: number; issuesAsLeader: number; issuesAsMember: number;
    totalDeductionPoints: number; commonIssues: { issue: string; count: number }[];
  };
  stagnantAndList: {
    assignedItems: number; soldItems: number; completionRate: number;
    cashRewardsEGP: number; nearExpiryItems: number;
  };
  managerEvaluation?: {
    overallScore: number; grade: string;
    axisScores: { axis: string; weight: number; score: number }[];
    strengths: string[]; improvements: string[];
    managerNotes: string; nextMonthPlan: string;
  };
  financialSummary: {
    monthlyIncentiveEGP: number; evaluationIncentiveEGP: number;
    stagnantRewardsEGP: number; totalRewardsEGP: number;
    totalDeductionsEGP: number; netPayableEGP: number;
  };
  historicalTrend: {
    months: { label: string; sales: number; points: number; attendanceRate: number; taskCompletionRate: number }[];
  };
  recommendations: { priority: 'high' | 'medium' | 'low'; category: string; message: string; actionable: string }[];
  overallScore: { score: number; grade: string; gradeColor: string; breakdown: { label: string; weight: number; score: number; weightedScore: number }[] };
  errors: string[];
}

export async function generateMonthlyReportHTML(report: UnifiedMonthlyReport): Promise<string> {
  const formatCurrency = (val: number) => new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP' }).format(val);
  const formatNumber = (val: number) => new Intl.NumberFormat('ar-EG').format(val);
  
  // HTML styling approach mapping to A4 pages
  // Each page will be 210mm x 297mm wrapped in a div with page-break-after: always (useful if printing too)
  
  const pageStyle = `
    width: 210mm;
    height: 297mm;
    padding: 20mm;
    box-sizing: border-box;
    background: white;
    font-family: 'Segoe UI', Tahoma, sans-serif;
    color: #06131f;
    direction: rtl;
    position: relative;
    overflow: hidden;
  `;
  
  const headerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #14b8a6; padding-bottom: 15px; margin-bottom: 20px;">
      <div>
        <h1 style="margin: 0; color: #0b1d31; font-size: 24px;">صيدليات دواء</h1>
        <p style="margin: 5px 0 0; color: #64748b; font-size: 14px;">تقرير الأداء الشهري الشامل 360°</p>
      </div>
      <div style="text-align: left;">
        <h2 style="margin: 0; font-size: 18px;">${report.employee.name}</h2>
        <p style="margin: 5px 0 0; color: #64748b; font-size: 14px;">${report.employee.role} - ${report.employee.branch}</p>
        <p style="margin: 5px 0 0; color: #14b8a6; font-size: 14px;">${report.cycle.label}</p>
      </div>
    </div>
  `;

  const footerHTML = `
    <div style="position: absolute; bottom: 15px; left: 20mm; right: 20mm; border-top: 1px solid #cbd5e1; padding-top: 10px; display: flex; justify-content: space-between; font-size: 12px; color: #94a3b8;">
      <span>تم إنشاء هذا التقرير بواسطة نظام صيدليات دواء 2027</span>
      <span>التاريخ: ${new Date().toLocaleDateString('ar-EG')}</span>
    </div>
  `;

  // Page 1: Cover & Exec Summary
  const page1 = `
    <div class="pdf-page" style="${pageStyle}">
      ${headerHTML}
      <div style="text-align: center; margin: 40px 0;">
        <div style="width: 200px; height: 200px; border-radius: 50%; border: 15px solid ${report.overallScore.gradeColor}; display: inline-flex; flex-direction: column; align-items: center; justify-content: center; box-shadow: 0 10px 25px rgba(0,0,0,0.05);">
          <span style="font-size: 48px; font-weight: bold; color: #0b1d31;">${report.overallScore.score}%</span>
          <span style="font-size: 24px; font-weight: bold; color: ${report.overallScore.gradeColor};">${report.overallScore.grade}</span>
        </div>
        <h3 style="margin-top: 20px; font-size: 20px; color: #475569;">التقييم العام للأداء</h3>
      </div>
      
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 30px;">
        <div style="background: #f8fafc; padding: 20px; border-radius: 12px; border-right: 4px solid #14b8a6;">
          <h4 style="margin: 0 0 10px; color: #0b1d31; font-size: 16px;">المبيعات</h4>
          <p style="margin: 0; font-size: 24px; font-weight: bold;">${formatCurrency(report.sales.totalSales)}</p>
          <p style="margin: 5px 0 0; color: #64748b; font-size: 14px;">عدد الفواتير: ${formatNumber(report.sales.invoicesCount)}</p>
        </div>
        <div style="background: #f8fafc; padding: 20px; border-radius: 12px; border-right: 4px solid #3b82f6;">
          <h4 style="margin: 0 0 10px; color: #0b1d31; font-size: 16px;">النقاط والحافز</h4>
          <p style="margin: 0; font-size: 24px; font-weight: bold;">${formatNumber(report.monthlyIncentive.netPoints)} نقطة</p>
          <p style="margin: 5px 0 0; color: #64748b; font-size: 14px;">حافز النقاط: ${formatCurrency(report.monthlyIncentive.incentiveEGP)}</p>
        </div>
        <div style="background: #f8fafc; padding: 20px; border-radius: 12px; border-right: 4px solid #f59e0b;">
          <h4 style="margin: 0 0 10px; color: #0b1d31; font-size: 16px;">الحضور والانصراف</h4>
          <p style="margin: 0; font-size: 24px; font-weight: bold;">${report.attendance.attendanceRate}%</p>
          <p style="margin: 5px 0 0; color: #64748b; font-size: 14px;">أيام الحضور: ${report.attendance.presentDays} / ${report.attendance.scheduledDays}</p>
        </div>
        <div style="background: #f8fafc; padding: 20px; border-radius: 12px; border-right: 4px solid #8b5cf6;">
          <h4 style="margin: 0 0 10px; color: #0b1d31; font-size: 16px;">المهام والعمليات</h4>
          <p style="margin: 0; font-size: 24px; font-weight: bold;">${report.dailyTasks.completionRate}%</p>
          <p style="margin: 5px 0 0; color: #64748b; font-size: 14px;">مكتمل: ${report.dailyTasks.completedTasks} / ${report.dailyTasks.totalTasks}</p>
        </div>
        <div style="background: #f8fafc; padding: 20px; border-radius: 12px; border-right: 4px solid #ec4899;">
          <h4 style="margin: 0 0 10px; color: #0b1d31; font-size: 16px;">تقييم المدير</h4>
          <p style="margin: 0; font-size: 24px; font-weight: bold;">${report.managerEvaluation ? report.managerEvaluation.overallScore + '%' : 'غير متوفر'}</p>
          <p style="margin: 5px 0 0; color: #64748b; font-size: 14px;">${report.managerEvaluation ? report.managerEvaluation.grade : '-'}</p>
        </div>
        <div style="background: #0f172a; padding: 20px; border-radius: 12px; color: white; border-right: 4px solid #22c55e;">
          <h4 style="margin: 0 0 10px; color: #94a3b8; font-size: 16px;">صافي المستحق النهائي</h4>
          <p style="margin: 0; font-size: 24px; font-weight: bold; color: #22c55e;">${formatCurrency(report.financialSummary.netPayableEGP)}</p>
          <p style="margin: 5px 0 0; color: #cbd5e1; font-size: 14px;">الحوافز ناقص الاستقطاعات</p>
        </div>
      </div>
      ${footerHTML}
    </div>
  `;

  // Page 2: Sales & Customers
  const page2 = `
    <div class="pdf-page" style="${pageStyle}">
      ${headerHTML}
      <h3 style="font-size: 20px; color: #0b1d31; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; margin-bottom: 20px;">تفاصيل المبيعات والعملاء</h3>
      
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px;">
        <div>
          <h4 style="color: #475569; font-size: 16px;">أداء المبيعات</h4>
          <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
            <tr style="background: #f8fafc;"><td style="padding: 10px; border: 1px solid #e2e8f0;">متوسط الفاتورة</td><td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold;">${formatCurrency(report.sales.avgInvoice)}</td></tr>
            <tr><td style="padding: 10px; border: 1px solid #e2e8f0;">حجم السلة</td><td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold;">${report.sales.basketSize} أصناف</td></tr>
            <tr style="background: #f8fafc;"><td style="padding: 10px; border: 1px solid #e2e8f0;">متوسط الفرع</td><td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold;">${formatCurrency(report.sales.branchAvgInvoice)}</td></tr>
            <tr><td style="padding: 10px; border: 1px solid #e2e8f0;">معدل المرتجعات</td><td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold;">${report.sales.returnsRate}%</td></tr>
          </table>
        </div>
        <div>
          <h4 style="color: #475569; font-size: 16px;">تحليل العملاء</h4>
          <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
            <tr style="background: #f8fafc;"><td style="padding: 10px; border: 1px solid #e2e8f0;">عملاء مميزين</td><td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold;">${formatNumber(report.customers.totalLinked)}</td></tr>
            <tr><td style="padding: 10px; border: 1px solid #e2e8f0;">عملاء جدد</td><td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold;">${formatNumber(report.customers.newThisCycle)}</td></tr>
            <tr style="background: #f8fafc;"><td style="padding: 10px; border: 1px solid #e2e8f0;">بدون رقم هاتف</td><td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold;">${formatNumber(report.customers.withoutPhone)} (${report.customers.withoutPhonePercent}%)</td></tr>
            <tr><td style="padding: 10px; border: 1px solid #e2e8f0;">معدل التكرار</td><td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold;">${report.customers.repeatPurchaseRate}%</td></tr>
          </table>
        </div>
      </div>

      <h4 style="color: #475569; font-size: 16px;">أداء الشيفتات</h4>
      <table style="width: 100%; border-collapse: collapse; margin-top: 10px; text-align: center;">
        <thead>
          <tr style="background: #0f172a; color: white;">
            <th style="padding: 10px; border: 1px solid #e2e8f0;">الشيفت</th>
            <th style="padding: 10px; border: 1px solid #e2e8f0;">المبيعات</th>
            <th style="padding: 10px; border: 1px solid #e2e8f0;">الفواتير</th>
          </tr>
        </thead>
        <tbody>
          ${report.sales.shiftBreakdown.map(s => `
            <tr>
              <td style="padding: 10px; border: 1px solid #e2e8f0;">${s.shift}</td>
              <td style="padding: 10px; border: 1px solid #e2e8f0;">${formatCurrency(s.sales)}</td>
              <td style="padding: 10px; border: 1px solid #e2e8f0;">${formatNumber(s.invoices)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      ${footerHTML}
    </div>
  `;

  // Page 3: Pillars & Trend
  const page3 = `
    <div class="pdf-page" style="${pageStyle}">
      ${headerHTML}
      <h3 style="font-size: 20px; color: #0b1d31; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; margin-bottom: 20px;">الأعمدة الخمسة والتطور التاريخي</h3>
      
      <div style="display: grid; grid-template-columns: 1fr; gap: 20px;">
        <div>
          ${report.pillars.map(p => `
            <div style="margin-bottom: 15px;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                <span style="font-weight: bold;">${p.pillar}</span>
                <span>${p.score} / ${p.maxScore} (${p.percentage}%)</span>
              </div>
              <div style="height: 10px; background: #e2e8f0; border-radius: 5px; overflow: hidden;">
                <div style="height: 100%; width: ${p.percentage}%; background: #14b8a6;"></div>
              </div>
            </div>
          `).join('')}
        </div>
        
        <div>
          <h4 style="color: #475569; font-size: 16px; margin-top: 30px;">التطور خلال آخر 3 أشهر</h4>
          <table style="width: 100%; border-collapse: collapse; margin-top: 10px; text-align: center;">
            <thead>
              <tr style="background: #0f172a; color: white;">
                <th style="padding: 10px; border: 1px solid #e2e8f0;">الشهر</th>
                <th style="padding: 10px; border: 1px solid #e2e8f0;">المبيعات</th>
                <th style="padding: 10px; border: 1px solid #e2e8f0;">النقاط</th>
                <th style="padding: 10px; border: 1px solid #e2e8f0;">الحضور</th>
              </tr>
            </thead>
            <tbody>
              ${report.historicalTrend.months.map(m => `
                <tr>
                  <td style="padding: 10px; border: 1px solid #e2e8f0;">${m.label}</td>
                  <td style="padding: 10px; border: 1px solid #e2e8f0;">${formatCurrency(m.sales)}</td>
                  <td style="padding: 10px; border: 1px solid #e2e8f0;">${formatNumber(m.points)}</td>
                  <td style="padding: 10px; border: 1px solid #e2e8f0;">${m.attendanceRate}%</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
      ${footerHTML}
    </div>
  `;

  // Page 4: Financial & Signatures
  const page4 = `
    <div class="pdf-page" style="${pageStyle}">
      ${headerHTML}
      <h3 style="font-size: 20px; color: #0b1d31; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; margin-bottom: 20px;">الماليات والتوصيات</h3>
      
      <div style="background: #f8fafc; padding: 20px; border-radius: 12px; border: 1px solid #e2e8f0; margin-bottom: 30px;">
        <h4 style="margin: 0 0 15px; color: #0b1d31; font-size: 16px;">الملخص المالي</h4>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
          <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #cbd5e1; padding-bottom: 5px;">
            <span>حافز النقاط:</span> <strong>${formatCurrency(report.financialSummary.monthlyIncentiveEGP)}</strong>
          </div>
          <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #cbd5e1; padding-bottom: 5px;">
            <span>حافز التقييم:</span> <strong>${formatCurrency(report.financialSummary.evaluationIncentiveEGP)}</strong>
          </div>
          <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #cbd5e1; padding-bottom: 5px;">
            <span>حافز الرواكد:</span> <strong>${formatCurrency(report.financialSummary.stagnantRewardsEGP)}</strong>
          </div>
          <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #cbd5e1; padding-bottom: 5px;">
            <span>إجمالي المكافآت:</span> <strong style="color: #22c55e;">${formatCurrency(report.financialSummary.totalRewardsEGP)}</strong>
          </div>
          <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #cbd5e1; padding-bottom: 5px;">
            <span>إجمالي الخصومات:</span> <strong style="color: #ef4444;">${formatCurrency(report.financialSummary.totalDeductionsEGP)}</strong>
          </div>
        </div>
        <div style="margin-top: 20px; padding-top: 15px; border-top: 2px solid #cbd5e1; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 18px; font-weight: bold; color: #0f172a;">صافي المستحق للدفع:</span>
          <span style="font-size: 24px; font-weight: bold; color: #14b8a6;">${formatCurrency(report.financialSummary.netPayableEGP)}</span>
        </div>
      </div>
      
      <h4 style="color: #475569; font-size: 16px; margin-bottom: 10px;">أهم التوصيات لتطوير الأداء</h4>
      <ul style="margin: 0 0 30px; padding-right: 20px; color: #334155; line-height: 1.6;">
        ${report.recommendations.slice(0,3).map(r => `<li><strong>${r.category}:</strong> ${r.message}</li>`).join('')}
      </ul>
      
      <div style="display: flex; justify-content: space-between; margin-top: 60px; padding-top: 30px; border-top: 1px solid #e2e8f0; text-align: center;">
        <div style="width: 30%;">
          <p style="margin-bottom: 40px; font-weight: bold;">توقيع الموظف</p>
          <div style="border-bottom: 1px dashed #cbd5e1;"></div>
        </div>
        <div style="width: 30%;">
          <p style="margin-bottom: 40px; font-weight: bold;">توقيع المدير المباشر</p>
          <div style="border-bottom: 1px dashed #cbd5e1;"></div>
        </div>
        <div style="width: 30%;">
          <p style="margin-bottom: 40px; font-weight: bold;">توقيع الإدارة</p>
          <div style="border-bottom: 1px dashed #cbd5e1;"></div>
        </div>
      </div>
      ${footerHTML}
    </div>
  `;

  return `
    <div id="pdf-report-container" style="background: #f1f5f9; padding: 20px; font-family: sans-serif;">
      ${page1}
      ${page2}
      ${page3}
      ${page4}
    </div>
  `;
}

export async function generateMonthlyReportPDF(report: UnifiedMonthlyReport): Promise<void> {
  // Create hidden container
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.innerHTML = await generateMonthlyReportHTML(report);
  document.body.appendChild(container);

  try {
    const pages = container.querySelectorAll('.pdf-page');
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    for (let i = 0; i < pages.length; i++) {
      if (i > 0) pdf.addPage();
      const pageEl = pages[i] as HTMLElement;
      
      const canvas = await html2canvas(pageEl, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
      });
      
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      
      pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
    }

    const filename = `تقرير_أداء_${report.employee.name.replace(/\s+/g, '_')}_${report.cycle.label.replace(/\s+/g, '_')}.pdf`;
    pdf.save(filename);
    
  } finally {
    document.body.removeChild(container);
  }
}
