import {
  REVIEW_CRITERIA,
  defaultReviewState,
  defaultSevereErrors,
  evaluateConversationReview,
  type ConversationReviewResult,
  type ConversationReviewState,
  type ReviewCriterionKey,
  type SevereErrorKey,
  type SevereErrorsState,
} from '@/lib/conversationReviews';
import {
  buildOfficialReviewSuggestion,
  type WhatsAppOfficialReviewSuggestion,
} from '@/lib/whatsappReviewScoring';
import type { WhatsAppConversationSession } from '@/lib/whatsappConversationParser';

export type AutomaticReviewItemSource = 'signal' | 'default_fallback';

export interface AutomaticReviewItemTrace {
  key: ReviewCriterionKey;
  source: AutomaticReviewItemSource;
  confidence: number;
  reason: string;
}

export interface SevereSuspicion {
  key: SevereErrorKey;
  reason: string;
  evidenceQuote: string;
}

export interface AutomaticReviewBuild {
  state: ConversationReviewState;
  severeErrors: SevereErrorsState;
  trace: AutomaticReviewItemTrace[];
  suggestion: WhatsAppOfficialReviewSuggestion;
  suspicions: SevereSuspicion[];
  signalResolvedCount: number;
  defaultFallbackCount: number;
}

// كلمات دالة على احتمال خطأ جسيم (طبي/فاتورة/إساءة...) — الغرض الوحيد منها هو
// لفت نظر المراجع البشري في evaluation_reason. ممنوع نهائيًا استخدامها لتفعيل
// severeErrors تلقائيًا: قرار الخطأ الجسيم لازم إنسان يتخذه، مش النظام الآلي.
const SUSPICION_PATTERNS: Array<{ key: SevereErrorKey; pattern: RegExp }> = [
  {
    key: 'medical_error',
    pattern: /جرعه\s*زياده|جرعة\s*زيادة|جرعة\s*غلط|جرعه\s*غلط|تحسست|حساسية\s*شديدة|غيبوبة|تسمم/i,
  },
  {
    key: 'invoice_error',
    pattern: /الفاتورة\s*غلط|فلوس\s*زياده|فلوس\s*زيادة|اتحاسبت\s*غلط|السعر\s*غلط\s*في\s*الفاتورة/i,
  },
  { key: 'delivery_error', pattern: /وصل\s*غلط|طلب\s*غلط\s*وصل|منتج\s*مختلف\s*وصل|التوصيل\s*ضاع/i },
  { key: 'wrong_price', pattern: /السعر\s*مختلف|السعر\s*غير|زودتوا\s*السعر|غالي\s*عن\s*المتفق/i },
  {
    key: 'promised_unavailable',
    pattern: /وعدتوني\s*وملقيتش|قلتوا\s*هتوفروا\s*ومحصلش|اتقال\s*هيجيلي\s*ومجاش/i,
  },
  {
    key: 'request_not_registered',
    pattern: /سجلت\s*الطلب\s*ومحدش\s*رد|قلت\s*هسجل\s*الطلب\s*ومحصلش\s*متابعة/i,
  },
  {
    key: 'insult',
    pattern: /كلمني\s*بأدب|اتكلم\s*معايا\s*بطريقة\s*وحشة|كلام\s*مش\s*لائق|اهانة|إهانة/i,
  },
];

function detectSuspicions(session: WhatsAppConversationSession): SevereSuspicion[] {
  const suspicions: SevereSuspicion[] = [];
  for (const message of session.messages) {
    if (message.direction !== 'inbound') continue;
    for (const { key, pattern } of SUSPICION_PATTERNS) {
      if (pattern.test(message.text)) {
        suspicions.push({
          key,
          reason:
            'تم رصد كلمات دالة على احتمال هذا الخطأ في رسالة العميل — يحتاج تأكيد بشري قبل اعتماده كخطأ جسيم.',
          evidenceQuote: message.text.slice(0, 200),
        });
      }
    }
  }
  return suspicions;
}

/**
 * يبني حالة تقييم كاملة (كل بنود REVIEW_CRITERIA) من إشارات المحادثة الآلية.
 * أي بند ما اتقدرش يتحسم من نص المحادثة (review_required) يُستبعد من نقاط التقييم
 * الآلي بدل ما ياخد قيمة افتراضية كاملة. يظل ظاهرًا للمراجع البشري مع trace منخفض الثقة.
 */
export function buildAutomaticWhatsAppReview(
  session: WhatsAppConversationSession,
  customerName?: string | null
): AutomaticReviewBuild {
  const suggestion = buildOfficialReviewSuggestion(session, customerName);
  const fallback = defaultReviewState();
  const state: ConversationReviewState = { ...fallback };
  const trace: AutomaticReviewItemTrace[] = [];

  for (const criterion of REVIEW_CRITERIA) {
    const item = suggestion.items.find((row) => row.key === criterion.key);
    if (!item) {
      trace.push({
        key: criterion.key,
        source: 'default_fallback',
        confidence: 40,
        reason: 'لا يوجد اقتراح آلي لهذا البند.',
      });
      continue;
    }
    if (item.status === 'assessed' && item.selectedOption) {
      state[criterion.key] = {
        applies: true,
        choice: item.selectedOption,
        notes: `آلي: ${item.reason}`,
      };
      trace.push({
        key: criterion.key,
        source: 'signal',
        confidence: item.confidence,
        reason: item.reason,
      });
    } else if (item.status === 'not_applicable' || item.status === 'review_required') {
      state[criterion.key] = {
        applies: false,
        choice: criterion.defaultChoice,
        notes: item.status === 'review_required'
          ? `آلي: يحتاج مراجعة بشرية ولم تُحتسب له نقاط — ${item.reason}`
          : `آلي: ${item.reason}`,
      };
      trace.push({
        key: criterion.key,
        source: 'signal',
        confidence: item.confidence,
        reason: item.reason,
      });
    } else {
      state[criterion.key] = {
        applies: fallback[criterion.key].applies,
        choice: fallback[criterion.key].choice,
        notes: `آلي (افتراضي غير مؤكد): ${item.reason}`,
      };
      trace.push({
        key: criterion.key,
        source: 'default_fallback',
        confidence: 40,
        reason: item.reason,
      });
    }
  }

  return {
    state,
    // ثابت دايمًا: التقييم الآلي ممنوع يفعّل أي خطأ جسيم بنفسه.
    severeErrors: defaultSevereErrors(),
    trace,
    suggestion,
    suspicions: detectSuspicions(session),
    signalResolvedCount: trace.filter((t) => t.source === 'signal').length,
    defaultFallbackCount: trace.filter((t) => t.source === 'default_fallback').length,
  };
}

export function evaluateAutomaticWhatsAppReview(
  session: WhatsAppConversationSession,
  customerName?: string | null
): { build: AutomaticReviewBuild; result: ConversationReviewResult } {
  const build = buildAutomaticWhatsAppReview(session, customerName);
  const result = evaluateConversationReview(build.state, build.severeErrors, undefined);
  if (result.hasSevereError) {
    // خط دفاع ثانٍ: severeErrors دايمًا false هنا وماحدش من الاختيارات
    // الافتراضية/المرصودة آليًا بيفعّل severe. لو حصل الخلل ده فهو باگ برمجي
    // في المنطق أعلاه وليس نتيجة بيانات — نوقف بدل ما نسمح باعتماد آلي لخطأ جسيم.
    throw new Error(
      '[whatsappAutomaticReviewScoring] invariant violated: automatic evaluation must never produce a severe error on its own.'
    );
  }
  return { build, result };
}
