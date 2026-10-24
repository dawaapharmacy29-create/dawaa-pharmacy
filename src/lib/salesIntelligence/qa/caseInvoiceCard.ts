// Case Invoice Card — one reviewer-facing projection of the invoice INSIDE the selected case.
//
// Pure: it reads only what the case page already loaded (persisted case view, persisted
// attribution/outcome, the invoice header and its recorded lines, the source row). It never
// decides attribution, never writes, and never copies invoice data anywhere. Three verdicts stay
// separate and none implies another:
//   1. does the invoice belong to this case (persisted attribution / human link),
//   2. did the customer give a final order confirmation in this case (conversation fact),
//   3. was each invoice line asked for in this case (conversation evidence per line),
//   4. was the order delivered (never proven here: no delivery evidence source exists),
//   5. the invoice's transaction branch versus this case's branch and the source branch.
// A proven invoice can make the sale countable; it never proves 2, 3 or 4.
import type { CaseIntelligenceView } from '../types';
import { caseBranchFact } from './caseIntelligencePresentation';
import type { QaCaseDetailBundle } from './queries';

/**
 * explicit: the customer named the item; staff_confirmed: the doctor named it and the customer
 * answered/confirmed it. A matching code and quantity never changes WHO named the item.
 */
export type InvoiceLineConversationMatch =
  | 'explicit'
  | 'staff_confirmed'
  | 'partial'
  | 'unresolved'
  | 'invoice_only';

export const INVOICE_LINE_MATCH_LABELS: Record<InvoiceLineConversationMatch, string> = {
  explicit: 'مذكور صراحة',
  staff_confirmed: 'أكده العميل بعد عرض الدكتور',
  partial: 'تطابق جزئي',
  unresolved: 'غير محسوم',
  invoice_only: 'موجود بالفاتورة فقط',
};

export interface CaseInvoiceCardLine {
  id: string;
  lineNo: number | null;
  /** Product name exactly as recorded on the invoice. */
  productName: string;
  productCode: string | null;
  quantity: number | null;
  returnedQuantity: number | null;
  effectiveQuantity: number | null;
  unitName: string | null;
  /** Unit price recorded on the invoice line (historical), never the current catalog price. */
  unitPrice: number | null;
  grossLineAmount: number | null;
  itemDiscountAmount: number | null;
  netLineAmount: number | null;
  match: InvoiceLineConversationMatch;
  matchLabel: string;
  /** Arabic explanation of why the line got its match state. */
  evidence: string;
  evidenceMessageIds: string[];
}

export interface CaseInvoiceCard {
  available: boolean;
  /** Arabic reason when no invoice can be shown for this case. */
  unavailableReason: string | null;
  customer: {
    code: string | null;
    analyticCustomerId: string | null;
    analyticStatusLabel: string;
    sourceLinkLabel: string;
    invoiceLinkLabel: string;
  };
  invoice: {
    id: string | null;
    number: string | null;
    transactionBranch: string | null;
    sourceBranch: string | null;
    caseBranchLabel: string;
    sellerName: string | null;
    sellerResolutionLabel: string;
    caseDoctors: Array<{ staffId: string | null; name: string; messageCount: number }>;
    sellerVsCaseLabel: string;
    invoiceAtLocal: string | null;
    caseWindowLocal: string | null;
    timeZoneLabel: string;
    headerTotal: number | null;
    linesNetTotal: number | null;
    bconnectInvoiceNet: number | null;
    totalsLabel: string;
  };
  verdicts: {
    invoiceBelongsToCase: string;
    customerFinalConfirmation: string;
    lineRequests: string;
    delivery: string;
    branch: string;
    /** What the persisted outcome counts, and what that does NOT mean. */
    counting: string;
  };
  lines: CaseInvoiceCardLine[];
  counts: Record<InvoiceLineConversationMatch, number>;
}

const CAIRO = 'Africa/Cairo';

function cairo(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: CAIRO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function cairoOffsetLabel(value: string | null | undefined): string {
  const date = value ? new Date(value) : new Date();
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: CAIRO, timeZoneName: 'shortOffset' })
      .formatToParts(Number.isNaN(date.getTime()) ? new Date() : date)
      .find((p) => p.type === 'timeZoneName')?.value;
    return `توقيت القاهرة (${part ?? 'Africa/Cairo'})`;
  } catch {
    return 'توقيت القاهرة (Africa/Cairo)';
  }
}

const sameCode = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase());

