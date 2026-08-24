import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { matchesOrderedSegments } from '@/lib/utils';

export type CustomerRequestStatus =
  | 'new'
  | 'purchasing_review'
  | 'searching_suppliers'
  | 'needs_customer_confirmation'
  | 'customer_confirmed'
  | 'sourcing'
  | 'available'
  | 'arrived'
  | 'customer_contacted'
  | 'delivered'
  | 'closed'
  | 'cancelled'
  | 'not_available';

export interface CustomerRequest {
  id: string;
  customer_id: string | null;
  customer_code: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  branch: string | null;
  medicine_name: string;
  medicine_image_url: string | null;
  item_image_url?: string | null;
  item_image_path?: string | null;
  requested_at?: string | null;
  needed_by_date?: string | null;
  expected_fulfillment_days?: number | null;
  potential_source_id?: string | null;
  potential_source_name?: string | null;
  potential_source_text?: string | null;
  quantity: number | null;
  urgency: string | null;
  status: CustomerRequestStatus | string | null;
  request_type: string | null;
  needs_customer_confirmation: boolean | null;
  is_expensive_or_special: boolean | null;
  doctor_id: string | null;
  doctor_name: string | null;
  purchasing_assignee: string | null;
  doctor_notes: string | null;
  supplier_hint: string | null;
  supplier_notes?: string | null;
  purchasing_notes: string | null;
  customer_confirmation_status: string | null;
  contact_summary: string | null;
  expected_arrival_date: string | null;
  expected_price?: number | null;
  closed_at: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string | null;
  updated_at: string | null;
  current_stage?: string | null;
  assigned_to?: string | null;
  due_date?: string | null;
  last_action_at?: string | null;
  priority?: string | null;
  is_urgent?: boolean | null;
  purchasing_received_by_name?: string | null;
  searching_by_name?: string | null;
  provided_by_name?: string | null;
  customer_contacted_by_name?: string | null;
  delivered_by_name?: string | null;
  unavailable_since?: string | null;
  shortage_item_id?: string | null;
  moved_to_shortage_at?: string | null;
  source_system?: string | null;
  source_entity?: string | null;
  source_record_id?: string | null;
  source_order_number?: string | null;
  source_status?: string | null;
  source_updated_at?: string | null;
  source_last_seen_at?: string | null;
  source_request_channel?: string | null;
  source_assigned_employee?: string | null;
  source_notes?: string | null;
  source_selling_price?: number | null;
  source_payload?: Record<string, unknown> | null;
  sync_conflict?: boolean | null;
  sync_conflict_reason?: string | null;
  customer_segment?: string | null;
  product_id?: string | null;
  product_code?: string | null;
  product_price?: number | null;
  next_action_at?: string | null;
}

export interface CustomerRequestEvent {
  id: string;
  request_id: string;
  old_status: string | null;
  new_status: string | null;
  action: string | null;
  notes: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string | null;
}

export interface CustomerRequestInput {
  customer_id?: string | null;
  customer_code?: string | null;
  customer_name: string;
  customer_phone?: string | null;
  branch?: string | null;
  medicine_name: string;
  medicine_image_url?: string | null;
  item_image_url?: string | null;
  item_image_path?: string | null;
  requested_at?: string | null;
  needed_by_date?: string | null;
  expected_fulfillment_days?: number | null;
  potential_source_id?: string | null;
  potential_source_text?: string | null;
  quantity?: number | null;
  urgency?: string | null;
  request_type?: string | null;
  source_request_channel?: string | null;
  needs_customer_confirmation?: boolean | null;
  is_expensive_or_special?: boolean | null;
  doctor_id?: string | null;
  doctor_name?: string | null;
  doctor_notes?: string | null;
  supplier_hint?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
}

function requireSupabaseConfig() {
  if (!isSupabaseConfigured) {
    throw new Error(
      'إعدادات Supabase غير موجودة. أضف VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY في ملف .env.'
    );
  }
}

function missingColumn(message: string) {
  return message.match(/'([^']+)' column/)?.[1] || message.match(/column "([^"]+)"/)?.[1] || '';
}

function removeColumn<T extends Record<string, unknown>>(payload: T, column: string) {
  const next = { ...payload };
  delete next[column];
  return next;
}

function isUuidLike(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value ?? '').trim()
  );
}

function safeUuid(value: unknown) {
  const text = String(value ?? '').trim();
  return isUuidLike(text) ? text : null;
}

async function insertResilient(table: string, payload: Record<string, unknown>) {
  let nextPayload = payload;
  const removed = new Set<string>();

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { data, error } = await supabase.from(table).insert(nextPayload).select('*').single();
    if (!error) return data;

    const column = missingColumn(error.message);
    if (!column || removed.has(column)) throw new Error(error.message);
    removed.add(column);
    nextPayload = removeColumn(nextPayload, column);
  }

  throw new Error(`تعذر حفظ البيانات في ${table}`);
}

