import { supabase } from '@/supabaseClient';

// مراجعة الصبح لفريق خدمة العملاء (migration 20261125090000): فواتير مشتريات امبارح من ٩ لـ ٩، التحويلات بين الفرعين،
// وتقرير أخطاء التسجيل للمدير العام بس. الربط التلقائي بين الشراء والبيع في التحويلات هنا (pairTransfers) عشان يتختبر.

export const PURCHASE_PROBLEMS = {
  qty: 'الكمية أو الرصيد',
  price: 'السعر',
  wrong_supplier: 'مورد غلط',
  serial: 'رقم الفاتورة أو المسلسل غلط/ناقص',
  wrong_store: 'مخزن أو فرع غلط',
  value: 'إجمالي الفاتورة مختلف',
  other: 'حاجة تانية',
} as const;
export type PurchaseProblem = keyof typeof PURCHASE_PROBLEMS;

export const TRANSFER_PROBLEMS = {
  no_sale: 'مش متسجلة بيع في الفرع التاني',
  no_purchase: 'مش متسجلة شراء عندنا',
  qty: 'صنف أو كمية مختلفة',
  value: 'القيمة مختلفة',
  other: 'حاجة تانية',
} as const;
export type TransferProblem = keyof typeof TRANSFER_PROBLEMS;

export function problemLabel(key: string): string {
  return (
    (PURCHASE_PROBLEMS as Record<string, string>)[key] ??
    (TRANSFER_PROBLEMS as Record<string, string>)[key] ??
    key
  );
}

/** What she corrected on the invoice; only the fields she changed are kept. */
export type PurchaseFix = {
  supplier_code?: string;
  supplier_name?: string;
  serial?: string;
  supplier_invoice_no?: string;
  store?: string;
  net?: number;
};

export type CheckStatus = 'ok' | 'fixed' | 'problem';

export type PurchaseCheck = {
  status: CheckStatus;
  problems: string[];
  fix: PurchaseFix;
  note: string | null;
  by: string | null;
  at: string;
};

export type PurchaseInvoice = {
  store: string;
  serial: string;
  invoice_at: string;
  supplier_code: string;
  supplier_name: string;
  supplier_invoice_no: string | null;
  items: number;
  net: number;
  payment: string | null;
  entered_by: string | null;
  note: string | null;
  check: PurchaseCheck | null;
  invoice_day?: string;
  branch?: string;
  /** Did whoever entered it write the BeeConnect serial by hand on the paper invoice? null = not answered yet. */
  paper_serial?: PaperSerial | null;
  returns_note?: string | null;
};

export type PaperSerial = 'yes' | 'no';

export type PurchaseDay = {
  day: string;
  branch: string;
  can_pick: boolean;
  from: string;
  to: string;
  uploads: Array<{ store: string; uploaded_at: string; last_invoice_at: string | null }>;
  invoices: PurchaseInvoice[];
  suppliers: Array<{ code: string; name: string }>;
};

export type TransferCheck = {
  status: 'ok' | 'problem';
  problems: string[];
  note: string | null;
  by: string | null;
  at: string;
  sale_invoice?: string | null;
  purchase_serial?: string | null;
};

export type TransferPurchase = {
  store: string;
  serial: string;
  invoice_at: string;
  supplier_name: string;
  supplier_invoice_no: string | null;
  items: number;
  net: number;
  entered_by: string | null;
  note: string | null;
  /** The invoice's items, when its purchases report was uploaded with them. */
  lines: TransferLine[];
  check: TransferCheck | null;
};

export type TransferLine = {
  code: string;
  name: string;
  qty: number;
  price: number;
  total: number;
};

export type TransferSale = {
  invoice: string;
  at: string;
  net: number;
  seller: string | null;
  lines: number;
  note: string | null;
  items: TransferLine[];
  check: TransferCheck | null;
};

export type TransferDay = {
  day: string;
  branch: string;
  sale_branch: string;
  can_pick: boolean;
  from: string;
  to: string;
  purchases: TransferPurchase[];
  sales: TransferSale[];
};

