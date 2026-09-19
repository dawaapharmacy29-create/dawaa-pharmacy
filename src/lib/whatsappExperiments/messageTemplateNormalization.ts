// تطبيع "قالب" الرسالة الصادرة عشان نقدر نجمع "أفضل الرسائل" على أساس القالب الفعلي
// (نفس الصياغة بأسماء عملاء مختلفة) مش النص الحرفي اللي كان بيفرّق رسالتين متطابقتين
// في المعنى لمجرد اختلاف اسم العميل أو مسافة زيادة أو عدد إيموجي.
export interface BestMessageCandidate {
  messageId: string;
  text: string;
  templateKey: string;
  staffName: string | null;
  burstId: string;
  gotReply: boolean;
  replyLatencySeconds: number | null;
}

export interface BestMessageAggregate {
  templateKey: string;
  displayText: string;
  sentCount: number;
  repliedCount: number;
  replyRate: number;
  /** أقل من عتبة العيّنة الموثوقة (افتراضيًا 5) = بيانات أولية، ما ينفعش تُعتبر "أفضل رسالة" بثقة. */
  sampleSizeLabel: 'preliminary' | 'ok';
}

const EMOJI_RX = /\p{Extended_Pictographic}/gu;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildMessageTemplateKey(rawText: string, customerName?: string | null): { templateKey: string; displayText: string } {
  let displayText = rawText.trim();
  const trimmedName = (customerName || '').trim();
  if (trimmedName.length >= 2) {
    displayText = displayText.replace(new RegExp(escapeRegExp(trimmedName), 'g'), '{{name}}');
  }

  let normalized = displayText
    .replace(EMOJI_RX, '')
    .replace(/[!]{2,}/g, '!')
    .replace(/[؟?]{2,}/g, '؟')
    .replace(/[.]{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  return { templateKey: normalized, displayText: displayText.replace(/\s+/g, ' ').trim() };
}

export function aggregateBestMessages(
  candidates: BestMessageCandidate[],
  minSent = 2,
  reliableSampleThreshold = 5
): BestMessageAggregate[] {
  const byTemplate = new Map<string, { displayText: string; sentCount: number; repliedCount: number }>();
  for (const c of candidates) {
    if (!c.templateKey) continue;
    const existing = byTemplate.get(c.templateKey) || { displayText: c.text.trim(), sentCount: 0, repliedCount: 0 };
    existing.sentCount += 1;
    if (c.gotReply) existing.repliedCount += 1;
    byTemplate.set(c.templateKey, existing);
  }
  return [...byTemplate.entries()]
    .map(([templateKey, v]) => ({
      templateKey,
      displayText: v.displayText,
      sentCount: v.sentCount,
      repliedCount: v.repliedCount,
      replyRate: Math.round((v.repliedCount / v.sentCount) * 1000) / 10,
      sampleSizeLabel: (v.sentCount >= reliableSampleThreshold ? 'ok' : 'preliminary') as 'ok' | 'preliminary',
    }))
    .filter((x) => x.sentCount >= minSent)
    .sort((a, b) => b.replyRate - a.replyRate || b.sentCount - a.sentCount)
    .slice(0, 10);
}
