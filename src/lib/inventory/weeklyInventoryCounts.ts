import { supabase } from '@/lib/supabase';

// Branch weekly inventory count (v1). The week's items and their system balance come from the
// pharmacy program as an Excel file; the branch assistants enter the counted quantity; the branch
// manager reviews the differences and closes the count. Every write goes through the authorized
// RPCs of migration 20261029120000_branch_inventory_weekly_counts_v1.

export type WeeklyCountStatus = 'planned' | 'counting' | 'submitted' | 'closed';
export type ReviewResult = 'confirmed' | 'corrected' | 'recount';

export interface WeeklyCountItemInput {
  product_code: string | null;
  item_name: string;
  expected_qty: string;
  unit_price: string | null;
}

export interface WeeklyCountSession {
  id: string;
  title: string | null;
  branch: string | null;
  week_start: string | null;
  due_date: string | null;
  status: WeeklyCountStatus | string | null;
  created_by_name: string | null;
  submitted_at: string | null;
  closed_at: string | null;
  reviewer_staff_name: string | null;
}

export interface WeeklyCountItem {
  id: string;
  session_id: string;
  product_code: string | null;
  item_name: string | null;
  expected_qty: number | null;
  actual_qty: number | null;
  difference: number | null;
  unit_price: number | null;
  expiry_date: string | null;
  notes: string | null;
  reviewed_qty: number | null;
  review_result: ReviewResult | string | null;
  reason: string | null;
  counted_at: string | null;
}

export const WEEKLY_COUNT_STATUS_LABELS: Record<WeeklyCountStatus, string> = {
  planned: 'لم يبدأ',
  counting: 'جاري الجرد',
  submitted: 'بانتظار مراجعة المدير',
  closed: 'معتمد',
};

export const REVIEW_RESULT_LABELS: Record<ReviewResult, string> = {
  confirmed: 'الفرق مؤكد',
  corrected: 'اتصحح بعد المراجعة',
  recount: 'يتجرد تاني',
};

const HEADER_ALIASES = {
  code: ['كود الصنف', 'الكود', 'كود', 'رقم الصنف', 'code', 'product_code', 'item_code'],
  name: ['اسم الصنف', 'الصنف', 'الاسم', 'اسم', 'item_name', 'name', 'product_name'],
  balance: ['الرصيد', 'رصيد', 'الرصيد الحالي', 'رصيد السيستم', 'الكمية', 'الكمية المتوقعة', 'السيستم', 'expected_qty', 'qty', 'balance', 'stock'],
  price: ['السعر', 'سعر البيع', 'سعر الصنف', 'سعر', 'unit_price', 'price'],
} as const;

const normalizeHeader = (value: string) =>
  value.replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim().toLowerCase();

const ALIAS_INDEX = Object.fromEntries(
  Object.entries(HEADER_ALIASES).map(([field, aliases]) => [field, aliases.map((alias) => normalizeHeader(alias))]),
) as Record<keyof typeof HEADER_ALIASES, string[]>;

const toNumberText = (value: unknown): string | null => {
  const text = String(value ?? '')
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[,٬\s]/g, '')
    .replace('٫', '.');
  return /^-?\d+(\.\d+)?$/.test(text) ? String(Number(text)) : null;
};

export interface ParsedWeeklyCountFile {
  items: WeeklyCountItemInput[];
  /** Rows skipped: no item name or no readable balance. */
  skipped: number;
  /** The columns recognized in the file (null when not found). */
  columns: Record<keyof typeof HEADER_ALIASES, string | null>;
  duplicates: number;
}

