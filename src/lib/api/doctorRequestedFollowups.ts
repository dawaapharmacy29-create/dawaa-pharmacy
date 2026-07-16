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

function isMine(row: Record<string, unknown>, staffId: string, userId: string, doctorName: string) {
  const staffIds = [row.requested_by_staff_id, row.created_by_staff_id].map(text).filter(Boolean);
  const userIds = [row.requested_by_user_id, row.created_by_user_id, row.created_by].map(text).filter(Boolean);
  if (staffId && staffIds.includes(staffId)) return true;
  if (userId && userIds.includes(userId)) return true;
  const names = [row.requested_by_name, row.created_by_name].map(normalizeName).filter(Boolean);
  return Boolean(doctorName && names.includes(normalizeName(doctorName)));
}

export async function createDoctorRequestedFollowup(
  input: CreateExceptionalFollowupInput & { createdByStaffId?: string | null }
) {
  const created = await createExceptionalFollowup({
    ...input,
    requestType: input.requestType || 'doctor_requested_followup',
    source: input.source || 'doctor_requested_followup',
  });

  const id = text(created?.id);
  if (id) {
    const identity = {
      requested_by_staff_id: input.createdByStaffId || null,
      requested_by_user_id: input.createdBy || null,
      created_by_staff_id: input.createdByStaffId || null,
      created_by_user_id: input.createdBy || null,
      source_type: 'doctor_requested_followup',
    };
    const { error } = await supabase.from('daily_followups').update(identity).eq('id', id);
    if (error && import.meta.env.DEV) console.warn('[doctor-followups] requester identity update failed', error.message);
  }
  return created;
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

  const clauses: string[] = [];
  if (identity.staffId) {
    clauses.push(`requested_by_staff_id.eq.${identity.staffId}`, `created_by_staff_id.eq.${identity.staffId}`);
  }
  if (identity.userId) {
    clauses.push(
      `requested_by_user_id.eq.${identity.userId}`,
      `created_by_user_id.eq.${identity.userId}`,
      `created_by.eq.${identity.userId}`
    );
  }
  if (clauses.length) query = query.or(clauses.join(','));
  if (filters.from) query = query.gte('created_at', `${filters.from}T00:00:00`);
  if (filters.to) query = query.lte('created_at', `${filters.to}T23:59:59`);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = ((data || []) as Record<string, unknown>[]).filter((row) =>
    isMine(row, identity.staffId, identity.userId, identity.doctorName)
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
    .from('daily_followup_events')
    .select('*')
    .eq('followup_id', followupId)
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  return (data || []) as DoctorFollowupEvent[];
}
