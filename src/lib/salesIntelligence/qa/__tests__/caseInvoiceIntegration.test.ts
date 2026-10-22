import { describe, expect, it } from 'vitest';
import { readInvoiceItemCommercialMeta } from '../../../invoices/invoiceItemCommercialMeta';
import { buildInvoiceItemEvidenceProvider } from '../../invoiceItemEvidenceRepository';
import { fetchQaCaseDetail } from '../queries';
import { buildCaseInvoiceCard, type CaseInvoiceCardInput } from '../caseInvoiceCard';
import { createInMemorySupabase } from './inMemorySupabase.testkit';
import { fixtureTables } from './selectedCaseFixtures.testkit';

// The compact B-Connect import row exactly as Production stores it (synthetic values).
const COMPACT_RAW = {
  unit: 'علبة',
  expiry: '2029/06',
  returned: 1,
  gross_line: 368,
  source_row: 2122,
  invoice_net: 849,
  invoice_items: 10,
  line_discount: 4,
  line_discount_pct: 1,
};

describe('invoice line commercial fields — one reader for both stored shapes', () => {
  it('reads the importer object', () => {
    const meta = readInvoiceItemCommercialMeta({
      __dawaa_commercial: {
        returned_quantity: 1,
        gross_line_amount: 200,
        net_line_amount: 180,
        invoice_net_amount: 500,
        unit_name: 'شريط',
        allocated_invoice_discount_amount: 20,
      },
    });
    expect(meta).toMatchObject({
      format: 'dawaa_commercial',
      returnedQuantity: 1,
      grossLineAmount: 200,
      netLineAmount: 180,
      invoiceNetAmount: 500,
      unitName: 'شريط',
      allocatedInvoiceDiscountAmount: 20,
    });
  });

  it('reads the compact B-Connect row instead of dropping its discounts, returns and invoice net', () => {
    expect(readInvoiceItemCommercialMeta(COMPACT_RAW)).toMatchObject({
      format: 'compact_import',
      returnedQuantity: 1,
      grossLineAmount: 368,
      itemDiscountAmount: 4,
      itemDiscountPercent: 1,
      invoiceNetAmount: 849,
      unitName: 'علبة',
      expiryRaw: '2029/06',
      // Not stored in the compact shape: never derived.
      netLineAmount: null,
      allocatedInvoiceDiscountAmount: null,
      effectiveQuantity: null,
    });
    expect(readInvoiceItemCommercialMeta({ ...COMPACT_RAW, expiry: '.' }).expiryRaw).toBeNull();
    expect(readInvoiceItemCommercialMeta(null).format).toBe('none');
  });

  it("attribution evidence subtracts a compact row's returned quantity", () => {
    const provider = buildInvoiceItemEvidenceProvider(
      [{ id: 'inv-1', invoice_number: '1', branch: 'فرع شكري' } as any],
      [
        {
          id: 'l1',
          invoice_id: 'inv-1',
          invoice_number: '1',
          branch: 'فرع شكري',
          product_id: 'p1',
          product_code: 'C1',
          product_name: 'X',
          quantity: 2,
          unit_price: 184,
          line_total: 257.57,
          raw_data: COMPACT_RAW,
        },
      ]
    );
    const items = provider.getItemsForInvoice('inv-1', '1');
    expect(items).not.toBe('unavailable');
    expect((items as any[])[0]).toMatchObject({
      quantity: 1,
      returnedQuantity: 1,
      grossLineAmount: 368,
      netLineAmount: 257.57,
    });
  });
});

describe('case page invoice reader', () => {
  it('a failed invoice-line read fails the case read instead of showing "no imported lines"', async () => {
    const base = createInMemorySupabase(fixtureTables());
    const failing = {
      ...base,
      from(table: string) {
        if (table !== 'sales_invoice_items_v21') return base.from(table);
        const builder: any = new Proxy(
          {},
          {
            get: (_t, key) =>
              key === 'then'
                ? (resolve: any) => resolve({ data: null, error: { message: 'permission denied' } })
                : () => builder,
          }
        );
        return builder;
      },
    };
    await expect(fetchQaCaseDetail(failing as any, 'case-A')).rejects.toBeTruthy();
  });

  it('shows compact-row discounts, returns and the B-Connect invoice net on the case page', async () => {
    const tables = fixtureTables();
    tables.sales_invoice_items_v21[0] = {
      ...tables.sales_invoice_items_v21[0],
      raw_data: { ...COMPACT_RAW, invoice_net: 150 },
    };
    const bundle = await fetchQaCaseDetail(createInMemorySupabase(tables), 'case-A');
    const line = bundle!.invoiceItemFacts[0];
    expect(line).toMatchObject({
      returnedQuantity: 1,
      effectiveQuantity: 1,
      grossLineAmount: 368,
      itemDiscountAmount: 4,
      unitName: 'علبة',
      bconnectInvoiceNetAmount: 150,
    });
    // Historical line price, never the catalog price.
    expect(line.unitPrice).toBe(75);
  });
});

