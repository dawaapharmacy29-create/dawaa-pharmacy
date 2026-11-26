import { supabase } from '@/supabaseClient';
import { parseGroupChat } from '@/lib/followupRequests/groupChatRequests';
import {
  FOLLOWUP_KINDS,
  type FollowupKind,
  type FollowupUnderstanding,
} from './followupUnderstanding';
import { findNamedDoctor } from '@/lib/followupRequests/namedDoctor';
import {
  describeRequest,
  extractCustomerCode,
  extractPhone,
  extractRequestCandidates,
  type RequestCandidate,
} from '@/features/customer-requests/groupImport/groupChatCustomerRequests';

// جروبات الواتساب لفريق خدمة العملاء (صاحب الصيدلية 2026-11-25), migration 20261125200000:
// - جروب المتابعات: كل حالة فيها كود أو رقم عميل بتبقى مهمة «حالة من الدكتور» في شيت النهارده، وبتتحسب للدكتور.
// - جروب الطلبات: الطلبات بأصنافها وكمياتها، بحالة لحد ما تتسلم، وتتصدر إكسيل. «اتوفر» بيعمل مهمة تبليغ في الشيت.

export type GroupDoctor = { staffId: string; name: string; branch: string | null };

const ERRORS: Record<string, string> = {
  group_invalid_branch: 'اختاري الفرع',
  group_invalid_rows: 'الملف كبير أوي أو فاضي',
  group_requests_invalid_branch: 'اختاري الفرع',
  group_invalid_status: 'الحالة دي مش من القايمة',
  request_needs_customer: 'اكتبي كود العميل أو رقم موبايله',
  request_needs_items: 'ضيفي صنف واحد على الأقل',
  unknown_staff: 'الدكتور ده مش في القايمة',
};

function fail(error: { message?: string } | null, fallback: string): never {
  const message = String(error?.message || '');
  const known = Object.keys(ERRORS).find((k) => message.includes(k));
  if (/function .* does not exist|Could not find the function/i.test(message))
    throw new Error('الصفحة لسه مستنية تحديث قاعدة البيانات');
  throw new Error(known ? ERRORS[known] : message || fallback);
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const latin = (v: string) =>
  v
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

export async function loadGroupDoctors(): Promise<GroupDoctor[]> {
  const { data, error } = await supabase.rpc('dawaa_cs_group_doctors_v1');
  if (error) fail(error, 'تعذّر تحميل أسماء الدكاترة');
  return ((data ?? []) as Array<{ staff_id: string; name: string; branch: string | null }>).map(
    (d) => ({ staffId: String(d.staff_id), name: d.name, branch: d.branch })
  );
}

// ---------- الأصناف والكميات ----------

/** A requested item. code/price when it was picked from the catalog, new when it is not in it, image when one was added. */
export type RequestItem = {
  name: string;
  qty: number | null;
  code?: string | null;
  price?: number | null;
  image?: string | null;
  new?: boolean;
};

const UNIT =
  '(?:علب[هة]?|علب|عبو[هة]|عبوات|شريط|شرايط|كيس|اكياس|أكياس|زجاج[هة]|ازاز[هة]|إزاز[هة]|امبول|أمبول|حقن[هة]?|قطع[هة]|كرتون[هة]|باكو|باكت|قلم|اقلام|أقلام)';
const DUAL: Array<[RegExp, number]> = [
  [/(?:علبتين|عبوتين|شريطين|كيسين|زجاجتين|ازازتين|حقنتين|قطعتين|امبولين|قلمين)/, 2],
];
/** Not an item: the doctor signing the request ("د دنيا", "د/ علياء"), or the group's own labels. */
const NOT_ITEM = /^(?:(?:د|دكتور[هة]?|dr)\s*\/?\s*[؀-ۿ]+(?:\s+[؀-ۿ]+)?|د|طلبات? عملاء|طلب عميل)$/i;
const FILLER =
  /^(?:محتاج[هة]?|محتاجين|عايز[هة]?|عاوز[هة]?|عايزين|طالب[هة]?|طلب|المطلوب|نوفر|نوفرله|نوفرلها|توفير|ل[هه]?)\s+/;

/**
 * The items a request asks for, from its details ("بانادول اكسترا ٢ علبة · كونكور 5"). A quantity is read only next
 * to a unit ("٢ علبة", "علبتين") or a multiplier ("x3"): a bare number is usually a strength ("كونكور 5"), so it stays
 * in the name and the quantity is left for her to fill.
 */
export function parseItems(details: string | null | undefined): RequestItem[] {
  if (!details) return [];
  const out: RequestItem[] = [];
  for (const raw of latin(details).split(/\s*(?:·|،|,|\+|\n|\s-\s)\s*|\s+و\s+(?=\S)/)) {
    let seg = raw
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!seg || NOT_ITEM.test(seg)) continue;
    const found: { qty: number | null } = { qty: null };
    const take = (re: RegExp, pick: (m: RegExpMatchArray) => number) => {
      const m = seg.match(re);
      if (!m || found.qty != null) return;
      found.qty = pick(m);
      seg = seg.replace(m[0], ' ');
    };
    take(new RegExp(`(\\d{1,3})\\s*${UNIT}`), (m) => Number(m[1]));
    take(new RegExp(`${UNIT}\\s*(\\d{1,3})(?!\\d)`), (m) => Number(m[1]));
    take(/(?:^|\s)[x×*]\s*(\d{1,3})(?!\d)/i, (m) => Number(m[1]));
    take(/(?<![\d.])(\d{1,3})\s*[x×*](?:\s|$)/i, (m) => Number(m[1]));
    for (const [re, n] of DUAL) take(re, () => n);
    take(new RegExp(`(?:^|\\s)${UNIT}(?:\\s|$)`), () => 1);
    const qty = found.qty;
    const name = seg
      .replace(/\s+/g, ' ')
      .trim()
      .replace(FILLER, '')
      .replace(/^[-–:.]+|[-–:.]+$/g, '')
      .trim();
    if (name.length < 2 || /^\d+$/.test(name)) {
      if (qty != null && out.length && out[out.length - 1].qty == null)
        out[out.length - 1].qty = qty;
      continue;
    }
    out.push({ name, qty: qty && qty > 0 && qty < 1000 ? qty : null });
  }
  return out.slice(0, 15);
}

