import { canonicalStaffRole } from '@/lib/staff/staffRoleCapabilities';

export type LeadershipEvidenceScope =
  | 'team'
  | 'branch'
  | 'multi_branch'
  | 'customer_service_team'
  | 'organization';

export type LeadershipEvidenceRequirement = {
  sectionKey: string;
  scope: LeadershipEvidenceScope;
  requiredSignals: string[];
  summary: string;
};

const REQUIREMENTS: Record<string, Record<string, Omit<LeadershipEvidenceRequirement, 'sectionKey'>>> = {
  shift_supervisor: {
    team_execution: { scope: 'team', requiredSignals: ['assigned_tasks', 'closed_tasks', 'overdue_tasks'], summary: 'تنفيذ مهام الفريق داخل الشيفت وإغلاق المتأخر منها.' },
    handover: { scope: 'team', requiredSignals: ['handover_records', 'open_items_transferred'], summary: 'سجلات التسليم والاستلام والمهام المفتوحة.' },
    customer_issues: { scope: 'team', requiredSignals: ['customer_escalations', 'resolution_time', 'resolution_outcome'], summary: 'تصعيدات العملاء ووقت ونتيجة الحل.' },
    operations: { scope: 'branch', requiredSignals: ['operational_incidents', 'resolved_incidents'], summary: 'مشكلات التشغيل التي ظهرت أثناء الشيفت وما تم إغلاقه.' },
  },
  branch_manager: {
    team: { scope: 'branch', requiredSignals: ['team_attendance', 'task_execution', 'development_actions'], summary: 'نتيجة الفريق وانضباطه وإغلاق المهام وخطط التطوير.' },
    operations: { scope: 'branch', requiredSignals: ['inventory_health', 'invoice_quality', 'delivery_health', 'operational_incidents'], summary: 'صحة تشغيل الفرع من مصادر التشغيل الفعلية.' },
    customers: { scope: 'branch', requiredSignals: ['customer_cases', 'followup_health', 'complaints', 'retention_signal'], summary: 'نتائج العملاء والمتابعات والتصعيدات على مستوى الفرع.' },
    quality: { scope: 'branch', requiredSignals: ['documented_errors', 'audit_findings', 'data_quality'], summary: 'الأخطاء الموثقة ونتائج الرقابة وسلامة البيانات.' },
    execution: { scope: 'branch', requiredSignals: ['assigned_actions', 'closed_actions', 'overdue_actions'], summary: 'الإجراءات المسندة والمغلقة والمتأخرة ونتيجتها.' },
  },
  branches_manager: {
    branch_health: { scope: 'multi_branch', requiredSignals: ['branch_kpis', 'branch_variance', 'critical_incidents'], summary: 'صحة الفروع والفجوات بينها والحالات الحرجة.' },
    managers: { scope: 'multi_branch', requiredSignals: ['manager_reviews', 'development_actions', 'followthrough'], summary: 'متابعة مديري الفروع وخطط التطوير ونتيجة المتابعة.' },
    operations: { scope: 'multi_branch', requiredSignals: ['inventory_health', 'operational_incidents', 'availability'], summary: 'استقرار التشغيل والمخزون والتوافر عبر الفروع.' },
    customers: { scope: 'multi_branch', requiredSignals: ['customer_health', 'complaints', 'retention_signal'], summary: 'جودة خدمة العملاء والاحتفاظ والتصعيدات عبر الفروع.' },
    execution: { scope: 'multi_branch', requiredSignals: ['strategic_actions', 'closed_actions', 'overdue_actions'], summary: 'المشروعات والإجراءات ووضوح المسؤول والموعد والنتيجة.' },
  },
  customer_service_manager: {
    team_quality: { scope: 'customer_service_team', requiredSignals: ['team_review_coverage', 'team_quality_score', 'coaching_actions'], summary: 'جودة الفريق وتغطية المراجعات وإجراءات التطوير.' },
    followups_sla: { scope: 'customer_service_team', requiredSignals: ['followup_volume', 'on_time_rate', 'overdue_followups'], summary: 'حجم المتابعات والالتزام بالموعد والمتأخر.' },
    customer_outcomes: { scope: 'customer_service_team', requiredSignals: ['purchase_after_followup', 'retention_signal', 'complaints'], summary: 'نتائج المتابعات والاحتفاظ والشكاوى.' },
    data_governance: { scope: 'customer_service_team', requiredSignals: ['data_completeness', 'duplicate_rate', 'classification_quality'], summary: 'اكتمال البيانات والتكرار وجودة التصنيف.' },
    leadership: { scope: 'customer_service_team', requiredSignals: ['escalations', 'cross_branch_coordination', 'closed_actions'], summary: 'التصعيد والتنسيق وإغلاق الإجراءات القيادية.' },
  },
  executive: {
    results: { scope: 'organization', requiredSignals: ['business_kpis', 'operational_stability', 'priority_delivery'], summary: 'نتائج المنظومة واستقرار التشغيل وتنفيذ الأولويات.' },
    governance: { scope: 'organization', requiredSignals: ['audit_findings', 'decision_traceability', 'permission_health'], summary: 'الحوكمة وسلامة القرارات والصلاحيات.' },
    leaders: { scope: 'organization', requiredSignals: ['leader_reviews', 'development_actions', 'followthrough'], summary: 'تطوير القيادات ومتابعة خطط التحسين.' },
    customers: { scope: 'organization', requiredSignals: ['customer_health', 'retention_signal', 'critical_escalations'], summary: 'صحة العملاء والاحتفاظ والتصعيدات الحرجة.' },
    projects: { scope: 'organization', requiredSignals: ['project_milestones', 'risk_closure', 'overdue_actions'], summary: 'المشروعات والمخاطر والالتزام بالمواعيد.' },
  },
  admin: {
    governance: { scope: 'organization', requiredSignals: ['permission_health', 'decision_traceability', 'audit_findings'], summary: 'سلامة الصلاحيات والقرارات والرقابة.' },
    operations: { scope: 'organization', requiredSignals: ['operational_incidents', 'resolved_incidents', 'risk_register'], summary: 'استقرار التشغيل والمخاطر والإجراءات.' },
    data: { scope: 'organization', requiredSignals: ['data_quality', 'duplicate_rate', 'source_health'], summary: 'دقة البيانات والتكرار وصحة مصادر الحقيقة.' },
    execution: { scope: 'organization', requiredSignals: ['assigned_actions', 'closed_actions', 'overdue_actions'], summary: 'إغلاق الإجراءات والالتزام بالمسؤول والموعد.' },
  },
};

export function leadershipEvidenceRequirement(role: unknown, sectionKey: string): LeadershipEvidenceRequirement | null {
  const canonicalRole = canonicalStaffRole(role);
  const requirement = REQUIREMENTS[canonicalRole]?.[String(sectionKey || '').toLowerCase()];
  return requirement ? { sectionKey: String(sectionKey || '').toLowerCase(), ...requirement } : null;
}

export function isLeadershipEvaluationRole(role: unknown) {
  return Boolean(REQUIREMENTS[canonicalStaffRole(role)]);
}

export function leadershipEvidenceIsSufficient(
  requirement: LeadershipEvidenceRequirement,
  availableSignals: Iterable<string>
) {
  const available = new Set([...availableSignals].map((value) => String(value).trim()).filter(Boolean));
  const missingSignals = requirement.requiredSignals.filter((signal) => !available.has(signal));
  return {
    sufficient: missingSignals.length === 0,
    status: missingSignals.length === 0 ? 'sufficient' as const : 'insufficient' as const,
    missingSignals,
  };
}
