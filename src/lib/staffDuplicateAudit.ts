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
}

/**
 * Linked-record counts for one staff row. `null` means the count failed to load and must be shown
 * as unavailable — never as a valid-looking zero.
 */
export interface StaffLinkedRecordCounts {
  sales_invoice_count: number | null;
  employee_transactions_count: number | null;
  conversation_reviews_count: number | null;
  daily_followups_count: number | null;
  shift_schedule_count: number | null;
  attendance_count: number | null;
  stagnant_list_records_count: number | null;
}

/**
 * The only linked-record sources counted by the audit. Each one exists in Production and is keyed by
 * the listed staff column. Legacy tables (points_transactions, point_records, time_off) and the
 * staff_sales_summary materialized view (no staff column) are intentionally not probed.
 */
export const STAFF_LINKED_RECORD_SOURCES: ReadonlyArray<{
  key: keyof StaffLinkedRecordCounts;
  table: string;
  column: string;
}> = [
  { key: 'sales_invoice_count', table: 'sales_invoices', column: 'staff_id' },
  { key: 'employee_transactions_count', table: 'employee_transactions', column: 'staff_id' },
  { key: 'conversation_reviews_count', table: 'conversation_sales_reviews', column: 'staff_id' },
  { key: 'daily_followups_count', table: 'daily_followups', column: 'staff_id' },
  { key: 'shift_schedule_count', table: 'shift_schedules', column: 'staff_id' },
  { key: 'attendance_count', table: 'attendance', column: 'staff_id' },
  { key: 'stagnant_list_records_count', table: 'stagnant_medicine_dispenses', column: 'doctor_id' },
];

/** Upper bound of concurrent count requests; keeps the browser and PostgREST out of saturation. */
export const STAFF_COUNT_CONCURRENCY = 3;
/** Upper bound of staff rows whose counts are loaded in one call (one expanded duplicate group). */
export const STAFF_COUNT_MAX_STAFF = 12;

type QueryResult = { data?: unknown; count?: number | null; error: unknown };
type CountQuery = PromiseLike<QueryResult> & { abortSignal?: (signal: AbortSignal) => CountQuery };

/** Minimal client surface used by the audit, so the request budget can be tested without a network. */
export interface StaffDuplicateAuditClient {
  from(table: string): {
    select(columns: string, options?: { count?: 'exact'; head?: boolean }): PromiseLike<QueryResult> & {
      eq(column: string, value: string): CountQuery;
    };
  };
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<QueryResult>;
}

const defaultClient = supabase as unknown as StaffDuplicateAuditClient;

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

async function loadStaffAccountsByStaffId(client: StaffDuplicateAuditClient): Promise<Map<string, string>> {
  const { data, error } = await client.rpc('get_staff_accounts_directory', {
    p_roles: null,
    p_branch: null,
  });
  if (error) throw new Error(String((error as { message?: string })?.message || error));
  const rows = ((data || []) as Array<{ account_id?: unknown; staff_id?: unknown }>).filter(Boolean);
  return new Map<string, string>(
    rows
      .filter((row) => Boolean(row.staff_id) && Boolean(row.account_id))
      .map((row): [string, string] => [String(row.staff_id), String(row.account_id)])
  );
}

/** Staff identity rows only: exactly two requests, independent of staff count. */
export async function fetchAllStaffRecords(
  client: StaffDuplicateAuditClient = defaultClient
): Promise<StaffDuplicateRecord[]> {
  const [staffResult, accountsByStaff] = await Promise.all([
    client.from('staff').select('id,name,role,branch,active,is_active,created_at'),
    loadStaffAccountsByStaffId(client),
  ]);
  if (staffResult.error) {
    throw new Error(String((staffResult.error as { message?: string })?.message || staffResult.error));
  }
  const staffData = ((staffResult.data || []) as Record<string, unknown>[]).filter(Boolean);

  return staffData.map((staff) => {
    const staffId = String(staff.id || '');
    const displayName = String(staff.name || '');
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
    };
  });
}

async function runBounded<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

/**
 * Loads linked-record counts on demand for one duplicate group. Requests are bounded to
 * STAFF_COUNT_MAX_STAFF × STAFF_LINKED_RECORD_SOURCES with STAFF_COUNT_CONCURRENCY in flight.
 */
export async function fetchStaffLinkedRecordCounts(
  staffIds: string[],
  options: { signal?: AbortSignal; client?: StaffDuplicateAuditClient } = {}
): Promise<Map<string, StaffLinkedRecordCounts>> {
  const client = options.client || defaultClient;
  const ids = Array.from(new Set(staffIds.filter(Boolean))).slice(0, STAFF_COUNT_MAX_STAFF);
  const tasks = ids.flatMap((staffId) =>
    STAFF_LINKED_RECORD_SOURCES.map((source) => async () => {
      if (options.signal?.aborted) return { staffId, key: source.key, value: null };
      let query = client.from(source.table).select('id', { count: 'exact', head: true }).eq(source.column, staffId);
      if (options.signal && query.abortSignal) query = query.abortSignal(options.signal);
      const { count, error } = await query;
      return { staffId, key: source.key, value: error ? null : count ?? null };
    })
  );
  const rows = await runBounded(tasks, STAFF_COUNT_CONCURRENCY);
  const result = new Map<string, StaffLinkedRecordCounts>();
  for (const row of rows) {
    const current =
      result.get(row.staffId) ||
      (Object.fromEntries(STAFF_LINKED_RECORD_SOURCES.map((s) => [s.key, null])) as unknown as StaffLinkedRecordCounts);
    current[row.key] = row.value;
    result.set(row.staffId, current);
  }
  return result;
}

function groupDuplicateStaff(allStaff: StaffDuplicateRecord[]): StaffDuplicateGroup[] {
  const groups = new Map<string, StaffDuplicateRecord[]>();
  for (const staff of allStaff.filter(Boolean)) {
    if (!staff.normalized_name) continue;
    const current = groups.get(staff.normalized_name) || [];
    current.push(staff);
    groups.set(staff.normalized_name, current);
  }
  return Array.from(groups.entries())
    .filter(([, staff]) => staff.length > 1)
    .map(([normalized_name, staff]) => ({ normalized_name, staff }));
}

export async function findStaffDuplicates(
  client: StaffDuplicateAuditClient = defaultClient
): Promise<StaffDuplicateGroup[]> {
  return groupDuplicateStaff(await fetchAllStaffRecords(client));
}

export async function getDuplicateStatistics(client: StaffDuplicateAuditClient = defaultClient) {
  const allStaff = await fetchAllStaffRecords(client);
  const duplicateGroups = groupDuplicateStaff(allStaff);
  return {
    totalStaff: allStaff.length,
    totalDuplicates: duplicateGroups.reduce((total, group) => total + group.staff.length, 0),
    uniqueDuplicateNames: duplicateGroups.length,
    duplicateGroups,
  };
}
