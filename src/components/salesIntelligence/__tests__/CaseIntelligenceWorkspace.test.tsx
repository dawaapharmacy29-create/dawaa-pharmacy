import fs from 'node:fs';
import path from 'node:path';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';
import { runSalesIntelligencePipeline } from '@/lib/salesIntelligence/salesIntelligencePipeline';
import { deriveLostOpportunity } from '@/lib/salesIntelligence/lostOpportunityEngine';
import { deriveFollowUpOpportunities } from '@/lib/salesIntelligence/followUpOpportunityEngine';
import { buildCaseIntelligenceView } from '@/lib/salesIntelligence/caseIntelligenceView';
import { readCaseIntelligence } from '@/lib/salesIntelligence/qa/caseIntelligencePresentation';
import { CaseIntelligenceWorkspace, type CaseIntelligenceTab } from '@/components/salesIntelligence/CaseIntelligenceWorkspace';
import type { CaseIntelligenceView, SalesIntelligenceCaseAnalysis } from '@/lib/salesIntelligence/types';

// STEP 5B — Case Intelligence Workspace is DISPLAY ONLY over the persisted caseIntelligence view.
// Views are produced by the real pipeline and passed through JSON (exactly what persistence stores).

function analyze(raw: string, resolved = true) {
  return runSalesIntelligencePipeline({
    conversationId: 'workspace',
    rawWhatsAppExportText: raw,
    resolveInvoiceCandidates: () => [],
    customerIdHint: resolved ? 'customer-1' : null,
    customerIdentityStatus: resolved ? 'resolved' : 'unresolved',
    branchNameRawHint: 'فرع شكري',
  }).caseAnalyses[0];
}

const persisted = (view: CaseIntelligenceView) =>
  readCaseIntelligence({ evidence_snapshot: JSON.parse(JSON.stringify({ caseIntelligence: view })) });

function render(view: CaseIntelligenceView | null, tab: CaseIntelligenceTab = 'conversation', conversationPanel: ReactNode = null) {
  return renderToStaticMarkup(createElement(CaseIntelligenceWorkspace, { view, initialTab: tab, conversationPanel }));
}

function asSaleProvenView(analysis: SalesIntelligenceCaseAnalysis, raw: string) {
  const understanding = buildConversationUnderstandingV32(splitWhatsAppSessions(parseWhatsAppExport(raw), Number.MAX_SAFE_INTEGER)[0]);
  const messages = understanding.messages;
  const salesOutcome = { ...analysis.salesOutcome, outcome: 'sale_proven' as const, saleProofState: 'proven' as const, isSaleCountable: true, isRevenueCountable: true };
  const lostOpportunity = deriveLostOpportunity({ caseId: analysis.caseId, messages, customerNeed: analysis.customerNeed, unavailableDemand: analysis.unavailableDemand, commercialConfirmation: analysis.commercialConfirmation, journeyState: analysis.journeyState, salesOutcome });
  const followUp = deriveFollowUpOpportunities({ conversationCase: analysis.conversationCase, messages, customerNeed: analysis.customerNeed, unavailableDemand: analysis.unavailableDemand, lostOpportunity, salesOutcome, customerIdentityStatus: 'resolved' });
  const { caseIntelligence: _old, ...rest } = analysis;
  return buildCaseIntelligenceView({ ...rest, salesOutcome, lostOpportunity, followUp }, { messages, interaction: understanding.interactions[0], customerIdentityStatus: 'resolved' });
}

const SALE = `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: تمام
[9/15/26, 9:03:00 AM] You: تم تأكيد الطلب`;

