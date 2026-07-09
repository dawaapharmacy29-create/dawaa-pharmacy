import { supabase } from '@/lib/supabase';
import { normalizeBranchName } from '@/lib/branch';

export interface AttendanceReportRow {
  id?: string;
  staff_id?: string | null;
  staff_name?: string | null;
  date?: string | null;
  check_in?: string | null;
  check_out?: string | null;
  branch?: string | null;
  shift_start?: string | null;
  shift_end?: string | null;
  notes?: string | null;
  status?: string | null;
}

function timeOnly(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 8);
  return date.toTimeString().slice(0, 8);
}

function rowKey(row: Pick<AttendanceReportRow, 'staff_id' | 'staff_name' | 'date'>) {
  return `${row.staff_id || row.staff_name || 'unknown'}__${row.date || ''}`;
}

function inBranch(rowBranch: string | null | undefined, branchFilter: string) {
  if (!branchFilter || branchFilter === 'الكل') return true;
  return normalizeBranchName(rowBranch || '') === normalizeBranchName(branchFilter);
}

async function fetchBaseAttendance(startDate: string, endDate: string, branchFilter: string) {
  let query = supabase
    .from('attendance')
    .select('id,staff_id,staff_name,date,check_in,check_out,branch,shift_start,shift_end,notes,status')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true })
    .limit(2500);
  if (branchFilter !== 'الكل') query = query.eq('branch', branchFilter);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as AttendanceReportRow[];
}

async function fetchBiometricLogs(startDate: string, endDate: string, branchFilter: string) {
  let query = supabase
    .from('staff_attendance_logs')
    .select('id,staff_id,staff_name,shift_date,attendance_type,branch_name,status,recorded_at,created_at,rejection_reason')
    .gte('shift_date', startDate)
    .lte('shift_date', endDate)
    .in('status', ['accepted', 'manual_review'])
    .order('shift_date', { ascending: true })
    .order('recorded_at', { ascending: true })
    .limit(4000);
  if (branchFilter !== 'الكل') query = query.eq('branch_name', branchFilter);
  const { data, error } = await query;
  if (error) return [];
  return (data || []) as Array<Record<string, any>>;
}

export async function fetchAttendanceReportRows(input: {
  startDate: string;
  endDate: string;
  branchFilter: string;
}): Promise<AttendanceReportRow[]> {
  const baseRows = await fetchBaseAttendance(input.startDate, input.endDate, input.branchFilter);
  const byKey = new Map<string, AttendanceReportRow>();
  for (const row of baseRows) byKey.set(rowKey(row), { ...row });

  const logs = await fetchBiometricLogs(input.startDate, input.endDate, input.branchFilter);
  for (const log of logs) {
    const branch = normalizeBranchName(log.branch_name || '') || log.branch_name || null;
    if (!inBranch(branch, input.branchFilter)) continue;
    const date = String(log.shift_date || '').slice(0, 10);
    const key = rowKey({ staff_id: log.staff_id, staff_name: log.staff_name, date });
    const current = byKey.get(key) || {
      id: `log-${log.staff_id || log.staff_name}-${date}`,
      staff_id: log.staff_id || null,
      staff_name: log.staff_name || 'غير محدد',
      date,
      branch,
      check_in: null,
      check_out: null,
      notes: 'مصدر التقرير: بصمة/سجل حضور حديث',
      status: log.status || 'accepted',
    };
    const recorded = log.recorded_at || log.created_at;
    if (log.attendance_type === 'check_in') {
      if (!current.check_in || String(timeOnly(recorded)) < String(current.check_in)) current.check_in = timeOnly(recorded);
    }
    if (log.attendance_type === 'check_out') {
      if (!current.check_out || String(timeOnly(recorded)) > String(current.check_out)) current.check_out = timeOnly(recorded);
    }
    current.branch = current.branch || branch;
    current.status = current.status || log.status || 'accepted';
    byKey.set(key, current);
  }

  return [...byKey.values()].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.staff_name || '').localeCompare(String(b.staff_name || ''), 'ar'));
}
