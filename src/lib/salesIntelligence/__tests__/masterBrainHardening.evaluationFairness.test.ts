// Gate 2 — Evaluation Fairness reference set (synthetic conversations only).
//
// Not a score snapshot: every conversation is checked against fairness invariants that must hold
// for all 19 criteria, plus the expectation that matters for that conversation type.
//   I1 a criterion that is not `assessed` carries no points (never a hidden 0);
//   I2 every deduction (assessed, points < max) cites the messages or system records it rests on;
//   I3 consultation and dosage are never scored automatically;
//   I4 the automatic score is null when nothing was assessed (never 0 for "no evidence");
//   I5 a sales criterion is never applied to a service-only conversation.
import { describe, expect, it } from 'vitest';
import { REVIEW_CRITERIA } from '@/lib/conversationReviews';
import { runSalesIntelligencePipeline } from '../salesIntelligencePipeline';
import { analyzeConversationEvaluation, type ConversationEvaluationResult } from '../conversationEvaluation';

function evaluate(raw: string) {
  const result = runSalesIntelligencePipeline({
    conversationId: 'fairness-conv',
    rawWhatsAppExportText: raw,
    customerIdHint: 'cust-1',
    customerNameHint: 'عميل اختبار',
    customerCodeHint: '100',
    customerIdentityStatus: 'resolved',
    staffIdBySender: { You: 'staff-1' },
    resolveInvoiceCandidates: () => [],
  });
  expect(result.caseAnalyses.length).toBeGreaterThan(0);
  return result.caseAnalyses.map((analysis) => analyzeConversationEvaluation(analysis.caseIntelligence, null));
}

function item(result: ConversationEvaluationResult, key: string) {
  const found = result.items.find((entry) => entry.key === key);
  if (!found) throw new Error(`missing ${key}`);
  return found;
}

function assertInvariants(name: string, result: ConversationEvaluationResult) {
  expect(result.items.map((entry) => entry.key), name).toEqual(REVIEW_CRITERIA.map((criterion) => criterion.key));
  for (const entry of result.items) {
    const where = `${name} / ${entry.key}`;
    if (entry.status !== 'assessed') expect(entry.pointsEarned, `${where}: unassessed carries points`).toBeNull();
    if (entry.status === 'assessed' && entry.pointsEarned != null && entry.pointsEarned < entry.maxPoints) {
      expect(entry.evidenceMessageIds.length + entry.systemRecordIds.length, `${where}: deduction without cited evidence`).toBeGreaterThan(0);
      expect(entry.reason.trim().length, `${where}: deduction without a reason`).toBeGreaterThan(0);
    }
    if (entry.key === 'consultation_quality' || entry.key === 'dosage_explanation') {
      expect(entry.status, where).not.toBe('assessed');
    }
  }
  const assessed = result.items.filter((entry) => entry.source === 'automatic' && entry.status === 'assessed');
  if (assessed.length === 0) expect(result.summary.autoScore, `${name}: score without evidence`).toBeNull();
}

const REFERENCE: Record<string, string> = {
  service_delivery_status: `[9/28/26, 9:00:00 AM] Customer: السلام عليكم الطلب بتاعي وصل فين؟
[9/28/26, 9:01:00 AM] You: أهلا بحضرتك، الطلب خرج مع المندوب وهيوصل خلال نص ساعة
[9/28/26, 9:02:00 AM] Customer: تمام شكرا`,
  sale_confirmed: `[9/28/26, 9:00:00 AM] Customer: عايز علبة بانادول اكسترا
[9/28/26, 9:00:30 AM] You: أهلا بحضرتك، بانادول اكسترا متوفر، العلبة ب 60 جنيه
[9/28/26, 9:01:00 AM] You: الطلب: بانادول اكسترا علبة واحدة، الإجمالي 60 جنيه، أأكد لحضرتك؟
[9/28/26, 9:01:30 AM] Customer: ايوه أكد
[9/28/26, 9:02:00 AM] You: تم تأكيد الطلب وجاري الإرسال، شكرا لحضرتك`,
  complaint_resolved: `[9/28/26, 9:00:00 AM] Customer: انا زعلان جدا الطلب وصل ناقص علبة
[9/28/26, 9:01:00 AM] You: حقك علينا يا فندم، هنبعت العلبة الناقصة حالا مع المندوب
[9/28/26, 9:40:00 AM] Customer: وصلت الحمد لله المشكلة اتحلت شكرا`,
  complaint_unanswered_at_export_end: `[9/28/26, 9:00:00 AM] Customer: الطلب اتأخر جدا وانا زعلان`,
  followup_promise_kept: `[9/28/26, 9:00:00 AM] Customer: عندكم كريم ميبو؟
[9/28/26, 9:00:30 AM] You: هشوف المخزن وارجع لحضرتك
[9/28/26, 9:10:00 AM] You: كريم ميبو متوفر يا فندم ب 95 جنيه`,
  insufficient_evidence_media: `[9/28/26, 9:00:00 AM] Customer: <image omitted>
[9/28/26, 9:00:10 AM] Customer: <audio omitted>`,
  thanks_only: `[9/28/26, 9:00:00 AM] Customer: شكرا يا دكتور
[9/28/26, 9:00:30 AM] You: العفو تحت أمر حضرتك`,
  staff_says_no_problem: `[9/28/26, 9:00:00 AM] Customer: ممكن أغير ميعاد التوصيل للساعة 5؟
[9/28/26, 9:00:30 AM] You: مفيش مشكلة يا فندم، هيوصل الساعة 5`,
};

