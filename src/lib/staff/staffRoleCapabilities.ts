export type CanonicalStaffRole =
  | 'doctor'
  | 'assistant'
  | 'inventory_assistant'
  | 'cleaning'
  | 'delivery'
  | 'customer_service'
  | 'customer_service_manager'
  | 'shift_supervisor'
  | 'branch_manager'
  | 'branches_manager'
  | 'purchasing'
  | 'executive'
  | 'admin'
  | 'other';

export type StaffCapability =
  | 'customer_conversation'
  | 'customer_followup'
  | 'customer_request'
  | 'sales_quality'
  | 'inventory'
  | 'cleaning'
  | 'delivery'
  | 'team_supervision'
  | 'branch_supervision'
  | 'points_incentive';

function token(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

// The «فريق دواء ألفا» team is customer service for WhatsApp conversation analysis only. It is kept
// out of canonicalStaffRole on purpose: that mapping drives evaluation profiles, capabilities and
// incentive applicability, which this analysis-only label must not change.
const CUSTOMER_SERVICE_TEAM_LABELS = ['team dawaa alpha', 'فريق دواء ألفا', 'فريق دواء الفا'];

/** Analysis-only: does this staff role/type label name the customer-service team? */
export function isCustomerServiceTeamLabel(value: unknown): boolean {
  return CUSTOMER_SERVICE_TEAM_LABELS.includes(token(value)) || canonicalStaffRole(value) === 'customer_service';
}

export function canonicalStaffRole(value: unknown): CanonicalStaffRole {
  const role = token(value);
  if (!role) return 'other';

  if (['صيدلاني', 'صيدلي', 'دكتور', 'doctor', 'pharmacist'].includes(role)) return 'doctor';
  if (['مساعد', 'مساعد صيدلي', 'assistant', 'pharmacy assistant'].includes(role)) return 'assistant';
  if (role === 'inventory assistant' || role.includes('مساعد مخزن') || role.includes('مساعد جرد') || role.includes('مساعد مخزون')) return 'inventory_assistant';
  if (role.includes('نظاف') || ['cleaning', 'cleaner', 'cleaning supervisor'].includes(role)) return 'cleaning';
  if (['توصيل', 'دليفري', 'مندوب توصيل', 'delivery', 'delivery rider', 'delivery driver', 'rider'].includes(role)) return 'delivery';
  if (['خدمة عملاء', 'خدمة العملاء', 'مسؤول خدمة العملاء', 'مسئول خدمة العملاء', 'مسؤولة خدمة العملاء', 'customer service'].includes(role)) return 'customer_service';
  if (['مدير خدمة العملاء', 'مديرة خدمة العملاء', 'customer service manager'].includes(role)) return 'customer_service_manager';
  if (
    ['مسؤول الشيفت', 'مسئول الشيفت', 'مسئولة الشيفت', 'shift supervisor'].includes(role)
    || /^(shift supervisor) (morning|evening)$/.test(role)
    || /^(مسؤول|مسئول|مسئولة|مشرف|مشرفة) شيفت (صباحي|مسائي)$/.test(role)
  ) return 'shift_supervisor';
  if (
    ['مدير فرع', 'مديرة فرع', 'branch manager'].includes(role)
    || /^branch manager (shamy|shokry)$/.test(role)
  ) return 'branch_manager';
  if (['مدير الفروع', 'مديرة الفروع', 'branches manager'].includes(role)) return 'branches_manager';
  if (role.includes('مشتريات') || ['purchasing', 'purchasing manager'].includes(role)) return 'purchasing';
  if (['مدير تنفيذي', 'مدير عام', 'executive manager', 'general manager'].includes(role)) return 'executive';
  if (['admin', 'أدمن', 'owner'].includes(role)) return 'admin';
  return 'other';
}

const CAPABILITIES: Record<CanonicalStaffRole, readonly StaffCapability[]> = {
  doctor: ['customer_conversation', 'customer_followup', 'customer_request', 'sales_quality', 'inventory', 'points_incentive'],
  assistant: ['inventory', 'customer_request', 'points_incentive'],
  inventory_assistant: ['inventory', 'points_incentive'],
  cleaning: ['cleaning', 'points_incentive'],
  delivery: ['delivery', 'points_incentive'],
  customer_service: ['customer_conversation', 'customer_followup', 'customer_request', 'points_incentive'],
  customer_service_manager: ['customer_conversation', 'customer_followup', 'customer_request', 'team_supervision', 'points_incentive'],
  shift_supervisor: ['team_supervision', 'points_incentive'],
  branch_manager: ['team_supervision', 'branch_supervision', 'points_incentive'],
  branches_manager: ['team_supervision', 'branch_supervision', 'points_incentive'],
  purchasing: ['inventory', 'customer_request', 'points_incentive'],
  executive: ['team_supervision', 'branch_supervision'],
  admin: ['team_supervision', 'branch_supervision'],
  other: [],
};

export function staffCapabilities(role: unknown): readonly StaffCapability[] {
  return CAPABILITIES[canonicalStaffRole(role)];
}

export function staffHasCapability(role: unknown, capability: StaffCapability): boolean {
  return staffCapabilities(role).includes(capability);
}

export function isCleaningRole(role: unknown): boolean {
  return canonicalStaffRole(role) === 'cleaning';
}

export function isAssistantRole(role: unknown): boolean {
  return canonicalStaffRole(role) === 'assistant';
}

export function isManagerRole(role: unknown): boolean {
  return ['customer_service_manager', 'shift_supervisor', 'branch_manager', 'branches_manager', 'executive', 'admin'].includes(
    canonicalStaffRole(role)
  );
}
