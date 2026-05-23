/** مفاتيح أدوار الاعتماد — تُطابق الحقل allowed_approver_roles في القواعد */
export type ApproverRoleKey =
  | "branch_manager"
  | "general_manager"
  | "quality_manager"
  | "customer_service_manager"
  | "delivery_manager";

export const APPROVER_ROLE_LABELS_AR: Record<ApproverRoleKey, string> = {
  branch_manager: "مدير الفرع",
  general_manager: "المدير العام",
  quality_manager: "مدير الجودة",
  customer_service_manager: "مدير خدمة العملاء",
  delivery_manager: "مدير التوصيل",
};

/** يحدد أي مفاتيح اعتماد يملكها المستخدم الحالي بناءً على دوره العربي في النظام */
export function approverKeysForUserRole(role: string | undefined): ApproverRoleKey[] {
  if (!role) return [];
  if (role === "أدمن") {
    return ["branch_manager", "general_manager", "quality_manager", "customer_service_manager", "delivery_manager"];
  }
  if (role === "مدير فرع") {
    return ["branch_manager", "delivery_manager"];
  }
  /** أدوار متخصصة عند إضافتها لاحقًا للفريق */
  if (role === "مدير جودة") return ["quality_manager", "general_manager"];
  if (role === "مدير خدمة عملاء") return ["customer_service_manager", "general_manager"];
  if (role === "مدير توصيل") return ["delivery_manager", "branch_manager"];
  return [];
}

export function userCanApprove(allowed: ApproverRoleKey[] | undefined, userRole: string | undefined): boolean {
  if (!allowed?.length) return true;
  const keys = approverKeysForUserRole(userRole);
  return allowed.some((k) => keys.includes(k));
}

export function formatApproverList(allowed: ApproverRoleKey[]): string {
  return allowed.map((k) => APPROVER_ROLE_LABELS_AR[k] ?? k).join("، ");
}
