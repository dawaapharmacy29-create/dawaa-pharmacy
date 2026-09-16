import type { WhatsAppConversationSession, WhatsAppParsedMessage } from './whatsappConversationParser';

export type JourneySessionRole =
  | 'order_request'
  | 'complaint_or_failure'
  | 'service_feedback_request'
  | 'apology_recovery'
  | 'recommendation_followup'
  | 'general_followup'
  | 'other';

export type JourneyRisk = 'low' | 'medium' | 'high' | 'critical';

export interface JourneySessionAssessment {
  sessionId: string;
  role: JourneySessionRole;
  label: string;
  startedAt: string;
  endedAt: string;
  staffNames: string[];
  customerReplied: boolean;
  customerSilentAfterOutbound: boolean;
  orderIntent: boolean;
  orderFailed: boolean;
  delayDetected: boolean;
  complaintDetected: boolean;
  apologyDetected: boolean;
  feedbackRequestDetected: boolean;
  recommendationDetected: boolean;
  evidenceMessageIds: string[];
  confidence: number;
}

export interface JourneyStaffAssessment {
  staffName: string;
  relevantSessionIds: string[];
  positiveSignals: string[];
  improvementSignals: string[];
  shouldReviewPerformance: boolean;
  rationale: string;
}

export interface JourneyOperationalAction {
  key: string;
  type: 'customer_followup' | 'customer_request' | 'complaint_followup' | 'recommendation_followup' | 'manual_review';
  priority: 'normal' | 'important' | 'urgent';
  reason: string;
  dueInHours: number | null;
  keepOpenUntil: 'customer_reengages' | 'resolved' | 'manual_close';
  autoEligible: boolean;
  evidenceSessionIds: string[];
}

export interface WhatsAppCustomerJourneyIntelligenceV15 {
  version: 'whatsapp-customer-journey-v15';
  sessionCount: number;
  meaningfulSessionCount: number;
  sessions: JourneySessionAssessment[];
  staffAssessments: JourneyStaffAssessment[];
  customerRisk: JourneyRisk;
  customerState: 'active' | 'silent_after_problem' | 'silent_after_recovery' | 'reengaged' | 'unknown';
  unresolvedOrder: boolean;
  unresolvedComplaint: boolean;
  recoveryAttempts: number;
  customerReplyAfterProblem: boolean;
  summary: string;
  improvementInsights: string[];
  actions: JourneyOperationalAction[];
}

const t = (messages: WhatsAppParsedMessage[]) => messages.map((m) => m.text).join('\n');
const inbound = (s: WhatsAppConversationSession) => s.messages.filter((m) => m.direction === 'inbound');
const outbound = (s: WhatsAppConversationSession) => s.messages.filter((m) => m.direction === 'outbound');
const has = (value: string, rx: RegExp) => rx.test(value);

const ORDER_RX = /(عايز|عاوز|محتاج|ابعت|ابعث|هات|اطلب|أطلب|متوفر|موجود عندكم|عندكم|اوردر|أوردر|طلب)/i;
const ORDER_CLOSE_RX = /(تم تأكيد|تم التاكيد|الأوردر اتأكد|الاوردر اتاكد|جاري الارسال|جاري الإرسال|خرج لحضرتك|فاتوره|فاتورة)/i;
const FAILURE_RX = /(ماوصلش|موصلش|الاوردر ماطلعش|الأوردر ماطلعش|الطلب ماطلعش|محدش جه|ماجاش|مجاش|اتلغى|اتلغي|لم يتم|ما تمش)/i;
const DELAY_RX = /(متاخر|متأخر|تاخير|تأخير|اتأخر|اتاخرت|استنيت|انتظرت|لسه مجاش|لسه ماوصلش)/i;
const COMPLAINT_RX = /(شكوي|شكوى|زعلت|اتضايقت|مش راضي|مش مبسوط|خدمه سيئه|خدمة سيئة|مشكله|مشكلة|محدش رد)/i;
const APOLOGY_RX = /(بنعتذر|نعتذر|متاسف|متأسف|آسفين|اسفين|حق حضرتك علينا|نعتذر لحضرتك|نعوض حضرتك)/i;
const FEEDBACK_RX = /(راضي عن الخدمه|راضي عن الخدمة|كانت الخدمه|كانت الخدمة|تقييم الخدمه|تقييم الخدمة|على مستوى رضا|رأي حضرتك|راي حضرتك)/i;
const RECOMMEND_RX = /(ارشح|أرشح|نرشح|ترشيح|انصح|أنصح|بديل|ممكن تستخدم|ممكن تاخد|ممكن تاخدي)/i;
const FOLLOWUP_RX = /(حابين نطمن|حبيت اطمن|حبيت أطمن|متابعه|متابعة|بنطمن|نطمن|اول ما|أول ما|هتابع|هتواصل)/i;

