export type ChatRole = 'customer' | 'staff' | 'unknown';

export type ParsedWhatsAppMessage = {
  id: string;
  lineNo: number;
  timestamp: string | null;
  speaker: string;
  role: ChatRole;
  text: string;
  system?: boolean;
};

export type ChatEvidence = {
  messageIds: string[];
  excerpt: string;
};

export type CriterionAssessment = {
  key: string;
  label: string;
  applies: boolean;
  score: number | null;
  maxScore: number;
  status: 'excellent' | 'good' | 'warning' | 'bad' | 'unknown';
  confidence: number;
  summary: string;
  evidence: ChatEvidence[];
  suggestions: string[];
};

export type ResponseGap = {
  customerMessageId: string;
  staffMessageId: string;
  seconds: number;
};

export type WhatsAppChatAnalysis = {
  version: 'wa-chat-intelligence-v2';
  messages: ParsedWhatsAppMessage[];
  participants: Array<{ name: string; role: ChatRole; messages: number }>;
  metrics: {
    totalMessages: number;
    customerMessages: number;
    staffMessages: number;
    mediaMessages: number;
    firstResponseSeconds: number | null;
    averageResponseSeconds: number | null;
    medianResponseSeconds: number | null;
    maxResponseSeconds: number | null;
    responseGaps: ResponseGap[];
    unansweredCustomerMessages: number;
    promisedFollowups: number;
    missedPromisedFollowups: number;
    detectedOrders: number;
    detectedProductQuestions: number;
    detectedComplaints: number;
  };
  criteria: CriterionAssessment[];
  positives: string[];
  risks: string[];
  training: string[];
  manualReviewReasons: string[];
  overallConfidence: number;
};

export type AnalyzeWhatsAppOptions = {
  staffNames?: string[];
  customerNames?: string[];
  knownDoctorNames?: string[];
  responseWindowMinutes?: number;
};

const MEDIA_TOKENS = ['<Media omitted>', 'image omitted', 'video omitted', 'audio omitted', 'sticker omitted', 'document omitted', 'صورة محذوفة', 'فيديو محذوف'];
const GREETING_RX = /(السلام|صباح الخير|مساء الخير|اهلا|أهلا|مرحب|مع حضرتك|صيدليات دواء)/i;
const COURTESY_RX = /(تحت أمر|تحت امرك|حضرتك|لو سمحت|من فضلك|شكرا|شكرًا|العفو|يشرفنا|نطمن)/i;
const WAIT_RX = /(لحظات|ثواني|هراجع|هتأكد|هاتأكد|بشوف|هشوف|راجع لحضرتك|ارجع لحضرتك)/i;
const ORDER_RX = /(اوردر|أوردر|طلب حضرتك|الطلب|فاتورة|الفاتورة|توصيل|العنوان|الدليفري|إرسال|ابعت)/i;
const PRODUCT_RX = /(متوفر|موجود|سعر|بكام|بديل|ترشيح|جرعة|استخدام|دواء|كريم|شامبو|فيتامين|مصل|حقنة)/i;
const COMPLAINT_RX = /(مشكلة|متأخر|اتأخر|زعلان|مش كويس|غلط|شكوى|محدش رد|ماوصلش|موصلش|سيء|وحش)/i;
const ANGRY_RX = /(زعلان|مستاء|سيء جدا|سيئ جدا|مش هتعامل|شكوى|غلط كبير|محدش بيرد)/i;
const CONFIRM_RX = /(تم تأكيد|تأكيد الطلب|الطلب اتأكد|هيتم التوصيل|هيوصل|العنوان|رقم تليفون|الإجمالي|اجمالي)/i;
const CLOSE_RX = /(تحت أمر حضرتك|تحت امرك|أي وقت|اى وقت|نتشرف|شرفتنا|سلامتك|الف سلامة|ألف سلامة)/i;
const UPSELL_RX = /(تحب|ممكن أضيف|ممكن نضيف|معاه|كمان|لو محتاج|فيه عرض|عندنا عرض|بديل أفضل|بديل افضل)/i;
const QUESTION_RX = /[؟?]|(ممكن|عايز|عاوزه|محتاج|فيه|هل|بكام|متوفر)/i;
const STAFF_MEDICAL_CAUTION_RX = /(استشارة الطبيب|الدكتور المعالج|لو حامل|لو مرض مزمن|لو عندك حساسية|الجرعة|بعد الأكل|قبل الأكل|مرة يوميا|مرتين يوميا)/i;

