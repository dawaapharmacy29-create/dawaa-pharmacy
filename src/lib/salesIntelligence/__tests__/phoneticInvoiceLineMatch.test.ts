import { describe, expect, it } from 'vitest';
import { findPhoneticInvoiceLine } from '@/lib/salesIntelligence/phoneticInvoiceLineMatch';

const lines = (...names: string[]) => names.map((productNameRaw) => ({ productNameRaw }));
const pick = (basket: string, invoice: ReturnType<typeof lines>) => findPhoneticInvoiceLine(basket, invoice)?.productNameRaw ?? null;

describe('phonetic invoice line match (same invoice only)', () => {
  it.each([
    ['لاكسيول', ['KETOFAN 50MG 30CAP', 'LAXEOL-PI 20 TAB'], 'LAXEOL-PI 20 TAB'],
    ['كيتوفان 50', ['KETOFAN 50MG 30CAP', 'LAXEOL-PI 20 TAB'], 'KETOFAN 50MG 30CAP'],
    ['نيكسكيور اطفال', ['SUPRAX 100MG SYRUP 60ML', 'NEXICURE 5 MG 28 SACHET', 'GAST-REG SYRUP', 'توصيل منزلي'], 'NEXICURE 5 MG 28 SACHET'],
    ['الليربان', ['ALLERBAN TAB'], 'ALLERBAN TAB'],
    ['اوتروفين', ['توصيل منزلي', 'OTRIVIN ADULT DROPS', 'clavimox 1 gm 12 tabs'], 'OTRIVIN ADULT DROPS'],
    ['برونشكم', ['BRONCHICUM ELIXIR', 'OXYMET INF DROPS'], 'BRONCHICUM ELIXIR'],
    ['كنت عاوزه جروزا', ['Groza tab'], 'Groza tab'],
    ['dantrelax', ['Daflon 1000 mg 30 tablets', 'dantrelax 25mg 30 caps', 'egycusate plus 30 tab'], 'dantrelax 25mg 30 caps'],
    ['perfectil', ['PERFECTIL HAIR EXTRA 60TAB', 'توصيل منزلي'], 'PERFECTIL HAIR EXTRA 60TAB'],
    ['ريجين فوم', ['REGAIN 5% FOAM', 'EPOETIN 4000 IU VIAL', 'SYRINGE 3 CM types'], 'REGAIN 5% FOAM'],
    ['دالتازون', ['deltasone 3 strips'], 'deltasone 3 strips'],
    ['مولبد البينك', ['MOLPED maxi EXTRA LONG 40 PCS'], 'MOLPED maxi EXTRA LONG 40 PCS'],
    ['لبن لاكتو مرحلة ٢', ['LACTO 2 MILK', 'توصيل منزلي', 'atla dk oral drops'], 'LACTO 2 MILK'],
  ])('%s → %s', (basket, invoice, expected) => {
    expect(pick(basket, lines(...invoice))).toBe(expected);
  });

  it.each([
    ['كام', ['Atomafutix 40 mg 30 Tabs', 'DIAMICRON 60 MR 30 TAB']],
    ['من ده', ['diaflozimet 5/1000 mg tab', 'QUITAPEX 25 MG 30 TAB']],
    ['كنت عاوزه اغير', ['BRADIPECT 5 MG TAB', 'توصيل منزلي']],
    ['اعرف سعره كام الاول', ['MOVENTOR TRIPLE ACTION 20 TAB', 'ALPHINTERN 30 TAB', 'HYFRESH DROPS', 'Glucophage 1000 mg XR 30 tab new']],
    ['<album message>', ['TOBRADEX OINT']],
    ['المضاد الحيوى دخ', ['XITHRONE 200MG SUSP 25ML']],
  ])('never invents a line for %s', (basket, invoice) => {
    expect(pick(basket, lines(...invoice))).toBeNull();
  });

  it('refuses when two lines of the invoice sound alike', () => {
    expect(pick('فولتارين', lines('VOLTAREN 6AMP', 'VOLTAREN EMULGEL 25GM'))).toBeNull();
  });
});

describe('attribution engine uses the phonetic link for display only', () => {
  const invoice = {
    id: 'inv-1', invoice_number: '90001', customer_id: 'cust-1', customer_code: '501', customer_name: 'عميل',
    branch: 'فرع شكري', invoice_datetime: '2026-11-20T10:05:00.000Z',
  };
  const provider = {
    getItemsForInvoice: () => [
      { productNameRaw: 'KETOFAN 50MG 30CAP', productCode: '76209', quantity: 1 },
      { productNameRaw: 'LAXEOL-PI 20 TAB', productCode: '21247', quantity: 1 },
    ],
  };
  const ctx = (item: Record<string, unknown>) => ({
    caseId: 'case-1', customerId: 'cust-1', customerPhone: null, customerCode: '501', customerName: 'عميل',
    branchNameRaw: 'فرع شكري', caseStartedAt: '2026-11-20T10:00:00.000Z', caseEndedAt: '2026-11-20T10:10:00.000Z',
    commercialConfirmation: { caseId: 'case-1', basketId: 'b1', basketVersion: 1, summaryPresented: true, customerConfirmed: true, staffConfirmed: true, announcedTotalPresent: false, modificationAfterConfirmation: false, currentState: 'commercial_confirmation_complete', primaryMessageIds: [], ruleIds: [], confidence: { level: 'strongly_inferred', score: 0.85, ruleIds: [], evidence: [] }, needsHumanReview: false, humanReviewReasons: [] }, activeAnnouncedTotal: null, activeBasketValue: null,
    activeBasketItems: [{ productNameRaw: 'لاكسيول', quantity: 1, resolutionStatus: 'partially_proven', ...item }],
    knownStaffIds: [], legacyMatchedInvoiceId: null, legacyMatchedInvoiceNumber: null, trustedInvoiceId: null, trustedInvoiceNumber: null,
  }) as any;

  it('links «لاكسيول» to LAXEOL-PI without counting it as product proof or a mismatch', async () => {
    const { deriveSaleAttributionAssessment } = await import('@/lib/salesIntelligence/saleAttributionEngine');
    const phonetic = deriveSaleAttributionAssessment(ctx({}), [invoice], provider);
    const noEvidence = deriveSaleAttributionAssessment(ctx({ productNameRaw: '<album message>' }), [invoice], { getItemsForInvoice: () => 'unavailable' as const });
    expect(phonetic.selectedCandidate?.lineMatches).toEqual([
      expect.objectContaining({ invoiceProductCode: '21247', matchedBy: 'name_phonetic', quantityAgrees: true }),
    ]);
    expect(phonetic.selectedCandidate?.productMatch).toBe('unavailable');
    expect(phonetic.selectedCandidate?.productCoverage).toBe('unavailable');
    expect(phonetic.attributionLevel).toBe(noEvidence.attributionLevel);
    expect(phonetic.selectedCandidate?.confidenceAssessment.score).toBeCloseTo(noEvidence.selectedCandidate!.confidenceAssessment.score, 5);
  });

  it('keeps tied catalog candidates and carried codes out of the phonetic link', async () => {
    const { deriveSaleAttributionAssessment } = await import('@/lib/salesIntelligence/saleAttributionEngine');
    for (const item of [{ catalogCandidateCount: 2 }, { productCode: '99999' }, { productId: 'prod-x' }]) {
      const result = deriveSaleAttributionAssessment(ctx(item), [invoice], provider);
      expect(result.selectedCandidate?.lineMatches ?? [], JSON.stringify(item)).toEqual([]);
    }
  });
});
