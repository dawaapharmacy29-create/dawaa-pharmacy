import { supabase } from '@/supabaseClient';
import type { StockFile } from './stockFile';

// رصيد المخازن (صاحب الصيدلية 2026-11-26), migration 20261127000000_inventory_stock_intelligence_v1:
// الملف بيترفع كل يوم ومنه قيمة المخزون في كل فرع، والطلبيات، والرواكد، والإكسبير، والجرد. للإدارة (د وائل ود معاذ).

export const BRANCH_OWNER: Record<string, string> = {
  'فرع شكري': 'د وائل',
  'فرع الشامي': 'د معاذ',
};

const ERRORS: Record<string, string> = {
  not_authorized: 'الصفحة دي للإدارة بس',
  inventory_upload_closed: 'الرفع ده اتقفل، ارفعي الملف تاني',
  inventory_upload_empty: 'الملف مفيهوش أصناف',
  inventory_invalid_kind: 'نوع الملف مش معروف',
  inventory_search_too_many: 'ابحثي عن ٣٠٠ صنف بالكتير مرة واحدة',
};

function fail(error: { message?: string } | null, fallback: string): never {
  const message = String(error?.message || '');
  const known = Object.keys(ERRORS).find((k) => message.includes(k));
  if (/function .* does not exist|Could not find the function/i.test(message))
    throw new Error('الصفحة لسه مستنية تحديث قاعدة البيانات');
  throw new Error(known ? ERRORS[known] : message || fallback);
}

const CHUNK = 2500;

export async function uploadStockFile(
  file: StockFile,
  fileName: string,
  day: string,
  onProgress?: (done: number, total: number) => void
): Promise<{ rows: number; day: string }> {
  const { data: id, error } = await supabase.rpc('dawaa_inventory_upload_begin_v1', {
    p_day: day,
    p_file_name: fileName,
    p_kind: file.kind,
  });
  if (error || !id) fail(error, 'تعذّر بدء الرفع');
  for (let i = 0; i < file.rows.length; i += CHUNK) {
    const { error: e } = await supabase.rpc('dawaa_inventory_upload_rows_v1', {
      p_upload: id,
      p_rows: file.rows.slice(i, i + CHUNK),
    });
    if (e) fail(e, 'تعذّر رفع جزء من الملف');
    onProgress?.(Math.min(i + CHUNK, file.rows.length), file.rows.length);
  }
  const { data, error: e2 } = await supabase.rpc('dawaa_inventory_upload_finish_v1', {
    p_upload: id,
  });
  if (e2) fail(e2, 'تعذّر حفظ الملف');
  const d = (data ?? {}) as { rows?: number; day?: string };
  return { rows: Number(d.rows ?? file.rows.length), day: String(d.day ?? day) };
}

export type StoreKind = 'main' | 'doctor' | 'expiry' | 'office';

export type InvStore = {
  store: string;
  branch: string;
  kind: StoreKind;
  items: number;
  qty: number;
  value: number;
  sale_value: number;
  near_expiry: number;
  expired: number;
};

export type InvBranch = {
  branch: string;
  items: number;
  value: number;
  sale_value: number;
  /** Sales value of the last 14 days. */
  sold_value_30: number;
  /** Sales value of the 14 days before. */
  sold_value_prev30: number;
  cogs_30: number;
  dead_value: number;
  dead_items: number;
  over_value: number;
  out_of_stock: number;
  negative: number;
};

export type InvOrder = {
  branch: string;
  code: string;
  name: string;
  company: string | null;
  qty: number;
  rate30: number;
  n90: number;
  requests: number;
  need: number;
  transfer_qty: number;
  buy_qty: number;
  cost: number;
  buy_cost: number;
  in_budget: boolean;
  out: boolean;
};

export type InvNearExpiry = {
  branch: string;
  store: string;
  code: string;
  name: string;
  qty: number;
  expiry: string;
  days: number;
  cost: number | null;
  value: number;
  supplier: string | null;
  location: string | null;
  rate30: number;
  risk_qty: number;
  risk_value: number;
  other_rate30: number;
};

export type InvExpiryStore = {
  branch: string;
  store: string;
  code: string;
  name: string;
  qty: number;
  value: number;
  expiry: string | null;
  supplier: string | null;
};

export type InvDead = {
  branch: string;
  code: string;
  name: string;
  company: string | null;
  qty: number;
  value: number;
  last_buy: string | null;
  last_sale: string | null;
  other_rate30: number;
  other_qty: number;
};

export type InvOver = {
  branch: string;
  code: string;
  name: string;
  qty: number;
  rate30: number;
  cover_days: number;
  excess_qty: number;
  excess_value: number;
  value: number;
  other_rate30: number;
  other_qty: number;
};

export type RequestAdvice = 'release' | 'release_important' | 'low' | 'other_branch';
export type InvRequest = {
  fingerprint: string;
  branch: string;
  day: string;
  status: string;
  customer_code: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  code: string;
  item: string;
  want: number | null;
  stock: number;
  rate30: number;
  other_stock: number;
  important: boolean;
  spend90: number;
  invoices90: number;
  advice: RequestAdvice;
};

export type CountReason = 'fast' | 'negative' | 'value' | 'multi_code' | 'multi_pack';
export type InvCount = {
  reason: CountReason;
  branch: string;
  code: string;
  name: string;
  qty: number;
  note: string;
};

export type InvMover = {
  branch: string;
  code: string;
  name: string;
  v30: number;
  vprev30: number;
  diff: number;
};

