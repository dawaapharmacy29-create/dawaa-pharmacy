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

function isMine(row: Record<string, unknown>, userId: string, doctorName: string) {
  const createdBy = text(row.created_by);
  if (userId && createdBy === userId) return true;
  const createdByName = normalizeName(row.created_by_name);
  return Boolean(doctorName && createdByName && createdByName === normalizeName(doctorName));
}

export async function createDoctorRequestedFollowup(
  input: CreateExceptionalFollowupInput & { createdByStaffId?: string | null }
) {
  return createExceptionalFollowup({
    ...input,
    requestType: input.requestType || 'doctor_requested_followup',
    source: input.source || 'doctor_requested_followup',
  });
}

export async function fetchMyRequestedFollowups(
  identity: { staffId: string; userId: string; doctorName: string },
  filters: DoctorFollowupFilters = {}
): Promise<FollowupRow[]> {
  let query = supabase
    .from('daily_followups')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1000);

  if (identity.userId) query = query.eq('created_by', identity.userId);
  if (filters.from) query = query.gte('created_at', `${filters.from}T00:00:00`);
  if (filters.to) query = query.lte('created_at', `${filters.to}T23:59:59`);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = ((data || []) as Record<string, unknown>[]).filter((row) =>
    isMine(row, identity.userId, identity.doctorName)
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

export async function fetchFollowupEvents(followupId: string): Promise<DoctorFollowupEvent[]> {
  const { data, error } = await supabase
    .from('customer_followup_edit_logs')
    .select('*')
    .eq('followup_id', followupId)
    .order('edited_at', { ascending: true })
    .limit(500);

  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) return [];
    throw new Error(error.message);
  }

  return ((data || []) as Record<string, unknown>[]).map((row) => ({
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
  }));
}