// ---------- جروب المتابعات ----------

export type FollowupCandidate = {
  fingerprint: string;
  sentAtLocal: string;
  sender: string;
  body: string;
  hasImage: boolean;
  /** The app thinks this is a case to follow (the words or an invoice photo with a description). */
  likely: boolean;
  customerCode: string | null;
  customerPhone: string | null;
  customerName: string | null;
  doctorId: string | null;
  doctorName: string | null;
};

function fingerprintOf(sender: string, at: string, body: string) {
  const text = `fu|${sender}|${at}|${body.replace(/\s+/g, '')}`;
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return `fu-${hash.toString(36)}-${text.length}`;
}

/** The follow-up group's messages that may be cases: the ones the app flags, plus any carrying a customer. */
export function followupCandidates(content: string, doctors: GroupDoctor[]): FollowupCandidate[] {
  const out: FollowupCandidate[] = [];
  for (const m of parseGroupChat(content)) {
    if (m.verdict === 'repeat') continue;
    const customerPhone = extractPhone(m.body);
    const customerCode = extractCustomerCode(m.body);
    if (m.verdict === 'ignored' && !customerPhone && !customerCode) continue;
    const named = findNamedDoctor(m.body, doctors);
    out.push({
      fingerprint: fingerprintOf(m.sender, m.sentAtLocal, m.body),
      sentAtLocal: m.sentAtLocal,
      sender: m.sender,
      body: m.body,
      hasImage: m.hasImage,
      // صورة فاتورة مع وصف، أو رسالة فيها كلام متابعة وعميل.
      likely:
        m.verdict === 'request' || (m.verdict === 'review' && !!(customerCode || customerPhone)),
      customerCode,
      customerPhone,
      customerName: customerCode || customerPhone ? describeRequest(m.body).customerName : null,
      doctorId: named?.staffId ?? null,
      doctorName: named?.name ?? null,
    });
  }
  return out;
}

export type FollowupImport = {
  saved: number;
  tasks: number;
  credited: number;
  no_customer: number;
  old: number;
};