export type InvCompany = {
  company: string;
  value: number;
  v30: number;
  vprev30: number;
  dead_value: number;
};

export type InventoryOverview = {
  empty?: boolean;
  upload: {
    day: string;
    kind: 'batches' | 'summary';
    file: string | null;
    by: string | null;
    at: string | null;
    rows: number;
    batches_day: string | null;
  };
  cover_days: number;
  budget: number | null;
  stores: InvStore[];
  trend: Array<{ day: string; branch: string; value: number; expiry: number }>;
  branches: InvBranch[];
  near_expiry: InvNearExpiry[];
  expiry_store: InvExpiryStore[];
  dead: InvDead[];
  overstock: InvOver[];
  order_totals: Array<{
    branch: string;
    lines: number;
    cost: number;
    in_budget_cost: number;
    in_budget_lines: number;
    transfer_lines: number;
  }>;
  orders: InvOrder[];
  requests_in_stock: InvRequest[];
  count: InvCount[];
  movers_up: InvMover[];
  movers_down: InvMover[];
  companies: InvCompany[];
};

export async function loadInventoryOverview(opts: {
  branch: string | null;
  budget: number | null;
  coverDays: number;
}): Promise<InventoryOverview | null> {
  const { data, error } = await supabase.rpc('dawaa_inventory_overview_v1', {
    p_branch: opts.branch,
    p_budget: opts.budget,
    p_cover_days: opts.coverDays,
  });
  if (error) fail(error, 'تعذّر تحميل تحليل المخزون');
  const d = (data ?? {}) as Partial<InventoryOverview>;
  if (d.empty || !d.upload) return null;
  const arr = <T>(v: T[] | null | undefined) => v ?? [];
  return {
    ...(d as InventoryOverview),
    stores: arr(d.stores),
    trend: arr(d.trend),
    branches: arr(d.branches),
    near_expiry: arr(d.near_expiry),
    expiry_store: arr(d.expiry_store),
    dead: arr(d.dead),
    overstock: arr(d.overstock),
    order_totals: arr(d.order_totals),
    orders: arr(d.orders),
    requests_in_stock: arr(d.requests_in_stock),
    count: arr(d.count),
    movers_up: arr(d.movers_up),
    movers_down: arr(d.movers_down),
    companies: arr(d.companies),
  };
}

// ---------- بحث صنف: رصيد أي صنف من آخر ملف (migration 20261127100000_inventory_item_search_v1) ----------

export type InvItem = {
  code: string;
  name: string | null;
  company: string | null;
  /** The search term (normalized) that matched this item; null when listing all items. */
  term: string | null;
  shokry: number;
  shami: number;
  expiry_store: number;
  nearest_expiry: string | null;
  cost: number | null;
  price: number | null;
  sold30_shokry: number;
  sold30_shami: number;
};

export type InvItemSearch = { day: string | null; rows: InvItem[]; unmatched: string[] };

/** Terms: one item per entry (code, or name words that must all appear). Empty = every item. */
export async function searchInventoryItems(terms: string[]): Promise<InvItemSearch> {
  const list = [...new Set(terms.map((t) => t.trim()).filter(Boolean))];
  const { data, error } = await supabase.rpc('dawaa_inventory_item_search_v1', {
    p_terms: list.length ? list : null,
  });
  if (error) fail(error, 'تعذّر البحث في الرصيد');
  const d = (data ?? {}) as Partial<InvItemSearch> & { empty?: boolean };
  return { day: d.day ?? null, rows: d.rows ?? [], unmatched: d.unmatched ?? [] };
}

// ---------- رصيد أصناف طلبات العملاء (لفريق خدمة العملاء) ----------

export type StockByCode = { day: string | null; stock: Map<string, Record<string, number>> };

export async function loadStockForCodes(codes: string[]): Promise<StockByCode> {
  const list = [...new Set(codes.filter(Boolean))];
  if (!list.length) return { day: null, stock: new Map() };
  const { data, error } = await supabase.rpc('dawaa_inventory_stock_for_codes_v1', {
    p_codes: list,
  });
  if (error) fail(error, 'تعذّر تحميل الرصيد');
  const d = (data ?? {}) as {
    day?: string | null;
    rows?: Array<{ code: string; branch: string; qty: number }>;
  };
  const stock = new Map<string, Record<string, number>>();
  for (const r of d.rows ?? []) {
    const e = stock.get(r.code) ?? {};
    e[r.branch] = Number(r.qty) || 0;
    stock.set(r.code, e);
  }
  return { day: d.day ?? null, stock };
}

// ---------- التصدير ----------

type Col<T> = { header: string; width: number; value: (r: T) => string | number | null };

export async function exportSheets(
  sheets: Array<{ name: string; rows: unknown[]; cols: Col<never>[] }>,
  title: string
): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31), {
      views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
    });
    ws.columns = s.cols.map((c, i) => ({ header: c.header, key: `c${i}`, width: c.width }));
    for (const r of s.rows) {
      const row: Record<string, unknown> = {};
      s.cols.forEach((c, i) => (row[`c${i}`] = (c.value as (x: unknown) => unknown)(r) ?? ''));
      ws.addRow(row);
    }
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    head.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    head.height = 24;
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.cols.length } };
  }
  const info = wb.addWorksheet('عن الملف', { views: [{ rightToLeft: true }] });
  info.getColumn(1).width = 90;
  info.addRow([title]).font = { bold: true, size: 13 };
  info.addRow([`اتصدر ${new Date().toLocaleString('ar-EG')}`]);
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export type { Col };
