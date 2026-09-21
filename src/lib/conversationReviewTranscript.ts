import type { WhatsAppConversationSession, WhatsAppParsedMessage } from './whatsappConversationParser';
import type { SmartQuickDecisionResult } from './whatsappSmartReviewDecision';
import type { SmartStaffRole } from './whatsappSmartReviewOwnership';
import type { StaffMessageEffort } from './whatsappOutboundMessageBursts';
import type { SmartIntelligenceSnapshotV1 } from './whatsappSmartIntelligenceSnapshot';
import type { ResolvedStaffIdentity } from './whatsappStaffIdentityResolver';
import type { SmartOfficialReviewDraftV1 } from './whatsappSmartOfficialReviewDraft';
import type { ConversationFocusV30, ConversationFocusLevelV30 } from './whatsappConversationFocusV30';

export type ConversationReviewMessageScope = 'scored' | 'context';

export interface ConversationReviewSnapshotMessage {
  id: string;
  timestamp: string;
  sender: string;
  direction: 'inbound' | 'outbound' | 'system';
  kind: string;
  text: string;
  scope: ConversationReviewMessageScope;
  evidence: boolean;
  /**
   * مستوى الأهمية للعرض فقط. لا يغيّر نطاق التقييم أو النقاط.
   * primary/supporting/background محسوبة على مستوى الـCase الكاملة.
   */
  focusLevel?: ConversationFocusLevelV30;
  focusScore?: number;
  focusReasons?: string[];
}

export interface ConversationReviewSnapshot {
  version: 1;
  source: 'whatsapp_export';
  sourceFileName: string | null;
  sessionId: string;
  customerName: string | null;
  staffName: string;
  staffRole: SmartStaffRole;
  /**
   * هوية الموظف الحقيقية (whatsappStaffIdentityResolver.ts) — staffId/branch/confidence
   * محسوبين وقت الاستيراد. لو موجودة ومش ambiguous، Reviews.tsx المفروض يستخدمها مباشرة
   * ومايعملش إعادة تخمين بالاسم. staffName فوق يفضل الاسم الظاهر في المحادثة (display name)
   * للعرض بس — مش مصدر الهوية الرسمي. Optional عشان أي snapshot قديم يفضل صالح.
   */
  staffIdentity?: ResolvedStaffIdentity;
  /**
   * اقتراح فعلي لكل بند تقييم رسمي (whatsappSmartOfficialReviewDraft.ts) — AI evaluates,
   * human approves. ممنوع severeErrorAutoApplied يبقى غير false، وممنوع أي اعتماد نقاط
   * قبل حفظ بشري. Optional عشان أي snapshot قديم يفضل صالح.
   */
  officialReviewDraft?: SmartOfficialReviewDraftV1;
  createdAt: string;
  scope: {
    from: string | null;
    to: string | null;
    scoredMessageIds: string[];
    contextMessageIds: string[];
  };
  decision: {
    value: SmartQuickDecisionResult['decision'];
    reasons: string[];
    affectedCriteria: string[];
    safeToQuickApprove: boolean;
  };
  messages: ConversationReviewSnapshotMessage[];
  /** النسخة الكاملة للـCase للمراجعة عند الحاجة. العرض/التقييم الافتراضي يعتمد على messages المركزة. */
  fullCaseMessages?: ConversationReviewSnapshotMessage[];
  /**
   * مقاييس burst للرسائل الصادرة (whatsappOutboundMessageBursts.ts) — قراءة/عرض فقط،
   * تشخيصية بحتة. ممنوع استخدامها في أي KPI رسمي أو نقاط حاليًا (لسه ما اتحقّقتش على
   * بيانات حقيقية — راجع threshold الـ10 دقائق في مراجعة التكامل). Optional عشان أي snapshot
   * قديم من غير الحقل ده يفضل صالح للقراءة.
   */
  outboundBurstMetrics?: StaffMessageEffort[];
  /**
   * عقد الخرج الموحّد من طبقة التحليل الذكي الإضافي (whatsappSmartIntelligenceSnapshot.ts) —
   * journey/saleState/staffEffort/invoiceVerification + حقول لسه مش متربطة (customer/
   * purchaseHistory/branchHint/bestMessageSignals). قراءة فقط، مفيش write منفصل — بيتحفظ
   * بس لما المراجع البشري يحفظ التقييم الرسمي عبر المسار الموجود أصلًا (raw_scores.
   * conversation_snapshot في Reviews.tsx). Optional عشان أي snapshot قديم يفضل صالح.
   */
  smartIntelligence?: SmartIntelligenceSnapshotV1;
  conversationFocusV30?: ConversationFocusV30;
  /**
   * حقول تدقيق (Audit) لقرار الاعتماد البشري على SmartOfficialReviewDraftV1 — تتسجل في
   * Reviews.tsx وقت الحفظ فقط، وممنوع تتحول لجدول منفصل أو تُستخدم كمصدر نقاط مستقل.
   * كلها Optional عشان أي snapshot قديم أو محادثة من غير Draft ذكي يفضل صالح.
   */
  smartDraftGeneratedAt?: string | null;
  smartDraftVersion?: string | null;
  smartSuggestedScore?: number | null;
  humanDecision?: 'approved_as_is' | 'edited_then_approved' | 'rejected' | null;
  humanModifiedCriteriaCount?: number | null;
}

