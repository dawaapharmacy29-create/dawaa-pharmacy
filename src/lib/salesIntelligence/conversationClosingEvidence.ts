import type { CaseIntelligenceView } from './types';

const OFFICIAL = /(?:(?:نتشرف|تشرفنا)[^\n]{0,60}(?:ب\s*خدم(?:ة|ه)?|خدمت)[^\n]{0,40}(?:24|٢٤|أي\s*وقت|اى\s*وقت|اي\s*وقت)|صيدليات?\s*دواء[^\n]{0,60}(?:تحت\s*(?:أمر|امر)|نتشرف|تتشرف|في\s*خدمت)|(?:نتشرف|تشرفنا)\s*ب\s*خدم(?:ة|ه)\s*حضرتك\s*(?:دائم|في\s*أي\s*وقت)?)/i;
const RESPECTFUL = /(?:تحت\s*(?:أمر|امر)\s*حضرتك|تحت\s*امرك|شكر(?:ا|ًا)\s*(?:لحضرتك|لتواصلك)|العفو\s*(?:يا\s*فندم)?|تشرفنا\s*(?:بخدمت|بالكلام)|في\s*(?:أي|اي|أى)\s*وقت|(?:ألف|الف)\s*سلام[ةه])/i;
const THANKS = /شكرا|شكرًا|شكراً|متشكر|تسلم|تسلمى|تسلمي|جزاك|ربنا\s*يكرمك|الله\s*يخليك/i;
const NEW_NEED = /عايز|عاوز|محتاج|ممكن|ينفع|بكام|سعر|موجود|متوفر|ابعت|ابعث|هات|لو\s*سمحت|سؤال|استفسار|كمان|[؟?]/i;
const BARE_ACK = /^(?:تمام|ماشي|حاضر|اوكي|أوكي|اوك|ok|العفو)[\s🌷🌸✨💚🙏!.،]*$/iu;

export function isClosingCourtesy(text: string): boolean {
  return BARE_ACK.test(text.trim()) || (THANKS.test(text) && !NEW_NEED.test(text));
}

/** Observable speech only: a courteous ending never proves a sale, delivery or complaint resolution. */
export function observableClosing(view: CaseIntelligenceView): { kind: 'official' | 'respectful'; messageId: string } | null {
  const messages = view.interaction.messages.filter(m => m.role === 'staff' || m.role === 'customer')
    .slice().sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const meaningful = messages.filter(m => m.meaningful);
  let respectful: { kind: 'respectful'; messageId: string } | null = null;
  for (const candidate of meaningful.slice(-5).reverse()) {
    if (candidate.role !== 'staff') continue;
    const index = messages.findIndex(m => m.id === candidate.id);
    const before = messages.slice(0, index);
    if (!messages.some(m => m.role === 'customer')) continue;
    // A new question or unread incoming media after a signature prevents that signature
    // from being credited as the ending of the later exchange.
    const laterCustomer = messages.slice(index + 1).filter(m => m.role === 'customer');
    if (laterCustomer.some(m => !m.meaningful || !isClosingCourtesy(m.text))) continue;
    if (OFFICIAL.test(candidate.text)) return { kind: 'official', messageId: candidate.id };
    if (!RESPECTFUL.test(candidate.text)) continue;
    const lastCustomer = before.filter(m => m.role === 'customer' && m.meaningful).at(-1);
    const explicitFarewell = /العفو|تشرفنا|في\s*(?:أي|اي|أى)\s*وقت|(?:ألف|الف)\s*سلام[ةه]/i.test(candidate.text);
    if (explicitFarewell || (lastCustomer && isClosingCourtesy(lastCustomer.text))) {
      respectful ??= { kind: 'respectful', messageId: candidate.id };
    }
  }
  return respectful;
}

/** A transaction state alone does not establish the end of a voice-led consultation. */
export function closingAbsenceAssessable(view: CaseIntelligenceView): boolean {
  const last = view.interaction.messages.filter(m => m.role === 'customer' || (m.role === 'staff' && m.meaningful)).at(-1);
  if (last?.role === 'customer' && (!last.meaningful || !isClosingCourtesy(last.text))) return false;
  return ['sale_proven', 'financially_settled', 'awaiting_invoice', 'customer_declined'].includes(view.journey.currentState) ||
    (view.lostOpportunity.state === 'lost' && view.lostOpportunity.recoverability === 'none') ||
    (view.journey.currentState === 'information_only' && last?.role === 'customer' && isClosingCourtesy(last.text));
}