// ---- Card model -------------------------------------------------------------------------------
const line = (over: Record<string, unknown>) =>
  ({
    id: String(over.id),
    invoiceId: 'inv-1',
    invoiceNumber: '74938',
    lineNo: Number(over.lineNo ?? 1),
    productId: null,
    productCode: null,
    productName: 'X',
    quantity: 1,
    effectiveQuantity: 1,
    unitName: null,
    unitPrice: 10,
    itemDiscountAmount: 0,
    itemDiscountPercent: 0,
    allocatedInvoiceDiscountAmount: null,
    grossLineAmount: 10,
    netLineAmount: 10,
    returnedQuantity: 0,
    sellerName: null,
    staffId: null,
    staffName: null,
    catalogCurrentPrice: 999,
    pricingStatus: 'no_offer',
    effectiveUnitPrice: 10,
    quotedUnitPrice: null,
    quotedLineTotal: null,
    quotedPriceStatus: 'not_quoted',
    quotedPriceDifference: null,
    quotedPriceDifferencePercent: null,
    matchedOfferId: null,
    matchedOfferTitle: null,
    pricingNeedsReview: false,
    bconnectInvoiceNetAmount: null,
    headerInvoiceNetAmount: null,
    financialNetDifference: null,
    financialNetMatch: null,
    ...over,
  }) as any;

const product = (over: Record<string, unknown>) =>
  ({
    productKey: String(over.productKey ?? over.productNameRaw),
    productNameRaw: '',
    productId: null,
    productCode: null,
    canonicalName: null,
    roles: ['requested'],
    requestedQuantity: null,
    offeredQuantity: null,
    finalQuantity: null,
    availability: 'unknown',
    alternativeCount: 0,
    alternativeResponses: [],
    inFinalBasket: false,
    demandKey: null,
    lossOutcome: null,
    lossReason: null,
    followUpKeys: [],
    mentionSource: 'customer_explicit',
    quantitySource: 'customer',
    evidenceMessageIds: ['m1'],
    invoiceLine: null,
    ...over,
  }) as any;