async function updateResilient(table: string, id: string, payload: Record<string, unknown>) {
  let nextPayload = payload;
  const removed = new Set<string>();

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { data, error } = await supabase
      .from(table)
      .update(nextPayload)
      .eq('id', id)
      .select('*')
      .single();
    if (!error) return data;

    const column = missingColumn(error.message);
    if (!column || removed.has(column) || !(column in nextPayload)) throw new Error(error.message);
    removed.add(column);
    nextPayload = removeColumn(nextPayload, column);
  }

  throw new Error(`تعذر تحديث البيانات في ${table}`);
}

export const REQUEST_STATUS_LABELS: Record<string, string> = {
  new: 'طلب جديد',
  purchasing_review: 'قيد مراجعة المشتريات',
  searching_suppliers: 'جاري البحث عند الموردين',
  needs_customer_confirmation: 'يحتاج تأكيد العميل',
  customer_confirmed: 'تم تأكيد العميل',
  sourcing: 'جاري التوفير',
  available: 'تم توفيره',
  arrived: 'وصل للصيدلية',
  customer_contacted: 'تم التواصل مع العميل',
  delivered: 'تم التسليم / البيع',
  closed: 'مغلق',
  cancelled: 'ملغي',
  not_available: 'غير متوفر',
};

Object.assign(REQUEST_STATUS_LABELS, {
  new: '1 - تسجيل الطلب',
  purchasing_review: '2 - استلام الطلب من المشتريات',
  searching_suppliers: '3 - البحث ومحاولة توفير الطلب',
  available: '4 - توفير الطلب',
  customer_contacted: '5 - التواصل مع العميل',
  delivered: '6 - تسليم العميل',
  cancelled: 'العميل ألغى الطلب',
  not_available: 'غير متوفر',
});

export const REQUEST_STATUS_FLOW: Array<{ value: CustomerRequestStatus; label: string }> = [
  { value: 'new', label: REQUEST_STATUS_LABELS.new },
  { value: 'purchasing_review', label: REQUEST_STATUS_LABELS.purchasing_review },
  { value: 'searching_suppliers', label: REQUEST_STATUS_LABELS.searching_suppliers },
  {
    value: 'needs_customer_confirmation',
    label: REQUEST_STATUS_LABELS.needs_customer_confirmation,
  },
  { value: 'customer_confirmed', label: REQUEST_STATUS_LABELS.customer_confirmed },
  { value: 'sourcing', label: REQUEST_STATUS_LABELS.sourcing },
  { value: 'available', label: REQUEST_STATUS_LABELS.available },
  { value: 'arrived', label: REQUEST_STATUS_LABELS.arrived },
  { value: 'customer_contacted', label: REQUEST_STATUS_LABELS.customer_contacted },
  { value: 'delivered', label: REQUEST_STATUS_LABELS.delivered },
  { value: 'closed', label: REQUEST_STATUS_LABELS.closed },
  { value: 'cancelled', label: REQUEST_STATUS_LABELS.cancelled },
  { value: 'not_available', label: REQUEST_STATUS_LABELS.not_available },
];

export function requestStatusLabel(status?: string | null) {
  return REQUEST_STATUS_LABELS[status || ''] || status || 'طلب جديد';
}

export function requestNeedsAttention(row: CustomerRequest) {
  return ['new', 'needs_customer_confirmation', 'arrived', 'available'].includes(
    String(row.status || 'new')
  );
}

