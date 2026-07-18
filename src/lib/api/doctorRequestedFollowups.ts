import { supabase } from '@/lib/supabase';
import {
  createExceptionalFollowup,
  type CreateExceptionalFollowupInput,
  type FollowupRow,
} from '@/lib/api/customerServiceCommandCenter';

export type DoctorFollowupEvent = {
  id: string;
  followup_id: string;
  event_type: string;
  title: string | null;
  status: string | null;
  notes: string | null;
  result: string | null;
  customer_response: string | null;
  responsible_name: string | null;
  actor_name: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type DoctorFollowupFilters = {
  search?: string;
  status?: string;
  closure?: 'all' | 'open' | 'closed';
  from?: string;
  to?: string;
};

type DoctorIdentity = { staffId: string; userId: string; doctorName: string };
type RawRow = Record<string, unknown>;

function text(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeName(value: unknown) {
  return text(value)
    .replace(/[ًٌٍَُِّْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\b(دكتور|دكتوره|د|dr)\b/gi, '')
    .replace(/[\s/_.-]+/g, ' ')
    .trim()
    .toLowerCase();
}

function isMine(row: RawRow, identity: DoctorIdentity) {
  const ids = new Set(
    [identity.userId, identity.staffId]
      .map(text)
      .filter(Boolean)
  );

  const linkedIds = [
    row.requested_by_staff_id,
    row.created_by,
    row.staff_id,
  ].map(text);

  if (linkedIds.some((value) => value && ids.has(value))) return true;

  const doctorName = normalizeName(identity.doctorName);
  if (!doctorName) return false;

  return [row.created_by_name, row.requested_by_name, row.assigned_doctor]
    .map(normalizeName)
    .some((value) => value && value === doctorName);
}

export async function createDoctorRequestedFollowup(
  input: CreateExceptionalFollowupInput & { createdByStaffId?: string | null }
) {
  return createExceptionalFollowup({
    ...input,
    createdBy: input.createdBy || input.createdByStaffId || null,
    requestedByStaffId: input.createdByStaffId || input.createdBy || null,
    requestType: input.requestType || 'doctor_requested_followup',
    source: input.source || 'doctor_requested_followup',
  });
}

export async function fetchMyRequestedFollowups(
  identity: DoctorIdentity,
  filters: DoctorFollowupFilters = {}
): Promise<FollowupRow[]> {
  let query = supabase
    .from('daily_followups')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1000);

  // لا نقيد الاستعلام بـ created_by فقط؛ السجلات القديمة والجديدة قد تكون
  // مرتبطة بالدكتور عبر user id أو staff id أو الاسم الموحد.
  if (filters.from) query = query.gte('created_at', `${filters.from}T00:00:00`);
  if (filters.to) query = query.lte('created_at', `${filters.to}T23:59:59`);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = ((data || []) as RawRow[]).filter((row) =>
    isMine(row, identity)
  ) as unknown as FollowupRow[];

  const search = text(filters.search).toLowerCase();
  return rows.filter((row) => {
    const rawStatus = text(row.followup_status || row.status || row.contact_status);
    if (filters.status && filters.status !== 'all' && rawStatus !== filters.status) return false;
    const closed = Boolean(row.closed_at || row.completed_at) || /closed|completed|resolved|مغلق|تم الحل|تم$/i.test(rawStatus);
    if (filters.closure === 'open' && closed) return false;
    if (filters.closure === 'closed' && !closed) return false;
    if (!search) return true;
    return [row.customer_name, row.customer_code, row.customer_phone, row.phone]
      .map(text)
      .join(' ')
      .toLowerCase()
      .includes(search);
  });
}

function mapExecutionEvent(row: RawRow): DoctorFollowupEvent {
  const eventType = text(row.event_type) || 'updated';
  const titles: Record<string, string> = {
    started: 'بدأ تنفيذ المتابعة',
    result_saved: 'تم تسجيل نتيجة المتابعة',
    completed: 'تم إكمال المتابعة',
    scheduled: 'تم تحديد متابعة قادمة',
    needs_manager: 'تم رفع الحالة للمدير',
  };
  return {
    id: text(row.id),
    followup_id: text(row.followup_id),
    event_type: eventType,
    title: titles[eventType] || 'تم تحديث المتابعة',
    status: text(row.event_status) || null,
    notes: text(row.notes) || null,
    result: text(row.event_status) || null,
    customer_response: null,
    responsible_name: text(row.actor_name) || null,
    actor_name: text(row.actor_name) || null,
    metadata: (row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as Record<string, unknown>,
    created_at: text(row.created_at),
  };
}

function mapLegacyEvent(row: RawRow): DoctorFollowupEvent {
  return {
    id: text(row.id),
    followup_id: text(row.followup_id),
    event_type: 'updated',
    title: 'تم تحديث المتابعة',
    status: text(row.new_status) || null,
    notes: text(row.new_notes) || null,
    result: text(row.new_result) || null,
    customer_response: null,
    responsible_name: null,
    actor_name: text(row.edited_by_name) || null,
    metadata: {
      old_status: row.old_status ?? null,
      old_result: row.old_result ?? null,
      old_notes: row.old_notes ?? null,
      changed_fields: row.changed_fields ?? null,
    },
    created_at: text(row.edited_at),
  };
}

export async function fetchFollowupEvents(followupId: string): Promise<DoctorFollowupEvent[]> {
  const [execution, legacy] = await Promise.all([
    supabase
      .from('customer_service_followup_events')
      .select('*')
      .eq('followup_id', followupId)
      .order('created_at', { ascending: true })
      .limit(500),
    supabase
      .from('customer_followup_edit_logs')
      .select('*')
      .eq('followup_id', followupId)
      .order('edited_at', { ascending: true })
      .limit(500),
  ]);

  const executionRows = execution.error && !/does not exist|schema cache/i.test(execution.error.message)
    ? []
    : ((execution.data || []) as RawRow[]).map(mapExecutionEvent);

  const legacyRows = legacy.error && !/does not exist|schema cache/i.test(legacy.error.message)
    ? []
    : ((legacy.data || []) as RawRow[]).map(mapLegacyEvent);

  return [...executionRows, ...legacyRows]
    .filter((row) => row.id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}
