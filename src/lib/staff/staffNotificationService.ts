/**
 * Smart Notification Service for Staff Performance
 * 
 * This service generates notifications based on staff performance data,
 * data health issues, and other important events.
 */

import type { StaffPerformanceProfile } from "./staffPerformanceProfileService";

export interface Notification {
  id: string;
  type: "data_health" | "performance" | "attendance" | "customer_service" | "incentive" | "recommendation";
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  message: string;
  staffId: string;
  staffName: string;
  timestamp: string;
  actionUrl?: string;
  dismissed: boolean;
}

export interface NotificationPreferences {
  enableDataHealthAlerts: boolean;
  enablePerformanceAlerts: boolean;
  enableAttendanceAlerts: boolean;
  enableCustomerServiceAlerts: boolean;
  enableRecommendationAlerts: boolean;
  minimumSeverity: "critical" | "high" | "medium" | "low";
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  enableDataHealthAlerts: true,
  enablePerformanceAlerts: true,
  enableAttendanceAlerts: true,
  enableCustomerServiceAlerts: true,
  enableRecommendationAlerts: true,
  minimumSeverity: "medium",
};

/**
 * Generate notifications from staff performance profile
 */
export function generateNotifications(
  profile: StaffPerformanceProfile,
  preferences: Partial<NotificationPreferences> = {}
): Notification[] {
  const prefs: NotificationPreferences = { ...DEFAULT_PREFERENCES, ...preferences };
  const notifications: Notification[] = [];
  const now = new Date().toISOString();

  // Data Health Notifications
  if (prefs.enableDataHealthAlerts) {
    if (profile.dataHealth.warnings.length > 0) {
      profile.dataHealth.warnings.forEach((warning, idx) => {
        const severity = getWarningSeverity(warning);
        if (shouldNotify(severity, prefs.minimumSeverity)) {
          notifications.push({
            id: `data-health-${profile.staff.id}-${idx}`,
            type: "data_health",
            severity,
            title: "مشكلة في جودة البيانات",
            message: warning,
            staffId: profile.staff.id,
            staffName: profile.staff.name,
            timestamp: now,
            actionUrl: `/staff/${profile.staff.id}`,
            dismissed: false,
          });
        }
      });
    }

    if (profile.dataHealth.duplicateStaff) {
      notifications.push({
        id: `duplicate-staff-${profile.staff.id}`,
        type: "data_health",
        severity: "high",
        title: "موظف مكرر",
        message: `الموظف ${profile.staff.name} لديه سجلات مكررة في النظام`,
        staffId: profile.staff.id,
        staffName: profile.staff.name,
        timestamp: now,
        actionUrl: `/staff/${profile.staff.id}`,
        dismissed: false,
      });
    }

    if (profile.dataHealth.missingStaffIdInSales > 0) {
      notifications.push({
        id: `missing-sales-staff-${profile.staff.id}`,
        type: "data_health",
        severity: "high",
        title: "فواتير غير مرتبطة",
        message: `${profile.dataHealth.missingStaffIdInSales} فاتورة غير مرتبطة بهذا الموظف`,
        staffId: profile.staff.id,
        staffName: profile.staff.name,
        timestamp: now,
        actionUrl: `/staff/${profile.staff.id}`,
        dismissed: false,
      });
    }
  }

  // Performance Notifications
  if (prefs.enablePerformanceAlerts && profile.monthlyIncentive) {
    const points = profile.monthlyIncentive.finalPoints;
    
    if (points < 350) {
      notifications.push({
        id: `low-points-${profile.staff.id}`,
        type: "performance",
        severity: "critical",
        title: "أداء منخفض",
        message: `النقاط الحالية (${points}) أقل من 350 نقطة`,
        staffId: profile.staff.id,
        staffName: profile.staff.name,
        timestamp: now,
        actionUrl: `/staff/${profile.staff.id}`,
        dismissed: false,
      });
    } else if (points < 400) {
      notifications.push({
        id: `medium-points-${profile.staff.id}`,
        type: "performance",
        severity: "medium",
        title: "أداء متوسط",
        message: `النقاط الحالية (${points}) أقل من 400 نقطة`,
        staffId: profile.staff.id,
        staffName: profile.staff.name,
        timestamp: now,
        actionUrl: `/staff/${profile.staff.id}`,
        dismissed: false,
      });
    }

    if (profile.monthlyIncentive.pendingDeductionPoints > 0) {
      notifications.push({
        id: `pending-deductions-${profile.staff.id}`,
        type: "incentive",
        severity: "high",
        title: "خصومات معلقة",
        message: `${profile.monthlyIncentive.pendingDeductionPoints} نقطة خصم معلقة للموافقة`,
        staffId: profile.staff.id,
        staffName: profile.staff.name,
        timestamp: now,
        actionUrl: `/staff/${profile.staff.id}`,
        dismissed: false,
      });
    }
  }

  // Attendance Notifications
  if (prefs.enableAttendanceAlerts && profile.attendance) {
    if (profile.attendance.attendanceCompliance < 80) {
      notifications.push({
        id: `low-attendance-${profile.staff.id}`,
        type: "attendance",
        severity: "high",
        title: "التزام منخفض بالحضور",
        message: `نسبة الالتزام بالحضور ${profile.attendance.attendanceCompliance.toFixed(0)}%`,
        staffId: profile.staff.id,
        staffName: profile.staff.name,
        timestamp: now,
        actionUrl: `/staff/${profile.staff.id}`,
        dismissed: false,
      });
    }

    if (profile.attendance.delaysOver20Minutes > 3) {
      notifications.push({
        id: `frequent-delays-${profile.staff.id}`,
        type: "attendance",
        severity: "medium",
        title: "تأخيرات متكررة",
        message: `${profile.attendance.delaysOver20Minutes} تأخيرات أكثر من 20 دقيقة`,
        staffId: profile.staff.id,
        staffName: profile.staff.name,
        timestamp: now,
        actionUrl: `/staff/${profile.staff.id}`,
        dismissed: false,
      });
    }

    if (profile.attendance.unauthorizedAbsences > 0) {
      notifications.push({
        id: `unauthorized-absences-${profile.staff.id}`,
        type: "attendance",
        severity: "high",
        title: "غيابات غير مصرح بها",
        message: `${profile.attendance.unauthorizedAbsences} غياب بدون إذن`,
        staffId: profile.staff.id,
        staffName: profile.staff.name,
        timestamp: now,
        actionUrl: `/staff/${profile.staff.id}`,
        dismissed: false,
      });
    }
  }

  // Customer Service Notifications
  if (prefs.enableCustomerServiceAlerts && profile.customerService) {
    if (profile.customerService.complaintCount > 0) {
      notifications.push({
        id: `complaints-${profile.staff.id}`,
        type: "customer_service",
        severity: "high",
        title: "شكاوى العملاء",
        message: `${profile.customerService.complaintCount} شكوى من العملاء`,
        staffId: profile.staff.id,
        staffName: profile.staff.name,
        timestamp: now,
        actionUrl: `/staff/${profile.staff.id}`,
        dismissed: false,
      });
    }

    if (profile.customerService.missingCustomerClassification > 10) {
      notifications.push({
        id: `missing-classification-${profile.staff.id}`,
        type: "customer_service",
        severity: "medium",
        title: "تصنيفات مفقودة",
        message: `${profile.customerService.missingCustomerClassification} عميل بدون تصنيف`,
        staffId: profile.staff.id,
        staffName: profile.staff.name,
        timestamp: now,
        actionUrl: `/staff/${profile.staff.id}`,
        dismissed: false,
      });
    }

    if (profile.customerService.conversationEvaluationAverage < 70) {
      notifications.push({
        id: `low-evaluation-${profile.staff.id}`,
        type: "customer_service",
        severity: "high",
        title: "تقييم منخفض",
        message: `متوسط التقييم ${profile.customerService.conversationEvaluationAverage.toFixed(0)}/100`,
        staffId: profile.staff.id,
        staffName: profile.staff.name,
        timestamp: now,
        actionUrl: `/staff/${profile.staff.id}`,
        dismissed: false,
      });
    }
  }

  // Recommendation Notifications
  if (prefs.enableRecommendationAlerts) {
    const highPriorityRecommendations = profile.recommendations.filter((r) => r.priority === "high");
    if (highPriorityRecommendations.length > 0) {
      highPriorityRecommendations.forEach((rec, idx) => {
        notifications.push({
          id: `recommendation-${profile.staff.id}-${idx}`,
          type: "recommendation",
          severity: "high",
          title: `توصية: ${rec.category}`,
          message: rec.reason,
          staffId: profile.staff.id,
          staffName: profile.staff.name,
          timestamp: now,
          actionUrl: `/staff/${profile.staff.id}`,
          dismissed: false,
        });
      });
    }
  }

  // Filter by minimum severity
  return notifications.filter((n) => shouldNotify(n.severity, prefs.minimumSeverity));
}

