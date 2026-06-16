import type { StaffBaseProfile } from "@/lib/staffDetailLoader";
import type { StaffIdentity } from "./staffPerformanceProfileService";
import type { StaffDataHealth } from "./staffPerformanceProfileService";
import type { StaffCycleIncentive } from "@/lib/staffIncentiveService";
import type { StaffSalesMetrics } from "./staffPerformanceProfileService";
import type { StaffCustomerMetrics } from "./staffPerformanceProfileService";
import type { StaffStagnantListMetrics } from "./staffPerformanceProfileService";
import type { StaffCustomerServiceMetrics } from "./staffPerformanceProfileService";
import type { StaffAttendanceMetrics } from "./staffPerformanceProfileService";
import type { StaffQuarterlyMetrics } from "./staffPerformanceProfileService";

export interface StaffRecommendation {
  priority: "high" | "medium" | "low";
  category: string;
  reason: string;
  suggestedAction: string;
  relatedMetric?: string;
  link?: string;
}

export interface RecommendationContext {
  staff: StaffBaseProfile;
  identity: StaffIdentity;
  dataHealth: StaffDataHealth;
  monthlyIncentive: StaffCycleIncentive | null;
  sales: StaffSalesMetrics | null;
  customers: StaffCustomerMetrics | null;
  stagnantMedicines: StaffStagnantListMetrics | null;
  listItems: StaffStagnantListMetrics | null;
  customerService: StaffCustomerServiceMetrics | null;
  attendance: StaffAttendanceMetrics | null;
  quarterlyIncentive: StaffQuarterlyMetrics | null;
}