export async function getCustomerRequests(
  options: { status?: string; branch?: string; search?: string } = {}
) {
  requireSupabaseConfig();

  let query = supabase
    .from('customer_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);

  if (options.status && options.status !== 'all') query = query.eq('status', options.status);
  if (options.branch && options.branch !== 'all') query = query.eq('branch', options.branch);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as CustomerRequest[];
  const q = (options.search || '').trim();
  if (!q) return rows;
  return rows.filter((row) =>
    [
      row.customer_name,
      row.customer_code,
      row.customer_phone,
      row.medicine_name,
      row.doctor_name,
      row.supplier_hint,
    ]
      .filter(Boolean)
      .some((value) => matchesOrderedSegments(String(value), q))
  );
}

export async function getCustomerRequestEvents(requestId: string) {
  requireSupabaseConfig();
  const { data, error } = await supabase
    .from('customer_request_events')
    .select('*')
    .eq('request_id', requestId)
    .order('created_at', { ascending: false });
  if (error) return [];
  return (data ?? []) as CustomerRequestEvent[];
}

/**
 * Retired compatibility API.
 *
 * Canonical request creation requires existing customer + product + staff identities
 * and must go through createCanonicalCustomerRequest / create_customer_request_canonical_v2.
 */
export async function createCustomerRequest(_input: CustomerRequestInput): Promise<CustomerRequest> {
  throw new Error('تم إيقاف مسار إنشاء طلبات العملاء القديم. استخدم تسجيل الطلب المعياري من صفحة طلبات العملاء.');
}

export async function updateCustomerRequestStatus(
  request: CustomerRequest,
  input: {
    status: string;
    notes?: string | null;
    purchasing_notes?: string | null;
    customer_confirmation_status?: string | null;
    contact_summary?: string | null;
    purchasing_assignee?: string | null;
    expected_arrival_date?: string | null;
    user_id?: string | null;
    user_name?: string | null;
  }
) {
  requireSupabaseConfig();
  const {
    startCustomerRequestSearch,
    reopenCustomerRequestSearch,
    recordCustomerRequestSourcing,
    confirmCustomerRequest,
    startCustomerRequestSourcing,
    markCustomerRequestArrived,
    contactCustomerForRequest,
    deliverCustomerRequest,
    closeCustomerRequest,
    cancelCustomerRequest,
  } = await import('@/features/customer-requests/commands/customerRequestCommands');

  const current = String(request.status || 'new');
  const target = String(input.status || '').trim();
  const notes = String(input.notes || input.purchasing_notes || input.contact_summary || '').trim();
  const actor = { id: input.user_id || null, name: input.user_name || null };

  if (!target || target === current) return request;
  if (target === 'purchasing_review' || (target === 'searching_suppliers' && current === 'purchasing_review')) {
    return startCustomerRequestSearch(request, actor);
  }
  if (target === 'searching_suppliers' && current === 'not_available') {
    return reopenCustomerRequestSearch(request, notes, actor);
  }
  if (target === 'needs_customer_confirmation') {
    return recordCustomerRequestSourcing(request, {
      outcome: 'needs_customer_confirmation',
      notes,
      actor,
    });
  }
  if (target === 'customer_confirmed') {
    return confirmCustomerRequest(request, notes, actor);
  }
  if (target === 'sourcing') {
    return startCustomerRequestSourcing(request, notes, actor);
  }
  if (target === 'available') {
    return recordCustomerRequestSourcing(request, {
      outcome: 'available',
      notes,
      expectedArrivalDate: input.expected_arrival_date || null,
      actor,
    });
  }
  if (target === 'arrived') {
    return markCustomerRequestArrived(request, notes, actor);
  }
  if (target === 'customer_contacted') {
    return contactCustomerForRequest(request, { outcome: 'answered', notes, actor });
  }
  if (target === 'delivered') {
    return deliverCustomerRequest(request, notes, actor);
  }
  if (target === 'closed') {
    return closeCustomerRequest(request, notes, actor);
  }
  if (target === 'cancelled') {
    return cancelCustomerRequest(request, notes, actor);
  }
  if (target === 'not_available') {
    return recordCustomerRequestSourcing(request, {
      outcome: 'not_available',
      notes,
      actor,
    });
  }

  throw new Error('الانتقال المطلوب غير مدعوم في مسار طلبات العملاء المعياري');
}

export type CustomerRequestContactOutcome = 'answered' | 'no_answer' | 'later';

export async function recordCustomerRequestContactAttempt(
  request: CustomerRequest,
  input: {
    outcome: CustomerRequestContactOutcome;
    notes?: string | null;
    followup_at?: string | null;
    user_id?: string | null;
    user_name?: string | null;
  }
) {
  requireSupabaseConfig();
  const { contactCustomerForRequest } = await import(
    '@/features/customer-requests/commands/customerRequestCommands'
  );
  return contactCustomerForRequest(request, {
    outcome: input.outcome,
    notes: input.notes || null,
    followupAt: input.followup_at || null,
    actor: { id: input.user_id || null, name: input.user_name || null },
  });
}

export async function updateCustomerRequestDetails(
  request: CustomerRequest,
  input: {
    medicine_name: string;
    quantity: number;
    urgency: string;
    request_type: string;
    source_request_channel?: string | null;
    customer_phone?: string | null;
    doctor_notes?: string | null;
    user_id?: string | null;
    user_name?: string | null;
  }
) {
  requireSupabaseConfig();
  if (input.medicine_name.trim() !== String(request.medicine_name || '').trim()) {
    throw new Error('اسم الصنف وهوية المنتج لا يتم تعديلهما من مسار التفاصيل. استخدم إصلاح ربط الصنف.');
  }
  const { updateCustomerRequestDetailsV2 } = await import(
    '@/features/customer-requests/commands/customerRequestCommands'
  );
  return updateCustomerRequestDetailsV2(request, {
    quantity: input.quantity,
    urgency: input.urgency,
    requestType: input.request_type,
    channel: input.source_request_channel || null,
    customerPhone: input.customer_phone || null,
    doctorNotes: input.doctor_notes || null,
  });
}

export async function addCustomerRequestEvent(
  requestId: string,
  input: {
    old_status?: string | null;
    new_status?: string | null;
    action: string;
    notes?: string | null;
    created_by?: string | null;
    created_by_name?: string | null;
  }
) {
  requireSupabaseConfig();
  const payload = {
    request_id: requestId,
    old_status: input.old_status || null,
    new_status: input.new_status || null,
    action: input.action,
    notes: input.notes || null,
    created_by: safeUuid(input.created_by),
    created_by_name: input.created_by_name || null,
    created_at: new Date().toISOString(),
  };
  await insertResilient('customer_request_events', payload);
}

export async function moveCustomerRequestToShortage(
  request: CustomerRequest,
  _input: { user_id?: string | null; user_name?: string | null }
) {
  requireSupabaseConfig();
  const { sendCustomerRequestToShortages } = await import(
    '@/features/customer-requests/commands/customerRequestCommands'
  );
  return sendCustomerRequestToShortages(request);
}