const MENTION_LABEL: Record<string, string> = {
  customer_explicit: 'العميل ذكره صراحة',
  staff_restatement: 'أعاد الدكتور ذكره وردّ العميل عليه',
  inferred: 'استنتاج من المحرك وليس تصريحًا من العميل',
};

type ViewProduct = CaseIntelligenceView['products'][number];

function classifyLine(
  item: QaCaseDetailBundle['invoiceItemFacts'][number],
  products: ViewProduct[],
  candidateLinesByProduct: Map<string, number>
): Pick<CaseInvoiceCardLine, 'match' | 'evidence' | 'evidenceMessageIds'> {
  // 1. A case product whose persisted invoice line is this exact invoice line.
  for (const product of products) {
    const line = product.invoiceLine;
    if (!line) continue;
    const sameLine =
      sameCode(line.invoiceProductCode, item.productCode) ||
      (!line.invoiceProductCode && line.invoiceProductNameRaw === item.productName);
    if (!sameLine) continue;
    const who = MENTION_LABEL[product.mentionSource ?? ''] ?? 'مصدر الذكر غير محدد';
    const ids = product.evidenceMessageIds ?? [];
    // An unresolved pack/strength (more than one catalog candidate) is never a complete match.
    const packUnresolved = (product.catalogCandidates?.length ?? 0) > 1;
    const identityAndQuantityAgree =
      (line.matchedBy === 'product_id' || line.matchedBy === 'product_code') &&
      line.quantityAgrees === true &&
      !packUnresolved;
    const same = `نفس ${line.matchedBy === 'product_id' ? 'المنتج في الكتالوج' : 'كود الصنف'} والكمية ${line.caseQuantity} = ${line.invoiceQuantity}`;
    // Who named the item decides the badge; the code/quantity agreement is reported, not promoted.
    if (identityAndQuantityAgree && product.mentionSource === 'customer_explicit') {
      return {
        match: 'explicit',
        evidence: `«${product.productNameRaw}» — ${who}؛ ${same}.`,
        evidenceMessageIds: ids,
      };
    }
    if (identityAndQuantityAgree && product.mentionSource === 'staff_restatement') {
      return {
        match: 'staff_confirmed',
        evidence: `«${product.productNameRaw}» — ذكره الدكتور وأكده العميل، وليس طلبًا بدأه العميل؛ ${same}.`,
        evidenceMessageIds: ids,
      };
    }
    const why = identityAndQuantityAgree
      ? `${same}، لكن لا يوجد تصريح من العميل بهذا الصنف`
      : packUnresolved
        ? 'التركيز/العبوة غير محسومة من النص'
        : line.matchedBy === 'name'
          ? 'التطابق بالاسم فقط وليس بكود الصنف'
          : line.quantityAgrees === false
            ? `الكمية في المحادثة ${line.caseQuantity} مقابل ${line.invoiceQuantity} بالفاتورة`
            : 'الكمية غير محسومة في المحادثة';
    return {
      match: 'partial',
      evidence: `«${product.productNameRaw}» — ${who}؛ ${why}.`,
      evidenceMessageIds: ids,
    };
  }
  // 2. An unresolved case mention whose canonical catalog candidates include this line.
  for (const product of products) {
    if (product.productId || !product.catalogCandidates?.length) continue;
    const isCandidate = product.catalogCandidates.some(
      (candidate) =>
        (item.productId && candidate.productId === item.productId) ||
        sameCode(candidate.productCode, item.productCode)
    );
    if (!isCandidate) continue;
    const ids = product.evidenceMessageIds ?? [];
    const names = product.catalogCandidates.map((candidate) => candidate.name).join(' / ');
    if ((candidateLinesByProduct.get(product.productKey) ?? 0) > 1) {
      return {
        match: 'unresolved',
        evidence: `«${product.productNameRaw}» قد يكون أكثر من بند في هذه الفاتورة (${names})؛ لا يمكن تحديد البند من المحادثة.`,
        evidenceMessageIds: ids,
      };
    }
    const qty = product.requestedQuantity ?? product.finalQuantity ?? null;
    const qtyText =
      qty == null || item.quantity == null
        ? 'الكمية غير محسومة'
        : qty === item.quantity
          ? `الكمية ${qty} متوافقة`
          : `الكمية ${qty} في المحادثة مقابل ${item.quantity} بالفاتورة`;
    return {
      match: 'partial',
      evidence: `«${product.productNameRaw}» يطابق اسم الصنف لكن التركيز/العبوة غير محسومة من النص (المرشحون: ${names})؛ ${qtyText}.`,
      evidenceMessageIds: ids,
    };
  }
  return {
    match: 'invoice_only',
    evidence:
      'لا يوجد ذكر لهذا الصنف في رسائل هذه الحالة؛ مسجل بالفاتورة فقط ولا يُنسب لطلب العميل.',
    evidenceMessageIds: [],
  };
}

