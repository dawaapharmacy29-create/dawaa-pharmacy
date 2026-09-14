import type { WhatsAppConversationSession, WhatsAppParsedMessage } from './whatsappConversationParser';
import { extractConversationSignals } from './whatsappConversationSignals';

export type SmartSessionKind = 'customer_conversation' | 'pharmacy_followup' | 'customer_ping' | 'mixed';

export interface FileIdentity {
  customerName: string | null;
  customerCode: string | null;
}

export interface SmartSessionView {
  session: WhatsAppConversationSession;
  customerName: string | null;
  kind: SmartSessionKind;
  meaningful: boolean;
}

export interface EvidenceItem {
  id: string;
  type: 'positive' | 'warning' | 'critical' | 'info';
  label: string;
  detail: string;
  messageIds: string[];
  responsibility: 'doctor' | 'delivery' | 'stock' | 'system' | 'customer' | 'unknown';
  confidence: number;
}

export interface WholeConversationOverview {
  customerName: string | null;
  customerCode: string | null;
  totalSessions: number;
  meaningfulSessions: number;
  totalMessages: number;
  staffNames: string[];
  complaintSessions: number;
  saleIntentSessions: number;
  deliverySessions: number;
  followupSessions: number;
  mediaCount: number;
  averageConfidence: number;
}

const DELIVERY_TEXT = [/مندوب/i, /توصيل/i, /خرج لحضرتك/i, /الأوردر/i, /الاوردر/i];
const STOCK_TEXT = [/ناقص/i, /مش موجود/i, /غير متوفر/i, /هطلبه/i, /بديل/i];
const SYSTEM_TEXT = [/السيستم/i, /النظام/i, /البرنامج/i];
const COMPLAINT_TEXT = [/تأخير/i, /متأخر/i, /لسه/i, /مشكلة/i, /شكوى/i, /استعجل/i, /تستعجل/i];
const APOLOGY_TEXT = [/متاسف/i, /آسف/i, /بنعتذر/i, /نعتذر/i];

function includesAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

function cleanFileBaseName(name: string) {
  return name
    .replace(/\.(zip|txt|md)$/i, '')
    .replace(/^whatsapp chat with\s+/i, '')
    .replace(/^واتساب\s*/i, '')
    .replace(/^محادثة\s*/i, '')
    .replace(/^chat\s*/i, '')
    .trim();
}

export function inferIdentityFromFileName(name: string): FileIdentity {
  const base = cleanFileBaseName(name);
  if (!base) return { customerName: null, customerCode: null };
  const codeMatch = base.match(/(?:^|[\s_\-])([0-9٠-٩]{2,8})(?:$|[\s_\-])/);
  const customerCode = codeMatch?.[1] || null;
  let customerName = base
    .replace(/[\-_]+/g, ' ')
    .replace(/\b[0-9٠-٩]{2,8}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^(chat|whatsapp|واتساب|محادثة)$/i.test(customerName)) customerName = '';
  return { customerName: customerName || null, customerCode };
}

export function resolveConversationIdentity(
  sessions: WhatsAppConversationSession[],
  sourceFileName: string
): FileIdentity {
  const fromMessages = sessions
    .map((session) => session.customerName)
    .find((name): name is string => Boolean(name && name.toLowerCase() !== 'you'));
  const fromFile = inferIdentityFromFileName(sourceFileName);
  return {
    customerName: fromMessages || fromFile.customerName,
    customerCode: fromFile.customerCode,
  };
}

export function classifySession(session: WhatsAppConversationSession): SmartSessionKind {
  const inbound = session.messages.filter((message) => message.direction === 'inbound');
  const outbound = session.messages.filter((message) => message.direction === 'outbound');
  if (!inbound.length && outbound.length) return 'pharmacy_followup';
  if (inbound.length && !outbound.length) return 'customer_ping';
  if (inbound.length && outbound.length) return 'customer_conversation';
  return 'mixed';
}

export function buildSmartSessions(
  sessions: WhatsAppConversationSession[],
  sourceFileName: string
): { sessions: SmartSessionView[]; identity: FileIdentity; preferredSessionId: string | null } {
  const identity = resolveConversationIdentity(sessions, sourceFileName);
  const views = sessions.map((session) => {
    const kind = classifySession(session);
    const meaningful = kind === 'customer_conversation' && session.messages.length >= 3;
    return {
      session: { ...session, customerName: session.customerName || identity.customerName },
      customerName: session.customerName || identity.customerName,
      kind,
      meaningful,
    };
  });
  const preferred = views.find((item) => item.meaningful)
    || views.find((item) => item.kind === 'customer_conversation')
    || views[0]
    || null;
  return { sessions: views, identity, preferredSessionId: preferred?.session.id || null };
}

function responsibilityFor(message: WhatsAppParsedMessage) {
  const value = message.text || '';
  if (includesAny(value, DELIVERY_TEXT)) return 'delivery' as const;
  if (includesAny(value, STOCK_TEXT)) return 'stock' as const;
  if (includesAny(value, SYSTEM_TEXT)) return 'system' as const;
  return message.direction === 'outbound' ? 'doctor' as const : 'unknown' as const;
}