const ERRORS: Record<string, string> = {
  not_your_branch: 'الفاتورة دي مش في فرعك الشهر ده',
  unknown_invoice: 'الفاتورة مش موجودة',
  unknown_sale: 'رقم فاتورة البيع ده مش موجود في الفرع التاني',
  empty_fix: 'اكتبي التعديل الأول',
  no_problem: 'اختاري نوع المشكلة',
  pair_required: 'عشان تقولي «مطابق» لازم يكون فيه شراء وبيع مربوطين',
  sale_already_paired: 'فاتورة البيع دي مربوطة بفاتورة شراء خلاص',
  not_authorized: 'الصفحة دي للمدير العام بس',
  already_decided: 'اتاخد فيها قرار قبل كده',
  invalid_outcome: 'اختار نوع الخصم',
  unknown_staff: 'اختار الموظف اللي سجّل الفاتورة',
  invalid_paper_serial: 'اختاري «مكتوب» أو «مش مكتوب»',
};

function fail(error: { message?: string } | null, fallback: string): never {
  const message = String(error?.message || '');
  const known = Object.keys(ERRORS).find((key) => message.includes(key));
  if (/function .* does not exist|Could not find the function/i.test(message))
    throw new Error('الصفحة لسه مستنية تحديث قاعدة البيانات');
  throw new Error(known ? ERRORS[known] : message || fallback);
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const cleanInvoice = (i: PurchaseInvoice): PurchaseInvoice => ({
  ...i,
  net: num(i.net),
  items: num(i.items),
});

/** The purchase invoices of the 9am-to-9am window that ends on `day` (today when omitted). */
export async function loadPurchaseDay(
  branch: string | null,
  day: string | null = null
): Promise<PurchaseDay> {
  const { data, error } = await supabase.rpc('dawaa_cs_purchase_day_v1', {
    p_day: day,
    p_branch: branch,
  });
  if (error) fail(error, 'تعذّر تحميل فواتير امبارح');
  const d = data as PurchaseDay;
  return {
    ...d,
    invoices: (d.invoices ?? []).map(cleanInvoice),
    uploads: d.uploads ?? [],
    suppliers: d.suppliers ?? [],
  };
}

/** Serial, supplier invoice number, whoever entered it, or supplier, in her branch over the last 90 days. */
export async function searchPurchases(
  q: string,
  branch: string | null
): Promise<PurchaseInvoice[]> {
  const { data, error } = await supabase.rpc('dawaa_cs_purchase_search_v1', {
    p_q: q,
    p_branch: branch,
  });
  if (error) fail(error, 'تعذّر البحث');
  return ((data ?? []) as PurchaseInvoice[]).map(cleanInvoice);
}

export type PurchaseMark = {
  store: string;
  serial: string;
  paper_serial?: PaperSerial | null;
  returns_note?: string | null;
};

export async function savePurchaseMarks(rows: PurchaseMark[]): Promise<number> {
  const { data, error } = await supabase.rpc('dawaa_cs_purchase_marks_save_v1', { p_rows: rows });
  if (error) fail(error, 'تعذّر الحفظ');
  return num((data as { saved?: number } | null)?.saved);
}

export type BulkApproveResult = {
  approved: number;
  kept: number;
  skipped: Array<{ serial: string; why: string }>;
};

/** Approves the picked invoices that were not reviewed yet (corrected or flagged ones are kept as they are). */
export async function bulkApprovePurchases(
  rows: Array<{ store: string; serial: string }>,
  paperSerial: PaperSerial | null
): Promise<BulkApproveResult> {
  const { data, error } = await supabase.rpc('dawaa_cs_purchase_bulk_approve_v1', {
    p_rows: rows.map((r) => ({ store: r.store, serial: r.serial })),
    p_paper_serial: paperSerial,
  });
  if (error) fail(error, 'تعذّر الاعتماد');
  const d = (data ?? {}) as Partial<BulkApproveResult>;
  return { approved: num(d.approved), kept: num(d.kept), skipped: d.skipped ?? [] };
}

const arabicDigits = (v: string) => v.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

/** Filters the loaded invoices by a number (serial or supplier invoice) or a name (who entered it, or supplier). */
export function matchesPurchase(i: PurchaseInvoice, q: string): boolean {
  const query = arabicDigits(q.trim());
  if (!query) return true;
  if (/^\d+$/.test(query))
    return (
      i.serial.includes(query) ||
      (i.supplier_invoice_no ?? '').includes(query) ||
      (i.check?.fix?.serial ?? '').includes(query) ||
      (i.check?.fix?.supplier_invoice_no ?? '').includes(query)
    );
  const norm = (s: string | null | undefined) =>
    (s ?? '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ');
  const n = norm(query);
  return norm(i.entered_by).includes(n) || norm(i.supplier_name).includes(n);
}

export type PaperSerialPerson = {
  name: string;
  branches: string;
  invoices: number;
  checked: number;
  wrote: number;
  forgot: number;
};

export type PaperSerialReport = {
  from: string;
  to: string;
  people: PaperSerialPerson[];
  forgotten: Array<{
    store: string;
    serial: string;
    branch: string;
    day: string;
    supplier: string;
    net: number;
    who: string;
    by: string | null;
  }>;
  returns: Array<{
    store: string;
    serial: string;
    branch: string;
    day: string;
    supplier: string;
    net: number;
    who: string;
    note: string;
    by: string | null;
  }>;
};

/** For the general manager: per person who entered purchase invoices, how many had the serial written by hand. */
export async function loadPaperSerialReport(from: string, to: string): Promise<PaperSerialReport> {
  const { data, error } = await supabase.rpc('dawaa_cs_paper_serial_report_v1', {
    p_from: from,
    p_to: to,
  });
  if (error) fail(error, 'تعذّر تحميل تقرير المسلسل');
  const d = data as PaperSerialReport;
  return {
    ...d,
    people: (d.people ?? []).map((p) => ({
      ...p,
      invoices: num(p.invoices),
      checked: num(p.checked),
      wrote: num(p.wrote),
      forgot: num(p.forgot),
    })),
    forgotten: (d.forgotten ?? []).map((f) => ({ ...f, net: num(f.net) })),
    returns: (d.returns ?? []).map((f) => ({ ...f, net: num(f.net) })),
  };
}

/** Share of the answered invoices where the serial was written, as a whole percent; null before any answer. */
export function paperSerialRate(p: { checked: number; wrote: number }): number | null {
  return p.checked ? Math.round((p.wrote / p.checked) * 100) : null;
}

export async function savePurchaseCheck(input: {
  store: string;
  serial: string;
  status: CheckStatus;
  problems: string[];
  fix: PurchaseFix;
  note: string;
}) {
  const { error } = await supabase.rpc('dawaa_cs_purchase_check_save_v1', {
    p_store: input.store,
    p_serial: input.serial,
    p_status: input.status,
    p_problems: input.problems,
    p_fix: input.fix,
    p_note: input.note || null,
    p_day: null,
  });
  if (error) fail(error, 'تعذّر الحفظ');
}

export async function loadTransferDay(branch: string | null): Promise<TransferDay> {
  const { data, error } = await supabase.rpc('dawaa_cs_transfer_day_v1', {
    p_day: null,
    p_branch: branch,
  });
  if (error) fail(error, 'تعذّر تحميل التحويلات');
  return transferData(data as TransferDay);
}

const transferLine = (l: Partial<TransferLine>): TransferLine => ({
  code: String(l.code ?? ''),
  name: String(l.name ?? ''),
  qty: num(l.qty),
  price: num(l.price),
  total: num(l.total),
});

function transferData(d: TransferDay): TransferDay {
  return {
    ...d,
    purchases: (d.purchases ?? []).map((p) => ({
      ...p,
      net: num(p.net),
      items: num(p.items),
      lines: (p.lines ?? []).map(transferLine),
    })),
    sales: (d.sales ?? []).map((s) => ({
      ...s,
      net: num(s.net),
      lines: num(s.lines),
      items: (s.items ?? []).map(transferLine),
    })),
  };
}

/** The transfers into a branch over a period (at most two months), for the accuracy report. */
export async function loadTransferPeriod(
  from: string,
  to: string,
  branch: string | null
): Promise<TransferDay> {
  const { data, error } = await supabase.rpc('dawaa_cs_transfer_period_v1', {
    p_from: from,
    p_to: to,
    p_branch: branch,
  });
  if (error) fail(error, 'تعذّر تحميل التحويلات');
  return transferData(data as TransferDay);
}

export async function saveTransferCheck(input: {
  purchaseStore: string | null;
  purchaseSerial: string | null;
  saleInvoice: string | null;
  status: 'ok' | 'problem';
  problems: string[];
  note: string;
  branch: string;
}) {
  const { error } = await supabase.rpc('dawaa_cs_transfer_check_save_v1', {
    p_purchase_store: input.purchaseStore,
    p_purchase_serial: input.purchaseSerial,
    p_sale_invoice: input.saleInvoice,
    p_status: input.status,
    p_problems: input.problems,
    p_note: input.note || null,
    p_branch: input.branch,
    p_day: null,
  });
  if (error) fail(error, 'تعذّر الحفظ');
}

export type UncodedBuild = { added: number; carried: number; dropped: number };

/** Adds the uncoded customers from yesterday's notes, carries unfinished new customers over, drops ones already welcomed. */
export async function buildUncodedNoteTasks(): Promise<UncodedBuild> {
  const { data, error } = await supabase.rpc('dawaa_cs_uncoded_note_tasks_build_v1');
  if (error) fail(error, 'تعذّر تجهيز العملاء اللي مش متكودين');
  const d = (data ?? {}) as Partial<UncodedBuild>;
  return { added: num(d.added), carried: num(d.carried), dropped: num(d.dropped) };
}

// ---- الربط التلقائي ----

export type PairHow = 'saved' | 'number' | 'codes' | 'value_items' | 'value';
export type TransferPair = { purchase: TransferPurchase; sale: TransferSale; how: PairHow };
export type TransferPairing = {
  pairs: TransferPair[];
  purchasesOnly: TransferPurchase[];
  salesOnly: TransferSale[];
};

const same = (a: number, b: number) => Math.abs(a - b) <= 0.5;
/** Share of the item codes the purchase and the sale have in common (0 when the purchase has no items). */
export function sharedCodes(p: TransferPurchase, s: TransferSale): number {
  if (!p.lines.length || !s.items.length) return 0;
  const a = new Set(p.lines.map((l) => l.code));
  const b = new Set(s.items.map((l) => l.code));
  const both = [...a].filter((c) => b.has(c)).length;
  return both / Math.max(a.size, b.size);
}
const minutes = (a: string, b: string) =>
  Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 60000;

/**
 * Pairs each transfer purchase with the other branch's sale: what she saved first, then the sale number written as the
 * supplier invoice number, then the same value with the same number of lines, then the same value, nearest in time.
 * Each sale is used once.
 */
export function pairTransfers(
  purchases: TransferPurchase[],
  sales: TransferSale[]
): TransferPairing {
  const pairs: TransferPair[] = [];
  const used = new Set<string>();
  const open: TransferPurchase[] = [];
  const byInvoice = new Map(sales.map((s) => [s.invoice, s]));

  for (const p of purchases) {
    const saved = p.check?.sale_invoice ? byInvoice.get(p.check.sale_invoice) : undefined;
    if (saved && !used.has(saved.invoice)) {
      pairs.push({ purchase: p, sale: saved, how: 'saved' });
      used.add(saved.invoice);
    } else open.push(p);
  }
  // فاتورة شراء متسجل عليها «مش متسجلة بيع» مابتتربطش تلقائي.
  const stillOpen = open.filter((p) => !(p.check?.status === 'problem' && !p.check.sale_invoice));
  const keptAside = open.filter((p) => !stillOpen.includes(p));

  const rounds: Array<{ how: PairHow; match: (p: TransferPurchase, s: TransferSale) => boolean }> =
    [
      {
        how: 'number',
        match: (p, s) => !!p.supplier_invoice_no && p.supplier_invoice_no.trim() === s.invoice,
      },
      // أصناف الفاتورتين (لما تقرير المشتريات يترفع بالأصناف): أغلب الأكواد واحدة.
      { how: 'codes', match: (p, s) => sharedCodes(p, s) >= 0.6 },
      {
        how: 'value_items',
        match: (p, s) => same(p.net, s.net) && p.items > 0 && p.items === s.lines,
      },
      { how: 'value', match: (p, s) => same(p.net, s.net) },
    ];
  let remaining = stillOpen;
  for (const round of rounds) {
    const next: TransferPurchase[] = [];
    for (const p of remaining) {
      const candidates = sales
        .filter((s) => !used.has(s.invoice) && !s.check?.purchase_serial && round.match(p, s))
        .sort((a, b) => minutes(a.at, p.invoice_at) - minutes(b.at, p.invoice_at));
      const s = candidates[0];
      if (s) {
        pairs.push({ purchase: p, sale: s, how: round.how });
        used.add(s.invoice);
      } else next.push(p);
    }
    remaining = next;
  }
  return {
    pairs,
    purchasesOnly: [...remaining, ...keptAside],
    salesOnly: sales.filter((s) => !used.has(s.invoice)),
  };
}

/** A transfer row is done when it has a saved check: a confirmed pair or a recorded problem. */
export function transferProgress(pairing: TransferPairing) {
  const total = pairing.pairs.length + pairing.purchasesOnly.length + pairing.salesOnly.length;
  const done =
    pairing.pairs.filter(
      (x) => x.purchase.check && x.purchase.check.sale_invoice === x.sale.invoice
    ).length +
    pairing.purchasesOnly.filter((p) => p.check).length +
    pairing.salesOnly.filter((s) => s.check).length;
  return { total, done };
}

// ---- تقرير المدير ----

export const DEDUCTION_OUTCOMES = {
  mixup_unregistered: 'لغبطة أو عدم تسجيل (−١)',
  negligence: 'إهمال في الإدخال (−٢)',
  customer_problem: 'خطأ سبب مشكلة مع عميل (−٤)',
} as const;
export type DeductionOutcome = keyof typeof DEDUCTION_OUTCOMES;

export type DoctorError = {
  id: string;
  kind: 'purchase' | 'transfer';
  branch: string | null;
  day: string | null;
  label: string | null;
  net: number | null;
  responsible: string | null;
  responsible_staff_id: string | null;
  problems: string[];
  note: string | null;
  reported_by: string | null;
  reported_at: string;
  decision: 'pending' | 'deducted' | 'dismissed';
  outcome: string | null;
  points: number | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
};

export type DoctorErrorsReport = {
  from: string;
  to: string;
  rows: DoctorError[];
  staff: Array<{ id: string; name: string; branch: string | null }>;
};

export async function loadDoctorErrors(
  from: string | null,
  to: string | null
): Promise<DoctorErrorsReport> {
  const { data, error } = await supabase.rpc('dawaa_cs_doctor_errors_v1', {
    p_from: from,
    p_to: to,
  });
  if (error) fail(error, 'تعذّر تحميل التقرير');
  const d = data as DoctorErrorsReport;
  return { ...d, rows: d.rows ?? [], staff: d.staff ?? [] };
}

export async function decideDoctorError(
  id: string,
  outcome: DeductionOutcome | 'dismissed',
  staffId: string | null,
  note: string
) {
  const { error } = await supabase.rpc('dawaa_cs_doctor_error_decide_v1', {
    p_id: id,
    p_outcome: outcome,
    p_staff_id: staffId,
    p_note: note || null,
  });
  if (error) fail(error, 'تعذّر الحفظ');
}

/** One line per person who registered: how many invoices had a problem and which problems. */
export function summarizeByDoctor(rows: DoctorError[]) {
  const map = new Map<
    string,
    {
      name: string;
      invoices: number;
      pending: number;
      points: number;
      problems: Record<string, number>;
    }
  >();
  for (const r of rows) {
    if (r.decision === 'dismissed') continue;
    const name = r.responsible || 'مش معروف';
    const entry = map.get(name) ?? { name, invoices: 0, pending: 0, points: 0, problems: {} };
    entry.invoices += 1;
    if (r.decision === 'pending') entry.pending += 1;
    entry.points += Number(r.points || 0);
    for (const p of r.problems) entry.problems[p] = (entry.problems[p] ?? 0) + 1;
    map.set(name, entry);
  }
  return [...map.values()].sort((a, b) => b.invoices - a.invoices);
}