function belongsVerdict(input: CaseInvoiceCardInput): string {
  const level = input.attribution?.attributionLevel ?? null;
  if (input.humanLinkConfirmed) return 'ربط الفاتورة بالحالة معتمد بشريًا.';
  if (level === 'proven') {
    return input.automaticProofRule
      ? 'الفاتورة مرتبطة بالحالة بقاعدة الإثبات الآلية المعتمدة (كود العميل + الاسم + توقيت قريب جدًا + صنف وكمية مطابقان، دون تعارض) — ليس اعتمادًا بشريًا.'
      : 'الفاتورة مرتبطة بالحالة برابط موثوق.';
  }
  if (level === 'strongly_inferred' || level === 'weakly_inferred') {
    return 'الفاتورة مرشحة لهذه الحالة فقط — لم يُثبت ربطها ولم يُعتمد بشريًا.';
  }
  return 'لا توجد فاتورة مرتبطة بهذه الحالة.';
}

export interface CaseInvoiceCardInput {
  view: CaseIntelligenceView | null;
  attribution: {
    attributionLevel: string | null;
    selectedInvoiceId: string | null;
    selectedInvoiceNumber: string | null;
    isOfficialForStaffEvaluation?: boolean | null;
  } | null;
  /** Rule ids of the persisted attribution, to tell an automatic proof from a trusted link. */
  automaticProofRule: boolean;
  humanLinkConfirmed: boolean;
  outcome: {
    isOrderConfirmed: boolean | null;
    saleProofState: string;
    isSaleCountable?: boolean | null;
    isRevenueCountable?: boolean | null;
  } | null;
  invoice: QaCaseDetailBundle['candidateInvoice'];
  items: QaCaseDetailBundle['invoiceItemFacts'];
  invoiceStaff: QaCaseDetailBundle['invoiceStaffTruth'];
  source: { branch: string | null; customerId: string | null; customerCode: string | null } | null;
  /** identity_customer_id persisted on the selected analysis (analysis-time resolution). */
  analysisCustomerId: string | null;
}

