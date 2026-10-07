import { REVIEW_CRITERIA } from '@/lib/conversationReviews';
import { isStaffFollowUpPromiseV32 } from '../whatsappSemanticSignalsV32';
import type { CaseIntelligenceView } from './types';
import { buildConversationEvaluationEvidence } from './conversationEvaluationEvidence';
import {
  evaluateFollowUpPromiseLifecycle,
  type FollowUpPromiseLifecycle,
} from '../followUpPromiseLifecycle';

export interface FollowUpAfterWaitAssessment {
  key: 'followup_after_wait';
  label: string;
  status: 'assessed' | 'not_applicable' | 'insufficient_evidence';
  selectedOption: string | null;
  selectedLabel: string;
  pointsEarned: number | null;
  maxPoints: number;
  confidence: number;
  reason: string;
  evidenceMessageIds: string[];
  waitSeconds: number | null;
  promiseCount: number;
  /**
   * Lifecycle of the weakest unfulfilled promise (pending/overdue/violated), so the reviewer sees
   * the promise time, SLA due time and how long the conversation was actually observed.
   */
  lifecycle: FollowUpPromiseLifecycle | null;
}

export interface ConversationEvaluationFollowUp {
  version: 'conversation-evaluation-followup-v2';
  caseId: string;
  item: FollowUpAfterWaitAssessment;
}

const criterion = REVIEW_CRITERIA.find((item) => item.key === 'followup_after_wait');
if (!criterion) throw new Error('Missing followup_after_wait review criterion');

const NUDGE_RX =
  /^(?:[؟?]+|يا\s*دكتور|دكتور|لسه|تمام|طيب|اوك|أوك|اوكي|ok|حضرتك|معلش)$/i;

function make(
  option: string | null,
  status: FollowUpAfterWaitAssessment['status'],
  confidence: number,
  reason: string,
  evidenceMessageIds: string[],
  waitSeconds: number | null,
  promiseCount: number,
  lifecycle: FollowUpPromiseLifecycle | null = null,
  labelOverride: string | null = null
): FollowUpAfterWaitAssessment {
  const choice = option ? criterion!.choices.find((item) => item.value === option) ?? null : null;
  return {
    key: 'followup_after_wait',
    label: criterion!.label,
    status,
    selectedOption: option,
    selectedLabel: labelOverride ||
      (status === 'not_applicable'
        ? 'غير منطبق على المحادثة'
        : status === 'insufficient_evidence'
          ? 'الدليل غير كافٍ للحكم'
          : choice?.label || 'تم التقييم'),
    pointsEarned: status === 'assessed' ? choice?.pointsEarned ?? null : null,
    maxPoints: criterion!.maxPoints,
    confidence,
    reason,
    evidenceMessageIds: Array.from(new Set(evidenceMessageIds.filter(Boolean))),
    waitSeconds,
    promiseCount,
    lifecycle,
  };
}

function waitOption(seconds: number): string {
  if (seconds <= 5 * 60) return 'within_5';
  if (seconds <= 10 * 60) return 'five_to_10';
  if (seconds <= 20 * 60) return 'over_10';
  return 'over_20';
}

function pointsFor(option: string): number {
  return criterion!.choices.find((choice) => choice.value === option)?.pointsEarned ?? 0;
}

