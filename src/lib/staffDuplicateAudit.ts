import { supabase } from './supabase';

export interface StaffDuplicateGroup {
  normalized_name: string;
  staff: StaffDuplicateRecord[];
}

export interface StaffDuplicateRecord {
  staff_id: string;
  staff_account_id?: string;
  display_name: string;
  normalized_name: string;
  role: string;
  branch: string;
  active: boolean;
  created_at: string;
  linked_user_id?: string;
  sales_invoice_count: number;
  staff_sales_summary_count: number;
  employee_transactions_count: number;
  points_transactions_count: number;
  point_records_count: number;
  conversation_reviews_count: number;
  daily_followups_count: number;
  shift_schedule_count: number;
  attendance_count: number;
  time_off_count: number;
  stagnant_list_records_count: number;
}

export function normalizeStaffName(name: string): string {
  if (!name) return '';
  return name
    .replace(/^(د|د\/|د\.|دكتور|أ|أ\/|أ\.|أستاذ|م|م\/|م\.|مهندس)/i, '')
    .trim()
    .replace(/[أإآ]/g, 'ا')
    .replace(/[ة]/g, 'ه')
    .replace(/[ي]/g, 'ى')
    .replace(/[.,،\-_]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

async function safeCount(table: string, column: string, staffId: string): Promise<number> {
  const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true }).eq(column, staffId);
  if (error) return 0;
  return count || 0;
}

async function loadStaffAccountsByStaffId() {
  const { data, error } = await supabase.from('staff_accounts').select('id,staff_id');
  if (error) return new Map<string, string>();
  return new Map((data || []).filter((row) => row.staff_id).map((row) => [String(row.staff_id), String(row.id)]));
}

export async function fetchAllStaffWithCounts(): Promise<StaffDuplicateRecord[]> {
  const staffSelects = [
    'id,name,role,branch,active,created_at',
    'id,name,role,branch,is_active,created_at',
    'id,name,role,branch,active',
    'id,name,role,branch,is_active',
    'id,name,role,branch',
  ];

  let staffData: Record<string, unknown>[] = [];
  let lastError: unknown = null;
  for (const select of staffSelects) {
    const { data, error } = await supabase.from('staff').select(select);
    if (!error) {
      staffData = (data || []) as Record<string, unknown>[];
      lastError = null;
      break;
    }
    lastError = error;
  }
  if (lastError) throw new Error(String((lastError as { message?: string })?.message || lastError));

  const accountsByStaff = await loadStaffAccountsByStaffId();

  return Promise.all(staffData.map(async (staff) => {
    const staffId = String(staff.id || '');
    const displayName = String(staff.name || '');
    const counts = await Promise.all([
      safeCount('sales_invoices', 'staff_id', staffId),
      safeCount('staff_sales_summary', 'staff_id', staffId),
      safeCount('employee_transactions', 'staff_id', staffId),
      safeCount('points_transactions', 'staff_id', staffId),
      safeCount('point_records', 'staff_id', staffId),
      safeCount('conversation_sales_reviews', 'staff_id', staffId),
      safeCount('daily_followups', 'staff_id', staffId),
      safeCount('shift_schedules', 'staff_id', staffId),
      safeCount('attendance', 'staff_id', staffId),
      safeCount('time_off', 'staff_id', staffId),
      safeCount('stagnant_medicine_dispenses', 'staff_id', staffId),
    ]);
    const accountId = accountsByStaff.get(staffId);
    return {
      staff_id: staffId,
      staff_account_id: accountId,
      display_name: displayName,
      normalized_name: normalizeStaffName(displayName),
      role: String(staff.role || ''),
      branch: String(staff.branch || ''),
      active: Boolean(staff.active ?? staff.is_active ?? true),
      created_at: String(staff.created_at || ''),
      linked_user_id: accountId,
      sales_invoice_count: counts[0],
      staff_sales_summary_count: counts[1],
      employee_transactions_count: counts[2],
      points_transactions_count: counts[3],
      point_records_count: counts[4],
      conversation_reviews_count: counts[5],
      daily_followups_count: counts[6],
      shift_schedule_count: counts[7],
      attendance_count: counts[8],
      time_off_count: counts[9],
      stagnant_list_records_count: counts[10],
    };
  }));
}

export async function findStaffDuplicates(): Promise<StaffDuplicateGroup[]> {
  const allStaff = await fetchAllStaffWithCounts();
  const groups = new Map<string, StaffDuplicateRecord[]>();
  for (const staff of allStaff) {
    if (!staff.normalized_name) continue;
    const current = groups.get(staff.normalized_name) || [];
    current.push(staff);
    groups.set(staff.normalized_name, current);
  }
  return [...groups.entries()]
    .filter(([, staff]) => staff.length > 1)
    .map(([normalized_name, staff]) => ({ normalized_name, staff }))
    .sort((a, b) => b.staff.length - a.staff.length);
}

export async function getDuplicateStatistics() {
  const allStaff = await fetchAllStaffWithCounts();
  const groups = new Map<string, StaffDuplicateRecord[]>();
  for (const staff of allStaff) {
    if (!staff.normalized_name) continue;
    const current = groups.get(staff.normalized_name) || [];
    current.push(staff);
    groups.set(staff.normalized_name, current);
  }
  const duplicateGroups = [...groups.entries()]
    .filter(([, staff]) => staff.length > 1)
    .map(([normalized_name, staff]) => ({ normalized_name, staff }))
    .sort((a, b) => b.staff.length - a.staff.length);
  return {
    totalStaff: allStaff.length,
    totalDuplicates: duplicateGroups.reduce((sum, group) => sum + group.staff.length, 0),
    uniqueDuplicateNames: duplicateGroups.length,
    duplicateGroups,
  };
}