export async function importFollowups(
  fileName: string,
  branch: string,
  rows: Array<
    FollowupCandidate & {
      customerCode: string | null;
      understanding?: (FollowupUnderstanding & { brief: string }) | null;
    }
  >
): Promise<FollowupImport> {
  const { data, error } = await supabase.rpc('dawaa_cs_group_followups_import_v1', {
    p_file_name: fileName,
    p_branch: branch,
    p_rows: rows.map((c) => ({
      fingerprint: c.fingerprint,
      sender: c.sender,
      sent_at_local: c.sentAtLocal,
      body: c.body,
      staff_id: c.doctorId,
      customer_code: c.customerCode,
      customer_phone: c.customerPhone,
      customer_name: c.customerName,
      kind: c.understanding?.kind ?? null,
      brief: c.understanding?.brief ?? null,
      due_date: c.understanding?.dueDate ?? null,
      items: c.understanding?.items ?? [],
      patient: c.understanding?.patient ?? null,
      urgent: c.understanding?.urgent ?? false,
    })),
  });
  if (error) fail(error, 'تعذّر الحفظ');
  const d = (data ?? {}) as Partial<FollowupImport>;
  return {
    saved: num(d.saved),
    tasks: num(d.tasks),
    credited: num(d.credited),
    no_customer: num(d.no_customer),
    old: num(d.old),
  };
}

export type GroupFollowup = {
  fingerprint: string;
  branch: string;
  sent_at: string;
  doctor: string;
  customer_code: string | null;
  customer_phone: string | null;
  customer_name: string | null;
  body: string;
  task_date: string | null;
  result: string | null;
  assigned_name: string | null;
  kind: FollowupKind | null;
  brief: string | null;
  due_date: string | null;
  items: string[] | null;
  patient: string | null;
  urgent: boolean | null;
};

export async function loadGroupFollowups(
  branch: string | null,
  from: string
): Promise<GroupFollowup[]> {
  const { data, error } = await supabase.rpc('dawaa_cs_group_followups_list_v1', {
    p_branch: branch,
    p_from: from,
  });
  if (error) fail(error, 'تعذّر تحميل المتابعات');
  return (data ?? []) as GroupFollowup[];
}

// ---------- جروب الطلبات ----------

export function requestCandidates(content: string, doctors: GroupDoctor[]): RequestCandidate[] {
  return extractRequestCandidates(parseGroupChat(content), doctors, []).filter(
    (c) => c.kind === 'request' && (c.customerCode || c.customerPhone)
  );
}

export type RequestsImport = { added: number; already: number; credited: number };

export async function importRequests(
  fileName: string,
  branch: string,
  rows: RequestCandidate[]
): Promise<RequestsImport> {
  const { data, error } = await supabase.rpc('import_customer_request_group_v3', {
    p_file_name: fileName,
    p_branch: branch,
    p_rows: rows.map((c) => ({
      fingerprint: c.fingerprint,
      sent_at_local: c.sentAtLocal,
      sender: c.sender,
      customer_code: c.customerCode,
      customer_phone: c.customerPhone,
      customer_name: c.customerName,
      details: c.details,
      body: c.body,
      staff_id: c.doctorId,
      attribution: c.doctorReason,
      items: parseItems(c.details),
    })),
  });
  if (error) fail(error, 'تعذّر الحفظ');
  const d = (data ?? {}) as { new?: number; already?: number; credited?: number };
  return { added: num(d.new), already: num(d.already), credited: num(d.credited) };
}

export const REQUEST_STATUSES = {
  new: 'جديد',
  sourcing: 'بنوفره',
  available: 'اتوفر',
  notified: 'العميل اتبلغ',
  delivered: 'اتسلم',
  cancelled: 'اتلغى',
} as const;
export type RequestStatus = keyof typeof REQUEST_STATUSES;

export type GroupRequest = {
  fingerprint: string;
  branch: string;
  sent_at: string;
  day: string;
  sender: string | null;
  doctor: string | null;
  customer_code: string | null;
  customer_phone: string | null;
  customer_name: string | null;
  details: string | null;
  body: string;
  items: RequestItem[];
  status: RequestStatus;
  status_note: string | null;
  status_by: string | null;
  status_at: string | null;
  notify_task: boolean;
};

