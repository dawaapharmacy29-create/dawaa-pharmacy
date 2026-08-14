import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { matchesOrderedSegments } from '@/lib/utils';
import { logActivity } from '@/lib/activityLog';

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

export async function createCustomerRequest(input: CustomerRequestInput) {
  requireSupabaseConfig();
  const needsConfirmation = Boolean(
    input.needs_customer_confirmation || input.is_expensive_or_special
  );
  const status: CustomerRequestStatus = needsConfirmation ? 'needs_customer_confirmation' : 'new';
  const payload: Record<string, unknown> = {
    customer_id: safeUuid(input.customer_id),
    customer_code: input.customer_code || null,
    customer_name: input.customer_name,
    customer_phone: input.customer_phone || null,
    branch: input.branch || null,
    medicine_name: input.medicine_name,
    medicine_image_url: input.medicine_image_url || input.item_image_url || null,
    item_image_url: input.item_image_url || input.medicine_image_url || null,
    item_image_path: input.item_image_path || null,
    quantity: Number(input.quantity || 1),
    urgency: input.urgency || 'normal',
    status,
    request_type: input.request_type || 'missing_medicine',
    source_request_channel: input.source_request_channel || null,
    needs_customer_confirmation: needsConfirmation,
    is_expensive_or_special: Boolean(input.is_expensive_or_special),
    doctor_id: safeUuid(input.doctor_id),
    doctor_name: input.doctor_name || null,
    doctor_notes: input.doctor_notes || null,
    supplier_hint: input.supplier_hint || null,
    requested_at: input.requested_at || new Date().toISOString(),
    needed_by_date: input.needed_by_date || null,
    expected_fulfillment_days: input.expected_fulfillment_days || null,
    potential_source_id: safeUuid(input.potential_source_id),
    potential_source_text: input.potential_source_text || input.supplier_hint || null,
    created_by: safeUuid(input.created_by),
    created_by_name: input.created_by_name || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const created = (await insertResilient('customer_requests', payload)) as CustomerRequest;
  await addCustomerRequestEvent(created.id, {
    old_status: null,
    new_status: created.status || status,
    action: 'إنشاء طلب عميل',
    notes: input.doctor_notes || `تم تسجيل طلب صنف: ${input.medicine_name}`,
    created_by: input.created_by || null,
    created_by_name: input.created_by_name || null,
  });
  return created;
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
  if (input.status === 'cancelled' && !input.notes?.trim()) {
    throw new Error('سبب إلغاء الطلب مطلوب');
  }
  const payload: Record<string, unknown> = {
    status: input.status,
    purchasing_notes: input.purchasing_notes ?? request.purchasing_notes,
    customer_confirmation_status:
      input.customer_confirmation_status ?? request.customer_confirmation_status,
    contact_summary: input.contact_summary ?? request.contact_summary,
    purchasing_assignee: input.purchasing_assignee ?? request.purchasing_assignee,
    expected_arrival_date: input.expected_arrival_date ?? request.expected_arrival_date,
    updated_at: new Date().toISOString(),
  };
  if (input.status === 'purchasing_review')
    payload.purchasing_received_by_name = input.user_name || input.purchasing_assignee || null;
  if (['searching_suppliers', 'sourcing'].includes(input.status))
    payload.searching_by_name = input.user_name || input.purchasing_assignee || null;
  if (['available', 'arrived'].includes(input.status))
    payload.provided_by_name = input.user_name || null;
  if (input.status === 'customer_contacted')
    payload.customer_contacted_by_name = input.user_name || null;
  if (input.status === 'delivered') payload.delivered_by_name = input.user_name || null;
  if (input.status === 'not_available') payload.unavailable_since = new Date().toISOString();
  if (['closed', 'delivered', 'cancelled', 'not_available'].includes(input.status)) {
    payload.closed_at = new Date().toISOString();
  }

  const updated = (await updateResilient(
    'customer_requests',
    request.id,
    payload
  )) as CustomerRequest;
  await addCustomerRequestEvent(request.id, {
    old_status: request.status,
    new_status: input.status,
    action: 'تغيير حالة طلب عميل',
    notes: input.notes || input.purchasing_notes || input.contact_summary || 'تم تحديث حالة الطلب',
    created_by: safeUuid(input.user_id),
    created_by_name: input.user_name || null,
  });
  await logActivity({
    action: 'تحديث طلب عميل',
    module: 'طلبات العملاء',
    target_type: 'customer_request',
    target_id: request.id,
    user_id: safeUuid(input.user_id) || undefined,
    user_name: input.user_name || undefined,
    branch_name: request.branch || undefined,
    details: {
      customer_name: request.customer_name,
      customer_code: request.customer_code,
      medicine_name: request.medicine_name,
      old_status: request.status,
      new_status: input.status,
      notes: input.notes || null,
    },
  });
  return updated;
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
  const labels: Record<CustomerRequestContactOutcome, string> = {
    answered: 'تم الرد',
    no_answer: 'لم يرد',
    later: 'تواصل لاحقًا',
  };
  const note = String(input.notes || '').trim();
  if (input.outcome === 'later' && !input.followup_at) throw new Error('حدد موعد التواصل القادم');
  if (input.outcome === 'later' && !note) throw new Error('اكتب سبب أو ملاحظة للتواصل لاحقًا');
  if (input.outcome === 'later' && input.followup_at && new Date(input.followup_at).getTime() <= Date.now()) throw new Error('موعد التواصل القادم يجب أن يكون في المستقبل');

  const currentStatus = String(request.status || 'new');
  const shouldAdvanceToContacted =
    input.outcome === 'answered' && ['available', 'arrived'].includes(currentStatus);
  const nextStatus = shouldAdvanceToContacted ? 'customer_contacted' : currentStatus;
  const summaryLine = [
    'نتيجة التواصل: ' + labels[input.outcome],
    note ? 'ملاحظة: ' + note : '',
    input.outcome === 'later' && input.followup_at ? 'موعد المتابعة: ' + new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(input.followup_at)) : '',
    'بواسطة: ' + (input.user_name || 'النظام'),
  ].filter(Boolean).join(' — ');
  const previousSummary = String(request.contact_summary || '').trim();
  const contactSummary = previousSummary ? summaryLine + '\n' + previousSummary : summaryLine;

  const payload: Record<string, unknown> = {
    status: nextStatus,
    contact_summary: contactSummary,
    updated_at: new Date().toISOString(),
    last_action_at: new Date().toISOString(),
    due_date: input.outcome === 'later' ? input.followup_at || request.due_date || null : request.due_date || null,
  };
  if (input.outcome === 'answered') payload.customer_contacted_by_name = input.user_name || null;

  const updated = (await updateResilient('customer_requests', request.id, payload)) as CustomerRequest;
  await addCustomerRequestEvent(request.id, {
    old_status: request.status,
    new_status: nextStatus,
    action: 'تسجيل نتيجة تواصل مع العميل',
    notes: summaryLine,
    created_by: input.user_id,
    created_by_name: input.user_name,
  });
  await logActivity({
    action: 'تسجيل نتيجة تواصل طلب عميل',
    module: 'طلبات العملاء',
    target_type: 'customer_request',
    target_id: request.id,
    user_id: safeUuid(input.user_id) || undefined,
    user_name: input.user_name || undefined,
    branch_name: request.branch || undefined,
    details: {
      customer_name: request.customer_name,
      customer_code: request.customer_code,
      medicine_name: request.medicine_name,
      outcome: input.outcome,
      old_status: request.status,
      new_status: nextStatus,
      notes: note || null,
      followup_at: input.followup_at || null,
    },
  });
  return updated;
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
  if (!input.medicine_name.trim()) throw new Error('اسم الصنف مطلوب');
  if (!Number.isFinite(input.quantity) || input.quantity < 1) throw new Error('الكمية غير صحيحة');

  const updated = (await updateResilient('customer_requests', request.id, {
    medicine_name: input.medicine_name.trim(),
    quantity: input.quantity,
    urgency: input.urgency,
    request_type: input.request_type,
    source_request_channel: input.source_request_channel || null,
    customer_phone: input.customer_phone?.trim() || null,
    doctor_notes: input.doctor_notes?.trim() || null,
    updated_at: new Date().toISOString(),
  })) as CustomerRequest;

  await addCustomerRequestEvent(request.id, {
    old_status: request.status,
    new_status: request.status,
    action: 'تعديل بيانات طلب عميل',
    notes: `تم تعديل بيانات الطلب بواسطة ${input.user_name || 'النظام'}`,
    created_by: input.user_id,
    created_by_name: input.user_name,
  });
  return updated;
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
  input: { user_id?: string | null; user_name?: string | null }
) {
  requireSupabaseConfig();
  const now = new Date().toISOString();
  const shortagePayload: Record<string, unknown> = {
    medicine_name: request.medicine_name,
    item_name: request.medicine_name,
    quantity: Number(request.quantity || 1),
    branch: request.branch || null,
    status: 'open',
    priority: request.priority || request.urgency || 'medium',
    notes: [
      `طلب عميل: ${request.customer_name || 'بدون اسم'}`,
      request.customer_code ? `كود العميل: ${request.customer_code}` : '',
      request.customer_phone ? `الهاتف: ${request.customer_phone}` : '',
      request.doctor_notes || '',
      request.purchasing_notes || '',
    ]
      .filter(Boolean)
      .join(' | '),
    customer_request_id: request.id,
    created_at: now,
    updated_at: now,
  };

  let shortage: Record<string, unknown> | null = null;
  const shortageTables = ['shortage_items', 'shortages'];
  let lastError: Error | null = null;
  for (const table of shortageTables) {
    try {
      shortage = await insertResilient(table, shortagePayload);
      if (shortage) break;
    } catch (error) {
      lastError = error as Error;
    }
  }
  if (!shortage) throw lastError || new Error('تعذر إضافة الطلب إلى النواقص');

  const updated = (await updateResilient('customer_requests', request.id, {
    shortage_item_id: shortage.id || null,
    moved_to_shortage_at: now,
    status: request.status === 'new' ? 'searching_suppliers' : request.status,
    updated_at: now,
  })) as CustomerRequest;

  await addCustomerRequestEvent(request.id, {
    old_status: request.status,
    new_status: updated.status,
    action: 'نقل طلب العميل إلى النواقص',
    notes: `تم ربط الطلب بقائمة النواقص${shortage.id ? ` - ${shortage.id}` : ''}`,
    created_by: input.user_id || null,
    created_by_name: input.user_name || null,
  });

  return { request: updated, shortage };
}