function cardInput(over: Partial<CaseInvoiceCardInput> = {}): CaseInvoiceCardInput {
  const colona = product({
    productNameRaw: 'كولونا',
    requestedQuantity: 2,
    catalogCandidates: [
      { productId: 'p-c40', productCode: '81948', name: 'colona 40 tab' },
      { productId: 'p-c30', productCode: '57909', name: 'COLONA 30 TAB' },
    ],
  });
  const gastro = product({
    productNameRaw: 'جاسترو بيوتيك 550',
    productId: 'p-g550',
    productCode: '78994',
    mentionSource: 'staff_restatement',
    invoiceLine: {
      basketProductNameRaw: 'جاسترو بيوتيك 550',
      invoiceProductNameRaw: 'GASTROBIOTIC 550 MG 20 TAB',
      invoiceProductCode: '78994',
      matchedBy: 'product_id',
      caseQuantity: 1,
      invoiceQuantity: 1,
      quantityAgrees: true,
    },
  });
  const view: any = {
    products: [colona, gastro],
    customer: { customerId: 'cust-1', customerCode: '18663', identityStatus: 'resolved' },
    branch: {
      branchNameRaw: null,
      recommendation: {
        branch: 'فرع شكري',
        strength: 'decided',
        reasons: ['فرع فاتورة مرتبطة ومثبتة لهذه الحالة'],
      },
    },
    ownership: {
      contributions: [
        { staffId: null, name: null, function: 'unresolved', messageIds: ['s0'] },
        {
          staffId: 'staff-shebl',
          name: 'د محمد شبل',
          function: 'pharmacist',
          messageIds: ['s1', 's2'],
        },
        {
          staffId: 'staff-heba',
          name: 'هبه محمد',
          function: 'customer_service',
          messageIds: ['h1'],
        },
      ],
    },
    interaction: { startedAt: '2026-09-27T21:56:27Z', endedAt: '2026-09-27T22:28:43Z' },
  };
  return {
    view,
    attribution: {
      attributionLevel: 'proven',
      selectedInvoiceId: 'inv-1',
      selectedInvoiceNumber: '74938',
    },
    automaticProofRule: true,
    humanLinkConfirmed: false,
    outcome: { isOrderConfirmed: false, saleProofState: 'proven' },
    invoice: {
      id: 'inv-1',
      invoiceNumber: '74938',
      customerName: 'د ابراهيم',
      customerCode: '18663',
      customerId: null,
      branch: 'فرع شكري',
      staffName: 'د محمد شبل',
      invoiceDatetime: '2026-09-27T22:06:00Z',
      total: 849,
    },
    items: [
      line({
        id: 'l-ringer',
        lineNo: 1,
        productId: 'p-ringer',
        productCode: '16467',
        productName: 'RINGER SOLUTION INJECTION 500 ML.',
        netLineAmount: 22.4,
      }),
      line({
        id: 'l-c40',
        lineNo: 9,
        productId: 'p-c40',
        productCode: '81948',
        productName: 'colona 40 tab',
        quantity: 2,
        unitPrice: 184,
        netLineAmount: 257.57,
      }),
      line({
        id: 'l-g',
        lineNo: 10,
        productId: 'p-g550',
        productCode: '78994',
        productName: 'GASTROBIOTIC 550 MG 20 TAB',
        unitPrice: 344,
        netLineAmount: 569.03,
      }),
    ],
    invoiceStaff: {
      invoiceStaffIdRaw: null,
      invoiceStaffNameRaw: 'د محمد شبل',
      canonicalStaffId: 'staff-shebl',
      canonicalStaffName: 'د محمد شبل',
      canonicalStaffRole: 'صيدلاني',
      canonicalStaffBranch: 'فرع شكري',
      resolutionStatus: 'resolved_by_unique_name',
      itemEvidenceAvailable: true,
    },
    source: { branch: 'المخزن', customerId: null, customerCode: '18663' },
    analysisCustomerId: 'cust-1',
    ...over,
  };
}

