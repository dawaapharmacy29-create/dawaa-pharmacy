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

  if (['صيدلاني', 'صيدلي', 'دكتور', 'doctor', 'pharmacist'].includes(role)) return 'doctor';
  if (['مساعد صيدلي', 'assistant', 'pharmacy assistant'].includes(role)) return 'assistant';
  if (['inventory assistant', 'inventory_assistant', 'مساعد مخزن', 'مساعد جرد'].includes(String(value || '').trim().toLowerCase()) || role.includes('مساعد مخزن') || role.includes('مساعد جرد')) return 'inventory_assistant';
  if (role.includes('نظاف') || ['cleaning', 'cleaner', 'cleaning supervisor'].includes(role)) return 'cleaning';
  if (['توصيل', 'دليفري', 'delivery', 'rider'].includes(role)) return 'delivery';
  if (['خدمة عملاء', 'مسؤول خدمة العملاء', 'مسؤولة خدمة العملاء', 'customer service'].includes(role)) return 'customer_service';
  if (['مدير خدمة العملاء', 'مديرة خدمة العملاء', 'customer service manager'].includes(role)) return 'customer_service_manager';
  if (['مسؤول الشيفت', 'مسئول الشيفت', 'shift supervisor'].includes(role)) return 'shift_supervisor';
  if (['مدير فرع', 'مديرة فرع', 'branch manager'].includes(role)) return 'branch_manager';
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