export async function loadGroupRequests(filter: {
  from: string;
  to: string;
  branch: string | null;
  status: string | null;
  q: string;
}): Promise<GroupRequest[]> {
  const { data, error } = await supabase.rpc('dawaa_cs_group_requests_list_v1', {
    p_from: filter.from,
    p_to: filter.to,
    p_branch: filter.branch,
    p_status: filter.status,
    p_q: filter.q.trim() || null,
  });
  if (error) fail(error, 'تعذّر تحميل الطلبات');
  const rows = ((data as { rows?: GroupRequest[] } | null)?.rows ?? []) as GroupRequest[];
  return rows.map((r) => ({
    ...r,
    // الطلبات اللي اتسجلت قبل الأصناف بتتقري من التفاصيل لحد ما حد يعدّلها.
    items:
      Array.isArray(r.items) && r.items.length
        ? r.items.map((i) => ({
            name: String(i?.name ?? ''),
            qty: i?.qty == null || i.qty === ('' as unknown) ? null : num(i.qty),
            ...(i?.code ? { code: String(i.code) } : {}),
            ...(i?.price != null && i.price !== ('' as unknown) ? { price: num(i.price) } : {}),
            ...(i?.image ? { image: String(i.image) } : {}),
            ...(i?.new ? { new: true } : {}),
          }))
        : parseItems(r.details),
  }));
}

export type RequestUpdate = {
  fingerprint: string;
  status?: RequestStatus;
  items?: RequestItem[];
  note?: string | null;
};

export async function updateGroupRequests(
  rows: RequestUpdate[]
): Promise<{ saved: number; tasks: number }> {
  const { data, error } = await supabase.rpc('dawaa_cs_group_requests_update_v1', { p_rows: rows });
  if (error) fail(error, 'تعذّر الحفظ');
  const d = (data ?? {}) as { saved?: number; tasks?: number };
  return { saved: num(d.saved), tasks: num(d.tasks) };
}

/** «حوّلي للنواقص»: every item of the requests becomes a shortage line with the customer; a new request becomes «بنوفره». */
export async function moveRequestsToShortages(
  fingerprints: string[]
): Promise<{ requests: number; items: number; skipped: number }> {
  const { data, error } = await supabase.rpc('dawaa_cs_group_requests_to_shortages_v1', {
    p_fingerprints: fingerprints,
  });
  if (error) fail(error, 'تعذّر التحويل للنواقص');
  const d = (data ?? {}) as { requests?: number; items?: number; skipped?: number };
  return { requests: num(d.requests), items: num(d.items), skipped: num(d.skipped) };
}

// ---------- التصدير ----------

const norm = (s: string) =>
  s
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** Items across requests, summed by name: how much to bring of each, for how many customers. */
export function itemTotals(rows: GroupRequest[]) {
  const map = new Map<
    string,
    { name: string; qty: number; unknown: number; customers: Set<string> }
  >();
  for (const r of rows) {
    for (const it of r.items) {
      const key = norm(it.name);
      if (!key) continue;
      const e = map.get(key) ?? { name: it.name, qty: 0, unknown: 0, customers: new Set<string>() };
      if (it.qty == null) e.unknown += 1;
      else e.qty += it.qty;
      e.customers.add(r.customer_code || r.customer_phone || r.fingerprint);
      map.set(key, e);
    }
  }
  return [...map.values()]
    .map((e) => ({ name: e.name, qty: e.qty, unknown: e.unknown, customers: e.customers.size }))
    .sort((a, b) => b.customers - a.customers || b.qty - a.qty);
}