export function generateStaffRecommendations(context: RecommendationContext): StaffRecommendation[] {
  const recommendations: StaffRecommendation[] = [];

  // Data Health Recommendations
  if (context.dataHealth.unresolvedSellerNames.length > 0) {
    recommendations.push({
      priority: "high",
      category: "data_health",
      reason: "قد تكون مبيعات الدكتور غير مربوطة بسبب اختلاف الاسم في الفواتير",
      suggestedAction: "اربط اسم الدكتور بالفواتير باستخدام staff_identity_aliases أو راجع spelling في الفواتير",
      relatedMetric: "unresolvedSellerNames",
    });
  }

  if (context.dataHealth.duplicateStaff) {
    recommendations.push({
      priority: "high",
      category: "data_health",
      reason: "يوجد موظف مكرر بنفس الاسم",
      suggestedAction: "راجع سجلات الموظفين ودمج الحسابات المكررة",
      relatedMetric: "duplicateStaff",
    });
  }

  if (!context.dataHealth.salesLinked && context.dataHealth.hasSales) {
    recommendations.push({
      priority: "high",
      category: "data_health",
      reason: "المبيعات موجودة لكن غير مربوطة بشكل صحيح",
      suggestedAction: "راجع عملية ربط المبيعات بالموظف",
      relatedMetric: "salesLinked",
    });
  }

  // Sales Performance Recommendations
  if (context.sales) {
    if (context.sales.avgInvoice < 500) {
      recommendations.push({
        priority: "high",
        category: "sales",
        reason: "متوسط الفاتورة أقل من 500 جنيه",
        suggestedAction: "راجع فرص البيع الإضافي والبدائل المناسبة لرفع متوسط الفاتورة",
        relatedMetric: "avgInvoice",
      });
    }

    if (context.sales.avgInvoice < 300) {
      recommendations.push({
        priority: "high",
        category: "sales",
        reason: "متوسط الفاتورة منخفض جداً (أقل من 300 جنيه)",
        suggestedAction: "الدكتور يحتاج تدريب على cross-selling ورفع قيمة الفاتورة",
        relatedMetric: "avgInvoice",
      });
    }

    if (context.sales.uniqueCustomers < 10) {
      recommendations.push({
        priority: "medium",
        category: "sales",
        reason: "عدد العملاء المختلفين منخفض",
        suggestedAction: "ركز على جذب عملاء جدد وتنيع قاعدة العملاء",
        relatedMetric: "uniqueCustomers",
      });
    }

    if (context.sales.deliveryInvoices > 0 && context.sales.deliveryInvoices / context.sales.cycleInvoicesCount > 0.3) {
      recommendations.push({
        priority: "medium",
        category: "sales",
        reason: "نسبة التوصيل عالية",
        suggestedAction: "راجع سياسة التوصيل ويمكن تحويل بعض العملاء لاستلام من الفرع",
        relatedMetric: "deliveryInvoices",
      });
    }

    if (context.sales.bestDay && context.sales.weakestDay) {
      recommendations.push({
        priority: "low",
        category: "sales",
        reason: "يوجد تفاوت في الأداء بين الأيام",
        suggestedAction: `أفضل يوم: ${context.sales.bestDay}، أضعف يوم: ${context.sales.weakestDay}. راجع سبب التفاوت`,
        relatedMetric: "bestDay",
      });
    }
  }

  // Customer Recommendations
  if (context.customers) {
    if (context.customers.customersNeedingFollowupCount > 5) {
      recommendations.push({
        priority: "high",
        category: "customers",
        reason: "يوجد عملاء يحتاجون متابعة",
        suggestedAction: "تواصل مع العملاء الذين يحتاجون متابعة لمنع فقدانهم",
        relatedMetric: "customersNeedingFollowupCount",
      });
    }

    if (context.customers.customersWithMissingPhone > 5) {
      recommendations.push({
        priority: "medium",
        category: "customers",
        reason: "يوجد عملاء بدون رقم هاتف",
        suggestedAction: "حاول الحصول على أرقام هواتف العملاء لتحسين التواصل",
        relatedMetric: "customersWithMissingPhone",
      });
    }

    if (context.customers.newCustomers < 5) {
      recommendations.push({
        priority: "medium",
        category: "customers",
        reason: "عدد العملاء الجدد منخفض",
        suggestedAction: "ركز على جذب عملاء جدد من خلال التوصيات والتسويق",
        relatedMetric: "newCustomers",
      });
    }

    if (context.customers.customersReturnedAfterFollowup.length > 0) {
      recommendations.push({
        priority: "low",
        category: "customers",
        reason: "بعض العملاء عادوا بعد المتابعة",
        suggestedAction: "استمر في استراتيجية المتابعة الفعالة",
        relatedMetric: "customersReturnedAfterFollowup",
      });
    }
  }

  // Stagnant/List Recommendations
  if (context.stagnantMedicines) {
    if (context.stagnantMedicines.stagnantCompletionPercent < 50) {
      recommendations.push({
        priority: "high",
        category: "stagnant_list",
        reason: "الرواكد المخصصة لم تتحرك بالشكل المطلوب",
        suggestedAction: "ضع خطة بيع للأصناف المتبقية قبل انتهاء فترة الحافز",
        relatedMetric: "stagnantCompletionPercent",
      });
    }

    if (context.stagnantMedicines.stagnantMissedTargets.length > 0) {
      recommendations.push({
        priority: "high",
        category: "stagnant_list",
        reason: "يوجد أصناف رواكد لم تتحرك",
        suggestedAction: `راجع الأصناف: ${context.stagnantMedicines.stagnantMissedTargets.slice(0, 3).join(", ")}`,
        relatedMetric: "stagnantMissedTargets",
      });
    }

    if (context.stagnantMedicines.itemsNearExpiry.length > 0) {
      recommendations.push({
        priority: "high",
        category: "stagnant_list",
        reason: "يوجد أصناف قاربت على انتهاء الصلاحية",
        suggestedAction: "سارع في بيع الأصناف القريبة من الانتهاء",
        relatedMetric: "itemsNearExpiry",
      });
    }

    if (context.stagnantMedicines.stagnantCashRewards === 0 && context.stagnantMedicines.assignedStagnantItems > 0) {
      recommendations.push({
        priority: "medium",
        category: "stagnant_list",
        reason: "لم يتم الحصول على مكافآت رواكد",
        suggestedAction: "ركز على بيع الرواكد للحصول على المكافآت",
        relatedMetric: "stagnantCashRewards",
      });
    }
  }

  if (context.listItems) {
    if (context.listItems.listCompletionPercent < 50) {
      recommendations.push({
        priority: "high",
        category: "stagnant_list",
        reason: "أصناف اللستة لم تتحرك بالشكل المطلوب",
        suggestedAction: "ركز على بيع أصناف اللستة للحصول على المكافآت",
        relatedMetric: "listCompletionPercent",
      });
    }

    if (context.listItems.listCashRewards === 0 && context.listItems.assignedListItems > 0) {
      recommendations.push({
        priority: "medium",
        category: "stagnant_list",
        reason: "لم يتم الحصول على مكافآت اللستة",
        suggestedAction: "ركز على بيع أصناف اللستة للحصول على المكافآت",
        relatedMetric: "listCashRewards",
      });
    }
  }

  // Incentive Recommendations
  if (context.monthlyIncentive) {
    if (context.monthlyIncentive.approvedDeductionPoints > 100) {
      recommendations.push({
        priority: "high",
        category: "incentives",
        reason: "الخصومات في زيادة",
        suggestedAction: "راجع أسباب الخصم الأكثر تكرارًا مع الموظف",
        relatedMetric: "approvedDeductionPoints",
      });
    }

    if (context.monthlyIncentive.approvedDeductionPoints > 200) {
      recommendations.push({
        priority: "high",
        category: "incentives",
        reason: "الخصومات عالية جداً",
        suggestedAction: "اجتماع مع الموظف لمناقشة الأداء وتحديد المشاكل",
        relatedMetric: "approvedDeductionPoints",
      });
    }

    if (context.monthlyIncentive.finalPoints < 400) {
      recommendations.push({
        priority: "high",
        category: "incentives",
        reason: "النقاط النهائية أقل من 400",
        suggestedAction: "الموظف يحتاج تحسين كبير في الأداء",
        relatedMetric: "finalPoints",
      });
    }

    if (context.monthlyIncentive.pendingDeductionPoints > 0) {
      recommendations.push({
        priority: "medium",
        category: "incentives",
        reason: "يوجد خصومات معلقة",
        suggestedAction: "راجع واعتماد أو رفض الخصومات المعلقة",
        relatedMetric: "pendingDeductionPoints",
      });
    }

    if (context.monthlyIncentive.pendingRewardPoints > 0) {
      recommendations.push({
        priority: "medium",
        category: "incentives",
        reason: "يوجد مكافآت معلقة",
        suggestedAction: "راجع واعتماد المكافآت المعلقة",
        relatedMetric: "pendingRewardPoints",
      });
    }

    if (context.monthlyIncentive.distinctionPointsAbove500 > 0) {
      recommendations.push({
        priority: "low",
        category: "incentives",
        reason: "النقاط النهائية أعلى من 500",
        suggestedAction: "أداء ممتاز! الزيادة تظهر كنقاط تميز فقط",
        relatedMetric: "distinctionPointsAbove500",
      });
    }
  }

  // Customer Service Recommendations
  if (context.customerService) {
    if (context.customerService.missingCustomerClassification > 10) {
      recommendations.push({
        priority: "medium",
        category: "customer_service",
        reason: "جودة تصنيف العملاء ضعيفة",
        suggestedAction: "الدكتور يحتاج تحسين تسجيل تصنيف العميل",
        relatedMetric: "missingCustomerClassification",
      });
    }

    if (context.customerService.missingInvoiceClassification > 10) {
      recommendations.push({
        priority: "medium",
        category: "customer_service",
        reason: "جودة تصنيف الفواتير ضعيفة",
        suggestedAction: "الدكتور يحتاج تحسين تسجيل تصنيف الفاتورة",
        relatedMetric: "missingInvoiceClassification",
      });
    }

    if (context.customerService.bothClassificationsMissing > 5) {
      recommendations.push({
        priority: "high",
        category: "customer_service",
        reason: "كلا التصنيفين مفقودين في عدة فواتير",
        suggestedAction: "الدكتور يحتاج تدريب على تصنيف الفواتير والعملاء",
        relatedMetric: "bothClassificationsMissing",
      });
    }

    if (context.customerService.followupsMissed > 5) {
      recommendations.push({
        priority: "medium",
        category: "customer_service",
        reason: "عدد كبير من المتابعات المفقودة",
        suggestedAction: "راجع نظام المتابعة وتحسين الالتزام",
        relatedMetric: "followupsMissed",
      });
    }

    if (context.customerService.conversationEvaluationAverage < 3) {
      recommendations.push({
        priority: "high",
        category: "customer_service",
        reason: "متوسط تقييم المحادثات منخفض",
        suggestedAction: "الدكتور يحتاج تدريب على خدمة العملاء",
        relatedMetric: "conversationEvaluationAverage",
      });
    }
  }

  // Attendance Recommendations
  if (context.attendance) {
    if (context.attendance.delaysOver20Minutes > 2) {
      recommendations.push({
        priority: "medium",
        category: "attendance",
        reason: "يوجد تكرار تأخير",
        suggestedAction: "راجع الالتزام بالشيفت مع الموظف",
        relatedMetric: "delaysOver20Minutes",
      });
    }

    if (context.attendance.permissionsUsed > 3) {
      recommendations.push({
        priority: "medium",
        category: "attendance",
        reason: "تجاوز الحد المسموح من الإذنات المجانية",
        suggestedAction: "الموظف تجاوز 3 إذنات مجانية، الباقي بخصم",
        relatedMetric: "permissionsUsed",
      });
    }

    if (context.attendance.unauthorizedAbsences > 0) {
      recommendations.push({
        priority: "high",
        category: "attendance",
        reason: "يوجد غياب بدون إذن",
        suggestedAction: "راجع سياسة الغياب مع الموظف",
        relatedMetric: "unauthorizedAbsences",
      });
    }

    if (context.attendance.attendanceCompliance < 80) {
      recommendations.push({
        priority: "high",
        category: "attendance",
        reason: "نسبة الالتزام بالحضور منخفضة",
        suggestedAction: "راجع أسباب الغياب والتأخير مع الموظف",
        relatedMetric: "attendanceCompliance",
      });
    }
  }

  // Quarterly Performance Recommendations
  if (context.quarterlyIncentive) {
    if (context.quarterlyIncentive.quarterlyScore < 50) {
      recommendations.push({
        priority: "high",
        category: "quarterly",
        reason: "النتيجة الربع سنوية منخفضة",
        suggestedAction: "راجع جميع جوانب الأداء لتحسين النتيجة في الربع القادم",
        relatedMetric: "quarterlyScore",
      });
    }

    if (context.quarterlyIncentive.quarterlyScore < 70) {
      recommendations.push({
        priority: "medium",
        category: "quarterly",
        reason: "النتيجة الربع سنوية تحت المتوسط",
        suggestedAction: "ركز على تحسين الجوانب الضعيفة في الأداء",
        relatedMetric: "quarterlyScore",
      });
    }

    if (context.quarterlyIncentive.quarterlyCashDeductions > 0) {
      recommendations.push({
        priority: "high",
        category: "quarterly",
        reason: "يوجد خصومات ربع سنوية",
        suggestedAction: "راجع أسباب الخصومات الربع سنوية",
        relatedMetric: "quarterlyCashDeductions",
      });
    }

    if (context.quarterlyIncentive.scoreBreakdown.salesGrowth < 10) {
      recommendations.push({
        priority: "medium",
        category: "quarterly",
        reason: "نمو المبيعات منخفض",
        suggestedAction: "ركز على زيادة المبيعات",
        relatedMetric: "salesGrowth",
      });
    }

    if (context.quarterlyIncentive.scoreBreakdown.avgInvoice < 10) {
      recommendations.push({
        priority: "medium",
        category: "quarterly",
        reason: "متوسط الفاتورة منخفض",
        suggestedAction: "ركز على رفع متوسط الفاتورة",
        relatedMetric: "avgInvoice",
      });
    }

    if (context.quarterlyIncentive.scoreBreakdown.customers < 10) {
      recommendations.push({
        priority: "medium",
        category: "quarterly",
        reason: "عدد العملاء منخفض",
        suggestedAction: "ركز على جذب عملاء جدد",
        relatedMetric: "customers",
      });
    }

    if (context.quarterlyIncentive.scoreBreakdown.listItems < 10) {
      recommendations.push({
        priority: "medium",
        category: "quarterly",
        reason: "أداء أصناف اللستة منخفض",
        suggestedAction: "ركز على بيع أصناف اللستة",
        relatedMetric: "listItems",
      });
    }

    if (context.quarterlyIncentive.scoreBreakdown.stagnantInventory < 5) {
      recommendations.push({
        priority: "medium",
        category: "quarterly",
        reason: "أداء الرواكد منخفض",
        suggestedAction: "ركز على بيع الرواكد",
        relatedMetric: "stagnantInventory",
      });
    }

    if (context.quarterlyIncentive.scoreBreakdown.registrationQuality < 5) {
      recommendations.push({
        priority: "medium",
        category: "quarterly",
        reason: "جودة التسجيل منخفضة",
        suggestedAction: "حسن جودة تسجيل البيانات",
        relatedMetric: "registrationQuality",
      });
    }
  }

  // Sort recommendations by priority
  recommendations.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });

  return recommendations;
}
