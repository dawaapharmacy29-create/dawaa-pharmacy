// تجميع الرسائل الصادرة المتتالية من نفس الموظف في "Burst" واحد قبل رد العميل، بدل ما نحسب
// كل رسالة صادرة لوحدها (وده كان بيظلم موظف بعت رسالتين/تلاتة متتاليين كجزء من نفس الرد
// المنطقي). الـKPI الأساسي هنا هو Burst Reply Rate، مش عدد الرسائل الفردية.
//
// قيد بيانات لازم يتوضح: ملفات تصدير واتساب TXT/MD مفيهاش بيانات "reaction"/emoji tapback
// خالص (واتساب نفسه ما بيصدّرهاش) — فـ"رد" هنا معناه أي رسالة نصية واردة من العميل بعد
// الـburst، قبل أي رسالة صادرة تالية أو نهاية الجلسة.
import type { WhatsAppConversationSession } from '@/lib/whatsappConversationParser';
import type { WhatsAppParticipantRoleModelV15 } from '@/lib/whatsappParticipantRoleResolverV15';

// 10 دقايق افتراضيًا — رقم تقديري لسه ما اتحقّقش على توزيع فجوات رد حقيقي من بياناتنا.
// اتعمل parameter قابل للتخصيص (مش ثابت جوه الدالة) بالظبط عشان كده — عشان نقدر نجرب
// thresholds مختلفة على بيانات حقيقية من غير ما نلمس منطق التجميع نفسه، ومن غير ما نعتبره
// KPI رسمي لحد ما يتحقق.
export const DEFAULT_BURST_GAP_THRESHOLD_MS = 10 * 60 * 1000;

export interface OutboundBurst {
  burstId: string;
  staffId: string | null;
  staffName: string | null;
  messageIds: string[];
  messageCount: number;
  gotReply: boolean;
  replyLatencySeconds: number | null;
}

export interface StaffMessageEffort {
  staffName: string;
  staffId: string | null;
  outboundMessages: number;
  burstCount: number;
  repliedBursts: number;
  burstReplyRatePct: number;
}

export function groupOutboundBursts(
  session: WhatsAppConversationSession,
  roles: WhatsAppParticipantRoleModelV15,
  gapThresholdMs: number = DEFAULT_BURST_GAP_THRESHOLD_MS
): OutboundBurst[] {
  const roleByMessageId = new Map(roles.messages.map((m) => [m.messageId, m]));
  const bursts: OutboundBurst[] = [];
  let current: { staffKey: string; staffId: string | null; staffName: string | null; messageIds: string[]; lastTimestamp: Date } | null = null;

  const flush = (replyMessage?: { timestamp: Date }) => {
    if (!current) return;
    const gotReply = Boolean(replyMessage);
    const replyLatencySeconds = replyMessage
      ? Math.max(0, Math.round((replyMessage.timestamp.getTime() - current.lastTimestamp.getTime()) / 1000))
      : null;
    bursts.push({
      burstId: current.messageIds[0],
      staffId: current.staffId,
      staffName: current.staffName,
      messageIds: current.messageIds,
      messageCount: current.messageIds.length,
      gotReply,
      replyLatencySeconds,
    });
    current = null;
  };

  for (const message of session.messages) {
    if (message.direction === 'inbound') {
      flush(message);
      continue;
    }
    if (message.direction === 'system') continue;

    const roleInfo = roleByMessageId.get(message.id);
    if (!roleInfo || roleInfo.role === 'customer' || roleInfo.role === 'system') continue;

    const key = roleInfo.staffId || roleInfo.staffName || roleInfo.sender || 'unknown';
    const withinGap = current ? message.timestamp.getTime() - current.lastTimestamp.getTime() <= gapThresholdMs : false;
    if (current && current.staffKey === key && withinGap) {
      current.messageIds.push(message.id);
      current.lastTimestamp = message.timestamp;
    } else {
      flush();
      current = { staffKey: key, staffId: roleInfo.staffId, staffName: roleInfo.staffName, messageIds: [message.id], lastTimestamp: message.timestamp };
    }
  }
  flush();

  return bursts;
}

export function computeStaffBurstEffort(bursts: OutboundBurst[]): StaffMessageEffort[] {
  const byStaff = new Map<string, StaffMessageEffort>();
  for (const burst of bursts) {
    const key = burst.staffId || burst.staffName || 'غير محدد';
    const existing = byStaff.get(key) || {
      staffName: burst.staffName || 'غير محدد',
      staffId: burst.staffId,
      outboundMessages: 0,
      burstCount: 0,
      repliedBursts: 0,
      burstReplyRatePct: 0,
    };
    existing.outboundMessages += burst.messageCount;
    existing.burstCount += 1;
    if (burst.gotReply) existing.repliedBursts += 1;
    byStaff.set(key, existing);
  }
  return [...byStaff.values()].map((entry) => ({
    ...entry,
    burstReplyRatePct: entry.burstCount ? Math.round((entry.repliedBursts / entry.burstCount) * 1000) / 10 : 0,
  }));
}