describe('Gate 2 — fairness invariants on every criterion of the reference set', () => {
  for (const [name, raw] of Object.entries(REFERENCE)) {
    it(name, () => {
      for (const result of evaluate(raw)) assertInvariants(name, result);
    });
  }
});

describe('Gate 2 — expectations per conversation type', () => {
  it('service-only conversation is never scored on selling', () => {
    for (const result of evaluate(REFERENCE.service_delivery_status)) {
      for (const key of ['sales_closing', 'cross_sell_upsell']) expect(item(result, key).status, key).toBe('not_applicable');
    }
  });

  it('a resolved complaint with apology and remedy is credited, not penalised', () => {
    const results = evaluate(REFERENCE.complaint_resolved);
    const angry = results.map((result) => item(result, 'angry_customer')).find((entry) => entry.status === 'assessed');
    expect(angry, 'complaint handling assessed').toBeTruthy();
    expect(angry!.pointsEarned! / angry!.maxPoints).toBeGreaterThanOrEqual(0.7);
  });

  it('missing evidence (media only) produces no deduction anywhere', () => {
    for (const result of evaluate(REFERENCE.insufficient_evidence_media)) {
      const deductions = result.items.filter((entry) => entry.status === 'assessed' && (entry.pointsEarned ?? 0) < entry.maxPoints);
      expect(deductions.map((entry) => entry.key)).toEqual([]);
    }
  });

  it('a thanks-only exchange is neither a sale nor a sales deduction', () => {
    for (const result of evaluate(REFERENCE.thanks_only)) {
      expect(item(result, 'sales_closing').status).toBe('not_applicable');
      expect(item(result, 'order_confirmation').status).not.toBe('assessed');
    }
  });

  it('the pharmacist saying "مفيش مشكلة" is not a customer complaint', () => {
    for (const result of evaluate(REFERENCE.staff_says_no_problem)) {
      expect(item(result, 'angry_customer').status).not.toBe('assessed');
    }
  });

  it('a kept follow-up promise is credited by the rubric time tier and cites the promise and the return', () => {
    const followup = evaluate(REFERENCE.followup_promise_kept).map((result) => item(result, 'followup_after_wait'))
      .find((entry) => entry.status === 'assessed');
    expect(followup).toBeTruthy();
    // Returning after ~9.5 minutes is the rubric's 5–10 minute tier (5/10): a policy choice, not a
    // missing-evidence penalty. Both the promise and the return are cited.
    expect(followup!.selectedOption).toBe('five_to_10');
    expect(followup!.pointsEarned).toBeGreaterThan(0);
    expect(followup!.evidenceMessageIds.length).toBeGreaterThanOrEqual(2);
  });

  it('a delayed "arrived / problem solved" confirmation stays in the complaint case', () => {
    const results = evaluate(REFERENCE.complaint_resolved);
    expect(results).toHaveLength(1);
  });

  it('a complaint at the very end of the export is evidence-cited, never a silent zero', () => {
    for (const result of evaluate(REFERENCE.complaint_unanswered_at_export_end)) {
      const angry = item(result, 'angry_customer');
      if (angry.status === 'assessed' && (angry.pointsEarned ?? 0) < angry.maxPoints) {
        expect(angry.evidenceMessageIds.length).toBeGreaterThan(0);
      }
    }
  });
});
