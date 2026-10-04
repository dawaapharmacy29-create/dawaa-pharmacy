import { describe, expect, it } from 'vitest';
import { buildWhatsAppCustomerCaseEngineV22 } from '@/lib/whatsappCustomerCaseEngineV22';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from '@/lib/whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';
import { deriveConversationCases } from '@/lib/salesIntelligence/conversationCaseEngine';
import { buildCaseBaskets } from '@/lib/salesIntelligence/caseBasketEngine';
import { deriveCommercialConfirmationState } from '@/lib/salesIntelligence/commercialConfirmationEngine';
import { runSalesIntelligencePipeline } from '@/lib/salesIntelligence/salesIntelligencePipeline';
import { buildCanonicalProduct, countNormalizedNames, type RawProductRow } from '@/lib/salesIntelligence/pharmacyProducts/canonicalProduct';
import { normalizePharmacyText } from '@/lib/salesIntelligence/pharmacyProducts/pharmacyNormalization';
import { buildPharmacyProductIndex, resolveProductMention } from '@/lib/salesIntelligence/pharmacyProducts/pharmacyProductResolverV2';

function msg(id: string, at: string, direction: 'inbound' | 'outbound', text: string, kind: WhatsAppParsedMessage['kind'] = 'text', mediaAvailable = false): WhatsAppParsedMessage {
  const timestamp = new Date(at);
  return {
    id,
    timestamp,
    rawTimestamp: at,
    sender: direction === 'inbound' ? 'عميل' : 'You',
    text,
    direction,
    kind,
    forwarded: false,
    raw: text,
    sourceFormat: 'txt',
    replyTo: null,
    mediaPlaceholder: kind !== 'text',
    mediaAvailable,
  };
}

function session(id: string, messages: WhatsAppParsedMessage[], staffNames: string[] = []): WhatsAppConversationSession {
  return {
    id,
    startedAt: messages[0].timestamp,
    endedAt: messages[messages.length - 1].timestamp,
    messages,
    participants: ['عميل', 'You'],
    outboundStaffNames: staffNames,
    customerName: 'عميل',
    mediaCount: messages.filter((m) => ['image', 'voice', 'video', 'document'].includes(m.kind)).length,
    missingMediaCount: messages.filter((m) => ['image', 'voice', 'video', 'document'].includes(m.kind) && !m.mediaAvailable).length,
    replyCount: 0,
    forwardedCount: 0,
  };
}

function assessFirstSalesCase(raw: string) {
  const sessions = splitWhatsAppSessions(parseWhatsAppExport(raw), 120);
  expect(sessions.length).toBeGreaterThan(0);
  const understanding = buildConversationUnderstandingV32(sessions[0]);
  const cases = deriveConversationCases({ understanding, conversationId: 'real-regression' });
  expect(cases.length).toBeGreaterThan(0);
  const interaction = understanding.interactions[0];
  const scoped = understanding.messages.filter((message) => interaction.messageIds.includes(message.id));
  const result = buildCaseBaskets(cases[0].caseId, scoped);
  const assessment = deriveCommercialConfirmationState(
    cases[0].caseId,
    result.baskets,
    result.summaryEvents,
    result.customerConfirmationEvents,
    result.staffFinalConfirmationEvents
  );
  return { ...result, assessment };
}

function crossScriptRegressionIndex() {
  const rows: RawProductRow[] = [
    { id: 'hero-1', name: 'hero baby nutradefense plus 1', product_code: '72474', normalized_name: 'hero baby nutradefense plus 1', category: null, price: 385, source: 'catalog_import' },
    { id: 'hero-2', name: 'hero baby nutradefense plus 2', product_code: '73191', normalized_name: 'hero baby nutradefense plus 2', category: null, price: 385, source: 'catalog_import' },
    { id: 'hero-3', name: 'hero baby nutradefense 3 plus', product_code: '74976', normalized_name: 'hero baby nutradefense 3 plus', category: null, price: 385, source: 'catalog_import' },
    { id: 'hero-fruit-3', name: 'HERO BABY 3 FRUITS JAR', product_code: '47782', normalized_name: 'hero baby 3 fruits jar', category: null, price: 55, source: 'catalog_import' },
  ];
  const counts = countNormalizedNames(rows);
  return buildPharmacyProductIndex(rows.map((row) => buildCanonicalProduct(row, counts, normalizePharmacyText)));
}