const TRANSFER_KEY = 'dawaa_pending_conversation_review_snapshot_v1';

function text(value: unknown) {
  return String(value ?? '').trim();
}

function parseJson(value: unknown) {
  if (!value) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value as any;
}

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function buildConversationReviewSnapshot(args: {
  session: WhatsAppConversationSession;
  displayMessages: WhatsAppParsedMessage[];
  fullCaseDisplayMessages?: WhatsAppParsedMessage[];
  scoredMessageIds: string[];
  contextMessageIds: string[];
  evidenceMessageIds?: string[];
  staffName: string;
  staffRole: SmartStaffRole;
  sourceFileName?: string | null;
  from?: Date | null;
  to?: Date | null;
  decision: SmartQuickDecisionResult;
  outboundBurstMetrics?: StaffMessageEffort[];
  smartIntelligence?: SmartIntelligenceSnapshotV1;
  staffIdentity?: ResolvedStaffIdentity;
  officialReviewDraft?: SmartOfficialReviewDraftV1;
  conversationFocusV30?: ConversationFocusV30;
}): ConversationReviewSnapshot {
  const scored = new Set(args.scoredMessageIds);
  const context = new Set(args.contextMessageIds);
  const evidence = new Set(args.evidenceMessageIds || args.decision.evidenceMessageIds || []);
  const ordered = args.displayMessages
    .filter((message) => scored.has(message.id) || context.has(message.id))
    .slice()
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  const toSnapshotMessage = (message: WhatsAppParsedMessage): ConversationReviewSnapshotMessage => {
    const focus = args.conversationFocusV30?.messages.find((row) => row.messageId === message.id);
    return {
      id: message.id,
      timestamp: message.timestamp.toISOString(),
      sender: message.sender,
      direction: message.direction,
      kind: message.kind,
      text: String(message.text || ''),
      scope: scored.has(message.id) ? 'scored' : 'context',
      evidence: evidence.has(message.id),
      ...(focus ? {
        focusLevel: focus.level,
        focusScore: focus.score,
        focusReasons: focus.reasons,
      } : {}),
    };
  };

  const fullCaseOrdered = (args.fullCaseDisplayMessages || [])
    .slice()
    .sort((a,b) => a.timestamp.getTime() - b.timestamp.getTime());

  return {
    version: 1,
    source: 'whatsapp_export',
    sourceFileName: text(args.sourceFileName) || null,
    sessionId: args.session.id,
    customerName: args.session.customerName || null,
    staffName: text(args.staffName),
    staffRole: args.staffRole,
    ...(args.staffIdentity ? { staffIdentity: args.staffIdentity } : {}),
    ...(args.officialReviewDraft ? { officialReviewDraft: args.officialReviewDraft } : {}),
    createdAt: new Date().toISOString(),
    scope: {
      from: iso(args.from),
      to: iso(args.to),
      scoredMessageIds: args.scoredMessageIds.slice(),
      contextMessageIds: args.contextMessageIds.slice(),
    },
    decision: {
      value: args.decision.decision,
      reasons: args.decision.reasons.slice(),
      affectedCriteria: args.decision.affectedCriteria.slice(),
      safeToQuickApprove: args.decision.safeToQuickApprove,
    },
    messages: ordered.map(toSnapshotMessage),
    ...(fullCaseOrdered.length ? { fullCaseMessages: fullCaseOrdered.map(toSnapshotMessage) } : {}),
    ...(args.outboundBurstMetrics ? { outboundBurstMetrics: args.outboundBurstMetrics } : {}),
    ...(args.smartIntelligence ? { smartIntelligence: args.smartIntelligence } : {}),
    ...(args.conversationFocusV30 ? { conversationFocusV30: args.conversationFocusV30 } : {}),
  };
}

export function parseConversationReviewSnapshot(value: unknown): ConversationReviewSnapshot | null {
  const direct = parseJson(value);
  const candidate = direct?.conversation_snapshot
    ? parseJson(direct.conversation_snapshot)
    : direct?.raw_scores
      ? parseJson(direct.raw_scores)?.conversation_snapshot
      : direct;
  if (!candidate || candidate.version !== 1 || candidate.source !== 'whatsapp_export') return null;
  if (!Array.isArray(candidate.messages) || !candidate.scope || !candidate.decision) return null;
  return candidate as ConversationReviewSnapshot;
}

export function snapshotFromReviewRow(row: Record<string, unknown> | null | undefined) {
  if (!row) return null;
  const direct = parseConversationReviewSnapshot(row.conversation_snapshot);
  if (direct) return direct;
  const raw = parseJson(row.raw_scores);
  return parseConversationReviewSnapshot(raw?.conversation_snapshot);
}

export function writePendingConversationReviewTransfer(snapshot: ConversationReviewSnapshot) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(TRANSFER_KEY, JSON.stringify(snapshot));
}

export function readPendingConversationReviewTransfer(): ConversationReviewSnapshot | null {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(TRANSFER_KEY);
  return parseConversationReviewSnapshot(raw);
}

export function clearPendingConversationReviewTransfer() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(TRANSFER_KEY);
}