export async function exportRequestsWorkbook(
  rows: GroupRequest[],
  title: string,
  /** Stock by item code and branch, from the last stock file (رصيد المخازن). */
  stock?: Map<string, Record<string, number>> | null
): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const head = (ws: import('exceljs').Worksheet) => {
    ws.views = [{ rightToLeft: true, state: 'frozen', ySplit: 1 }];
    const row = ws.getRow(1);
    row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    row.height = 24;
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
  };

  const ws = wb.addWorksheet('الطلبات');
  ws.columns = [
    { header: 'اليوم', key: 'day', width: 11 },
    { header: 'الفرع', key: 'branch', width: 11 },
    { header: 'العميل', key: 'name', width: 22 },
    { header: 'الكود', key: 'code', width: 9 },
    { header: 'الموبايل', key: 'phone', width: 14 },
    { header: 'كود الصنف', key: 'icode', width: 10 },
    { header: 'الصنف', key: 'item', width: 32 },
    { header: 'الكمية', key: 'qty', width: 8 },
    { header: 'رصيد الفرع', key: 'here', width: 9 },
    { header: 'رصيد الفرع التاني', key: 'other', width: 11 },
    { header: 'السعر', key: 'price', width: 9 },
    { header: 'صورة', key: 'image', width: 14 },
    { header: 'الحالة', key: 'status', width: 12 },
    { header: 'الدكتور', key: 'doctor', width: 16 },
    { header: 'ملاحظة', key: 'note', width: 26 },
    { header: 'الرسالة', key: 'body', width: 50 },
  ];
  for (const r of rows) {
    const items: RequestItem[] = r.items.length ? r.items : [{ name: r.details ?? '', qty: null }];
    items.forEach((it, i) =>
      ws.addRow({
        day: r.day.split('-').reverse().join('/'),
        branch: r.branch.replace('فرع ', ''),
        name: r.customer_name ?? '',
        code: r.customer_code ?? '',
        phone: r.customer_phone ?? '',
        icode: it.code ?? (it.new ? 'جديد' : ''),
        item: it.name,
        qty: it.qty ?? '',
        here: it.code && stock ? (stock.get(it.code)?.[r.branch] ?? 0) : '',
        other:
          it.code && stock
            ? Object.entries(stock.get(it.code) ?? {})
                .filter(([b]) => b !== r.branch)
                .reduce((t, [, q]) => t + q, 0)
            : '',
        price: it.price ?? '',
        image: it.image ? { text: 'الصورة', hyperlink: it.image } : '',
        status: REQUEST_STATUSES[r.status] ?? r.status,
        doctor: r.doctor ?? r.sender ?? '',
        note: r.status_note ?? '',
        body: i === 0 ? r.body : '',
      })
    );
  }
  head(ws);
  ws.eachRow((row, n) => {
    if (n > 1) row.alignment = { vertical: 'top', wrapText: true };
  });

  const sum = wb.addWorksheet('إجمالي الأصناف');
  sum.columns = [
    { header: 'الصنف', key: 'name', width: 36 },
    { header: 'إجمالي الكمية', key: 'qty', width: 14 },
    { header: 'طلبات من غير كمية', key: 'unknown', width: 18 },
    { header: 'عدد العملاء', key: 'customers', width: 12 },
  ];
  itemTotals(rows).forEach((t) => sum.addRow(t));
  head(sum);

  const info = wb.addWorksheet('عن الملف');
  info.views = [{ rightToLeft: true }];
  info.getColumn(1).width = 90;
  info.addRow([title]).font = { bold: true, size: 13 };
  info.addRow([`${rows.length} طلب · اتصدر ${new Date().toLocaleString('ar-EG')}`]);
  info.addRow([
    '«الطلبات»: كل صنف في سطر. «إجمالي الأصناف»: الكمية المطلوبة من كل صنف وعدد العملاء.',
  ]);
  info.addRow(['الكمية الفاضية يعني الدكتور ماكتبهاش في الجروب.']);

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

// ---------- طلب من الصفحة ----------

export type NewRequest = {
  branch: string;
  customerCode: string;
  customerPhone: string;
  customerName: string;
  items: RequestItem[];
  note: string;
  staffId: string | null;
};

export async function createGroupRequest(r: NewRequest): Promise<string> {
  const { data, error } = await supabase.rpc('dawaa_cs_group_request_create_v1', {
    p_branch: r.branch,
    p_customer_code: r.customerCode.trim() || null,
    p_customer_phone: r.customerPhone.trim() || null,
    p_customer_name: r.customerName.trim() || null,
    p_items: r.items.filter((i) => i.name.trim()),
    p_note: r.note.trim() || null,
    p_staff_id: r.staffId,
  });
  if (error) fail(error, 'تعذّر تسجيل الطلب');
  return String((data as { fingerprint?: string } | null)?.fingerprint ?? '');
}

export type GroupUploads = {
  followups: { at: string | null; last_message: string | null };
  requests: { at: string | null; last_message: string | null };
};

/** When each group was last uploaded (for the morning files page). */
export async function loadGroupUploads(): Promise<GroupUploads> {
  const { data, error } = await supabase.rpc('dawaa_cs_group_uploads_v1');
  if (error) fail(error, 'تعذّر تحميل آخر رفع للجروبات');
  const d = (data ?? {}) as Partial<GroupUploads>;
  return {
    followups: { at: d.followups?.at ?? null, last_message: d.followups?.last_message ?? null },
    requests: { at: d.requests?.at ?? null, last_message: d.requests?.last_message ?? null },
  };
}