describe('WhatsAppCustomerCaseEngineV22', () => {
  it('keeps failed order + feedback + apology in one recovery case', () => {
    const rows = [
      session('s1', [
        msg('m1', '2026-09-01T10:00:00', 'inbound', 'عاوز الطلب ده لو سمحت'),
        msg('m2', '2026-09-01T11:00:00', 'outbound', 'حاضر يا فندم'),
        msg('m3', '2026-09-01T14:00:00', 'inbound', 'الاوردر ماوصلش واتضايقت من التأخير'),
      ], ['د مي']),
      session('s2', [
        msg('m4', '2026-09-02T12:00:00', 'outbound', 'حابين نعرف كانت الخدمة على مستوى رضا حضرتك؟'),
      ], ['هبه']),
      session('s3', [
        msg('m5', '2026-09-03T12:00:00', 'outbound', 'بنعتذر لحضرتك عن التأخير وان الطلب ماوصلش'),
      ], ['هبة']),
    ];

    const result = buildWhatsAppCustomerCaseEngineV22(rows);
    expect(result.caseCount).toBe(1);
    expect(result.cases[0].state).toBe('recovery');
    expect(result.cases[0].sessionIds).toEqual(['s1', 's2', 's3']);
    expect(result.cases[0].recoveryAttempts).toBeGreaterThanOrEqual(2);
  });

  it('starts a new case when the customer returns later with a new order', () => {
    const rows = [
      session('s1', [
        msg('m1', '2026-08-01T10:00:00', 'inbound', 'عاوز الطلب'),
        msg('m2', '2026-08-01T14:00:00', 'inbound', 'الطلب ماوصلش'),
      ]),
      session('s2', [
        msg('m3', '2026-08-02T10:00:00', 'outbound', 'بنعتذر لحضرتك وهنعمل متابعة'),
      ]),
      session('s3', [
        msg('m4', '2026-08-25T10:00:00', 'inbound', 'محتاج اوردر جديد'),
        msg('m5', '2026-08-25T10:10:00', 'outbound', 'تم تأكيد الطلب وجاري الإرسال'),
      ]),
    ];

    const result = buildWhatsAppCustomerCaseEngineV22(rows);
    expect(result.caseCount).toBe(2);
    expect(result.cases[0].state).toBe('recovery');
    expect(result.cases[1].state).toBe('confirmed_order');
  });

  it('tracks missing media without pretending the content was understood', () => {
    const rows = [
      session('s1', [
        msg('m1', '2026-09-01T10:00:00', 'inbound', 'دي موجودة؟'),
        msg('m2', '2026-09-01T10:01:00', 'inbound', '<image omitted>', 'image', false),
        msg('m3', '2026-09-01T10:03:00', 'outbound', 'هراجع لحضرتك'),
      ]),
    ];
    const result = buildWhatsAppCustomerCaseEngineV22(rows);
    expect(result.mediaReferenced).toBe(1);
    expect(result.mediaAvailable).toBe(0);
    expect(result.mediaMissing).toBe(1);
    expect(result.mediaCoveragePercent).toBe(0);
    expect(result.cases[0].needsHumanReview).toBe(true);
    expect(result.analysisCoverageLabel).toContain('لا يتم تخمين');
  });

  it('normalizes spelling variants of the same short doctor name inside a case', () => {
    const rows = [
      session('s1', [
        msg('m1', '2026-09-01T10:00:00', 'inbound', 'محتاج صنف'),
        msg('m2', '2026-09-01T10:05:00', 'outbound', 'متاح'),
      ], ['د مي']),
      session('s2', [
        msg('m3', '2026-09-01T18:00:00', 'outbound', 'حابين نطمن على الطلب'),
      ], ['د مى']),
    ];
    const result = buildWhatsAppCustomerCaseEngineV22(rows);
    expect(result.caseCount).toBe(1);
    expect(result.cases[0].staffNames).toHaveLength(1);
  });

  it('closes a transfer followup once the pharmacy explicitly acknowledges receipt', () => {
    const rows = [
      session('payment', [
        msg('m1', '2026-09-28T02:52:09', 'outbound', 'اتفضل رقم التحويل يا فندم 01028308235 واستاذن حضرتك في صورة التحويل'),
        msg('m2', '2026-09-28T03:08:09', 'inbound', 'الحساب كام من فضلك'),
        msg('m3', '2026-09-28T03:08:36', 'outbound', '778 ان شاء الله'),
        msg('m4', '2026-09-28T03:09:45', 'inbound', '<image omitted>', 'image', false),
        msg('m5', '2026-09-28T03:10:40', 'outbound', 'وصل شكرا جزيلا'),
      ]),
    ];

    const result = buildWhatsAppCustomerCaseEngineV22(rows);
    expect(result.caseCount).toBe(1);
    expect(result.cases[0].type).toBe('followup');
    expect(result.cases[0].state).toBe('closed');
    expect(result.cases[0].nextAction).toBeNull();
  });
});