export function buildCaseInvoiceCard(input: CaseInvoiceCardInput): CaseInvoiceCard {
  const view = input.view;
  const products = view?.products ?? [];
  const invoice = input.invoice;
  const items = input.items;

  // How many lines of THIS invoice each unresolved mention could be.
  const candidateLinesByProduct = new Map<string, number>();
  for (const product of products) {
    if (product.productId || !product.catalogCandidates?.length) continue;
    const n = items.filter((item) =>
      product.catalogCandidates!.some(
        (candidate) =>
          (item.productId && candidate.productId === item.productId) ||
          sameCode(candidate.productCode, item.productCode)
      )
    ).length;
    candidateLinesByProduct.set(product.productKey, n);
  }

  const lines: CaseInvoiceCardLine[] = items.map((item) => {
    const classified = classifyLine(item, products, candidateLinesByProduct);
    return {
      id: item.id,
      lineNo: item.lineNo,
      productName: item.productName,
      productCode: item.productCode,
      quantity: item.quantity,
      returnedQuantity: item.returnedQuantity,
      effectiveQuantity: item.effectiveQuantity,
      unitName: item.unitName,
      unitPrice: item.unitPrice,
      grossLineAmount: item.grossLineAmount,
      itemDiscountAmount: item.itemDiscountAmount,
      netLineAmount: item.netLineAmount,
      ...classified,
      matchLabel: INVOICE_LINE_MATCH_LABELS[classified.match],
    };
  });
  const counts = { explicit: 0, staff_confirmed: 0, partial: 0, unresolved: 0, invoice_only: 0 } as Record<
    InvoiceLineConversationMatch,
    number
  >;
  for (const line of lines) counts[line.match] += 1;

  const code =
    view?.customer.customerCode ?? input.source?.customerCode ?? invoice?.customerCode ?? null;
  const analyticCustomerId = input.analysisCustomerId ?? view?.customer.customerId ?? null;
  const identityStatus =
    view?.customer.identityStatus ?? (analyticCustomerId ? 'resolved' : 'not_provided');
  // Durable customer_id links actually saved on the conversation record and on the invoice.
  const persistedIds = [input.source?.customerId ?? null, invoice?.customerId ?? null].filter(
    (id): id is string => Boolean(id)
  );
  const customer = {
    code,
    analyticCustomerId,
    analyticStatusLabel:
      identityStatus === 'resolved' && analyticCustomerId
        ? persistedIds.some((id) => id !== analyticCustomerId)
          ? `تعارض: العميل المحدد تحليليًا بالكود ${code ?? '—'} يختلف عن customer_id المحفوظ — يحتاج مراجعة.`
          : persistedIds.length === 2
            ? `العميل محدد بالكود ${code ?? '—'}، وسجل المحادثة والفاتورة مربوطان رسميًا بنفس سجل العميل.`
            : persistedIds.length === 1
              ? `العميل محدد بالكود ${code ?? '—'}، ومربوط رسميًا في ${input.source?.customerId ? 'سجل المحادثة' : 'الفاتورة'} فقط.`
              : `سجل العميل موجود وحُدد تحليليًا بالكود ${code ?? '—'} (حل تحليلي، ليس ربطًا محفوظًا).`
        : identityStatus === 'ambiguous'
          ? 'هوية العميل ملتبسة (أكثر من سجل) — لا يُختار سجل.'
          : identityStatus === 'contradicted'
            ? 'أدلة هوية العميل متعارضة — تحتاج مراجعة.'
            : 'لم يُحدد سجل عميل لهذه الحالة.',
    sourceLinkLabel: input.source?.customerId
      ? 'سجل المحادثة مربوط رسميًا بالعميل (customer_id محفوظ).'
      : 'سجل المحادثة غير مربوط رسميًا بالعميل (customer_id فارغ).',
    invoiceLinkLabel: !invoice
      ? '—'
      : invoice.customerId
        ? 'الفاتورة مربوطة رسميًا بسجل عميل (customer_id محفوظ).'
        : 'الفاتورة تحمل كود العميل فقط؛ لا يوجد customer_id محفوظ عليها.',
  };

  const caseDoctors = (view?.ownership?.contributions ?? [])
    .filter((c) => c.function === 'pharmacist')
    .map((c) => ({
      staffId: c.staffId,
      name: c.name ?? 'دكتور غير محسوم',
      messageCount: c.messageIds.length,
    }));
  const sellerId = input.invoiceStaff?.canonicalStaffId ?? null;
  const sellerName =
    input.invoiceStaff?.canonicalStaffName ||
    input.invoiceStaff?.invoiceStaffNameRaw ||
    invoice?.staffName ||
    null;
  const sellerResolutionLabel = !input.invoiceStaff
    ? sellerName
      ? 'اسم البائع كما هو على الفاتورة'
      : 'لا يوجد بائع على الفاتورة'
    : input.invoiceStaff.resolutionStatus === 'resolved_by_staff_id'
      ? 'محدد برقم الموظف على الفاتورة'
      : input.invoiceStaff.resolutionStatus === 'resolved_by_unique_name'
        ? 'محدد بتطابق اسم وحيد في دليل الموظفين'
        : input.invoiceStaff.resolutionStatus === 'ambiguous_name'
          ? 'الاسم يطابق أكثر من موظف — غير محسوم'
          : 'غير محسوم';
  const sellerVsCaseLabel = !caseDoctors.length
    ? 'لا يوجد دكتور منسوب لرسائل هذه الحالة.'
    : sellerId && caseDoctors.some((d) => d.staffId === sellerId)
      ? 'بائع الفاتورة هو نفس الدكتور المنسوب لرسائل هذه الحالة (من تعريفه داخل الحالة، وليس من الفاتورة).'
      : 'الدكتور المنسوب للحالة من رسائلها؛ بائع الفاتورة لا يُستخدم لإسناد الرسائل.';

  const branchFact = view ? caseBranchFact(view) : null;
  const caseBranchLabel = !branchFact
    ? 'غير محسوم'
    : `${branchFact.label === 'القسم' ? `${branchFact.value} (قسم وليس فرعًا)` : branchFact.value}${branchFact.hint ? ` — ${branchFact.hint}` : ''}`;

  const linesNetTotal =
    items.length && items.every((i) => i.netLineAmount != null)
      ? Number(items.reduce((sum, i) => sum + (i.netLineAmount ?? 0), 0).toFixed(2))
      : null;
  const bconnectInvoiceNet =
    items.find((i) => i.bconnectInvoiceNetAmount != null)?.bconnectInvoiceNetAmount ?? null;
  const headerTotal = invoice?.total ?? null;
  const totals = [headerTotal, linesNetTotal, bconnectInvoiceNet].filter(
    (v): v is number => v != null
  );
  const totalsLabel =
    totals.length < 2
      ? 'لا يوجد مصدر ثانٍ للمقارنة.'
      : totals.every((v) => Math.abs(v - totals[0]) <= 0.02)
        ? 'إجمالي رأس الفاتورة ومجموع صافي البنود متطابقان.'
        : 'يوجد فرق بين إجمالي رأس الفاتورة ومجموع البنود — يُعرض كما هو للمراجعة.';

  const startedAt = view?.interaction.startedAt ?? null;
  const endedAt = view?.interaction.endedAt ?? null;
  const orderConfirmed = input.outcome?.isOrderConfirmed;
  const proven = input.outcome?.saleProofState === 'proven';
  const counted = input.outcome?.isSaleCountable === true || input.outcome?.isRevenueCountable === true;
  const official = input.attribution?.isOfficialForStaffEvaluation;
  const counting = counted
    ? `البيع${input.outcome?.isRevenueCountable ? ' والإيراد' : ''} محسوب${input.outcome?.isRevenueCountable ? 'ان' : ''} من إثبات ربط الفاتورة بهذه الحالة فقط${official == null ? '' : official ? ' (معلّم رسميًا لتقييم الموظف)' : ' (غير رسمي لتقييم الموظف)'}. هذا لا يعني تأكيد العميل النهائي ولا التسليم ولا أن كل بنود الفاتورة طُلبت.`
    : proven
      ? 'الفاتورة مثبتة للحالة لكن البيع غير محسوب في النتيجة المحفوظة.'
      : 'لا يُحتسب بيع أو إيراد لهذه الحالة: لا توجد فاتورة مثبتة لها.';
  const transactionBranch = invoice?.branch ?? null;
  const branchVerdict = `فرع المعاملة بالفاتورة: ${transactionBranch ?? 'غير متاح'} • ${branchFact?.label ?? 'فرع الحالة'}: ${branchFact?.value ?? 'غير محسوم'} • فرع مصدر المحادثة: ${input.source?.branch ?? 'غير متاح'} (لا يتغير بالفاتورة).`;

  return {
    available: Boolean(invoice),
    unavailableReason: invoice
      ? null
      : input.attribution?.selectedInvoiceId
        ? 'تعذر قراءة رأس الفاتورة المختارة.'
        : 'لا توجد فاتورة مرشحة أو مرتبطة بهذه الحالة.',
    customer,
    invoice: {
      id: invoice?.id ?? null,
      number: invoice?.invoiceNumber ?? input.attribution?.selectedInvoiceNumber ?? null,
      transactionBranch: invoice?.branch ?? null,
      sourceBranch: input.source?.branch ?? null,
      caseBranchLabel,
      sellerName,
      sellerResolutionLabel,
      caseDoctors,
      sellerVsCaseLabel,
      invoiceAtLocal: cairo(invoice?.invoiceDatetime),
      caseWindowLocal: startedAt ? `${cairo(startedAt)} ← ${cairo(endedAt) ?? '—'}` : null,
      timeZoneLabel: cairoOffsetLabel(invoice?.invoiceDatetime ?? startedAt),
      headerTotal,
      linesNetTotal,
      bconnectInvoiceNet,
      totalsLabel,
    },
    verdicts: {
      invoiceBelongsToCase: belongsVerdict(input),
      lineRequests: items.length
        ? `${counts.explicit} مذكور صراحة من العميل، ${counts.staff_confirmed} أكده العميل بعد عرض الدكتور، ${counts.partial} تطابق جزئي، ${counts.unresolved} غير محسوم، ${counts.invoice_only} بالفاتورة فقط. ربط الفاتورة بالحالة لا يعني أن كل بنودها طُلبت في المحادثة.`
        : 'بنود الفاتورة غير متاحة للمقارنة.',
      customerFinalConfirmation:
        orderConfirmed === true
          ? 'أكد العميل الطلب النهائي في رسائل هذه الحالة.'
          : orderConfirmed === false
            ? 'لا توجد رسالة تأكيد نهائي من العميل في هذه الحالة؛ إثبات الفاتورة لا يعوّضها.'
            : 'تأكيد العميل النهائي غير مسجل في التحليل المحفوظ.',
      delivery: 'غير مثبت — «تم الإرسال» لا تثبت التسليم، ولا تثبته الفاتورة.',
      branch: branchVerdict,
      counting,
    },
    lines,
    counts,
  };
}