function lastMeaningfulDirection(session: WhatsAppConversationSession) {
  const rows = session.messages.filter((m) => m.direction !== 'system' && m.text.trim());
  return rows.at(-1)?.direction || 'system';
}

function classifySession(session: WhatsAppConversationSession): JourneySessionAssessment {
  const inText = t(inbound(session));
  const outText = t(outbound(session));
  const all = `${inText}\n${outText}`;
  const orderIntent = has(inText, ORDER_RX);
  const orderClosed = has(all, ORDER_CLOSE_RX);
  const orderFailed = has(all, FAILURE_RX) || (orderIntent && has(all, DELAY_RX) && !orderClosed);
  const delayDetected = has(all, DELAY_RX);
  const complaintDetected = has(all, COMPLAINT_RX) || (orderFailed && delayDetected);
  const apologyDetected = has(outText, APOLOGY_RX);
  const feedbackRequestDetected = has(outText, FEEDBACK_RX);
  const recommendationDetected = has(outText, RECOMMEND_RX);
  const customerReplied = inbound(session).length > 0;
  const customerSilentAfterOutbound = outbound(session).length > 0 && lastMeaningfulDirection(session) === 'outbound';

  let role: JourneySessionRole = 'other';
  if (orderIntent && (orderFailed || complaintDetected)) role = 'complaint_or_failure';
  else if (orderIntent) role = 'order_request';
  else if (apologyDetected) role = 'apology_recovery';
  else if (feedbackRequestDetected) role = 'service_feedback_request';
  else if (recommendationDetected) role = 'recommendation_followup';
  else if (has(outText, FOLLOWUP_RX)) role = 'general_followup';

  const label: Record<JourneySessionRole, string> = {
    order_request: 'طلب عميل',
    complaint_or_failure: 'طلب متعثر / شكوى',
    service_feedback_request: 'طلب تقييم الخدمة',
    apology_recovery: 'اعتذار واسترجاع العميل',
    recommendation_followup: 'متابعة ترشيح',
    general_followup: 'متابعة من الصيدلية',
    other: 'جلسة عامة',
  };

  const evidenceMessageIds = session.messages
    .filter((m) => ORDER_RX.test(m.text) || FAILURE_RX.test(m.text) || DELAY_RX.test(m.text) || COMPLAINT_RX.test(m.text) || APOLOGY_RX.test(m.text) || FEEDBACK_RX.test(m.text) || RECOMMEND_RX.test(m.text))
    .map((m) => m.id)
    .slice(0, 20);

  let confidence = 58;
  if (role === 'complaint_or_failure') confidence = orderFailed && delayDetected ? 94 : 86;
  else if (role === 'apology_recovery' || role === 'service_feedback_request') confidence = 92;
  else if (role === 'order_request' || role === 'recommendation_followup') confidence = 84;

  return {
    sessionId: session.id,
    role,
    label: label[role],
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt.toISOString(),
    staffNames: session.outboundStaffNames,
    customerReplied,
    customerSilentAfterOutbound,
    orderIntent,
    orderFailed,
    delayDetected,
    complaintDetected,
    apologyDetected,
    feedbackRequestDetected,
    recommendationDetected,
    evidenceMessageIds,
    confidence,
  };
}

