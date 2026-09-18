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

const COMPLAINT_STRONG_RX = /(شكوى|مش راضي|مش راضية|زعلان|زعلانة|خدمة وحشة|اتأخرتوا|اتأخر الطلب|مقصرين|مش مبسوط|محدش رد|مفيش رد|غلطتوا|غلط من عندكم)/i;
const COMPLAINT_WEAK_RX = /(للأسف|استغرب|اتأخر|غلط)/i;
const NEGATION_OR_RESOLUTION_RX = /(مفيش مشكلة|مافيش مشكلة|حصل خير|تمام شكرا|تمام شكرًا|خلاص تمام|ولا يهمك|ولا يهم حضرتك)/i;
const SICK_PERSON_STRONG_RX = /(حرارة عالية|حرارته عالية|سخونية|قيء|ترجيع|إسهال|احتقان شديد|تعبان جدا|تعبانة جدا|مريض في البيت|مريضة في البيت|محتاج تمريض|محتاج ممرض|كبير في السن وتعبان|كبيره في السن وتعبانه|كحة شديدة|كحه شديده)/i;
const SICK_PERSON_WEAK_RX = /(تعبان|تعبانة|تعبانه|عيان|عيانة|عيانه|مريض|مريضة|مريضه)/i;
const MEDICAL_CONTEXT_RX = /(دواء|علاج|جرعة|جرعه|حرارة|سخونية|كحة|كحه|احتقان|قيء|ترجيع|إسهال|ضغط|سكر|روشتة|روشته|دكتور|مستشفى|تمريض|ممرض|اعراض|أعراض|وجع|ألم|الم)/i;
const DOCTOR_RECOMMENDATION_RX = /(أنصح حضرتك|بنصحك|ينفع تجرب|في بديل|فيه بديل|ممكن تجرب|هرشح لحضرتك|هارشح لحضرتك|ممكن ارشح|ممكن أرشح|ممكن نرشح|الأفضل ليك|أحسن حاجة ليك|جرب ده|حاجة تانية أفضل|حاجه افضل|حاجة افضل)/i;
const MISSING_PRODUCT_RX = /(مش متوفر|مش موجود|غير متوفر|خلص من عندنا|مش عندنا حاليا|مش عندنا حاليًا|نفذت الكمية|مش متوفره|مش موجوده)/i;
const PRODUCT_ASK_RX = /(عندكم|فيه عندكم|متوفر|موجود)\s+([^\n؟?.]{2,60})/i;
const GENERIC_PRODUCT_REQUEST_RX = /(عايز|عايزة|محتاج|محتاجة|لو سمحت|ممكن)\s+([^\n؟?.]{2,60})/i;
const CONTACT_WHEN_AVAILABLE_RX = /(اول ما يتوفر|أول ما يتوفر|لما يتوفر|لو توفر|لو اتوفر|بلغوني|بلغني|كلموني|كلمني|ابعتولي|ابعتهولي|خليهولي|احجزهولي|احجزوهولي)/i;
const CUSTOMER_DECLINE_RX = /(خلاص مش محتاج|مش محتاج|لا شكرا|لا شكرًا|سيبها|مش عايز|مش عاوز)/i;

function isStaffMessage(message: WhatsAppParsedMessage) {
  return message.direction === 'outbound';
}