export function analyzeConversationEvaluationFollowUp(
  view: CaseIntelligenceView
): ConversationEvaluationFollowUp {
  const contract = buildConversationEvaluationEvidence(view);
  const gate = contract.criteria.find((item) => item.key === 'followup_after_wait');
  if (gate?.readiness === 'not_applicable') {
    return {
      version: 'conversation-evaluation-followup-v2',
      caseId: view.caseId,
      item: make(null, 'not_applicable', 100, 'لم يتم رصد وعد من الموظف بالرجوع/المراجعة داخل هذا التفاعل.', [], null, 0),
    };
  }

  const ordered = view.interaction.messages
    .slice()
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const promises = ordered.filter(
    (message) => message.role === 'staff' && message.meaningful && isStaffFollowUpPromiseV32(message.text)
  );

  if (!promises.length) {
    return {
      version: 'conversation-evaluation-followup-v2',
      caseId: view.caseId,
      item: make(null, 'not_applicable', 100, 'لم يتم رصد وعد من الموظف بالرجوع/المراجعة داخل هذا التفاعل.', [], null, 0),
    };
  }

  const assessed: Array<{
    option: string;
    seconds: number | null;
    confidence: number;
    reason: string;
    evidence: string[];
  }> = [];
  const ambiguousEvidence: string[] = [];
  const unfulfilled: Array<{ lifecycle: FollowUpPromiseLifecycle; evidence: string[] }> = [];
  // The latest observed message bounds what we actually know; the export end is not a failure.
  const observedUntil = ordered.length ? ordered[ordered.length - 1].at : null;

  for (const promise of promises) {
    const promiseIndex = ordered.findIndex((message) => message.id === promise.id);
    const after = ordered.slice(promiseIndex + 1);
    const nextReturn = after.find(
      (message) =>
        message.role === 'staff' &&
        message.meaningful &&
        !isStaffFollowUpPromiseV32(message.text)
    );

    const beforeReturn = nextReturn
      ? after.slice(0, after.findIndex((message) => message.id === nextReturn.id))
      : after;
    const substantiveNewCustomerRequest = beforeReturn.find(
      (message) =>
        message.role === 'customer' &&
        message.meaningful &&
        !NUDGE_RX.test(message.text.trim())
    );

    if (substantiveNewCustomerRequest) {
      ambiguousEvidence.push(promise.id, substantiveNewCustomerRequest.id);
      continue;
    }

    if (nextReturn) {
      const promiseAt = new Date(promise.at).getTime();
      const returnAt = new Date(nextReturn.at).getTime();
      const seconds = Math.max(0, Math.round((returnAt - promiseAt) / 1000));
      if (!Number.isFinite(seconds)) {
        ambiguousEvidence.push(promise.id, nextReturn.id);
        continue;
      }
      const option = waitOption(seconds);
      assessed.push({
        option,
        seconds,
        confidence: 98,
        reason: `الموظف وعد بالرجوع ثم أرسل نتيجة/ردًا جديدًا بعد ${seconds} ثانية داخل نفس التفاعل، دون ظهور طلب عميل جديد يغيّر السياق بينهما.`,
        evidence: [promise.id, nextReturn.id],
      });
      continue;
    }

    const unresolvedPromise = view.followUp.opportunities.find(
      (opportunity) =>
        opportunity.reason === 'staff_promised_check' &&
        opportunity.evidenceMessageIds.includes(promise.id)
    );
    if (unresolvedPromise) {
      const lifecycle = evaluateFollowUpPromiseLifecycle({ promiseAt: promise.at, observedUntil });
      const evidence = [promise.id, ...unresolvedPromise.evidenceMessageIds];
      if (lifecycle?.status === 'violated') {
        assessed.push({
          option: 'never',
          seconds: null,
          confidence: 99,
          reason: `تم رصد وعد صريح بالرجوع، ومحرك المتابعة الكانوني أكد أنه لم يظهر رد موظف لاحق ينفذ هذا الوعد. ${lifecycle.reason}`,
          evidence,
        });
      } else if (lifecycle) {
        unfulfilled.push({ lifecycle, evidence });
      } else {
        ambiguousEvidence.push(promise.id);
      }
    } else {
      ambiguousEvidence.push(promise.id);
    }
  }

  if (!assessed.length && unfulfilled.length) {
    const weakest =
      unfulfilled.find((row) => row.lifecycle.status === 'overdue') || unfulfilled[0];
    return {
      version: 'conversation-evaluation-followup-v2',
      caseId: view.caseId,
      item: make(
        null,
        'insufficient_evidence',
        weakest.lifecycle.status === 'overdue' ? 70 : 90,
        weakest.lifecycle.reason,
        [...weakest.evidence, ...ambiguousEvidence],
        null,
        promises.length,
        weakest.lifecycle,
        weakest.lifecycle.status === 'overdue'
          ? 'وعد متابعة متأخر — يحتاج مراجعة بشرية (بدون خصم تلقائي)'
          : 'وعد متابعة قيد الانتظار — لا خصم'
      ),
    };
  }

  if (!assessed.length) {
    return {
      version: 'conversation-evaluation-followup-v2',
      caseId: view.caseId,
      item: make(
        null,
        'insufficient_evidence',
        60,
        'يوجد وعد بالرجوع، لكن تسلسل الرسائل لا يسمح بربط رسالة لاحقة بهذا الوعد بثقة؛ لا يوجد خصم تلقائي.',
        ambiguousEvidence,
        null,
        promises.length
      ),
    };
  }

  // If there were multiple promises in one interaction, evaluate the weakest proven execution.
  // One missed/slow promise must not disappear because another promise was handled quickly.
  const worst = assessed
    .slice()
    .sort((a, b) => pointsFor(a.option) - pointsFor(b.option) || (b.seconds ?? Number.MAX_SAFE_INTEGER) - (a.seconds ?? Number.MAX_SAFE_INTEGER))[0];

  return {
    version: 'conversation-evaluation-followup-v2',
    caseId: view.caseId,
    item: make(
      worst.option,
      'assessed',
      worst.confidence,
      promises.length > 1
        ? `${worst.reason} تم رصد ${promises.length} وعود في التفاعل، وتم اعتماد أضعف تنفيذ مثبت حتى لا يختفي التأخير داخل المتوسط.`
        : worst.reason,
      worst.evidence,
      worst.seconds,
      promises.length
    ),
  };
}