function normalizeArabic(input: string) {
  return input
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[\u064B-\u065F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function roleForSpeaker(speaker: string, options: AnalyzeWhatsAppOptions): ChatRole {
  const n = normalizeArabic(speaker);
  if ((options.staffNames || []).some((x) => normalizeArabic(x) === n)) return 'staff';
  if ((options.customerNames || []).some((x) => normalizeArabic(x) === n)) return 'customer';
  return 'unknown';
}

function parseDateTime(datePart: string, timePart: string, ampm?: string) {
  const dm = datePart.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  const tm = timePart.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!dm || !tm) return null;
  let [, d, m, y] = dm;
  if (y.length === 2) y = `20${y}`;
  let h = Number(tm[1]);
  const min = Number(tm[2]);
  const sec = Number(tm[3] || 0);
  const marker = normalizeArabic(ampm || '');
  if ((marker.includes('م') || marker === 'pm') && h < 12) h += 12;
  if ((marker.includes('ص') || marker === 'am') && h === 12) h = 0;
  const iso = new Date(Number(y), Number(m) - 1, Number(d), h, min, sec);
  return Number.isNaN(iso.getTime()) ? null : iso.toISOString();
}

export function parseWhatsAppExport(raw: string, options: AnalyzeWhatsAppOptions = {}): ParsedWhatsAppMessage[] {
  const lines = String(raw || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  const out: ParsedWhatsAppMessage[] = [];
  let current: ParsedWhatsAppMessage | null = null;
  const prefix = /^\[?(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*([APap][Mm]|[صم])?\]?\s*[-–]?\s*(.*)$/;

  lines.forEach((line, index) => {
    const match = line.match(prefix);
    if (!match) {
      if (current && line.trim()) current.text += `\n${line}`;
      return;
    }
    const rest = match[4] || '';
    const speakerMatch = rest.match(/^([^:]{1,80}):\s([\s\S]*)$/);
    const id = `m${index + 1}`;
    if (!speakerMatch) {
      current = {
        id,
        lineNo: index + 1,
        timestamp: parseDateTime(match[1], match[2], match[3]),
        speaker: 'system',
        role: 'unknown',
        text: rest.trim(),
        system: true,
      };
      out.push(current);
      return;
    }
    const speaker = speakerMatch[1].trim();
    current = {
      id,
      lineNo: index + 1,
      timestamp: parseDateTime(match[1], match[2], match[3]),
      speaker,
      role: roleForSpeaker(speaker, options),
      text: speakerMatch[2].trim(),
    };
    out.push(current);
  });

  const humans = out.filter((m) => !m.system);
  const unknownSpeakers = [...new Set(humans.filter((m) => m.role === 'unknown').map((m) => m.speaker))];
  if (!options.staffNames?.length && unknownSpeakers.length === 2) {
    const [a, b] = unknownSpeakers;
    const score = (name: string) => humans.filter((m) => m.speaker === name && (GREETING_RX.test(m.text) || COURTESY_RX.test(m.text) || CONFIRM_RX.test(m.text))).length;
    const staff = score(a) >= score(b) ? a : b;
    humans.forEach((m) => { m.role = m.speaker === staff ? 'staff' : 'customer'; });
  }
  return out;
}

function secondsBetween(a?: string | null, b?: string | null) {
  if (!a || !b) return null;
  const x = new Date(a).getTime();
  const y = new Date(b).getTime();
  return Number.isFinite(x) && Number.isFinite(y) ? Math.max(0, Math.round((y - x) / 1000)) : null;
}

function excerpt(messages: ParsedWhatsAppMessage[], ids: string[]): ChatEvidence {
  const selected = messages.filter((m) => ids.includes(m.id));
  return { messageIds: ids, excerpt: selected.map((m) => `${m.speaker}: ${m.text.replace(/\n/g, ' ')}`).join(' | ').slice(0, 500) };
}

function assess(label: string, key: string, applies: boolean, score: number | null, maxScore: number, confidence: number, summary: string, evidence: ChatEvidence[] = [], suggestions: string[] = []): CriterionAssessment {
  const ratio = score == null || !maxScore ? null : score / maxScore;
  const status: CriterionAssessment['status'] = !applies || ratio == null ? 'unknown' : ratio >= .9 ? 'excellent' : ratio >= .7 ? 'good' : ratio >= .4 ? 'warning' : 'bad';
  return { key, label, applies, score, maxScore, confidence, summary, evidence, suggestions, status };
}

export function analyzeWhatsAppChat(raw: string, options: AnalyzeWhatsAppOptions = {}): WhatsAppChatAnalysis {
  const messages = parseWhatsAppExport(raw, options);
  const human = messages.filter((m) => !m.system);
  const customer = human.filter((m) => m.role === 'customer');
  const staff = human.filter((m) => m.role === 'staff');
  const gaps: ResponseGap[] = [];
  let unanswered = 0;

  for (let i = 0; i < human.length; i += 1) {
    const m = human[i];
    if (m.role !== 'customer') continue;
    const next = human.slice(i + 1).find((x) => x.role === 'staff');
    if (!next) { unanswered += 1; continue; }
    const seconds = secondsBetween(m.timestamp, next.timestamp);
    if (seconds != null) gaps.push({ customerMessageId: m.id, staffMessageId: next.id, seconds });
  }

  const responseSeconds = gaps.map((g) => g.seconds).sort((a, b) => a - b);
  const firstResponseSeconds = responseSeconds[0] ?? null;
  const averageResponseSeconds = responseSeconds.length ? Math.round(responseSeconds.reduce((a, b) => a + b, 0) / responseSeconds.length) : null;
  const medianResponseSeconds = responseSeconds.length ? responseSeconds[Math.floor(responseSeconds.length / 2)] : null;
  const maxResponseSeconds = responseSeconds.length ? responseSeconds[responseSeconds.length - 1] : null;

  const firstStaff = staff[0];
  const greetingOk = Boolean(firstStaff && GREETING_RX.test(firstStaff.text));
  const doctorMention = staff.find((m) => /(د\.?\s*[\u0600-\u06FF]{2,}|دكتور|دكتوره|دكتورة)/i.test(m.text));
  const politeCount = staff.filter((m) => COURTESY_RX.test(m.text)).length;
  const waitMessages = staff.filter((m) => WAIT_RX.test(m.text));
  let missedPromisedFollowups = 0;
  const waitEvidence: ChatEvidence[] = [];
  for (const wait of waitMessages) {
    const idx = human.findIndex((m) => m.id === wait.id);
    const nextStaff = human.slice(idx + 1).find((m) => m.role === 'staff');
    const sec = secondsBetween(wait.timestamp, nextStaff?.timestamp);
    if (!nextStaff || (sec != null && sec > 20 * 60)) missedPromisedFollowups += 1;
    waitEvidence.push(excerpt(messages, [wait.id, ...(nextStaff ? [nextStaff.id] : [])]));
  }

  const complaints = customer.filter((m) => COMPLAINT_RX.test(m.text));
  const orders = human.filter((m) => ORDER_RX.test(m.text));
  const products = customer.filter((m) => PRODUCT_RX.test(m.text) || QUESTION_RX.test(m.text));
  const confirmation = staff.find((m) => CONFIRM_RX.test(m.text));
  const closing = [...staff].reverse().find((m) => CLOSE_RX.test(m.text));
  const upsell = staff.find((m) => UPSELL_RX.test(m.text));
  const angry = customer.find((m) => ANGRY_RX.test(m.text));
  const medical = human.some((m) => /(جرعه|جرعة|حامل|رضاع|اعراض|أعراض|ضغط|سكر|حساسي|مضاد|حقن|دواء)/i.test(m.text));
  const medicalCaution = staff.find((m) => STAFF_MEDICAL_CAUTION_RX.test(m.text));

  const firstScore = firstResponseSeconds == null ? null : firstResponseSeconds <= 300 ? 10 : firstResponseSeconds <= 600 ? 5 : 0;
  const criteria: CriterionAssessment[] = [
    assess('سرعة أول رد', 'first_response_speed', customer.length > 0, firstScore, 10, firstResponseSeconds == null ? .35 : .98,
      firstResponseSeconds == null ? 'تعذر قياس أول رد من التوقيتات المتاحة.' : `أول رد بعد ${Math.round(firstResponseSeconds / 60)} دقيقة تقريبًا.`,
      gaps[0] ? [excerpt(messages, [gaps[0].customerMessageId, gaps[0].staffMessageId])] : [], firstScore === 0 ? ['تقليل زمن أول رد وتوزيع مسؤولية متابعة الواتساب بوضوح.'] : []),
    assess('رسالة الترحيب الرسمية', 'greeting', Boolean(firstStaff), greetingOk ? 10 : 2, 10, firstStaff ? .9 : .4,
      greetingOk ? 'بداية المحادثة تحتوي على تحية/تعريف مناسب.' : 'لم أجد عناصر كافية من رسالة الترحيب في أول رد.', firstStaff ? [excerpt(messages, [firstStaff.id])] : [], greetingOk ? [] : ['استخدام تحية + تعريف بصيدليات دواء + اسم الدكتور + عرض المساعدة.']),
    assess('ذكر اسم الدكتور', 'doctor_name', staff.length > 0, doctorMention ? 10 : 0, 10, .82,
      doctorMention ? 'تم رصد تقديم الدكتور لنفسه أو ذكر اسم دكتور.' : 'لم يتم رصد اسم الدكتور بوضوح.', doctorMention ? [excerpt(messages, [doctorMention.id])] : [], doctorMention ? [] : ['ذكر اسم الدكتور في بداية المحادثة.']),
    assess('احترام العميل وجودة الأسلوب', 'tone', staff.length > 0, politeCount >= Math.max(1, Math.ceil(staff.length * .25)) ? 10 : politeCount ? 7 : 4, 10, .72,
      politeCount ? `تم رصد ${politeCount} رسالة بها مؤشرات احترام واهتمام.` : 'الأسلوب يحتاج مراجعة بشرية؛ المؤشرات اللغوية المهذبة محدودة.', staff.filter((m) => COURTESY_RX.test(m.text)).slice(0, 3).map((m) => excerpt(messages, [m.id])), politeCount ? [] : ['زيادة عبارات الاهتمام والتأكيد للعميل بدون إطالة.']),
    assess('فهم طلب العميل', 'understanding', products.length > 0, staff.some((m) => QUESTION_RX.test(m.text)) ? 10 : 7, 10, .65,
      staff.some((m) => QUESTION_RX.test(m.text)) ? 'تم رصد أسئلة/استيضاحات من الدكتور قبل أو أثناء التعامل.' : 'لا توجد قرائن كافية على أسئلة استيضاحية؛ يلزم مراجعة السياق.', staff.filter((m) => QUESTION_RX.test(m.text)).slice(0, 3).map((m) => excerpt(messages, [m.id]))),
    assess('المتابعة بعد لحظات/هراجع', 'followup_after_wait', waitMessages.length > 0, waitMessages.length ? Math.max(0, 10 - missedPromisedFollowups * 10) : null, 10, .95,
      waitMessages.length ? `${waitMessages.length} وعد بالرجوع، منها ${missedPromisedFollowups} متأخر/غير مكتمل.` : 'لم يتم رصد وعد بالرجوع.', waitEvidence, missedPromisedFollowups ? ['أي وعد بالرجوع يجب أن يكون له متابعة فعلية واضحة خلال دقائق.'] : []),
    assess('جودة الاستشارة', 'consultation_quality', medical, medical ? (medicalCaution ? 10 : 7) : null, 10, medical ? .58 : .4,
      medical ? (medicalCaution ? 'المحادثة طبية وتم رصد عناصر احتراز/شرح.' : 'المحادثة فيها محتوى طبي وتحتاج مراجعة بشرية دقيقة للسلامة والجرعات.') : 'لا توجد قرائن كافية على استشارة طبية.', medicalCaution ? [excerpt(messages, [medicalCaution.id])] : [], medical && !medicalCaution ? ['مراجعة أي جرعات/موانع/ترشيحات طبيًا قبل اعتماد التقييم.'] : []),
    assess('إغلاق البيع/تأكيد الطلب', 'sales_closing', orders.length > 0, confirmation ? 10 : 4, 10, .84,
      confirmation ? 'تم رصد تأكيد واضح لعناصر الطلب/التوصيل.' : orders.length ? 'يوجد سياق طلب لكن تأكيد الطلب النهائي غير واضح.' : 'لا يوجد سياق طلب واضح.', confirmation ? [excerpt(messages, [confirmation.id])] : [], orders.length && !confirmation ? ['تأكيد الأصناف والكمية والعنوان/التوصيل قبل إنهاء المحادثة.'] : []),
    assess('Cross-sell / Upsell', 'cross_sell_upsell', orders.length > 0 || products.length > 0, upsell ? 10 : 5, 10, .55,
      upsell ? 'تم رصد محاولة مناسبة لإضافة احتياج/عرض/بديل.' : 'لم يتم رصد Cross-sell واضح؛ قد يكون غير مناسب للحالة ويحتاج مراجعة.', upsell ? [excerpt(messages, [upsell.id])] : []),
    assess('التعامل مع عميل غاضب', 'angry_customer', Boolean(angry), angry ? (staff.some((m) => /(حق حضرتك|اسف|آسف|نعتذر|هحل|هنتابع|متفهم)/i.test(m.text)) ? 10 : 3) : null, 10, angry ? .78 : .45,
      angry ? 'تم رصد مؤشرات شكوى/غضب وتقييم الاستجابة بناءً على التهدئة والحل.' : 'لا توجد مؤشرات واضحة على عميل غاضب.', angry ? [excerpt(messages, [angry.id])] : []),
    assess('رسالة الختام', 'closing_message', staff.length > 0, closing ? 10 : 3, 10, .82,
      closing ? 'تم رصد ختام مهني مناسب.' : 'لم يتم رصد ختام واضح للمحادثة.', closing ? [excerpt(messages, [closing.id])] : [], closing ? [] : ['إنهاء المحادثة بتأكيد المساعدة وأن الصيدلية تحت أمر العميل.']),
  ];

  const risks: string[] = [];
  if (unanswered) risks.push(`${unanswered} رسالة من العميل بدون رد لاحق ظاهر.`);
  if (missedPromisedFollowups) risks.push(`${missedPromisedFollowups} وعد بالرجوع لم تتم متابعته في الوقت المناسب.`);
  if (firstResponseSeconds != null && firstResponseSeconds > 600) risks.push('زمن أول رد تجاوز 10 دقائق.');
  if (medical && !medicalCaution) risks.push('يوجد محتوى طبي يحتاج مراجعة بشرية قبل اعتماد أي استنتاج سلامة/جرعات.');
  if (orders.length && !confirmation) risks.push('يوجد سياق بيع/طلب بدون تأكيد نهائي واضح.');

  const positives = criteria.filter((c) => c.status === 'excellent').map((c) => c.label).slice(0, 6);
  const training = [...new Set(criteria.flatMap((c) => c.suggestions))];
  const manualReviewReasons: string[] = [];
  if (human.some((m) => m.role === 'unknown')) manualReviewReasons.push('هوية بعض المتحدثين غير مؤكدة.');
  if (medical) manualReviewReasons.push('المحادثة تحتوي محتوى طبي؛ لا يعتمد الحكم الطبي آليًا وحده.');
  if (messages.filter((m) => !m.timestamp && !m.system).length) manualReviewReasons.push('بعض الرسائل بلا توقيت قابل للقراءة.');
  const confidenceValues = criteria.filter((c) => c.applies).map((c) => c.confidence);
  const overallConfidence = confidenceValues.length ? Number((confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length).toFixed(2)) : .3;

  const participants = [...new Set(human.map((m) => m.speaker))].map((name) => ({
    name,
    role: human.find((m) => m.speaker === name)?.role || 'unknown',
    messages: human.filter((m) => m.speaker === name).length,
  }));

  return {
    version: 'wa-chat-intelligence-v2',
    messages,
    participants,
    metrics: {
      totalMessages: human.length,
      customerMessages: customer.length,
      staffMessages: staff.length,
      mediaMessages: human.filter((m) => MEDIA_TOKENS.some((token) => m.text.toLowerCase().includes(token.toLowerCase()))).length,
      firstResponseSeconds,
      averageResponseSeconds,
      medianResponseSeconds,
      maxResponseSeconds,
      responseGaps: gaps,
      unansweredCustomerMessages: unanswered,
      promisedFollowups: waitMessages.length,
      missedPromisedFollowups,
      detectedOrders: orders.length,
      detectedProductQuestions: products.length,
      detectedComplaints: complaints.length,
    },
    criteria,
    positives,
    risks,
    training,
    manualReviewReasons,
    overallConfidence,
  };
}