function normalizedText(value: unknown) {
  return String(value ?? '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\u064B-\u065F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactQuote(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 300);
}

function extractRequestedProduct(messages: WhatsAppParsedMessage[], beforeIndex: number) {
  for (let j = beforeIndex - 1; j >= Math.max(0, beforeIndex - 5); j -= 1) {
    const prev = messages[j];
    if (isStaffMessage(prev) || prev.kind !== 'text' || !prev.text) continue;
    const direct = prev.text.match(PRODUCT_ASK_RX);
    if (direct?.[2]) return direct[2].trim().slice(0, 80);
    const generic = prev.text.match(GENERIC_PRODUCT_REQUEST_RX);
    if (generic?.[2]) return generic[2].trim().slice(0, 80);
    if (prev.text.length <= 80) return prev.text.trim();
  }
  return null;
}

function hasNearbyCustomerContext(messages: WhatsAppParsedMessage[], index: number) {
  for (let j = Math.max(0, index - 2); j <= Math.min(messages.length - 1, index + 2); j += 1) {
    if (j === index) continue;
    const m = messages[j];
    if (!isStaffMessage(m) && m.kind === 'text' && Boolean(m.text?.trim())) return true;
  }
  return false;
}

function hasNearbyMedicalContext(messages: WhatsAppParsedMessage[], index: number) {
  for (let j = Math.max(0, index - 3); j <= Math.min(messages.length - 1, index + 3); j += 1) {
    const m = messages[j];
    if (m.kind === 'text' && MEDICAL_CONTEXT_RX.test(m.text || '')) return true;
  }
  return false;
}

function customerResolvedSoon(messages: WhatsAppParsedMessage[], index: number) {
  for (let j = index + 1; j <= Math.min(messages.length - 1, index + 8); j += 1) {
    const next = messages[j];
    if (!isStaffMessage(next) && next.kind === 'text' && NEGATION_OR_RESOLUTION_RX.test(next.text || '')) return true;
  }
  return false;
}

function customerDeclinedSoon(messages: WhatsAppParsedMessage[], index: number) {
  for (let j = index + 1; j <= Math.min(messages.length - 1, index + 6); j += 1) {
    const next = messages[j];
    if (!isStaffMessage(next) && next.kind === 'text' && CUSTOMER_DECLINE_RX.test(next.text || '')) return true;
  }
  return false;
}

function dedupeSignals(signals: DetectedFollowupSignal[]) {
  const sorted = [...signals].sort((a, b) => a.evidenceTimestamp.getTime() - b.evidenceTimestamp.getTime());
  const result: DetectedFollowupSignal[] = [];
  for (const signal of sorted) {
    const duplicateIndex = result.findIndex((candidate) =>
      candidate.signalType === signal.signalType &&
      Math.abs(signal.evidenceTimestamp.getTime() - candidate.evidenceTimestamp.getTime()) <= 5 * 60 * 1000 &&
      normalizedText(candidate.evidenceQuote) === normalizedText(signal.evidenceQuote));
    if (duplicateIndex >= 0) {
      if (signal.confidence > result[duplicateIndex].confidence) result[duplicateIndex] = signal;
      continue;
    }
    result.push(signal);
  }
  return result;
}

export function detectFollowupSignals(session: WhatsAppConversationSession): DetectedFollowupSignal[] {
  const signals: DetectedFollowupSignal[] = [];
  const messages = session.messages;

  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i];
    if (m.kind !== 'text' || !m.text?.trim()) continue;

    const text = m.text.trim();
    const staffMessage = isStaffMessage(m);

    if (!staffMessage && !NEGATION_OR_RESOLUTION_RX.test(text)) {
      const resolvedSoon = customerResolvedSoon(messages, i);
      if (COMPLAINT_STRONG_RX.test(text)) {
        signals.push({
          signalType: 'complaint',
          signalTypeLabel: SIGNAL_LABELS.complaint,
          evidenceQuote: compactQuote(text),
          evidenceTimestamp: m.timestamp,
          confidence: resolvedSoon ? 0.64 : 0.92,
        });
      } else if (COMPLAINT_WEAK_RX.test(text) && hasNearbyCustomerContext(messages, i) && !resolvedSoon) {
        signals.push({
          signalType: 'complaint',
          signalTypeLabel: SIGNAL_LABELS.complaint,
          evidenceQuote: compactQuote(text),
          evidenceTimestamp: m.timestamp,
          confidence: 0.68,
        });
      }

      if (SICK_PERSON_STRONG_RX.test(text)) {
        signals.push({
          signalType: 'sick_person',
          signalTypeLabel: SIGNAL_LABELS.sick_person,
          evidenceQuote: compactQuote(text),
          evidenceTimestamp: m.timestamp,
          confidence: 0.88,
        });
      } else if (SICK_PERSON_WEAK_RX.test(text) && text.length >= 8 && hasNearbyMedicalContext(messages, i)) {
        signals.push({
          signalType: 'sick_person',
          signalTypeLabel: SIGNAL_LABELS.sick_person,
          evidenceQuote: compactQuote(text),
          evidenceTimestamp: m.timestamp,
          confidence: 0.67,
        });
      }

      if (CONTACT_WHEN_AVAILABLE_RX.test(text) && !CUSTOMER_DECLINE_RX.test(text)) {
        signals.push({
          signalType: 'other_opportunity',
          signalTypeLabel: SIGNAL_LABELS.other_opportunity,
          evidenceQuote: compactQuote(text),
          evidenceTimestamp: m.timestamp,
          requestedProductName: extractRequestedProduct(messages, i),
          confidence: 0.82,
        });
      }
    }

    if (staffMessage && DOCTOR_RECOMMENDATION_RX.test(text) && hasNearbyCustomerContext(messages, i)) {
      signals.push({
        signalType: 'doctor_recommendation',
        signalTypeLabel: SIGNAL_LABELS.doctor_recommendation,
        evidenceQuote: compactQuote(text),
        evidenceTimestamp: m.timestamp,
        confidence: 0.78,
      });
    }

    if (staffMessage && MISSING_PRODUCT_RX.test(text)) {
      const requestedProduct = extractRequestedProduct(messages, i);
      let alternativeOffered = DOCTOR_RECOMMENDATION_RX.test(text);
      let alternativeProduct: string | null = alternativeOffered ? compactQuote(text).slice(0, 200) : null;

      if (!alternativeOffered) {
        for (let j = i + 1; j <= Math.min(messages.length - 1, i + 4); j += 1) {
          const next = messages[j];
          if (isStaffMessage(next) && next.kind === 'text' && DOCTOR_RECOMMENDATION_RX.test(next.text || '')) {
            alternativeOffered = true;
            alternativeProduct = compactQuote(next.text || '').slice(0, 200);
            break;
          }
        }
      }

      const declined = customerDeclinedSoon(messages, i);
      signals.push({
        signalType: 'missing_product',
        signalTypeLabel: SIGNAL_LABELS.missing_product,
        evidenceQuote: compactQuote(text),
        evidenceTimestamp: m.timestamp,
        requestedProductName: requestedProduct,
        alternativeOffered,
        alternativeProductName: alternativeProduct,
        confidence: declined ? 0.58 : requestedProduct ? (alternativeOffered ? 0.8 : 0.9) : 0.66,
      });
    }
  }

  return dedupeSignals(signals);
}

export function detectFollowupSignalsAcrossSessions(sessions: WhatsAppConversationSession[]) {
  return sessions.flatMap((session) => detectFollowupSignals(session).map((signal) => ({ session, signal })));
}
