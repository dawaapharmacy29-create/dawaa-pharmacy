export interface PillarInput {
  // Sales & invoices
  invoicesWithCustomerCode: number;
  totalInvoices: number;
  avgInvoice: number;
  branchAvgInvoice: number;
  invoiceCountCurrentCycle: number;
  invoiceCountPreviousCycle: number;
  avgBasketSize: number;
  // Customers
  totalLinkedCustomers: number;
  customersWithoutPhone: number;
  // Reviews
  avgConversationReviewScore: number; // out of 5
  totalReviews: number;
  // Followups
  completedFollowups: number;
  totalFollowups: number;
  // Attendance
  presentDays: number;
  scheduledDays: number;
  // Tasks
  completedTasks: number;
  totalTasks: number;
  // Shift issues
  shiftIssuesAsLeader: number;
  shiftIssuesAsMember: number;
  totalShiftReviews: number;
  // Stagnant & list
  stagnantSold: number;
  stagnantAssigned: number;
  listSold: number;
  listAssigned: number;
  nearExpiryHandled: number;
  nearExpiryTotal: number;
  // System usage
  followupSystemUsageRate: number; // 0-1
}

export interface PillarScore {
  pillar: string;
  score: number;
  maxScore: number;
  percentage: number;
  details: string[];
  breakdown: { label: string; earned: number; max: number }[];
}

