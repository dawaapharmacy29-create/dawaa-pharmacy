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

export function canonicalStaffRole(value: unknown): CanonicalStaffRole {
  const role = token(value);
  if (!role) return 'other';

  if (['صيدلاني', 'صيدلي', 'دكتور', 'doctor', 'pharmacist', 'صيدلي اول', 'صيدلي أول', 'senior pharmacist', 'pharmacist senior'].includes(role)) return 'doctor';
  if (['مساعد', 'مساعد صيدلي', 'مساعد صيدلية', 'مساعد صيدليه', 'assistant', 'pharmacy assistant'].includes(role)) return 'assistant';
  if (role === 'inventory assistant' || role.includes('مساعد مخزن') || role.includes('مساعد جرد') || role.includes('مساعد مخزون')) return 'inventory_assistant';
  if (role.includes('نظاف') || ['cleaning', 'cleaner', 'cleaning supervisor'].includes(role)) return 'cleaning';
  if (['توصيل', 'دليفري', 'مندوب توصيل', 'مندوب دليفري', 'delivery', 'delivery rider', 'delivery driver', 'rider'].includes(role)) return 'delivery';
  if (['خدمة عملاء', 'خدمة العملاء', 'مسؤول خدمة العملاء', 'مسئول خدمة العملاء', 'مسؤولة خدمة العملاء', 'customer service', 'كول سنتر', 'call center', 'فريق دواء ألفا', 'team_dawaa_alpha'].includes(role)) return 'customer_service';
  if (['مدير خدمة العملاء', 'مديرة خدمة العملاء', 'customer service manager'].includes(role)) return 'customer_service_manager';
  if (
    ['مسؤول الشيفت', 'مسئول الشيفت', 'مسئولة الشيفت', 'مشرف شيفت', 'مشرفة شيفت', 'shift supervisor'].includes(role)
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
