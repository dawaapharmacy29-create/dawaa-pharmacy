export type FollowupScriptContext = {
  customerName: string;
  agentName: string;
  doctorName?: string | null;
  reason?: string | null;
  source?: string | null;
  result?: string | null;
  branch?: string | null;
  lastPurchase?: string | null;
  profileTags?: string[];
  segment?: string | null;
  customerStatus?: string | null;
};

export type ScriptPack = {
  title: string;
  objective: string;
  opening: string;
  questions: string[];
  objections: Array<{ objection: string; response: string }>;
  closing: string;
  nextStep: string;
  whatsapp: string;
};

function cleanName(value: unknown) {
  return String(value || '')
    .replace(/\++/g, ' ')
    .replace(/^(?:أ\/?|ا\/?|د\/?|دكتور(?:ة)?|أستاذ(?:ة)?)\s*/i, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function displayCustomerName(value: string) {
  const cleaned = cleanName(value);
  if (!cleaned || /^(?:غير محدد|عميل|بدون اسم|مجهول)$/i.test(cleaned)) return '';
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length > 1 && parts[0].length === 1) parts.shift();
  return parts.slice(0, 2).join(' ');
}

function validPersonName(value?: string | null) {
  const name = cleanName(value);
  return name && !/^(?:غير محدد|غير معروف|لا يوجد|بدون|النظام الذكي|فريق خدمة العملاء)$/i.test(name)
    ? name
    : '';
}

function agentLabel(value: string) {
  const raw = String(value || '').trim();
  const name = validPersonName(raw);
  if (!name) return 'فريق خدمة العملاء';
  const doctor = /^(?:د\/?|دكتور(?:ة)?)\s*/i.test(raw);
  return (doctor ? 'د/ ' : '') + name;
}

function brandedIntro(context: FollowupScriptContext) {
  const customer = displayCustomerName(context.customerName);
  const greeting = customer ? 'أهلًا بحضرتك ' + customer : 'أهلًا بحضرتك';
  return greeting + '، مع حضرتك ' + agentLabel(context.agentName) + ' من خدمة عملاء صيدليات دواء.';
}

function respectfulClose() {
  return 'شكرًا جدًا لوقت حضرتك. صيدليات دواء تحت أمر حضرتك في أي وقت.';
}

function internalSignal(context: FollowupScriptContext) {
  return [
    context.source,
    context.reason,
    context.result,
    context.customerStatus,
    context.segment,
  ]
    .filter(Boolean)
    .join(' ');
}

function isBereavement(text: string) {
  return /وفاة|توف(?:ى|ي)|البقاء لله|فقد(?:ت|نا|ان)|قدر الله وما شاء فعل/i.test(text);
}

function isComplaint(text: string) {
  return /شكوى|غاضب|تأخير|مشكلة|تصعيد|استرجاع مبلغ|refund|complaint/i.test(text);
}

function isPostPurchase(text: string) {
  return /yesterday|أمس|بعد الشراء|بعد الطلب|فاتورة|طلب وصل|post.?purchase/i.test(text);
}

function isInternalDoctorRequest(text: string, doctorName?: string | null) {
  return /doctor|طلب دكتور|طلب متابعة|doctor[_ -]?request/i.test(text) || Boolean(validPersonName(doctorName));
}

function isAtRisk(text: string) {
  return /at_risk|مهدد|متوقف|قلل|انخفاض|استرجاع عميل|inactive|غير نشط/i.test(text);
}

function isTravelRelated(text: string) {
  return /سفر|مسافر|مسافرة|راجع من سفر|عودة من سفر|travel/i.test(text);
}

type ProfileHint = { question: string };

const PROFILE_HINTS: Record<string, ProfileHint> = {
  monthly_treatment: {
    question: 'هل تحب نرتب متابعة دورية مع حضرتك في ميعاد مناسب؟',
  },
  cosmetics_interest: {
    question: 'هل في نوع من الطلبات تحب نتابع توافره لحضرتك بشكل دوري؟',
  },
  supplements_interest: {
    question: 'هل تحب نرتب مع حضرتك متابعة بسيطة للطلبات المتكررة؟',
  },
  has_children: {
    question: 'هل في طلبات دورية للبيت تحب نرتب متابعتها مع حضرتك؟',
  },
  mother_customer: {
    question: 'هل في مواعيد أو طلبات دورية تحب نساعدك في تنظيم متابعتها؟',
  },
  elderly_in_house: {
    question: 'هل في ميعاد توصيل أو متابعة دورية تحب نثبته لحضرتك؟',
  },
};

function applyProfileHints(pack: ScriptPack, tags?: string[]): ScriptPack {
  if (!tags || !tags.length) return pack;

  for (const tag of tags) {
    const hint = PROFILE_HINTS[tag];
    if (hint && !pack.questions.includes(hint.question)) {
      return {
        ...pack,
        questions: [...pack.questions, hint.question].slice(0, 4),
      };
    }
  }

  return pack;
}

function bereavementScript(context: FollowupScriptContext): ScriptPack {
  const opening =
    brandedIntro(context) +
    ' قدر الله وما شاء فعل. خالص تعازينا لحضرتكم، وربنا يصبركم ويجبر خاطركم.';
  return {
    title: 'تعزية ومساندة',
    objective: 'التواصل الإنساني فقط، بدون أي بيع أو اقتراحات أو ضغط للمتابعة.',
    opening,
    questions: [],
    objections: [],
    closing: 'إحنا تحت أمر حضرتك في أي وقت، وربنا يصبركم ويجبر خاطركم.',
    nextStep:
      'أوقف أي متابعة تجارية مؤقتًا، وسجّل إن الحالة تحتاج احترام الخصوصية وعدم الضغط.',
    whatsapp: opening + '\n\nإحنا تحت أمر حضرتك في أي وقت.',
  };
}

function complaintScript(context: FollowupScriptContext): ScriptPack {
  const opening =
    brandedIntro(context) +
    ' حبيت أطمن على حضرتك وأسمع ملاحظتك بنفسي، عشان نراجع التفاصيل ونتابعها بشكل واضح.';
  return {
    title: 'احتواء ملاحظة أو شكوى',
    objective: 'الاستماع الكامل وتحديد خطوة واضحة وموعد رجوع، بدون افتراض سبب الخطأ.',
    opening,
    questions: [
      'ممكن حضرتك تحكيلي اللي حصل من البداية؟',
      'إيه النقطة الأهم اللي تحب نركز عليها في المتابعة؟',
      'تحب نرجع لحضرتك بإجابة أو إجراء في ميعاد معين؟',
    ],
    objections: [
      {
        objection: 'اتكلمت قبل كده ولسه الموضوع مفتوح',
        response:
          'فاهم حضرتك. هراجع اللي اتسجل وأرجع لحضرتك بخطوة واضحة وموعد محدد بدل ما يفضل الموضوع مفتوح.',
      },
      {
        objection: 'مش حابب أكمل التعامل',
        response:
          'أكيد نحترم قرار حضرتك. هنسجل ده، ولو في نقطة مفتوحة تخص التجربة الحالية هنقفلها مع حضرتك من غير أي ضغط.',
      },
    ],
    closing:
      'شكرًا لوقت حضرتك وثقتك في إنك شاركتنا ملاحظتك. هنراجع التفاصيل ونرجع لحضرتك في الموعد المتفق عليه.',
    nextStep: 'سجّل الملاحظة، المسؤول، والخطوة التالية بموعد محدد قبل إنهاء التواصل.',
    whatsapp:
      opening +
      '\n\nلو مناسب لحضرتك ابعتلنا ملاحظتك هنا، وإحنا هنراجعها ونتابعها مع حضرتك.',
  };
}

function postPurchaseScript(context: FollowupScriptContext): ScriptPack {
  const opening =
    brandedIntro(context) +
    ' حبيت أطمن إن آخر طلب وصل لحضرتك كويس وإن تجربة الطلب كانت مريحة.';
  return {
    title: 'اطمئنان بعد الطلب',
    objective: 'التأكد من جودة التجربة ومعالجة أي ملاحظة بدون ذكر تفاصيل حساسة أو أصناف.',
    opening,
    questions: [
      'كل حاجة وصلت بالشكل المتوقع لحضرتك؟',
      'في أي ملاحظة على الطلب أو التوصيل تحب نراجعها؟',
      'لو عند حضرتك استفسار عن الاستخدام، تحب أوصل حضرتك بالصيدلي؟',
    ],
    objections: [
      {
        objection: 'في ملاحظة على الطلب',
        response:
          'تمام، سجلت ملاحظتك. هراجع التفاصيل مع الفرع ونرجع لحضرتك بخطوة واضحة.',
      },
      {
        objection: 'كل حاجة تمام',
        response: 'الحمد لله، ده أهم حاجة عندنا. شكرًا جدًا لوقتك وثقتك.',
      },
    ],
    closing: respectfulClose(),
    nextStep: 'سجّل النتيجة وأي نقطة تحتاج مراجعة من الفرع أو الصيدلي بدون تفاصيل زائدة.',
    whatsapp:
      opening +
      '\n\nلو في أي ملاحظة أو استفسار، ابعتلنا هنا في الوقت المناسب لحضرتك. تحت أمر حضرتك.',
  };
}

function generalCheckinScript(context: FollowupScriptContext): ScriptPack {
  const opening =
    brandedIntro(context) +
    ' حبيت أطمن على حضرتك وأتأكد إن آخر تعامل معانا كان مريح، وإن مفيش أي ملاحظة نقدر نتابعها مع حضرتك.';
  return {
    title: 'اطمئنان على العميل',
    objective: 'متابعة دافئة ومختصرة بدون كشف سبب داخلي أو دفع العميل للشراء.',
    opening,
    questions: [
      'هل آخر تعامل لحضرتك معانا كان مريح؟',
      'هل في أي ملاحظة أو استفسار تحب نتابعه مع حضرتك؟',
      'هل في وقت معين تفضّل نتواصل فيه لو احتجنا نرجع لحضرتك؟',
    ],
    objections: [
      {
        objection: 'مش محتاج حاجة دلوقتي',
        response:
          'تمام يا فندم، إحنا بس حبينا نطمن على حضرتك. شكرًا لوقتك، وتحت أمر حضرتك في أي وقت.',
      },
      {
        objection: 'الوقت غير مناسب',
        response: 'أكيد يا فندم. قولنا بس الوقت الأنسب لحضرتك وهنلتزم بيه.',
      },
    ],
    closing: respectfulClose(),
    nextStep: 'سجّل النتيجة أو الوقت المناسب للرجوع، بدون ذكر سبب المتابعة الداخلي للعميل.',
    whatsapp:
      opening +
      '\n\nتقدر ترد في الوقت المناسب لحضرتك، وصيدليات دواء تحت أمر حضرتك.',
  };
}

function atRiskScript(context: FollowupScriptContext): ScriptPack {
  const opening =
    brandedIntro(context) +
    ' حبيت أطمن على حضرتك وأتأكد إن تجربتك معانا مريحة، ولو في أي ملاحظة نقدر نتابعها مع حضرتك.';
  return {
    title: 'متابعة اهتمام واستعادة الثقة',
    objective: 'فهم أي سبب لضعف التفاعل بدون إخبار العميل بأنه قلّل التعامل أو توقف.',
    opening,
    questions: [
      'هل في أي نقطة في الخدمة تحب نراجعها أو نحسنها مع حضرتك؟',
      'هل في طلب متكرر بتحب نساعدك في متابعته أو تجهيزه في وقت مناسب؟',
      'إيه الطريقة الأسهل لحضرتك في التواصل معانا بعد كده؟',
    ],
    objections: [
      {
        objection: 'مش محتاج حاجة حاليًا',
        response:
          'تمام جدًا. إحنا بس حبينا نطمن على حضرتك ونأكد إننا موجودين وقت ما تحتاجنا.',
      },
      {
        objection: 'في ملاحظة على الخدمة',
        response:
          'شكرًا إن حضرتك قلتلنا. هسجل الملاحظة بوضوح ونحدد خطوة عملية لمتابعتها.',
      },
    ],
    closing: respectfulClose(),
    nextStep: 'سجّل سبب الملاحظة إن وُجد، وحدد إجراء واحد فقط وموعد متابعة مناسب.',
    whatsapp:
      opening +
      '\n\nيسعدنا نسمع رأي حضرتك، وتحت أمر حضرتك في أي وقت.',
  };
}

function travelSafeScript(context: FollowupScriptContext): ScriptPack {
  const opening =
    brandedIntro(context) +
    ' حبيت أطمن على حضرتك ونشكرك على ثقتك وتعاملك مع صيدليات دواء.';
  return {
    title: 'متابعة تقدير واطمئنان',
    objective: 'الحفاظ على التواصل باحترام بدون ذكر أي تفاصيل خاصة بالسفر أو مكانه.',
    opening,
    questions: [
      'هل في أي ملاحظة أو استفسار تحب نساعدك فيه؟',
      'تحب نتواصل مع حضرتك في وقت معين لو في متابعة لاحقة؟',
    ],
    objections: [
      {
        objection: 'مش محتاج متابعة',
        response:
          'تمام يا فندم، شكرًا لوقتك وثقتك. مش هنضغط على حضرتك، وإحنا تحت أمرك في أي وقت.',
      },
    ],
    closing: respectfulClose(),
    nextStep: 'احترم رغبة العميل، ولا تذكر دولة أو مكان السفر أو أي تفاصيل شخصية غير لازمة.',
    whatsapp:
      opening +
      '\n\nسعداء بتعاملك معانا، وصيدليات دواء تحت أمر حضرتك في أي وقت.',
  };
}

function buildFollowupScriptCore(context: FollowupScriptContext): ScriptPack {
  const text = internalSignal(context);

  if (isBereavement(text)) return bereavementScript(context);
  if (isComplaint(text)) return complaintScript(context);
  if (isTravelRelated(text)) return travelSafeScript(context);
  if (isPostPurchase(text)) return postPurchaseScript(context);
  if (isAtRisk(text)) return atRiskScript(context);
  if (isInternalDoctorRequest(text, context.doctorName)) return generalCheckinScript(context);

  return generalCheckinScript(context);
}

export function buildFollowupScript(context: FollowupScriptContext): ScriptPack {
  return applyProfileHints(buildFollowupScriptCore(context), context.profileTags);
}

export function buildWelcomeMessageScript(context: FollowupScriptContext): ScriptPack {
  const opening =
    brandedIntro(context) +
    ' تشرفنا بتعاملك مع صيدليات دواء، وحبينا نرحب بحضرتك ونأكد إن فريقنا تحت أمر حضرتك لأي طلب أو استفسار.';
  const core: ScriptPack = {
    title: 'ترحيب بعميل جديد',
    objective: 'ترحيب بسيط، تعريف بطريقة التواصل، وفهم التفضيل بدون ضغط بيعي.',
    opening,
    questions: [
      'لو احتجنا نتواصل مع حضرتك بعد كده، تفضّل واتساب ولا مكالمة؟',
      'هل تحب نبعث لحضرتك طريقة الطلب والتوصيل بشكل مختصر؟',
    ],
    objections: [
      {
        objection: 'مش محتاج حاجة دلوقتي',
        response:
          'تمام جدًا يا فندم. تشرفنا بتعاملك معانا، وإحنا تحت أمر حضرتك وقت ما تحتاجنا.',
      },
      {
        objection: 'أفضل مايبقاش في رسائل كتير',
        response:
          'أكيد، هنحترم ده تمامًا ونتواصل فقط وقت الحاجة أو حسب تفضيل حضرتك.',
      },
    ],
    closing: 'تشرفنا بحضرتك، وصيدليات دواء تحت أمر حضرتك دائمًا.',
    nextStep: 'سجّل وسيلة التواصل المفضلة وأي تفضيل واضح ذكره العميل.',
    whatsapp:
      opening +
      '\n\nلو احتجت أي مساعدة، ابعتلنا هنا في الوقت المناسب لحضرتك. تحت أمر حضرتك.',
  };
  return applyProfileHints(core, context.profileTags);
}

export function buildVipCareScript(context: FollowupScriptContext): ScriptPack {
  const text = internalSignal(context);
  if (isBereavement(text)) return bereavementScript(context);
  if (isComplaint(text)) return complaintScript(context);

  const opening =
    brandedIntro(context) +
    ' بنقدّر جدًا ثقة حضرتك وتعاملك المستمر معانا، وحبينا نطمن إن تجربتك مع صيدليات دواء مريحة.';
  const core: ScriptPack = {
    title: 'رعاية خاصة لعميل مهم',
    objective: 'تقدير العميل ومتابعته باهتمام أعلى بدون مبالغة أو كشف تصنيفه الداخلي.',
    opening,
    questions: [
      'هل في أي ملاحظة مؤخراً تحب نراجعها مع حضرتك؟',
      'هل في طريقة معينة تخلي التعامل معانا أسهل وأريح لحضرتك؟',
      'تحب يكون في ميعاد أو وسيلة تواصل ثابتة للمتابعات المهمة؟',
    ],
    objections: [
      {
        objection: 'محتاج رد أسرع',
        response:
          'وصلت ملاحظتك، وهسجلها كأولوية في المتابعة عشان يكون الرجوع لحضرتك أسرع وواضح.',
      },
      {
        objection: 'الاهتمام قل',
        response:
          'شكرًا إن حضرتك قلتلنا. هراجع آخر المتابعات ونحدد خطوة واضحة نرجعلك بيها.',
      },
    ],
    closing:
      'شكرًا جدًا على ثقة حضرتك المستمرة. صيدليات دواء تحت أمر حضرتك في أي وقت.',
    nextStep: 'وثّق أي التزام بموعد ومسؤول واضح، بدون إظهار تصنيف VIP للعميل.',
    whatsapp:
      opening +
      '\n\nلو في أي ملاحظة أو حاجة تحب نتابعها، ابعتلنا هنا في الوقت المناسب لحضرتك.',
  };
  return applyProfileHints(core, context.profileTags);
}

export function followupPriorityScore(input: {
  source?: string;
  priority?: string;
  reason?: string;
  createdAt?: string | null;
  nextDate?: string | null;
}) {
  const text = (input.source || '') + ' ' + (input.priority || '') + ' ' + (input.reason || '');
  let score = 0;
  const reasons: string[] = [];

  if (/شكوى|تصعيد|غاضب|عاجل/i.test(text)) {
    score += 100;
    reasons.push('شكوى أو حالة عاجلة');
  }
  if (/doctor|طلب دكتور|طلب متابعة/i.test(text)) {
    score += 90;
    reasons.push('طلب متابعة داخلي');
  }
  if (input.nextDate && input.nextDate.slice(0, 10) <= new Date().toLocaleDateString('en-CA')) {
    score += 75;
    reasons.push('موعدها اليوم أو متأخرة');
  }
  if (/مهدد|متوقف|استرجاع/i.test(text)) {
    score += 60;
    reasons.push('عميل مهدد أو مطلوب استرجاعه');
  }
  if (/مهم جدًا|vip/i.test(text)) {
    score += 45;
    reasons.push('عميل مهم');
  }

  const ageHours = input.createdAt
    ? Math.max(0, (Date.now() - new Date(input.createdAt).getTime()) / 3600000)
    : 0;
  score += Math.min(30, Math.floor(ageHours / 4));
  if (ageHours >= 24) reasons.push('منتظرة منذ أكثر من يوم');

  return { score, label: reasons.slice(0, 2).join(' · ') || 'متابعة دورية' };
}
