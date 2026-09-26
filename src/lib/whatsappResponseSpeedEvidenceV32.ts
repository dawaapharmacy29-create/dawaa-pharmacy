// V32 Phase C.1 / C.2 — Response Speed criterion, evidence-contract implementation.
// Reuses the EXACT point thresholds already live in REVIEW_CRITERIA['first_response_speed']
// and whatsappReviewScoring.ts's firstResponseOption() — no business-rule change.
import {
  computeConfidenceV32,
  messagesInScopeV32,
  notApplicableResultV32,
  type CriterionEvaluationInputV32,
  type CriterionEvidenceContractV32,
  type CriterionEvidenceResultV32,
  type CriterionFindingV32,
} from './whatsappCriterionEvidenceV32';
import { isGreetingOnly } from './whatsappSemanticSignalsV32';

const VERSION = 'response-speed-evidence-v32.2';
const MAX_POINTS = 10;

// Mirrors REVIEW_CRITERIA['first_response_speed'].choices point values exactly.
const SCORE_BANDS: Array<{ band: string; maxSeconds: number; points: number }> = [
  { band: 'within_5', maxSeconds: 300, points: 10 },
  { band: 'five_to_10', maxSeconds: 600, points: 5 },
  { band: 'ten_to_20', maxSeconds: 1200, points: 0 },
  { band: 'over_20', maxSeconds: 1800, points: 0 },
  { band: 'over_30', maxSeconds: Infinity, points: 0 },
];

function bandFor(seconds: number) {
  return SCORE_BANDS.find((b) => seconds <= b.maxSeconds) || SCORE_BANDS[SCORE_BANDS.length - 1];
}

/**
 * The trigger is the EARLIEST substantive customer message, not the first meaningful one and
 * not the last one of a request burst. A pure greeting ("مساء الخير") is skipped in favor of the
 * next meaningful message if one exists in scope — but if the customer only ever sent greetings
 * (nothing else), that greeting is still the trigger: we never lose the measurement entirely.
 * This also means a 3-message customer burst ("مساء الخير" / "عايز اسأل عن دواء" / "ترايليبتال
 * 600") is timed from message 2, not message 3 — never later than the real first substantive ask.
 */
function selectTrigger(scoped: ReturnType<typeof messagesInScopeV32>) {
  const meaningfulCustomerMessages = scoped.filter((m) => m.role === 'customer' && m.isMeaningful);
  const nonGreeting = meaningfulCustomerMessages.find((m) => !isGreetingOnly(m.text));
  return nonGreeting || meaningfulCustomerMessages[0] || null;
}

export function evaluateResponseSpeedV32(input: CriterionEvaluationInputV32): CriterionEvidenceResultV32 {
  const scoped = messagesInScopeV32(input);

  const trigger = selectTrigger(scoped);
  if (!trigger) {
    return notApplicableResultV32(
      'response_speed',
      VERSION,
      MAX_POINTS,
      'لا توجد رسالة عميل ذات محتوى فعلي في نطاق هذا التفاعل تستلزم ردًا.'
    );
  }

  // First meaningful staff reply at/after the trigger, never before it, never outside this interaction/scope.
  const reply = scoped.find(
    (m) => m.timestamp.getTime() >= trigger.timestamp.getTime() && m.role === 'staff' && m.isMeaningful
  );

  const triggerRuleId = trigger.requestBurstId
    ? 'response_speed.trigger.earliest_substantive_message_in_burst'
    : isGreetingOnly(trigger.text)
      ? 'response_speed.trigger.greeting_only_no_alternative'
      : 'response_speed.trigger.first_substantive_customer_message';

  if (!reply) {
    const finding: CriterionFindingV32 = {
      key: 'no_staff_reply',
      status: 'missing',
      fact: `لم يتم العثور على رد فعلي من الموظف بعد رسالة العميل "${trigger.text.slice(0, 80)}" داخل نطاق هذا التفاعل.`,
      interpretation: null,
      source: 'conversation',
      provenance: 'derived_timing',
      evidenceMessageIds: [trigger.id],
      ruleId: triggerRuleId,
    };
    return {
      criterionKey: 'response_speed',
      version: VERSION,
      maxPoints: MAX_POINTS,
      applicable: true,
      applicabilityReason: 'توجد رسالة عميل تستلزم ردًا.',
      findings: [finding],
      positiveEvidenceMessageIds: [],
      negativeEvidenceMessageIds: [trigger.id],
      contradictionMessageIds: [],
      primaryMessageIds: [trigger.id],
      scoreBand: null,
      pointsEarned: null,
      scoreReasoning: 'لا يمكن حساب زمن الرد لعدم وجود رد فعلي من الموظف في نطاق هذا التفاعل.',
      confidence: computeConfidenceV32({
        evidenceCompleteness: 1,
        evidenceClarity: 1,
        contradictions: 1,
        sourceReliability: 1,
      }),
      confidenceFactors: { evidenceCompleteness: 1, evidenceClarity: 1, contradictions: 1, sourceReliability: 1 },
      needsHumanReview: true,
      humanReviewReasons: ['no_staff_reply_found'],
    };
  }

  const elapsedSeconds = Math.max(0, Math.round((reply.timestamp.getTime() - trigger.timestamp.getTime()) / 1000));
  const elapsedMinutes = Math.round((elapsedSeconds / 60) * 10) / 10;
  const { band, points } = bandFor(elapsedSeconds);

  const finding: CriterionFindingV32 = {
    key: 'first_response_latency',
    status: 'proven',
    fact: `أول رسالة عميل ذات محتوى فعلي: "${trigger.text.slice(0, 80)}" في ${trigger.timestamp.toISOString()}. أول رد فعلي من الموظف "${reply.sender}": "${reply.text.slice(0, 80)}" في ${reply.timestamp.toISOString()}. الفارق الزمني: ${elapsedSeconds} ثانية (${elapsedMinutes} دقيقة).`,
    interpretation: null,
    source: 'conversation',
    provenance: 'derived_timing',
    evidenceMessageIds: [trigger.id, reply.id],
    ruleId: triggerRuleId,
  };

  return {
    criterionKey: 'response_speed',
    version: VERSION,
    maxPoints: MAX_POINTS,
    applicable: true,
    applicabilityReason: 'توجد رسالة عميل ورد فعلي من الموظف داخل نطاق هذا التفاعل.',
    findings: [finding],
    positiveEvidenceMessageIds: [trigger.id, reply.id],
    negativeEvidenceMessageIds: [],
    contradictionMessageIds: [],
    primaryMessageIds: [trigger.id, reply.id],
    scoreBand: band,
    pointsEarned: points,
    scoreReasoning: `زمن أول رد = ${elapsedSeconds} ثانية، ضمن نطاق "${band}" (${points}/${MAX_POINTS}) حسب سلم النقاط الحالي لسرعة أول رد.`,
    confidence: computeConfidenceV32({
      evidenceCompleteness: 1,
      evidenceClarity: 1,
      contradictions: 1,
      sourceReliability: 1,
    }),
    confidenceFactors: { evidenceCompleteness: 1, evidenceClarity: 1, contradictions: 1, sourceReliability: 1 },
    needsHumanReview: false,
    humanReviewReasons: [],
  };
}

export const ResponseSpeedEvidenceContractV32: CriterionEvidenceContractV32 = {
  criterionKey: 'response_speed',
  version: VERSION,
  maxPoints: MAX_POINTS,
  evaluate: evaluateResponseSpeedV32,
};
