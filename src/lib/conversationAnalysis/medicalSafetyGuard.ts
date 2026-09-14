import type { ParsedWhatsAppMessage, WhatsAppChatAnalysis } from './whatsappChatAnalyzer';

export type MedicalSafetyFlag = {
  key: string;
  severity: 'info' | 'review' | 'high';
  summary: string;
  messageIds: string[];
};

export type MedicalSafetyReview = {
  hasMedicalContent: boolean;
  requiresHumanReview: boolean;
  flags: MedicalSafetyFlag[];
  blockedAutoJudgments: string[];
  safeReviewerChecklist: string[];
};

const MEDICAL_RX = /(جرعه|جرعة|دواء|مضاد|حقنه|حقنة|حامل|رضاع|رضاعة|ضغط|سكر|حساسي|حساسية|اعراض|أعراض|حراره|حرارة|كحة|اسهال|إسهال|قيء|ترجيع|ألم|وجع|التهاب)/i;
const DOSE_RX = /(\d+\s*(مجم|mg|مل|ml|قرص|كبسوله|كبسولة|مره|مرة|مرتين|ثلاث مرات)|قبل الاكل|بعد الاكل|كل \d+ ساعات)/i;
const RED_FLAG_RX = /(ضيق نفس|ألم صدر|الم صدر|اغماء|إغماء|نزيف|تشنج|حساسيه شديده|حساسية شديدة|زرقة|طفل رضيع|حامل)/i;
const CAUTION_RX = /(راجع الطبيب|استشارة الطبيب|الدكتور المعالج|طوارئ|لو الحالة ساءت|لو الاعراض زادت|لو الأعراض زادت|حساسية|حامل|رضاعة)/i;

export function analyzeMedicalSafety(analysis: WhatsAppChatAnalysis): MedicalSafetyReview {
  const messages = analysis.messages.filter((m) => !m.system);
  const medicalMessages = messages.filter((m) => MEDICAL_RX.test(m.text));
  const staffMedical = messages.filter((m) => m.role === 'staff' && MEDICAL_RX.test(m.text));
  const flags: MedicalSafetyFlag[] = [];

  const doseMessages = staffMedical.filter((m) => DOSE_RX.test(m.text));
  if (doseMessages.length) {
    flags.push({
      key: 'dosage_present',
      severity: 'review',
      summary: 'تم رصد جرعة/طريقة استخدام؛ يجب مراجعتها بشريًا قبل اعتماد جودة الاستشارة.',
      messageIds: doseMessages.map((m) => m.id),
    });
  }

  const redFlags = medicalMessages.filter((m) => RED_FLAG_RX.test(m.text));
  if (redFlags.length) {
    flags.push({
      key: 'potential_red_flag',
      severity: 'high',
      summary: 'المحادثة تحتوي مؤشرات صحية حساسة/طارئة محتملة؛ لا يعتمد التقييم الطبي آليًا.',
      messageIds: redFlags.map((m) => m.id),
    });
  }

  const cautionMessages = staffMedical.filter((m) => CAUTION_RX.test(m.text));
  if (medicalMessages.length && !cautionMessages.length) {
    flags.push({
      key: 'missing_caution_signal',
      severity: 'review',
      summary: 'يوجد محتوى طبي ولم يتم رصد تنبيه/احتراز أو إحالة واضحة؛ يحتاج مراجع صيدلي.',
      messageIds: staffMedical.map((m) => m.id).slice(0, 6),
    });
  }

  const hasMedicalContent = medicalMessages.length > 0;
  return {
    hasMedicalContent,
    requiresHumanReview: hasMedicalContent,
    flags,
    blockedAutoJudgments: hasMedicalContent
      ? ['صحة الجرعة', 'سلامة الترشيح الطبي', 'موانع الاستعمال', 'ملاءمة العلاج للحالة', 'الحكم على وجود خطأ طبي جسيم']
      : [],
    safeReviewerChecklist: hasMedicalContent
      ? [
          'راجع العمر/الحمل/الرضاعة إن كانت مؤثرة.',
          'راجع الجرعة وطريقة الاستخدام من مصدر مهني مناسب.',
          'راجع الأمراض المزمنة والحساسيات والتداخلات إن ظهرت في الشات.',
          'تأكد أن أي Red Flag أخذت توجيهًا مناسبًا للرعاية الطبية.',
          'لا تعتمد خصم خطأ طبي آليًا بدون مراجعة صيدلي/مدير مخول.',
        ]
      : [],
  };
}

export function medicalEvidence(messages: ParsedWhatsAppMessage[], ids: string[]) {
  return messages.filter((m) => ids.includes(m.id)).map((m) => `${m.speaker}: ${m.text}`).join(' | ');
}