describe('Case Intelligence Workspace (display only)', () => {
  it('A. successful sale: header answers need/stage/outcome; candidate invoices never shown as a sale', () => {
    const view = persisted(analyze(SALE).caseIntelligence)!;
    const header = render(view);
    expect(header).toContain('في انتظار الفاتورة');
    expect(header).toContain('طلب مؤكد — البيع غير مثبت بعد');
    expect(header).toContain('لا تحتاج متابعة');
    expect(header).toContain('رسائل هذا التفاعل فقط');
    const sale = render(view, 'sale');
    expect(sale).toContain('180 جنيه');
    expect(sale).toContain('مرشحة فقط — ليست بيعًا');
  });

  it('A2. conversation tab can render the WhatsApp-style transcript supplied by the case page', () => {
    const view = persisted(analyze(SALE).caseIntelligence)!;
    const html = render(view, 'conversation', createElement('div', { 'data-testid': 'whatsapp-like-transcript' }, 'WhatsApp transcript'));
    expect(html).toContain('conversation-whatsapp-panel');
    expect(html).toContain('whatsapp-like-transcript');
    expect(html).not.toContain('conversation-messages');
  });

  it('A3. trusted invoice lines can recover executed product identity without pretending the chat exposed it', () => {
    const view = persisted(analyze(SALE).caseIntelligence)!;
    const noChatProducts: CaseIntelligenceView = { ...view, products: [], need: { ...view.need, products: [] } };
    const html = renderToStaticMarkup(createElement(CaseIntelligenceWorkspace, {
      view: noChatProducts,
      initialTab: 'products',
      invoiceEvidence: {
        status: 'trusted',
        invoiceNumber: '74966',
        items: [{ id: 'line-1', productName: 'Bon Care', productCode: 'BC-1', quantity: 2, unitName: 'علبة', netLineAmount: 180 }],
      },
    }));
    expect(html).toContain('trusted-invoice-products');
    expect(html).toContain('Bon Care');
    expect(html).toContain('فاتورة موثوقة');
    expect(html).toContain('لا توجد أصناف واضحة من نص هذا التفاعل');
  });

  it('A4. candidate invoice lines are never exposed as product truth', () => {
    const view = persisted(analyze(SALE).caseIntelligence)!;
    const html = renderToStaticMarkup(createElement(CaseIntelligenceWorkspace, {
      view,
      initialTab: 'products',
      invoiceEvidence: {
        status: 'candidate',
        invoiceNumber: '74966',
        items: [{ id: 'line-1', productName: 'SHOULD-NOT-RENDER', productCode: null, quantity: 1, unitName: null, netLineAmount: null }],
      },
    }));
    expect(html).toContain('candidate-invoice-products-blocked');
    expect(html).not.toContain('SHOULD-NOT-RENDER');
  });

  it('A5. unresolved media need can use only trusted invoice lines as execution reference', () => {
    const view = persisted(analyze(`[9/28/26, 6:51:56 AM] Customer: السلام عليكم لو سمحت يادكتور عايزه الحاجات دي
[9/28/26, 6:51:59 AM] Customer: <image omitted>`).caseIntelligence)!;
    const html = renderToStaticMarkup(createElement(CaseIntelligenceWorkspace, {
      view,
      initialTab: 'need',
      invoiceEvidence: {
        status: 'trusted',
        invoiceNumber: '74966',
        items: [{ id: 'line-1', productName: 'Bon Care', productCode: 'BC-1', quantity: 2, unitName: 'علبة', netLineAmount: 180 }],
      },
    }));
    expect(html).toContain('need-trusted-invoice-fallback');
    expect(html).toContain('Bon Care');
    expect(html).toContain('ما تم صرفه فعليًا');
    expect(html).toContain('وليست ادعاءً بأن الصورة/الفويس تم قراءته');
  });

  it('A6. unresolved media need never consumes candidate invoice items as request truth', () => {
    const view = persisted(analyze(`[9/28/26, 6:51:56 AM] Customer: السلام عليكم لو سمحت يادكتور عايزه الحاجات دي
[9/28/26, 6:51:59 AM] Customer: <image omitted>`).caseIntelligence)!;
    const html = renderToStaticMarkup(createElement(CaseIntelligenceWorkspace, {
      view,
      initialTab: 'need',
      invoiceEvidence: {
        status: 'candidate',
        invoiceNumber: '74966',
        items: [{ id: 'line-1', productName: 'SHOULD-NOT-RENDER', productCode: null, quantity: 1, unitName: null, netLineAmount: null }],
      },
    }));
    expect(html).toContain('need-candidate-invoice-not-used');
    expect(html).toContain('لا نستخدم أصنافها');
    expect(html).not.toContain('SHOULD-NOT-RENDER');
  });

  it('A7. unresolved media opportunity is displayed as review-before-follow-up, never no-follow-up', () => {
    const view = persisted(analyze(`[9/28/26, 6:51:56 AM] Customer: السلام عليكم لو سمحت يادكتور عايزه الحاجات دي
[9/28/26, 6:51:59 AM] Customer: <image omitted>
[9/28/26, 6:52:06 AM] You: أهلًا وسهلًا بحضرتك
خدمة التوصيل متاحة على مدار ٢٤ ساعة`).caseIntelligence)!;
    expect(render(view)).toContain('تحتاج مراجعة قبل تحديد المتابعة');
    const followUp = render(view, 'followup');
    expect(followUp).toContain('followup-review-required');
    expect(followUp).toContain('لا توجد متابعة تلقائية الآن');
    expect(followUp).not.toContain('لا توجد متابعة لهذا التفاعل');
  });

  it('B. unavailable + alternative rejected: product card, recoverable loss and stock follow-up', () => {
    const view = persisted(analyze(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:01:00 AM] You: كونجستال مش متوفر حاليًا، فيه بديل كومتركس
[9/15/26, 9:02:00 AM] Customer: لا مش عايزه`).caseIntelligence)!;
    const products = render(view, 'products');
    expect(products).toContain('غير متوفر — قابل للاسترداد');
    expect(products).toContain('رفض البديل');
    expect(render(view, 'lost')).toContain('رفض البديل');
    expect(render(view, 'followup')).toContain('التواصل مع العميل عند توفر الصنف');
  });

  it('C. unavailable + alternative accepted + sale proven: won, demand kept, no actionable follow-up', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:01:00 AM] You: كونجستال مش متوفر حاليًا، ممكن بدل منه نجيب كومتركس
[9/15/26, 9:02:00 AM] Customer: تمام هاته`;
    const view = persisted(asSaleProvenView(analyze(raw), raw))!;
    expect(render(view)).toContain('بيع مثبت بفاتورة');
    expect(render(view, 'lost')).toContain('تم البيع');
    expect(render(view, 'products')).toContain('وافق على البديل');
    expect(render(view, 'followup')).not.toContain('data-followup="actionable"');
  });

  it('D. staff no response: loss owned by staff, immediate reply obligation', () => {
    const view = persisted(analyze(`[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة فيتامين د`).caseIntelligence)!;
    expect(render(view)).toContain('لم يرد أحد');
    expect(render(view, 'lost')).toContain('الموظف');
    const followUp = render(view, 'followup');
    expect(followUp).toContain('الرد على طلب العميل');
    expect(followUp).toContain('فورًا');
  });

  it('E. unknown customer identity: full view, identity badge, blocked follow-up, nothing guessed', () => {
    const view = persisted(analyze(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة كونجستال
[9/15/26, 9:01:00 AM] You: كونجستال مش موجود حاليًا
[9/15/26, 9:02:00 AM] Customer: طيب`, false).caseIntelligence)!;
    const header = render(view);
    expect(header).toContain('هوية غير محسومة');
    expect(header).not.toContain('customer-1');
    const followUp = render(view, 'followup');
    expect(followUp).toContain('data-followup="blocked"');
    expect(followUp).toContain('هوية العميل غير محسومة');
  });

  it('F. multiple staff: "who said what" keeps each sender', () => {
    const view = persisted(analyze(SALE).caseIntelligence)!;
    const staffView: CaseIntelligenceView = {
      ...view,
      staff: {
        participants: [
          { sender: 'د. سارة', staffId: null, messageIds: ['a'], messageCount: 1 },
          { sender: 'د. أحمد', staffId: null, messageIds: ['b'], messageCount: 1 },
        ],
        facts: [
          { fact: 'stated_unavailable', messageId: 'a', staffSender: 'د. سارة', staffId: null, productKey: null, source: 'customer_need' },
          { fact: 'offered_alternative', messageId: 'b', staffSender: 'د. أحمد', staffId: null, productKey: null, source: 'customer_need' },
        ],
      },
    };
    const review = render(staffView, 'review');
    expect(review).toContain('د. سارة: قال إن الصنف غير متوفر');
    expect(review).toContain('د. أحمد: عرض بديلًا');
  });

  it('F2. technical "You" is replaced by persisted source staff identity for display only', () => {
    const view = persisted(analyze(SALE).caseIntelligence)!;
    const header = renderToStaticMarkup(createElement(CaseIntelligenceWorkspace, {
      view,
      staffDisplayName: 'د محمد شبل',
    }));
    expect(header).toContain('الموظف بالمحادثة');
    expect(header).toContain('د محمد شبل');
    expect(header).not.toContain('>You<');

    const staffView: CaseIntelligenceView = {
      ...view,
      staff: {
        participants: [{ sender: 'You', staffId: null, messageIds: ['a'], messageCount: 1 }],
        facts: [{ fact: 'stated_available', messageId: 'a', staffSender: 'You', staffId: null, productKey: null, source: 'customer_need' }],
      },
    };
    const review = renderToStaticMarkup(createElement(CaseIntelligenceWorkspace, {
      view: staffView,
      initialTab: 'review',
      staffDisplayName: 'د محمد شبل',
    }));
    expect(review).toContain('د محمد شبل: قال إن الصنف متوفر');
    expect(review).not.toContain('You:');
  });

  it('G. mixed products: A in a proven sale, B unavailable — two separate states', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 1 علبة كونجستال
[9/15/26, 9:00:20 AM] Customer: وكمان 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: كونجستال مش موجود حاليًا، وفيتامين د موجود
[9/15/26, 9:02:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:03:00 AM] Customer: تمام`;
    const view = persisted(asSaleProvenView(analyze(raw), raw))!;
    const products = render(view, 'products');
    expect(products).toContain('ضمن بيع مثبت');
    expect(products).toContain('غير متوفر — قابل للاسترداد');
    expect(render(view, 'lost')).toContain('التفاعل نفسه انتهى ببيع، لكن فيه صنف لم يُبع');
  });

  it('H. review required: badge + canonical reasons only', () => {
    const view = persisted(analyze(`[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة كونجستال
[9/15/26, 9:01:00 AM] You: كونجستال مش موجود حاليًا`, false).caseIntelligence)!;
    expect(render(view)).toContain('يحتاج مراجعة');
    const review = render(view, 'review');
    expect(review).toContain('يحتاج مراجعة؟ نعم');
    expect(review).toContain('هوية العميل غير محسومة');
    // No raw ids / versions in the main review view (only under advanced details).
    expect(review).not.toContain(view.caseId);
  });

  it('I. old analysis without caseIntelligence: explicit notice, no legacy truth fallback', () => {
    const oldRow = { evidence_snapshot: { customerNeed: { primaryNeed: 'legacy' }, journeyState: { currentState: 'sale_proven' } } };
    expect(readCaseIntelligence(oldRow)).toBeNull();
    expect(readCaseIntelligence({ evidence_snapshot: { caseIntelligence: { version: 'case-intelligence-v0' } } })).toBeNull();
    const html = render(null);
    expect(html).toContain('التحليل الموحد غير متاح لهذه الحالة القديمة');
    expect(html).not.toContain('legacy');
    expect(html).not.toContain('بيع مثبت');
  });

  it('display-only guard: no engine, legacy module, database access or regex business logic', () => {
    for (const file of [
      '../CaseIntelligenceWorkspace.tsx',
      '../../../lib/salesIntelligence/qa/caseIntelligencePresentation.ts',
    ]) {
      const code = fs.readFileSync(path.resolve(__dirname, file), 'utf8').replace(/^\s*\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/derive[A-Z]\w*\(|runSalesIntelligencePipeline|buildCaseIntelligenceView|OperationalIntelligenceV6|ProductJourneyV7|CustomerCaseEngineV22|CaseLostReasonV23|supabase|\.from\(|\.rpc\(|new RegExp|\/[^/\n]{2,}\/[gimsuy]*\.test\(/);
    }
  });
});
