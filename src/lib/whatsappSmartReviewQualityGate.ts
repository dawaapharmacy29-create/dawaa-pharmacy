import type { WhatsAppConversationSession, WhatsAppParsedMessage } from './whatsappConversationParser';
import type { SmartDeepConversationAnalysis } from './whatsappSmartConversationIntelligence';

export interface SmartReviewQualityGate {
  missingMediaMessageIds: string[];
  criticalMissingMediaMessageIds: string[];
  confidencePenalty: number;
  humanReviewRequired: boolean;
  reasons: string[];
}

const ACTIONABLE_RX = /(محتاج|عايز|عاوزه|موجود|متاح|بكام|سعر|جرع|استخدام|اعراض|كحه|حراره|اسهال|ترجيع|قيء|استشاره|بديل|اوردر|طلب|روشته|علاج|دوا|دواء|صيدلي|تابع|متابعه)/i;

function isMissingMedia(message: WhatsAppParsedMessage) {
  return ['image', 'voice', 'video', 'document'].includes(message.kind)
    && Boolean(message.mediaPlaceholder)
    && !message.mediaAvailable;
}

function around(messages: WhatsAppParsedMessage[], index: number, radius = 2) {
  return messages.slice(Math.max(0, index - radius), Math.min(messages.length, index + radius + 1));
}

export function buildSmartReviewQualityGate(
  session: WhatsAppConversationSession,
  deep: SmartDeepConversationAnalysis,
): SmartReviewQualityGate {
  const messages = session.messages
    .filter((message) => message.direction !== 'system' && message.kind !== 'system')
    .slice()
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  const missing = messages.filter(isMissingMedia);
  const critical = new Set<string>();
  for (const message of missing) {
    const index = messages.findIndex((item) => item.id === message.id);
    const neighbors = around(messages, index);
    const hasActionableContext = neighbors.some((item) => ACTIONABLE_RX.test(String(item.text || '')));
    const touchesEvidence = deep.evidenceMessageIds.includes(message.id)
      || neighbors.some((item) => deep.evidenceMessageIds.includes(item.id));
    if (hasActionableContext || touchesEvidence) critical.add(message.id);
  }

  const reasons: string[] = [];
  if (missing.length) reasons.push(`يوجد ${missing.length} رسالة ميديا غير مقروءة داخل الجزء المحلل`);
  if (critical.size) reasons.push('جزء مؤثر من الطلب/الاستشارة موجود في صورة أو فويس غير متاح نصه؛ يلزم تأكيد بشري قبل الاعتماد');

  const confidencePenalty = Math.min(0.3, missing.length * 0.04 + critical.size * 0.06);
  return {
    missingMediaMessageIds: missing.map((message) => message.id),
    criticalMissingMediaMessageIds: Array.from(critical),
    confidencePenalty,
    humanReviewRequired: critical.size > 0,
    reasons,
  };
}
