import { describe, expect, it } from 'vitest';
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from '@/lib/whatsappConversationParser';
import { buildWhatsAppCaseContextsV27 } from '@/lib/whatsappCaseContextV27';
import { buildConversationFocusV30 } from '@/lib/whatsappConversationFocusV30';
import { buildConversationTimingV28, type ConversationTimingV28 } from '@/lib/whatsappConversationTimingV28';
import { buildDelayAttributionV29 } from '@/lib/whatsappDelayAttributionV29';
import { buildEvaluationConversationV31 } from '@/lib/whatsappEvaluationConversationV31';
import { applySmartReviewMessageScope } from '@/lib/whatsappSmartReviewScope';
import {
  buildConversationReviewSnapshot,
  parseConversationReviewSnapshot,
  snapshotFromReviewRow,
  type ConversationReviewSnapshot,
} from '@/lib/conversationReviewTranscript';
import type { SmartIntelligenceSnapshotV1 } from '@/lib/whatsappSmartIntelligenceSnapshot';
import type { SmartQuickDecisionResult } from '@/lib/whatsappSmartReviewDecision';

// يحاكي المسار الحقيقي بالكامل: WhatsAppSmartFolderWatcher.tsx يبني نفس السلسلة
// V27 -> (لكل موظف) applySmartReviewMessageScope -> V30 -> V31 -> Timing على المحادثة
// المركزة -> Snapshot -> حفظ في raw_scores.conversation_snapshot -> قراءة عبر
// ConversationReviewDetailsFast.tsx. الاختبار ده بيتحقق إن الجولة كاملة (End-to-End)
// بتحافظ على استقلالية كل موظف، وإن أي بيانات (رسائل/توقيت/سبب تأخير) بتتحفظ زي
// ما هي بعد أي عدد من مرات الحفظ والقراءة (JSON عبر raw_scores jsonb).

function msg(id: string, at: string, direction: 'inbound' | 'outbound', text: string, sender: string): WhatsAppParsedMessage {
  return { id, timestamp: new Date(at), rawTimestamp: at, sender, text, direction, kind: 'text', forwarded: false, raw: text };
}

function buildCaseSession(): WhatsAppConversationSession {
  const messages = [
    msg('c0', '2026-09-15T10:00:00', 'inbound', 'عايز الاوردر ده لو سمحت', 'العميل'),
    msg('o1', '2026-09-15T10:02:00', 'outbound', 'مع حضرتك د اسلام، حاضر هظبط لحضرتك الطلب', 'اسلام'),
    msg('o2', '2026-09-15T10:05:00', 'outbound', 'تم تأكيد الطلب', 'اسلام'),
    msg('c1', '2026-09-15T10:06:00', 'inbound', 'تمام شكرا', 'العميل'),
    msg('c2', '2026-09-15T11:30:00', 'inbound', 'الاوردر اتأخر ولسه ماوصلش', 'العميل'),
    msg('o3', '2026-09-15T11:35:00', 'outbound', 'مع حضرتك د مي، بنعتذر عن التأخير وبنتابع مع الفريق المختص', 'مي'),
    msg('c3', '2026-09-15T11:40:00', 'inbound', 'تمام متشكر جدا', 'العميل'),
  ];
  return {
    id: 's-roundtrip',
    startedAt: messages[0].timestamp,
    endedAt: messages[messages.length - 1].timestamp,
    messages,
    participants: ['العميل', 'اسلام', 'مي'],
    outboundStaffNames: ['اسلام', 'مي'],
    customerName: 'ابراهيم الصياد',
    mediaCount: 0,
    missingMediaCount: 0,
    replyCount: 0,
    forwardedCount: 0,
  };
}

const CLEAR_DECISION: SmartQuickDecisionResult = {
  decision: 'clear',
  reasons: [],
  affectedCriteria: [],
  evidenceMessageIds: [],
  safeToQuickApprove: true,
};