/** The follow-up cases as the team works them: who, what kind, what to do, when, and the doctor's words. */
export async function exportFollowupsWorkbook(rows: GroupFollowup[], title: string): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('المتابعات', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
  });
  ws.columns = [
    { header: 'اليوم', key: 'day', width: 11 },
    { header: 'الفرع', key: 'branch', width: 9 },
    { header: 'العميل', key: 'name', width: 20 },
    { header: 'الكود', key: 'code', width: 9 },
    { header: 'الموبايل', key: 'phone', width: 14 },
    { header: 'نوع المتابعة', key: 'kind', width: 18 },
    { header: 'المطلوب', key: 'todo', width: 48 },
    { header: 'الأصناف', key: 'items', width: 22 },
    { header: 'المريض', key: 'patient', width: 10 },
    { header: 'الميعاد', key: 'due', width: 11 },
    { header: 'الدكتور', key: 'doctor', width: 14 },
    { header: 'كلام الدكتور', key: 'body', width: 44 },
    { header: 'المهمة', key: 'task', width: 20 },
  ];
  const day = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
  for (const r of rows) {
    const todo = (r.brief ?? '').split('\n')[0].replace(/^[^:]+:\s*/, '');
    const row = ws.addRow({
      day: new Date(r.sent_at).toLocaleDateString('en-GB', { timeZone: 'Africa/Cairo' }),
      branch: r.branch.replace('فرع ', ''),
      name: r.customer_name ?? '',
      code: r.customer_code ?? '',
      phone: r.customer_phone ?? '',
      kind: (r.kind ? FOLLOWUP_KINDS[r.kind] : 'متابعة') + (r.urgent ? ' (ضروري)' : ''),
      todo,
      items: (r.items ?? []).join('، '),
      patient: r.patient ?? '',
      due: day(r.due_date) || 'في أقرب وقت',
      doctor: r.doctor,
      body: r.body,
      task: r.task_date
        ? `${r.result ? 'اتعملت' : 'في شيت'} ${day(r.task_date)}${r.assigned_name ? ` على ${r.assigned_name}` : ''}`
        : r.customer_code || r.customer_phone
          ? 'أقدم من ٣ أيام'
          : 'محتاجة كود',
    });
    row.alignment = { vertical: 'top', wrapText: true, readingOrder: 'rtl' };
    if (r.urgent) row.getCell('kind').font = { bold: true, color: { argb: 'FFB91C1C' } };
  }
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
  head.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  head.height = 24;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };

  const sum = wb.addWorksheet('حسب النوع', { views: [{ rightToLeft: true }] });
  sum.columns = [
    { header: 'نوع المتابعة', key: 'kind', width: 24 },
    { header: 'عدد الحالات', key: 'n', width: 12 },
    { header: 'اتعملت', key: 'done', width: 10 },
  ];
  const by = new Map<string, { n: number; done: number }>();
  for (const r of rows) {
    const k = r.kind ? FOLLOWUP_KINDS[r.kind] : 'متابعة';
    const e = by.get(k) ?? { n: 0, done: 0 };
    e.n += 1;
    if (r.result) e.done += 1;
    by.set(k, e);
  }
  [...by.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .forEach(([kind, e]) => sum.addRow({ kind, ...e }));
  sum.getRow(1).font = { bold: true };

  const info = wb.addWorksheet('عن الملف', { views: [{ rightToLeft: true }] });
  info.getColumn(1).width = 90;
  info.addRow([title]).font = { bold: true, size: 13 };
  info.addRow([
    '«المطلوب» و«نوع المتابعة» و«الميعاد» السيستم فهمهم من كلام الدكتور والبنت راجعتهم وقت الرفع.',
  ]);
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** The messages of a file that were saved before, so only the new ones are shown and sent. */
export async function knownFingerprints(
  kind: 'followups' | 'requests',
  fingerprints: string[]
): Promise<Set<string>> {
  const known = new Set<string>();
  for (let i = 0; i < fingerprints.length; i += 2000) {
    const { data, error } = await supabase.rpc('dawaa_cs_group_known_v1', {
      p_kind: kind,
      p_fingerprints: fingerprints.slice(i, i + 2000),
    });
    if (error) fail(error, 'تعذّر مقارنة الرسايل باللي اتسجل');
    for (const fp of (data ?? []) as string[]) known.add(fp);
  }
  return known;
}