export function calculatePillarScores(input: PillarInput): PillarScore[] {
  const scores: PillarScore[] = [];

  const safeRate = (numerator: number, denominator: number) => {
    return denominator > 0 ? Math.min(Math.max(numerator / denominator, 0), 1) : 0;
  };

  // 1. خدمة العملاء والمتابعات (Customer Service) - max 100
  const linkingRate = safeRate(input.invoicesWithCustomerCode, input.totalInvoices);
  const linkingScore = Math.round(linkingRate * 30);
  
  const conversationScoreRatio = safeRate(input.avgConversationReviewScore, 5);
  const conversationScore = input.totalReviews > 0 ? Math.round(conversationScoreRatio * 40) : 40;
  
  const followupRate = safeRate(input.completedFollowups, input.totalFollowups);
  const followupScore = input.totalFollowups > 0 ? Math.round(followupRate * 30) : 30;

  const customerServiceTotal = linkingScore + conversationScore + followupScore;

  scores.push({
    pillar: 'خدمة العملاء والمتابعات',
    score: customerServiceTotal,
    maxScore: 100,
    percentage: customerServiceTotal,
    details: [
      `نسبة ربط الفواتير بالعملاء: ${Math.round(linkingRate * 100)}%`,
      `تقييم المحادثات: ${input.avgConversationReviewScore.toFixed(1)} / 5`,
      `معدل إكمال المتابعات: ${Math.round(followupRate * 100)}%`
    ],
    breakdown: [
      { label: 'ربط العملاء', earned: linkingScore, max: 30 },
      { label: 'تقييم المحادثات', earned: conversationScore, max: 40 },
      { label: 'إكمال المتابعات', earned: followupScore, max: 30 }
    ]
  });

  // 2. الالتزام والتشغيل (Compliance & Operations) - max 100
  const attendanceRate = safeRate(input.presentDays, input.scheduledDays);
  const attendanceScore = input.scheduledDays > 0 ? Math.round(attendanceRate * 40) : 40;
  
  const taskRate = safeRate(input.completedTasks, input.totalTasks);
  const taskScore = input.totalTasks > 0 ? Math.round(taskRate * 30) : 30;
  
  const totalIssues = input.shiftIssuesAsLeader + input.shiftIssuesAsMember;
  const issuesPenalty = Math.min(totalIssues * 6, 30); // 6 points lost per issue
  const shiftScore = 30 - issuesPenalty;

  const complianceTotal = attendanceScore + taskScore + shiftScore;

  scores.push({
    pillar: 'الالتزام والتشغيل',
    score: complianceTotal,
    maxScore: 100,
    percentage: complianceTotal,
    details: [
      `نسبة الحضور: ${Math.round(attendanceRate * 100)}%`,
      `إنجاز المهام: ${Math.round(taskRate * 100)}%`,
      `ملاحظات الشفتات: ${totalIssues} ملاحظة`
    ],
    breakdown: [
      { label: 'الحضور والانصراف', earned: attendanceScore, max: 40 },
      { label: 'إنجاز المهام', earned: taskScore, max: 30 },
      { label: 'جودة الشفتات', earned: shiftScore, max: 30 }
    ]
  });

  // 3. جودة البيع والتسجيل (Sales Quality) - max 100
  const avgInvoiceRatio = input.branchAvgInvoice > 0 ? Math.min(input.avgInvoice / input.branchAvgInvoice, 2.0) : 1;
  const avgInvoiceScore = Math.round(Math.min(avgInvoiceRatio, 1.0) * 40);
  
  let invoiceGrowthRatio = 1.0;
  if (input.invoiceCountPreviousCycle > 0) {
    const growth = (input.invoiceCountCurrentCycle - input.invoiceCountPreviousCycle) / input.invoiceCountPreviousCycle;
    const normalizedGrowth = (growth + 0.2) / 0.3; 
    invoiceGrowthRatio = Math.max(Math.min(normalizedGrowth, 1.0), 0);
  }
  const growthScore = Math.round(invoiceGrowthRatio * 30);
  
  const basketSizeRatio = safeRate(input.avgBasketSize, 3);
  const basketSizeScore = Math.round(basketSizeRatio * 30);

  const salesTotal = avgInvoiceScore + growthScore + basketSizeScore;

  scores.push({
    pillar: 'جودة البيع والتسجيل',
    score: salesTotal,
    maxScore: 100,
    percentage: salesTotal,
    details: [
      `متوسط الفاتورة: ${input.avgInvoice.toFixed(2)} مقارنة بمتوسط الفرع ${input.branchAvgInvoice.toFixed(2)}`,
      `النمو في الفواتير: ${input.invoiceCountPreviousCycle ? Math.round(((input.invoiceCountCurrentCycle - input.invoiceCountPreviousCycle) / input.invoiceCountPreviousCycle) * 100) : 0}%`,
      `متوسط سلة المشتريات: ${input.avgBasketSize.toFixed(1)} صنف/فاتورة`
    ],
    breakdown: [
      { label: 'متوسط الفاتورة', earned: avgInvoiceScore, max: 40 },
      { label: 'نمو الفواتير', earned: growthScore, max: 30 },
      { label: 'سلة المشتريات', earned: basketSizeScore, max: 30 }
    ]
  });

  // 4. المخزون والرواكد واللستة (Inventory) - max 100
  const stagnantRate = safeRate(input.stagnantSold, input.stagnantAssigned);
  const stagnantScore = input.stagnantAssigned > 0 ? Math.round(stagnantRate * 50) : 50;

  const listRate = safeRate(input.listSold, input.listAssigned);
  const listScore = input.listAssigned > 0 ? Math.round(listRate * 30) : 30;

  const expiryRate = safeRate(input.nearExpiryHandled, input.nearExpiryTotal);
  const expiryScore = input.nearExpiryTotal > 0 ? Math.round(expiryRate * 20) : 20;

  const inventoryTotal = stagnantScore + listScore + expiryScore;

  scores.push({
    pillar: 'المخزون والرواكد واللستة',
    score: inventoryTotal,
    maxScore: 100,
    percentage: inventoryTotal,
    details: [
      `بيع الرواكد: ${Math.round(stagnantRate * 100)}%`,
      `بيع اللستة التحفيزية: ${Math.round(listRate * 100)}%`,
      `التعامل مع التوالف: ${Math.round(expiryRate * 100)}%`
    ],
    breakdown: [
      { label: 'بيع الرواكد', earned: stagnantScore, max: 50 },
      { label: 'اللستة التحفيزية', earned: listScore, max: 30 },
      { label: 'الأدوية قاربت الصلاحية', earned: expiryScore, max: 20 }
    ]
  });

  // 5. استخدام السيستم والتطوير (System Usage) - max 100
  const sysCustomerCodeScore = Math.round(linkingRate * 40); 
  
  const customersWithPhone = Math.max(input.totalLinkedCustomers - input.customersWithoutPhone, 0);
  const dataAccuracyRate = safeRate(customersWithPhone, input.totalLinkedCustomers);
  const dataAccuracyScore = input.totalLinkedCustomers > 0 ? Math.round(dataAccuracyRate * 30) : 30;
  
  const sysFollowupScore = Math.round(safeRate(input.followupSystemUsageRate, 1) * 30);

  const systemTotal = sysCustomerCodeScore + dataAccuracyScore + sysFollowupScore;

  scores.push({
    pillar: 'استخدام السيستم والتطوير',
    score: systemTotal,
    maxScore: 100,
    percentage: systemTotal,
    details: [
      `استخدام كود العميل: ${Math.round(linkingRate * 100)}%`,
      `دقة تسجيل البيانات: ${Math.round(dataAccuracyRate * 100)}%`,
      `استخدام نظام المتابعات: ${Math.round(input.followupSystemUsageRate * 100)}%`
    ],
    breakdown: [
      { label: 'كود العميل بالفواتير', earned: sysCustomerCodeScore, max: 40 },
      { label: 'دقة البيانات', earned: dataAccuracyScore, max: 30 },
      { label: 'استخدام نظام المتابعات', earned: sysFollowupScore, max: 30 }
    ]
  });

  return scores;
}
