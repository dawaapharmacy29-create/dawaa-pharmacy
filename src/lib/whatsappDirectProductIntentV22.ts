import type { WhatsAppParsedMessage } from './whatsappConversationParser';

const EXPLICIT_REQUEST_RX =
  /(عايزه|عاوزه|محتاجه|عايزين|محتاجين|عايز|عاوز|محتاج|هات|ابعت|ابعث|اطلب|أطلب|موجود عندكم|متوفر عندكم|عندكم|بكام|سعر)/i;

const MEDICAL_NARRATIVE_RX =
  /(باخد|باخدها|باخده|بستخدم|استخدمت|ينفع|جرعه|جرعة|اعراض|أعراض|عندي|عندها|عنده|الدكتور كتب|الطبيب كتب|حامل|رضاع|حساسي|حساسية|ضغط|سكر)/i;

const NON_PRODUCT_CHAT_RX =
  /^(?:صباح|مساء|اهلا|أهلا|شكرا|شكراً|تمام|ماشي|حاضر|السلام|وعليكم|ازيك|إزيك|الحمد لله|الحمدلله)/i;

function stripForwardedPrefixV22(value: string) {
  return String(value || '')
    .replace(/^\s*\[?forwarded\]?\s*/i, '')
    .replace(/^\s*تمت إعادة توجيه\s*/i, '')
    .trim();
}

export function isDirectCommercialProductMessageV22(
  message: Pick<WhatsAppParsedMessage, 'direction' | 'kind' | 'forwarded' | 'text'>
): boolean {
  if (message.direction !== 'inbound' || message.kind !== 'text') return false;
  const text = stripForwardedPrefixV22(message.text);
  if (!text || NON_PRODUCT_CHAT_RX.test(text)) return false;

  if (EXPLICIT_REQUEST_RX.test(text)) return true;

  // A medical narrative may contain an exact catalog brand but is not, by itself, purchase intent.
  if (MEDICAL_NARRATIVE_RX.test(text)) return false;

  // Forwarded product cards/names are common in real customer orders. Keep this deliberately narrow:
  // short text, product-like letters, and no long explanatory sentence.
  if (message.forwarded) {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length < 1 || words.length > 12 || text.length > 140) return false;
    if (!/[A-Za-z\u0600-\u06ff]{3,}/.test(text)) return false;
    if (/[.!؟]\s+.+[.!؟]/.test(text)) return false;
    return true;
  }

  return false;
}