function buildStaffSnapshot(args: {
  caseSession: WhatsAppConversationSession;
  staffName: string;
  caseTimingV28: ConversationTimingV28;
  caseDelayAttributionV29: ReturnType<typeof buildDelayAttributionV29>;
}): ConversationReviewSnapshot {
  const scope = applySmartReviewMessageScope(args.caseSession, { staffName: args.staffName, contextMessages: 2 });
  expect(scope.valid).toBe(true);
  expect(scope.scoredSession).not.toBeNull();

  const staffTimingOnOwnedOnly = buildConversationTimingV28(scope.scoredSession!);
  const focus = buildConversationFocusV30(args.caseSession, {
    scoredMessageIds: scope.inScopeMessageIds,
    timing: args.caseTimingV28,
    delayAttribution: args.caseDelayAttributionV29,
  });
  const v31 = buildEvaluationConversationV31(args.caseSession, {
    scoredMessageIds: scope.inScopeMessageIds,
    focus,
    staffTiming: staffTimingOnOwnedOnly,
  });
  const evaluationSession = v31.session;
  const focusedStaffTimingV28 = buildConversationTimingV28(evaluationSession);

  const includedIds = new Set(v31.includedMessageIds);
  const focusedScoredIds = scope.inScopeMessageIds.filter((id) => includedIds.has(id));
  const focusedContextIds = v31.includedMessageIds.filter((id) => !focusedScoredIds.includes(id));

  const smartIntelligence: SmartIntelligenceSnapshotV1 = {
    version: 'smart-intelligence-snapshot-v1',
    generatedAt: '2026-09-15T12:00:00.000Z',
    journey: {} as SmartIntelligenceSnapshotV1['journey'],
    staffEffort: [],
    invoiceVerification: {} as SmartIntelligenceSnapshotV1['invoiceVerification'],
    customer: null,
    purchaseHistory: null,
    branchHint: null,
    bestMessageSignals: [],
    evaluationV2: null,
    timingV28: args.caseTimingV28,
    staffTimingV28: focusedStaffTimingV28,
    delayAttributionV29: args.caseDelayAttributionV29,
    evidence: { engineVersions: {} },
  };

  return buildConversationReviewSnapshot({
    session: evaluationSession,
    displayMessages: evaluationSession.messages,
    fullCaseDisplayMessages: args.caseSession.messages,
    scoredMessageIds: focusedScoredIds,
    contextMessageIds: focusedContextIds,
    staffName: args.staffName,
    staffRole: 'pharmacist',
    decision: CLEAR_DECISION,
    smartIntelligence,
  });
}

// يحاكي jsonb الحقيقي في Postgres: Supabase بيرجع JS object جاهز من raw_scores،
// فمحاكاة الحفظ/القراءة بـJSON.stringify/parse مطابقة لسلوك jsonb لأنواعنا كلها JSON-safe.
function roundTripThroughDb(snapshot: ConversationReviewSnapshot) {
  const savedPayload = { raw_scores: { conversation_snapshot: snapshot } };
  const persisted = JSON.parse(JSON.stringify(savedPayload));
  const row = { raw_scores: persisted.raw_scores };
  return snapshotFromReviewRow(row);
}

