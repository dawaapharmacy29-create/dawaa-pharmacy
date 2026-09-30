import type { WhatsAppConversationSession, WhatsAppParsedMessage } from './whatsappConversationParser';
import type { ConversationFocusV30 } from './whatsappConversationFocusV30';
import type { ConversationTimingV28 } from './whatsappConversationTimingV28';

export interface EvaluationConversationV31 {
  version: 'whatsapp-evaluation-conversation-v31';
  session: WhatsAppConversationSession;
  includedMessageIds: string[];
  excludedMessageIds: string[];
  excludedCount: number;
  includedCount: number;
  reasonsByMessageId: Record<string, string[]>;
}

const DELETED_RX = /(you deleted this message|this message was deleted|تم حذف هذه الرسالة|لقد حذفت هذه الرسالة)/i;

function cloneSession(source: WhatsAppConversationSession, messages: WhatsAppParsedMessage[]) {
  const ordered = messages.slice().sort((a,b) => a.timestamp.getTime() - b.timestamp.getTime());
  const first = ordered[0] || source.messages[0];
  const last = ordered[ordered.length - 1] || source.messages[source.messages.length - 1];
  return {
    ...source,
    id: source.id + '-evaluation-v31',
    startedAt: first?.timestamp || source.startedAt,
    endedAt: last?.timestamp || source.endedAt,
    messages: ordered,
    participants: Array.from(new Set(ordered.filter((m) => m.direction !== 'system').map((m) => m.sender))),
    outboundStaffNames: Array.from(new Set(ordered.filter((m) => m.direction === 'outbound').map((m) => m.sender).filter(Boolean))),
    mediaCount: ordered.filter((m) => ['image','voice','video','document'].includes(m.kind)).length,
    missingMediaCount: ordered.filter((m) => ['image','voice','video','document'].includes(m.kind) && !m.mediaAvailable).length,
  } satisfies WhatsAppConversationSession;
}

function addReason(map: Map<string,string[]>, id: string, reason: string) {
  const list = map.get(id) || [];
  if (!list.includes(reason)) list.push(reason);
  map.set(id, list);
}

export function buildEvaluationConversationV31(
  fullCase: WhatsAppConversationSession,
  args: {
    scoredMessageIds: string[];
    evidenceMessageIds?: string[];
    focus: ConversationFocusV30;
    staffTiming?: ConversationTimingV28 | null;
  }
): EvaluationConversationV31 {
  const include = new Set<string>();
  const reasons = new Map<string,string[]>();
  const byId = new Map(fullCase.messages.map((m) => [m.id,m]));

  // 1) كل الرسائل التي تقع داخل مسؤولية الموظف الحالي تظل موجودة.
  for (const id of args.scoredMessageIds) {
    include.add(id);
    addReason(reasons,id,'ضمن مسؤولية الموظف الجاري تقييمه');
  }

  // 2) الأدلة المباشرة لا تُحذف أبدًا.
  for (const id of args.evidenceMessageIds || []) {
    include.add(id);
    addReason(reasons,id,'دليل مباشر في التقييم');
  }

  // 3) الرسائل المحورية/المساندة على مستوى الـCase تدخل فقط لو ليست محذوفة.
  for (const row of args.focus.messages) {
    const message = byId.get(row.messageId);
    if (!message || DELETED_RX.test(String(message.text || ''))) continue;
    if (row.level === 'primary' || row.level === 'supporting') {
      include.add(row.messageId);
      addReason(reasons,row.messageId,row.level === 'primary' ? 'رسالة محورية في رحلة العميل' : 'سياق مساند مهم');
    }
  }

  // 4) أهم قاعدة للعدالة: لو الدكتور رد على Turn للعميل، نضم Turn العميل الذي رد عليه.
  for (const turn of args.staffTiming?.responseTurns || []) {
    const responseIsOwned = Boolean(turn.responseMessageId && args.scoredMessageIds.includes(turn.responseMessageId));
    if (!responseIsOwned) continue;
    for (const id of turn.inboundMessageIds) {
      include.add(id);
      addReason(reasons,id,'سؤال/طلب العميل الذي رد عليه الموظف الحالي');
    }
    if (turn.responseMessageId) {
      include.add(turn.responseMessageId);
      addReason(reasons,turn.responseMessageId,'أول رد للموظف على Turn العميل');
    }
  }

  // 5) سياق ملاصق قصير جدًا فقط، لتفادي ظهور عشرات الرسائل غير المؤثرة.
  const ordered = fullCase.messages.slice().sort((a,b) => a.timestamp.getTime() - b.timestamp.getTime());
  const indexes = new Map(ordered.map((m,i) => [m.id,i]));
  const seedIds = [...include];
  for (const id of seedIds) {
    const i = indexes.get(id);
    if (i == null) continue;
    for (const n of [i-1,i+1]) {
      if (n < 0 || n >= ordered.length) continue;
      const neighbor = ordered[n];
      if (DELETED_RX.test(String(neighbor.text || ''))) continue;
      const gapMin = Math.abs(neighbor.timestamp.getTime() - ordered[i].timestamp.getTime()) / 60000;
      if (gapMin <= 5 && neighbor.direction !== 'system') {
        include.add(neighbor.id);
        addReason(reasons,neighbor.id,'سياق مباشر ملاصق لرسالة مهمة');
      }
    }
  }

  // 6) لو رسالة الموظف نفسها placeholder محذوفة، لا نستخدمها في التحليل حتى لو دخلت ownership.
  for (const id of [...include]) {
    const message = byId.get(id);
    if (message && DELETED_RX.test(String(message.text || ''))) include.delete(id);
  }

  const includedMessages = ordered.filter((m) => include.has(m.id));
  const excludedIds = ordered.filter((m) => !include.has(m.id)).map((m) => m.id);

  return {
    version:'whatsapp-evaluation-conversation-v31',
    session: cloneSession(fullCase,includedMessages),
    includedMessageIds: includedMessages.map((m) => m.id),
    excludedMessageIds: excludedIds,
    excludedCount: excludedIds.length,
    includedCount: includedMessages.length,
    reasonsByMessageId: Object.fromEntries([...reasons.entries()].filter(([id]) => include.has(id))),
  };
}