describe('Sales Intelligence real closing regressions', () => {
  it('recognizes Mohamed El Gendy natural recap, compact total, customer acceptance, and dispatch close', () => {
    const result = assessFirstSalesCase(`[9/26/26, 9:46:41 PM] Customer: عايزه من دا 4
[9/26/26, 9:50:02 PM] You: يعني كدا 4 علب لبن مع 2 نوع شراب اللي الدكتور بيقولهم في الريكورد
[9/26/26, 9:50:08 PM] You: مظبوط كدا ان شاء الله؟
[9/26/26, 9:50:12 PM] Customer: ايوا
[9/26/26, 9:50:25 PM] Customer: كدا هيبقا كام
[9/26/26, 9:50:44 PM] You: حالا هبلغ حضرتك
[9/26/26, 9:56:48 PM] You: 1579ج ان شاء الله
[9/26/26, 9:58:03 PM] Customer: تمام
[9/26/26, 10:01:12 PM] You: جاري الارسال`);

    expect(result.summaryEvents).toHaveLength(1);
    expect(result.baskets.at(-1)?.announcedTotal?.amount).toBe(1579);
    expect(result.customerConfirmationEvents).toHaveLength(1);
    expect(result.staffFinalConfirmationEvents).toHaveLength(1);
    expect(result.assessment.currentState).toBe('commercial_confirmation_complete');
  });

  it('does not manufacture a product identity from an unresolved media deictic such as العلبه دي', () => {
    const result = assessFirstSalesCase(`[9/27/26, 8:28:35 PM] Customer: لو سمحت يادكتور عايزه العلبه دي
[9/27/26, 8:28:37 PM] Customer: <image omitted>
[9/27/26, 8:30:00 PM] You: تحت امر حضرتك`);

    const activeBasket = result.baskets.at(-1);
    const items = activeBasket ? result.itemsByBasketId[activeBasket.basketId] ?? [] : [];
    expect(items.some((item) => ['دي', 'ده', 'دا'].includes(item.productNameRaw.trim()))).toBe(false);
  });
});