export function buildSessionEvidence(session: WhatsAppConversationSession): EvidenceItem[] {
  const signals = extractConversationSignals(session);
  const evidence: EvidenceItem[] = [];
  const complaintMessages = session.messages.filter((message) => includesAny(message.text, COMPLAINT_TEXT));
  if (complaintMessages.length) {
    evidence.push({
      id: `complaint-${session.id}`,
      type: 'warning',
      label: 'شكوى أو تصعيد محتمل',
      detail: `تم العثور على ${complaintMessages.length} رسالة تحمل مؤشرات شكوى/استعجال.`,
      messageIds: complaintMessages.map((message) => message.id),
      responsibility: responsibilityFor(complaintMessages[0]),
      confidence: 88,
    });
  }

  const apologyMessages = session.messages.filter((message) => message.direction === 'outbound' && includesAny(message.text, APOLOGY_TEXT));
  if (apologyMessages.length) {
    evidence.push({
      id: `apology-${session.id}`,
      type: 'positive',
      label: 'محاولة استعادة رضا العميل',
      detail: 'تم رصد اعتذار صريح من الصيدلية بعد المشكلة أو أثناء التعامل معها.',
      messageIds: apologyMessages.map((message) => message.id),
      responsibility: 'doctor',
      confidence: 95,
    });
  }

  const slow = signals.responseWaits.filter((item) => (item.seconds || 0) > 300);
  if (slow.length) {
    const worst = [...slow].sort((a, b) => (b.seconds || 0) - (a.seconds || 0))[0];
    evidence.push({
      id: `slow-${session.id}`,
      type: (worst.seconds || 0) > 600 ? 'critical' : 'warning',
      label: 'تأخير في الرد',
      detail: `يوجد ${slow.length} انتظار فوق 5 دقائق، وأطول انتظار ${Math.round((worst.seconds || 0) / 60)} دقيقة تقريبًا.`,
      messageIds: [worst.inboundMessageId, ...(worst.outboundMessageId ? [worst.outboundMessageId] : [])],
      responsibility: 'doctor',
      confidence: 100,
    });
  }

  if (signals.unansweredInboundCount) {
    const unanswered = signals.responseWaits.filter((item) => item.outboundMessageId == null);
    evidence.push({
      id: `unanswered-${session.id}`,
      type: 'warning',
      label: 'رسائل عميل بلا رد لاحق',
      detail: `${signals.unansweredInboundCount} رسالة واردة لم يظهر بعدها رد من الصيدلية داخل الجلسة.`,
      messageIds: unanswered.map((item) => item.inboundMessageId),
      responsibility: 'doctor',
      confidence: 100,
    });
  }

  if (signals.greetingDetected) {
    const greeting = session.messages.find((message) => message.direction === 'outbound' && /أهل|السلام|مع حضرتك|نورتنا/i.test(message.text));
    evidence.push({
      id: `greeting-${session.id}`,
      type: 'positive',
      label: 'ترحيب وتعريف',
      detail: 'تم رصد ترحيب أو تعريف من الصيدلية في المحادثة.',
      messageIds: greeting ? [greeting.id] : [],
      responsibility: 'doctor',
      confidence: 92,
    });
  }

  if (signals.mediaCount) {
    const media = session.messages.filter((message) => message.kind !== 'text');
    evidence.push({
      id: `media-${session.id}`,
      type: 'info',
      label: 'أدلة ميديا غير مقروءة',
      detail: `يوجد ${signals.mediaCount} عنصر ميديا؛ لا يتم افتراض محتواه في النسخة الحالية.`,
      messageIds: media.map((message) => message.id),
      responsibility: 'unknown',
      confidence: 100,
    });
  }

  return evidence;
}

export function buildWholeConversationOverview(
  smartSessions: SmartSessionView[],
  identity: FileIdentity
): WholeConversationOverview {
  const signalRows = smartSessions.map((item) => extractConversationSignals(item.session));
  return {
    customerName: identity.customerName,
    customerCode: identity.customerCode,
    totalSessions: smartSessions.length,
    meaningfulSessions: smartSessions.filter((item) => item.meaningful).length,
    totalMessages: smartSessions.reduce((sum, item) => sum + item.session.messages.length, 0),
    staffNames: Array.from(new Set(smartSessions.flatMap((item) => item.session.outboundStaffNames))),
    complaintSessions: signalRows.filter((row) => row.complaintOrEscalationDetected).length,
    saleIntentSessions: signalRows.filter((row) => row.saleIntentDetected).length,
    deliverySessions: signalRows.filter((row) => row.deliveryIntentDetected).length,
    followupSessions: smartSessions.filter((item) => item.kind === 'pharmacy_followup').length,
    mediaCount: signalRows.reduce((sum, row) => sum + row.mediaCount, 0),
    averageConfidence: signalRows.length
      ? Math.round(signalRows.reduce((sum, row) => sum + row.deterministicConfidence, 0) / signalRows.length)
      : 0,
  };
}