describe('Conversation review snapshot end-to-end (V27 -> V30 -> V31 -> snapshot -> save -> read)', () => {
  it('keeps the focused evaluation conversation a strict subset of the full case for each staff independently', () => {
    const caseSession = buildCaseSession();
    const caseContexts = buildWhatsAppCaseContextsV27([caseSession]);
    expect(caseContexts.contexts).toHaveLength(1);
    const merged = caseContexts.contexts[0].mergedSession;

    const caseTimingV28 = buildConversationTimingV28(merged);
    const caseDelayAttributionV29 = buildDelayAttributionV29(merged, caseTimingV28);
    expect(caseDelayAttributionV29.detected).toBe(true);

    const islamSnapshot = buildStaffSnapshot({ caseSession: merged, staffName: 'اسلام', caseTimingV28, caseDelayAttributionV29 });
    const mayySnapshot = buildStaffSnapshot({ caseSession: merged, staffName: 'مي', caseTimingV28, caseDelayAttributionV29 });

    // 1) المحادثة أثناء الإنشاء (snapshot.messages) هي V31 المركزة، ومفيش تسريب: نفس عدد
    //    رسائلها (بعد فرز context/scored) أبدًا مايتجاوزش عدد رسائل الحالة كاملة. في هذه
    //    الحالة الصغيرة (رحلة واحدة قصيرة، تسليم واحد) كل الرسائل صارت مركزية فعلًا (Turn
    //    عميل، Milestone تأخير/تسليم) فمفيش استبعاد فعلي هنا - سلوك الاستبعاد الحقيقي
    //    (لرسالة خلفية غير مرتبطة) مُختبر بشكل مخصص في whatsappEvaluationConversationV31.test.ts.
    expect(islamSnapshot.messages.length).toBeLessThanOrEqual(islamSnapshot.fullCaseMessages!.length);
    expect(mayySnapshot.messages.length).toBeLessThanOrEqual(mayySnapshot.fullCaseMessages!.length);

    // 2) fullCaseMessages يحمل نفس عدد رسائل الـCase الكاملة لكل الأطراف (Audit فقط).
    expect(islamSnapshot.fullCaseMessages).toHaveLength(merged.messages.length);
    expect(mayySnapshot.fullCaseMessages).toHaveLength(merged.messages.length);

    // 3) أي رسالة "scored" (تدخل في نقاط الموظف) لازم تكون من نفس الموظف بس -
    //    ممنوع نقاط اسلام تتحسب من رسالة مي أو العكس.
    for (const message of islamSnapshot.messages.filter((m) => m.scope === 'scored')) {
      expect(message.direction === 'outbound' ? message.sender : 'العميل').not.toBe('مي');
    }
    for (const message of mayySnapshot.messages.filter((m) => m.scope === 'scored')) {
      expect(message.direction === 'outbound' ? message.sender : 'العميل').not.toBe('اسلام');
    }

    // مي لا يمكن أن "تسرق" رسائل اسلام الصريحة (o1/o2) كـscored، والعكس صحيح.
    const islamScoredIds = islamSnapshot.messages.filter((m) => m.scope === 'scored').map((m) => m.id);
    const mayyScoredIds = mayySnapshot.messages.filter((m) => m.scope === 'scored').map((m) => m.id);
    expect(islamScoredIds).toEqual(expect.arrayContaining(['o1', 'o2']));
    expect(mayyScoredIds).not.toContain('o1');
    expect(mayyScoredIds).not.toContain('o2');
    expect(mayyScoredIds).toEqual(expect.arrayContaining(['o3']));
    expect(islamScoredIds).not.toContain('o3');

    // 4) توقيت كل موظف مستقل: أول رد اسلام محسوب من طلب العميل الأصلي، بينما استجابة
    //    مي محسوبة من شكوى التأخير التي ردت عليها هي، مش من بداية الـCase كله.
    const islamTiming = islamSnapshot.smartIntelligence!.staffTimingV28!;
    const mayyTiming = mayySnapshot.smartIntelligence!.staffTimingV28!;
    expect(islamTiming.responseSummary.firstResponseSeconds).not.toBeNull();
    expect(mayyTiming.responseSummary.firstResponseSeconds).not.toBeNull();
    // فارق الرد بتاع مي لازم يتحسب من شكواها هي (خلال دقايق) مش من أول رسالة في الـCase (ساعة ونص).
    expect(mayyTiming.responseSummary.firstResponseSeconds as number).toBeLessThan(islamTiming.totalCaseMinutes * 60);

    // 5) سبب التأخير (V29) محفوظ في الاثنين، وممنوع خصم تلقائي على أي حد.
    expect(islamSnapshot.smartIntelligence!.delayAttributionV29!.shouldPenalizeCurrentStaffAutomatically).toBe(false);
    expect(mayySnapshot.smartIntelligence!.delayAttributionV29!.shouldPenalizeCurrentStaffAutomatically).toBe(false);
  });

  it('round-trips messages, fullCaseMessages, staffTimingV28 and delayAttributionV29 losslessly through save+read', () => {
    const caseSession = buildCaseSession();
    const merged = buildWhatsAppCaseContextsV27([caseSession]).contexts[0].mergedSession;
    const caseTimingV28 = buildConversationTimingV28(merged);
    const caseDelayAttributionV29 = buildDelayAttributionV29(merged, caseTimingV28);
    const before = buildStaffSnapshot({ caseSession: merged, staffName: 'اسلام', caseTimingV28, caseDelayAttributionV29 });

    const after = roundTripThroughDb(before);
    expect(after).not.toBeNull();

    // نفس الرسائل بالضبط ونفس الترتيب - مش نسخة تانية ولا Full Case بدل المركزة.
    expect(after!.messages).toEqual(before.messages);
    expect(after!.messages.map((m) => m.id)).toEqual(before.messages.map((m) => m.id));
    expect(after!.fullCaseMessages).toEqual(before.fullCaseMessages);
    expect(after!.smartIntelligence!.staffTimingV28).toEqual(before.smartIntelligence!.staffTimingV28);
    expect(after!.smartIntelligence!.delayAttributionV29).toEqual(before.smartIntelligence!.delayAttributionV29);

    // ومفيش أي تسريب بعد القراءة: عدد رسائل المحادثة المركزة يفضل بالظبط زي قبل الحفظ،
    // وأبدًا مايتجاوزش عدد رسائل الرحلة كاملة.
    expect(after!.messages.length).toBeLessThanOrEqual(after!.fullCaseMessages!.length);
    expect(after!.messages.length).toBe(before.messages.length);

    // نفس الشيء لازم يتحقق سواء اتقرا من عمود conversation_snapshot مباشرة أو من
    // جوه raw_scores - الاتنين مسارات قراءة حقيقية مستخدمة في الكود.
    const direct = parseConversationReviewSnapshot(JSON.parse(JSON.stringify(before)));
    expect(direct).toEqual(before);
  });
});