describe('case invoice card', () => {
  it("classifies every recorded line against this case's conversation, with its evidence", () => {
    const card = buildCaseInvoiceCard(cardInput());
    const byCode = Object.fromEntries(card.lines.map((l) => [l.productCode, l]));
    expect(byCode['78994']).toMatchObject({ match: 'explicit', matchLabel: 'مذكور صراحة' });
    expect(byCode['78994'].evidence).toMatch(/أعاد الدكتور ذكره/);
    // «علبتين كولونا»: quantity agrees, strength/pack not settled by the text.
    expect(byCode['81948']).toMatchObject({ match: 'partial', matchLabel: 'تطابق جزئي' });
    expect(byCode['81948'].evidence).toMatch(/التركيز\/العبوة غير محسومة/);
    expect(byCode['81948'].evidence).toMatch(/الكمية 2 متوافقة/);
    // «تكرر المحلول» names no catalog product: the Ringer line stays invoice-only.
    expect(byCode['16467']).toMatchObject({
      match: 'invoice_only',
      matchLabel: 'موجود بالفاتورة فقط',
    });
    expect(card.counts).toEqual({ explicit: 1, partial: 1, unresolved: 0, invoice_only: 1 });
  });

  it('an ambiguous mention that could be two lines of the invoice stays unresolved for both', () => {
    const input = cardInput();
    input.items = [
      ...input.items,
      line({
        id: 'l-c30',
        lineNo: 11,
        productId: 'p-c30',
        productCode: '57909',
        productName: 'COLONA 30 TAB',
        quantity: 2,
      }),
    ];
    const card = buildCaseInvoiceCard(input);
    expect(card.lines.filter((l) => /colona/i.test(l.productName)).map((l) => l.match)).toEqual([
      'unresolved',
      'unresolved',
    ]);
  });

  it('a name-only or quantity-conflicting persisted match is partial, never explicit', () => {
    const input = cardInput();
    input.view!.products[1] = {
      ...input.view!.products[1],
      invoiceLine: { ...input.view!.products[1].invoiceLine, matchedBy: 'name' },
    };
    expect(buildCaseInvoiceCard(input).lines.find((l) => l.productCode === '78994')!.match).toBe(
      'partial'
    );
    input.view!.products[1] = {
      ...input.view!.products[1],
      invoiceLine: {
        ...input.view!.products[1].invoiceLine,
        matchedBy: 'product_id',
        caseQuantity: 2,
        quantityAgrees: false,
      },
    };
    const gastro = buildCaseInvoiceCard(input).lines.find((l) => l.productCode === '78994')!;
    expect(gastro.match).toBe('partial');
    expect(gastro.evidence).toMatch(/الكمية في المحادثة 2 مقابل 1/);
  });

  it('keeps analytic customer identity apart from a missing durable customer_id on the source and the invoice', () => {
    const { customer } = buildCaseInvoiceCard(cardInput());
    expect(customer.code).toBe('18663');
    expect(customer.analyticStatusLabel).toMatch(/حُدد تحليليًا بالكود 18663/);
    expect(customer.analyticStatusLabel).toMatch(/ليس ربطًا محفوظًا/);
    expect(customer.sourceLinkLabel).toMatch(/غير مربوط رسميًا/);
    expect(customer.invoiceLinkLabel).toMatch(/لا يوجد customer_id محفوظ/);
    const linked = buildCaseInvoiceCard(
      cardInput({ source: { branch: 'المخزن', customerId: 'cust-1', customerCode: '18663' } })
    ).customer;
    expect(linked.sourceLinkLabel).toMatch(/مربوط رسميًا بالعميل/);
  });

  it('shows the invoice branch as the transaction branch without replacing the source branch', () => {
    const { invoice } = buildCaseInvoiceCard(cardInput());
    expect(invoice.transactionBranch).toBe('فرع شكري');
    expect(invoice.sourceBranch).toBe('المخزن');
  });

  it("attributes messages from the case's own doctors, never from the invoice seller or customer service", () => {
    const { invoice } = buildCaseInvoiceCard(cardInput());
    expect(invoice.caseDoctors).toEqual([
      { staffId: 'staff-shebl', name: 'د محمد شبل', messageCount: 2 },
    ]);
    expect(invoice.sellerVsCaseLabel).toMatch(/من تعريفه داخل الحالة، وليس من الفاتورة/);
    const noDoctor = cardInput();
    noDoctor.view!.ownership!.contributions = [
      { staffId: 'staff-heba', name: 'هبه محمد', function: 'customer_service', messageIds: ['h1'] },
    ];
    expect(buildCaseInvoiceCard(noDoctor).invoice.caseDoctors).toEqual([]);
  });

  it('keeps the three verdicts separate: a linked invoice proves neither every line nor delivery', () => {
    const { verdicts } = buildCaseInvoiceCard(cardInput());
    expect(verdicts.invoiceBelongsToCase).toMatch(/قاعدة الإثبات الآلية المعتمدة/);
    expect(verdicts.invoiceBelongsToCase).toMatch(/ليس اعتمادًا بشريًا/);
    expect(verdicts.lineRequests).toMatch(/لا يعني أن كل بنودها طُلبت/);
    expect(verdicts.orderAndDelivery).toMatch(/التسليم: غير مثبت/);
    const candidate = buildCaseInvoiceCard(
      cardInput({
        attribution: {
          attributionLevel: 'weakly_inferred',
          selectedInvoiceId: 'inv-1',
          selectedInvoiceNumber: '74938',
        },
        automaticProofRule: false,
      })
    );
    expect(candidate.verdicts.invoiceBelongsToCase).toMatch(/مرشحة لهذه الحالة فقط/);
  });

  it('uses historical invoice amounts in Cairo time, never the current catalog price', () => {
    const card = buildCaseInvoiceCard(cardInput());
    expect(card.lines.find((l) => l.productCode === '81948')!.unitPrice).toBe(184);
    expect(JSON.stringify(card)).not.toContain('999');
    expect(card.invoice.timeZoneLabel).toMatch(/توقيت القاهرة/);
    expect(card.invoice.invoiceAtLocal).toMatch(/٠١:٠٦/);
    // 22.40 + 257.57 + 569.03 = 849.00 = header total.
    expect(card.invoice.totalsLabel).toBe('إجمالي رأس الفاتورة ومجموع صافي البنود متطابقان.');
    const differing = cardInput();
    differing.invoice = { ...differing.invoice!, total: 900 };
    expect(buildCaseInvoiceCard(differing).invoice.totalsLabel).toMatch(/يوجد فرق/);
  });

  it('explains in Arabic when there is no invoice for the case', () => {
    const card = buildCaseInvoiceCard(cardInput({ invoice: null, items: [], attribution: null }));
    expect(card.available).toBe(false);
    expect(card.unavailableReason).toBe('لا توجد فاتورة مرشحة أو مرتبطة بهذه الحالة.');
  });
});
