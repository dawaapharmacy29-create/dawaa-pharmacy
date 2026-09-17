import type { WhatsAppConversationSession, WhatsAppParsedMessage } from './whatsappConversationParser';

export type FollowupSignalType = 'complaint' | 'sick_person' | 'doctor_recommendation' | 'missing_product' | 'other_opportunity';

export interface DetectedFollowupSignal {
  signalType: FollowupSignalType;
  signalTypeLabel: string;
  evidenceQuote: string;
  evidenceTimestamp: Date;
  requestedProductName?: string | null;
  alternativeOffered?: boolean | null;
  alternativeProductName?: string | null;
  confidence: number;
}

const SIGNAL_LABELS: Record<FollowupSignalType, string> = {
  complaint: 'شكوى عميل',
  sick_person: 'حالة مريض بالمنزل',
  doctor_recommendation: 'ترشيح من الدكتور',
  missing_product: 'صنف مطلوب غير متوفر',
  other_opportunity: 'فرصة متابعة أخرى',
};

const COMPLAINT_RX = /(شكو[ىي]|مش راضي|مش راضيه|زعلان|زعلانه|للأسف|بجد وحش|خدمة وحشة|اتأخرتوا|اتأخر الطلب|غلط|غلطتوا|مقصرين|مش مبسوط|استغرب|مش لاقي حل|حد يرد عل[يى]|من ساعتين مفيش رد)/i;
const SICK_PERSON_RX = /(تعبان|تعبانه|تعبانة|عيان|عيانه|عيانة|مريض|مريضه|مريضة|حرارة عالي|حرارته عالي|قاعد في السرير|محتاج ممرض|محتاج تمريض|كبير في السن وتعبان)/i;
const DOCTOR_RECOMMENDATION_RX = /(أنصح حضرتك|بنصحك|ينفع تجرب|في بديل|فيه بديل|ممكن تجرب|هرشح لحضرتك|هارشح لحضرتك|ممكن ارشح|ممكن أرشح|ممكن نرشح|الأفضل ليك|أحسن حاجة ليك|جرب ده|حاجة تانية أفضل|حاجه افضل|حاجة افضل)/i;
const MISSING_PRODUCT_RX = /(مش متوفر|مش موجود|غير متوفر|خلص من عندنا|مش عندنا حاليا|نفذت الكمية|مش متوفره|مش موجوده)/i;
const PRODUCT_ASK_RX = /(عندكم|فيه عندكم|متوفر|موجود)\s+([^\n؟?.]{2,40})/i;

function isStaffMessage(message: WhatsAppParsedMessage) {
  return message.direction === 'outbound';
}

export function detectFollowupSignals(session: WhatsAppConversationSession): DetectedFollowupSignal[] {
  const signals: DetectedFollowupSignal[] = [];
  const messages = session.messages;

  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i];
    if (m.kind !== 'text' || !m.text) continue;

    if (!isStaffMessage(m) && COMPLAINT_RX.test(m.text)) {
      signals.push({
        signalType: 'complaint',
        signalTypeLabel: SIGNAL_LABELS.complaint,
        evidenceQuote: m.text.slice(0, 300),
        evidenceTimestamp: m.timestamp,
        confidence: 0.8,
      });
    }

    if (!isStaffMessage(m) && SICK_PERSON_RX.test(m.text)) {
      signals.push({
        signalType: 'sick_person',
        signalTypeLabel: SIGNAL_LABELS.sick_person,
        evidenceQuote: m.text.slice(0, 300),
        evidenceTimestamp: m.timestamp,
        confidence: 0.65,
      });
    }

    if (isStaffMessage(m) && DOCTOR_RECOMMENDATION_RX.test(m.text)) {
      signals.push({
        signalType: 'doctor_recommendation',
        signalTypeLabel: SIGNAL_LABELS.doctor_recommendation,
        evidenceQuote: m.text.slice(0, 300),
        evidenceTimestamp: m.timestamp,
        confidence: 0.7,
      });
    }

    if (isStaffMessage(m) && MISSING_PRODUCT_RX.test(m.text)) {
      // دور على اسم الصنف في آخر رسالة من العميل قبل رد "مش متوفر"
      let requestedProduct: string | null = null;
      for (let j = i - 1; j >= Math.max(0, i - 4); j -= 1) {
        const prev = messages[j];
        if (isStaffMessage(prev)) continue;
        if (prev.kind === 'text' && prev.text) {
          const match = prev.text.match(PRODUCT_ASK_RX);
          requestedProduct = match ? match[2].trim() : prev.text.slice(0, 60);
          break;
        }
      }
      // هل اتعرض بديل في نفس الرسالة أو في الرسائل الجاية؟
      let alternativeOffered = DOCTOR_RECOMMENDATION_RX.test(m.text);
      let alternativeProduct: string | null = alternativeOffered ? m.text.slice(0, 200) : null;
      if (!alternativeOffered) {
        for (let j = i + 1; j <= Math.min(messages.length - 1, i + 3); j += 1) {
          const next = messages[j];
          if (isStaffMessage(next) && next.kind === 'text' && DOCTOR_RECOMMENDATION_RX.test(next.text || '')) {
            alternativeOffered = true;
            alternativeProduct = next.text?.slice(0, 200) || null;
            break;
          }
        }
      }
      signals.push({
        signalType: 'missing_product',
        signalTypeLabel: SIGNAL_LABELS.missing_product,
        evidenceQuote: m.text.slice(0, 300),
        evidenceTimestamp: m.timestamp,
        requestedProductName: requestedProduct,
        alternativeOffered,
        alternativeProductName: alternativeProduct,
        confidence: 0.6,
      });
    }
  }

  return signals;
}

export function detectFollowupSignalsAcrossSessions(sessions: WhatsAppConversationSession[]) {
  return sessions.flatMap((session) => detectFollowupSignals(session).map((signal) => ({ session, signal })));
}