/**
 * Get severity level from warning message
 */
function getWarningSeverity(warning: string): "critical" | "high" | "medium" | "low" {
  const warningLower = warning.toLowerCase();
  
  if (warningLower.includes("خطأ") || warningLower.includes("مفقود") || warningLower.includes("غير مرتبط")) {
    return "critical";
  }
  if (warningLower.includes("تحذير") || warningLower.includes("مشكلة")) {
    return "high";
  }
  if (warningLower.includes("ملاحظة") || warningLower.includes("تذكير")) {
    return "medium";
  }
  return "low";
}

/**
 * Check if notification should be sent based on severity preferences
 */
function shouldNotify(severity: "critical" | "high" | "medium" | "low", minimum: "critical" | "high" | "medium" | "low"): boolean {
  const severityOrder = ["critical", "high", "medium", "low"];
  const severityIndex = severityOrder.indexOf(severity);
  const minimumIndex = severityOrder.indexOf(minimum);
  
  return severityIndex <= minimumIndex;
}

/**
 * Generate batch notifications for multiple staff profiles
 */
export async function generateBatchNotifications(
  profiles: StaffPerformanceProfile[],
  preferences: Partial<NotificationPreferences> = {}
): Promise<Notification[]> {
  const allNotifications: Notification[] = [];
  
  for (const profile of profiles) {
    const notifications = generateNotifications(profile, preferences);
    allNotifications.push(...notifications);
  }
  
  // Sort by severity and timestamp
  const severityOrder = ["critical", "high", "medium", "low"];
  allNotifications.sort((a, b) => {
    const severityDiff = severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity);
    if (severityDiff !== 0) return severityDiff;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });
  
  return allNotifications;
}

/**
 * Get notification summary statistics
 */
export function getNotificationSummary(notifications: Notification[]): {
  total: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
  dismissed: number;
  unread: number;
} {
  return {
    total: notifications.length,
    byType: notifications.reduce((acc, n) => {
      acc[n.type] = (acc[n.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    bySeverity: notifications.reduce((acc, n) => {
      acc[n.severity] = (acc[n.severity] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    dismissed: notifications.filter((n) => n.dismissed).length,
    unread: notifications.filter((n) => !n.dismissed).length,
  };
}

/**
 * Mark notification as dismissed
 */
export function dismissNotification(notificationId: string, notifications: Notification[]): Notification[] {
  return notifications.map((n) =>
    n.id === notificationId ? { ...n, dismissed: true } : n
  );
}

/**
 * Mark all notifications as dismissed
 */
export function dismissAllNotifications(notifications: Notification[]): Notification[] {
  return notifications.map((n) => ({ ...n, dismissed: true }));
}
