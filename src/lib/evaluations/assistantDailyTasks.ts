export type AssistantTaskDefinition = {
  key: string;
  label: string;
  weight: number;
  hint?: string;
};

/**
 * لازم المفاتيح دي تطابق بالظبط v_weights في settle_assistant_checklist_points()
 * على قاعدة البيانات — أي تغيير هنا لازم يتغيّر هناك كمان.
 */
export const ASSISTANT_DAILY_TASKS: AssistantTaskDefinition[] = [
  { key: 'inventory_count', label: 'تنفيذ الجرد الدوري', weight: 20, hint: 'ASSIST-001' },
  { key: 'purchase_invoices_entry', label: 'إدخال فواتير المشتريات', weight: 20, hint: 'ASSIST-002' },
  { key: 'shelving', label: 'رص وترتيب الأصناف والرفوف', weight: 15, hint: 'ASSIST-003' },
  { key: 'expiry_tracking', label: 'متابعة تواريخ الصلاحية', weight: 15, hint: 'ASSIST-004' },
  { key: 'stock_requests', label: 'تجهيز طلبات النواقص', weight: 10, hint: 'ASSIST-005' },
  { key: 'storage_cleanliness', label: 'نظافة وتنظيم مكان التخزين', weight: 10, hint: 'ASSIST-006' },
  { key: 'peak_support', label: 'دعم الصيدلي في أوقات الزحام', weight: 10, hint: 'ASSIST-007' },
];

export const ASSISTANT_TASKS_TOTAL_WEIGHT = ASSISTANT_DAILY_TASKS.reduce((sum, t) => sum + t.weight, 0);