/** Pure: rows of the program's Excel sheet → the week's items. */
export function parseWeeklyCountRows(rows: Array<Record<string, unknown>>): ParsedWeeklyCountFile {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const find = (field: keyof typeof HEADER_ALIASES) =>
    ALIAS_INDEX[field].map((alias) => headers.find((header) => normalizeHeader(header) === alias)).find(Boolean) ?? null;
  const columns = { code: find('code'), name: find('name'), balance: find('balance'), price: find('price') };
  const items: WeeklyCountItemInput[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let duplicates = 0;
  for (const row of rows) {
    const name = columns.name ? String(row[columns.name] ?? '').trim() : '';
    const balance = columns.balance ? toNumberText(row[columns.balance]) : null;
    if (!name || balance === null) {
      if (name || (columns.balance && String(row[columns.balance] ?? '').trim())) skipped += 1;
      continue;
    }
    const code = columns.code ? String(row[columns.code] ?? '').trim() || null : null;
    const key = code || name.toLowerCase();
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    items.push({
      product_code: code,
      item_name: name,
      expected_qty: balance,
      unit_price: columns.price ? toNumberText(row[columns.price]) : null,
    });
  }
  return { items, skipped, columns, duplicates };
}

export async function readWeeklyCountFile(file: File): Promise<ParsedWeeklyCountFile> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return parseWeeklyCountRows(XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' }));
}

const COUNTED_ALIASES = ['الفعلي', 'الكمية الفعلية', 'الجرد', 'الجرد الفعلي', 'العدد', 'المعدود', 'counted', 'actual', 'actual_qty']
  .map((alias) => normalizeHeader(alias));

export interface CountedFileMatch {
  counts: Array<{ item_id: string; actual_qty: string }>;
  /** Rows of the file that match no item of the week. */
  unmatched: string[];
  /** Week items the file does not count. */
  missing: number;
  countedColumn: string | null;
}

/**
 * Pure: the counted file (after the count) → quantities for the week's items. A row matches by
 * product code, else by exact item name; the counted column is never the program balance column.
 */
export function matchCountedFileRows(
  rows: Array<Record<string, unknown>>,
  items: ReadonlyArray<Pick<WeeklyCountItem, 'id' | 'product_code' | 'item_name'>>,
): CountedFileMatch {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const pick = (aliases: string[]) => aliases.map((alias) => headers.find((header) => normalizeHeader(header) === alias)).find(Boolean) ?? null;
  const countedColumn = pick(COUNTED_ALIASES);
  if (!countedColumn) return { counts: [], unmatched: [], missing: items.length, countedColumn };
  const codeColumn = pick(ALIAS_INDEX.code);
  const nameColumn = pick(ALIAS_INDEX.name);
  const byCode = new Map(items.filter((item) => item.product_code).map((item) => [String(item.product_code).trim().toLowerCase(), item.id]));
  const byName = new Map(items.filter((item) => item.item_name).map((item) => [String(item.item_name).trim().toLowerCase(), item.id]));
  const found = new Map<string, string>();
  const unmatched: string[] = [];
  for (const row of rows) {
    const qty = toNumberText(row[countedColumn]);
    if (qty === null || Number(qty) < 0) continue;
    const code = codeColumn ? String(row[codeColumn] ?? '').trim() : '';
    const name = nameColumn ? String(row[nameColumn] ?? '').trim() : '';
    const id = (code && byCode.get(code.toLowerCase())) || (name && byName.get(name.toLowerCase())) || null;
    if (id) found.set(id, qty);
    else if (code || name) unmatched.push(name || code);
  }
  return {
    counts: [...found.entries()].map(([item_id, actual_qty]) => ({ item_id, actual_qty })),
    unmatched,
    missing: items.filter((item) => !found.has(item.id)).length,
    countedColumn,
  };
}

export async function readCountedFile(file: File, items: ReadonlyArray<Pick<WeeklyCountItem, 'id' | 'product_code' | 'item_name'>>) {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return matchCountedFileRows(XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' }), items);
}

export interface InventoryCounter {
  staff_account_id: string;
  name: string | null;
  branch_scope: 'shokry' | 'elshamy' | 'ALL';
  active: boolean;
  can_login: boolean;
}

export const COUNTER_SCOPE_LABELS: Record<InventoryCounter['branch_scope'], string> = {
  shokry: 'فرع شكري',
  elshamy: 'فرع الشامي',
  ALL: 'كل الفروع',
};

export async function listInventoryCounters(): Promise<InventoryCounter[]> {
  const { data, error } = await supabase.rpc('list_inventory_counters_v1');
  if (error) throw error;
  return (data || []) as InventoryCounter[];
}

export async function listWeeklyCountSessions(branch: string | null): Promise<WeeklyCountSession[]> {
  let query = supabase
    .from('inventory_count_sessions')
    .select('id,title,branch,week_start,due_date,status,created_by_name,submitted_at,closed_at,reviewer_staff_name')
    .eq('count_type', 'weekly_items')
    .order('week_start', { ascending: false })
    .limit(30);
  if (branch) query = query.eq('branch', branch);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as WeeklyCountSession[];
}

export async function listWeeklyCountItems(sessionId: string): Promise<WeeklyCountItem[]> {
  const { data, error } = await supabase
    .from('inventory_count_items')
    .select('id,session_id,product_code,item_name,expected_qty,actual_qty,difference,unit_price,expiry_date,notes,reviewed_qty,review_result,reason,counted_at')
    .eq('session_id', sessionId)
    .order('item_name', { ascending: true })
    .limit(1000);
  if (error) throw error;
  return (data || []) as WeeklyCountItem[];
}

export async function createWeeklyCount(input: { branch: string; weekStart: string; dueDate: string; items: WeeklyCountItemInput[] }) {
  const { data, error } = await supabase.rpc('create_inventory_weekly_count_v1', {
    p_branch: input.branch,
    p_week_start: input.weekStart,
    p_due_date: input.dueDate,
    p_items: input.items,
  });
  if (error) throw error;
  return data as { session_id: string; items: number };
}

export async function saveCountedQuantities(sessionId: string, counts: Array<{ item_id: string; actual_qty: string; notes?: string | null }>) {
  const { data, error } = await supabase.rpc('save_inventory_count_quantities_v1', { p_session_id: sessionId, p_counts: counts });
  if (error) throw error;
  return Number(data) || 0;
}

export async function submitWeeklyCount(sessionId: string) {
  const { error } = await supabase.rpc('submit_inventory_count_v1', { p_session_id: sessionId });
  if (error) throw error;
}

export async function reviewWeeklyCount(
  sessionId: string,
  reviews: Array<{ item_id: string; review_result: ReviewResult; reviewed_qty?: string | null; reason?: string | null }>,
  decision: 'approve' | 'return',
) {
  const { error } = await supabase.rpc('review_inventory_count_v1', { p_session_id: sessionId, p_reviews: reviews, p_decision: decision });
  if (error) throw error;
}

/** Arabic message for the RPC errors raised by the migration. */
export function weeklyCountErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message || error || '');
  if (message.includes('not_authorized')) return 'مش مسموح لك بالخطوة دي في الفرع ده';
  if (message.includes('week_already_planned')) return 'جرد الأسبوع ده متسجل قبل كده للفرع';
  if (message.includes('items_not_counted')) return `لسه فيه ${message.split(':').pop()} صنف من غير كمية فعلية`;
  if (message.includes('session_not_open')) return 'الجرد اتسلم للمدير، مينفعش يتعدل دلوقتي';
  if (message.includes('session_not_submitted')) return 'الجرد لسه ما اتسلمش للمراجعة';
  if (message.includes('invalid_items')) return 'فيه صنف من غير اسم أو رصيده مش رقم';
  if (message.includes('invalid_dates')) return 'تاريخ التسليم لازم يكون بعد بداية الأسبوع';
  if (message.includes('too_many_items')) return 'الملف فيه أكتر من 1000 صنف';
  return message || 'حصل خطأ غير متوقع';
}