export function buildWhatsAppCustomerJourneyIntelligenceV15(sessions: WhatsAppConversationSession[]): WhatsAppCustomerJourneyIntelligenceV15 {
  const ordered = [...sessions].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  const assessed = ordered.map(classifySession);
  const problemIndex = assessed.findIndex((s) => s.orderFailed || s.complaintDetected);
  const problemSession = problemIndex >= 0 ? assessed[problemIndex] : null;
  const later = problemIndex >= 0 ? assessed.slice(problemIndex + 1) : [];
  const recoveryAttempts = later.filter((s) => s.apologyDetected || s.feedbackRequestDetected || s.role === 'general_followup').length;
  const customerReplyAfterProblem = problemIndex >= 0
    ? ordered.slice(problemIndex + 1).some((s) => inbound(s).length > 0)
    : false;
  const unresolvedOrder = Boolean(problemSession?.orderFailed && !customerReplyAfterProblem);
  const unresolvedComplaint = Boolean(problemSession?.complaintDetected && !customerReplyAfterProblem);

  let customerState: WhatsAppCustomerJourneyIntelligenceV15['customerState'] = 'unknown';
  if (problemSession && customerReplyAfterProblem) customerState = 'reengaged';
  else if (problemSession && recoveryAttempts > 0 && !customerReplyAfterProblem) customerState = 'silent_after_recovery';
  else if (problemSession && !customerReplyAfterProblem) customerState = 'silent_after_problem';
  else if (assessed.some((s) => s.orderIntent)) customerState = 'active';

  let customerRisk: JourneyRisk = 'low';
  if (unresolvedOrder && recoveryAttempts >= 2) customerRisk = 'critical';
  else if (unresolvedOrder || unresolvedComplaint) customerRisk = 'high';
  else if (recoveryAttempts > 0 && !customerReplyAfterProblem) customerRisk = 'medium';

  const staffMap = new Map<string, JourneyStaffAssessment>();
  for (const session of assessed) {
    for (const staffName of session.staffNames) {
      const existing = staffMap.get(staffName) || {
        staffName,
        relevantSessionIds: [],
        positiveSignals: [],
        improvementSignals: [],
        shouldReviewPerformance: false,
        rationale: '',
      };
      existing.relevantSessionIds.push(session.sessionId);
      if (session.apologyDetected) existing.positiveSignals.push('شارك في محاولة استرجاع العميل واحتواء التجربة.');
      if (session.feedbackRequestDetected) existing.positiveSignals.push('تمت محاولة قياس رضا العميل بعد الخدمة.');
      if (session.orderFailed) {
        existing.improvementSignals.push('الطلب لم يكتمل/لم يصل ويحتاج مراجعة مسؤولية التنفيذ والتواصل في الجلسة الأصلية.');
        existing.shouldReviewPerformance = true;
      }
      if (session.delayDetected) {
        existing.improvementSignals.push('تم رصد تأخير مرتبط بالطلب ويجب مراجعة سرعة التصعيد وإبلاغ العميل.');
        existing.shouldReviewPerformance = true;
      }
      staffMap.set(staffName, existing);
    }
  }
  const staffAssessments = [...staffMap.values()].map((row) => ({
    ...row,
    positiveSignals: [...new Set(row.positiveSignals)],
    improvementSignals: [...new Set(row.improvementSignals)],
    rationale: row.shouldReviewPerformance
      ? 'التقييم يجب أن يركز على الجلسة التي بدأ فيها الطلب وتعثر، ولا يُحمّل عدم رد العميل في جلسات المتابعة اللاحقة كخطأ على موظف جديد.'
      : 'لا توجد إشارة كافية لخطأ تشغيلي مباشر؛ أي تقييم رسمي يحتاج مراجعة بشرية للدليل.',
  }));

  const actions: JourneyOperationalAction[] = [];
  if (unresolvedOrder || unresolvedComplaint) {
    actions.push({
      key: 'journey-recovery-followup',
      type: unresolvedComplaint ? 'complaint_followup' : 'customer_followup',
      priority: customerRisk === 'critical' ? 'urgent' : 'important',
      reason: recoveryAttempts > 0
        ? `العميل لم يعد للرد بعد مشكلة الطلب رغم ${recoveryAttempts} محاولة متابعة/استرجاع؛ استمر في المتابعة الذكية حتى إعادة التفاعل أو إغلاق السبب.`
        : 'الطلب تعثر والعميل لم يعد للرد؛ يلزم استرجاع العميل ومتابعته.',
      dueInHours: customerRisk === 'critical' ? 6 : 24,
      keepOpenUntil: 'customer_reengages',
      autoEligible: true,
      evidenceSessionIds: assessed.filter((s) => s.orderFailed || s.complaintDetected || s.apologyDetected || s.feedbackRequestDetected).map((s) => s.sessionId),
    });
  }
  if (assessed.some((s) => s.recommendationDetected) && !customerReplyAfterProblem) {
    actions.push({
      key: 'journey-recommendation-followup',
      type: 'recommendation_followup',
      priority: 'normal',
      reason: 'يوجد ترشيح/بديل في الرحلة ويجب التأكد من قرار العميل والنتيجة قبل اعتبار الفرصة منتهية.',
      dueInHours: 24,
      keepOpenUntil: 'resolved',
      autoEligible: true,
      evidenceSessionIds: assessed.filter((s) => s.recommendationDetected).map((s) => s.sessionId),
    });
  }

  const improvementInsights: string[] = [];
  if (problemSession?.delayDetected) improvementInsights.push('قياس وقت الطلب → أول تصعيد → إبلاغ العميل، وتحديد أين حدث التأخير بالضبط.');
  if (problemSession?.orderFailed) improvementInsights.push('ربط الطلب المتعثر بالفاتورة/الدليفري لمعرفة هل لم يُسجل، لم يخرج، أم خرج ولم يصل.');
  if (recoveryAttempts >= 1 && !customerReplyAfterProblem) improvementInsights.push('منع إغلاق العميل بعد رسالة اعتذار واحدة؛ يبقى في Recovery Queue مع cadence متابعة بدون إزعاج.');
  if (assessed.some((s) => s.feedbackRequestDetected && s.customerSilentAfterOutbound)) improvementInsights.push('عدم الرد على استبيان الخدمة إشارة صمت وليست رضا؛ لا تُحسب كنتيجة إيجابية أو سلبية وحدها.');

  let summary = `تم ربط ${assessed.length} جلسة في رحلة عميل واحدة.`;
  if (problemSession) {
    summary += ` رُصد ${problemSession.orderFailed ? 'تعثر طلب' : 'شكوى'} في الجلسة الأصلية`;
    if (problemSession.delayDetected) summary += ' مع تأخير';
    summary += '.';
  }
  if (recoveryAttempts) summary += ` تمت ${recoveryAttempts} محاولة متابعة/استرجاع لاحقة.`;
  if (!customerReplyAfterProblem && problemSession) summary += ' العميل لم يعد للرد حتى الآن، لذلك الحالة ما زالت مفتوحة للاسترجاع.';

  return {
    version: 'whatsapp-customer-journey-v15',
    sessionCount: assessed.length,
    meaningfulSessionCount: assessed.filter((s) => s.role !== 'other').length,
    sessions: assessed,
    staffAssessments,
    customerRisk,
    customerState,
    unresolvedOrder,
    unresolvedComplaint,
    recoveryAttempts,
    customerReplyAfterProblem,
    summary,
    improvementInsights,
    actions,
  };
}