describe('Sales Intelligence cross-script product regressions', () => {
  it('promotes Hero Baby Nutradefense stage 3 only when two independent language clues and the stage number agree', () => {
    const result = resolveProductMention('عايز علبتين لبن هيرو بيبي نيوتروني دفنس 3', crossScriptRegressionIndex());

    expect(result.selected?.product.productId).toBe('hero-3');
    expect(result.selected?.basis).toBe('cross_script_composite');
    expect(result.selected?.confidence).toBe('strongly_inferred');
  });

  it('keeps a single cross-script clue weak even when a number is present', () => {
    const result = resolveProductMention('عايز نيوتروني دفنس 3', crossScriptRegressionIndex());

    expect(result.selected).toBeNull();
    expect(result.ambiguous).toBe(true);
    expect(result.candidates.some((candidate) => candidate.confidence === 'strongly_inferred')).toBe(false);
    expect(result.candidates.some((candidate) => candidate.basis === 'cross_script_composite')).toBe(false);
  });

  it('matches Ibrahim real Hero Baby basket to invoice 74884 end to end without a false missing/extra Hero item', () => {
    const raw = `[9/27/26, 9:03:05 PM] ابراهيم الصياد ٣٦٤٣: مساء الخير
[9/27/26, 9:03:12 PM] You: أهلًا وسهلًا بحضرتك✨
نورتنا في صيدليات دواء 💚
مع حضرتك د دنيا
خدمة التوصيل متاحة على مدار ٢٤ ساعة 🚗
[9/27/26, 9:03:15 PM] You: مساء النور يا فندم
[9/27/26, 9:03:34 PM] ابراهيم الصياد ٣٦٤٣: لوسمحت كنت محتاجه علبتين لبن هيرو بيبي نيوتروني دفنس 3
[9/27/26, 9:04:00 PM] You: تحت امر حضرتك يا مدام اميره
[9/27/26, 9:04:08 PM] You: حضرتك تؤمرينا بحاجة تانيه ان شاء الله؟
[9/27/26, 9:05:48 PM] ابراهيم الصياد ٣٦٤٣: لا شكرا
[9/27/26, 9:05:59 PM] You: العفو يا فندم مكان حضرتك في اي وقت✨
[9/27/26, 9:06:00 PM] You: جاري الارسال
نتشرف ب خدمة حضرتك ٢٤ ساعه 🌸🌸
[9/27/26, 9:09:42 PM] You: <image omitted>
[9/27/26, 9:09:58 PM] You: تفاصيل الفاتورة يا فندم عشان في عطل في طابعه الريسيت
[9/27/26, 9:15:35 PM] You: صيدليات دواء تتشرف بخدمة حضرتك دائما 💚
الأقرب إليك… ونهتم بصحتك دائمًا. 🌿`;

    const canonicalCustomerId = 'a2fd0b6e-1562-438c-8f16-76a43539f792';
    const result = runSalesIntelligencePipeline({
      conversationId: 'ibrahim-real-74884',
      rawWhatsAppExportText: raw,
      customerIdHint: canonicalCustomerId,
      customerPhoneHint: '01016891940',
      customerCodeHint: '3643',
      customerNameHint: 'ابراهيم الصياد',
      customerIdentityStatus: 'resolved',
      branchNameRawHint: 'فرع شكري',
      productIndex: crossScriptRegressionIndex(),
      resolveInvoiceCandidates: () => [{
        id: 'inv-74884',
        invoice_number: '74884',
        customer_id: canonicalCustomerId,
        customer_code: '3643',
        customer_name: 'ابراهيم الصياد',
        customer_phone: '01016891940',
        branch: 'فرع شكري',
        // TXT export timestamps are local-clock values. CI runs UTC, so use the same clock-time
        // representation here; the live database stores the equivalent Egypt instant as 18:06Z.
        invoice_datetime: '2026-09-27T21:06:00.000Z',
        net_amount: 778,
      }],
      itemEvidenceProvider: {
        getItemsForInvoice: (invoiceId) => invoiceId === 'inv-74884'
          ? [
              { productNameRaw: 'hero baby nutradefense 3 plus', productId: 'hero-3', productCode: '74976', quantity: 2, lineTotal: 772.9676584734799 },
              { productNameRaw: 'توصيل منزلي', productId: 'delivery', productCode: '79693', quantity: 1, lineTotal: 5.032341526520052 },
            ]
          : 'unavailable',
      },
    });

    expect(result.caseAnalyses).toHaveLength(1);
    const analysis = result.caseAnalyses[0];
    expect(analysis.attribution.selectedInvoiceNumber).toBe('74884');
    const activeItems = analysis.activeBasket
      ? (analysis.itemsByBasketId[analysis.activeBasket.basketId] ?? [])
      : [];
    expect(activeItems.some((item) => item.productId === 'hero-3' && item.quantity === 2)).toBe(true);
    expect(analysis.basketInvoiceMatch.quantityMatch).toBe('exact');
    expect(analysis.basketInvoiceMatch.differences.some((difference) => difference.type === 'missing_item' && String(difference.key).includes('هيرو'))).toBe(false);
    expect(analysis.basketInvoiceMatch.differences.some((difference) => difference.type === 'extra_item' && String(difference.key).toLowerCase().includes('hero baby'))).toBe(false);
  });
});
