export const CUSTOMER_REQUEST_CLOSED_STATUSES = ['closed', 'delivered', 'cancelled', 'not_available'] as const;

export const CUSTOMER_REQUEST_WORKFLOW = [
  'new',
  'purchasing_review',
  'searching_suppliers',
  'needs_customer_confirmation',
  'customer_confirmed',
  'sourcing',
  'available',
  'arrived',
  'customer_contacted',
  'delivered',
  'closed',
  'cancelled',
  'not_available',
] as const;

export type CanonicalCustomerRequestStatus = (typeof CUSTOMER_REQUEST_WORKFLOW)[number];

export const CUSTOMER_REQUEST_STATUS_LABELS: Record<CanonicalCustomerRequestStatus, string> = {
  new: 'تسجيل الطلب',
  purchasing_review: 'استلام المشتريات',
  searching_suppliers: 'البحث والتوفير',
  needs_customer_confirmation: 'يحتاج تأكيد العميل',
  customer_confirmed: 'تم تأكيد العميل',
  sourcing: 'جاري التوفير',
  available: 'تم التوفير',
  arrived: 'وصل للصيدلية',
  customer_contacted: 'تم التواصل',
  delivered: 'تم التسليم',
  closed: 'مغلق',
  cancelled: 'ملغي',
  not_available: 'غير متوفر',
};

export type CustomerRequestOperationalStage = 'intake' | 'sourcing' | 'ready' | 'contact' | 'completed' | 'exception';

export function normalizeCustomerRequestStatus(value?: string | null): CanonicalCustomerRequestStatus {
  const normalized = String(value || 'new').trim().toLowerCase();
  return (CUSTOMER_REQUEST_WORKFLOW as readonly string[]).includes(normalized)
    ? (normalized as CanonicalCustomerRequestStatus)
    : 'new';
}

export function customerRequestStatusLabel(value?: string | null) {
  return CUSTOMER_REQUEST_STATUS_LABELS[normalizeCustomerRequestStatus(value)];
}

export function customerRequestOperationalStage(value?: string | null): CustomerRequestOperationalStage {
  const status = normalizeCustomerRequestStatus(value);
  if (status === 'new' || status === 'purchasing_review') return 'intake';
  if (['searching_suppliers', 'needs_customer_confirmation', 'customer_confirmed', 'sourcing'].includes(status)) return 'sourcing';
  if (status === 'available' || status === 'arrived') return 'ready';
  if (status === 'customer_contacted') return 'contact';
  if (status === 'delivered' || status === 'closed') return 'completed';
  return 'exception';
}

export function customerRequestIsClosedStatus(value?: string | null) {
  return (CUSTOMER_REQUEST_CLOSED_STATUSES as readonly string[]).includes(normalizeCustomerRequestStatus(value));
}

export function customerRequestPrimaryAction(value?: string | null) {
  switch (normalizeCustomerRequestStatus(value)) {
    case 'new':
    case 'purchasing_review': return { action: 'start_search', label: 'ابدأ البحث' } as const;
    case 'searching_suppliers':
    case 'customer_confirmed':
    case 'sourcing': return { action: 'record_sourcing', label: 'سجل نتيجة التوفير' } as const;
    case 'needs_customer_confirmation': return { action: 'confirm_customer', label: 'تواصل لتأكيد الطلب' } as const;
    case 'available':
    case 'arrived': return { action: 'contact_customer', label: 'تواصل مع العميل' } as const;
    case 'customer_contacted': return { action: 'confirm_delivery', label: 'تأكيد التسليم' } as const;
    case 'delivered':
    case 'closed': return { action: 'none', label: 'مكتمل' } as const;
    case 'cancelled': return { action: 'none', label: 'ملغي' } as const;
    case 'not_available': return { action: 'review_exception', label: 'راجع البديل أو الإغلاق' } as const;
  }
}
