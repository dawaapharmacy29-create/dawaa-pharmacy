export type FollowupScriptContext = {
  customerName: string;
  agentName: string;
  doctorName?: string | null;
  reason?: string | null;
  source?: string | null;
  result?: string | null;
  branch?: string | null;
  lastPurchase?: string | null;
  // إشارات ملف العميل — من customer_flags + التصنيف والحالة، عشان السكريبت
  // يتخصص فعليًا لكل عميل مش يفضل نص عام واحد للجميع.
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

function customerGreeting(value: string) {
  const cleaned = cleanName(value);
  if (!cleaned || /^(?:غير محدد|عميل|بدون اسم|مجهول)$/i.test(cleaned)) return 'يا فندم';
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length > 1 && parts[0].length === 1) parts.shift();
  const displayName = parts.slice(0, 2).join(' ');
  return displayName ? `يا أستاذ ${displayName}` : 'يا فندم';
}

function validPersonName(value?: string | null) {
  const name = cleanName(value);
  return name && !/^(?:غير محدد|غير معروف|لا يوجد|بدون|النظام الذكي|فريق خدمة العملاء)$/i.test(name)
    ? name
    : '';
}

function publicReason(value?: string | null) {
  const reason = String(value || '')
    .replace(/\[بدون رقم صحيح\]|المصدر\s*:[^\n|]+/gi, '')
    .replace(/طريقة مفضلة\s*:[^|·]+/gi, '')
    .replace(/ملاحظة شخصية\s*:[^|·]+/gi, '')
    .replace(/طلب من\s*:?\s*د\/?\s*[^|·]+/gi, '')
    .replace(/[|]+/g, ' · ')
    .replace(/\s+/g, ' ')
    .trim();
  const looksInternal =
    !reason ||
    /طلب متابعة|متابعة العميل|عميل مهم|مهم جدًا|مهم جدا|يجب متابعته|متابعته كويس|أولوية|استثنائي|غير مصنف|doctor[_ -]?request/i.test(
      reason
    );
  return looksInternal ? '' : reason.replace(/^(?:بخصوص|بسبب)\s*/i, '').trim();
}

function agentLabel(value: string) {
  const agent = validPersonName(value);
  return agent ? `د/ ${agent.replace(/^د\/?\s*/i, '')}` : 'فريق خدمة العملاء';
}

function brandedIntro(context: FollowupScriptContext) {
  return `أهلًا بحضرتك ${customerGreeting(context.customerName)}، مع حضرتك ${agentLabel(context.agentName)} من خدمة عملاء صيدليات دواء.`;
}

function naturalOpening(context: FollowupScriptContext) {
  return `${brandedIntro(context)} حبيت أطمن على حضرتك وأتأكد إن آخر تعامل ليك معانا كان كويس، وإن مفيش أي استفسار أو حاجة نقدر نساعد حضرتك فيها.`;
}

function respectfulClose() {
  return 'شكرًا جدًا لوقت حضرتك، وتشرفنا بالكلام معاك. سجلت ملاحظات حضرتك، وصيدليات دواء تحت أمر حضرتك في أي وقت.';
}

// ============================================================================
// إشارات ملف العميل — تحويل تصنيفات customer_flags لسؤال/جملة فعلية تتقال
// في المكالمة، بدل ما تفضل مجرد "علامة" الموظف شايفها وميستخدمهاش عمليًا.
// ============================================================================

type ProfileHint = { question: string; whatsappLine: string };

const PROFILE_HINTS: Record<string, ProfileHint> = {
  monthly_treatment: {
    question: 'إيه ميعاد آخر مرة جددت فيها علاجك الشهري؟ عشان نطمن إنه ميتأخرش عليك المرة الجاية.',
    whatsappLine: 'وحابين نفكرك بميعاد تجديد علاجك الشهري قبل ما يخلص عندك، عشان ميتقطعش.',
  },
  cosmetics_interest: {
    question: 'حابب نعرفك على أحدث منتجات الكوزمو والعناية اللي وصلتنا؟',
    whatsappLine: 'وصلنا منتجات عناية وكوزمو جديدة حسينا إنها هتعجب حضرتك، حابين نبعتلك تفاصيلها؟',
  },
  supplements_interest: {
    question: 'المكملات اللي بتاخدها لسه مستمر عليها؟ محتاج نجهزلك كمية جديدة؟',
    whatsappLine: 'لو المكملات قربت تخلص عندك، قولنا نجهزها لحضرتك من دلوقتي.',
  },
  has_children: {
    question: 'الأطفال محتاجين أي حاجة (فيتامينات، لقاحات، منتجات عناية) نجهزها لحضرتك؟',
    whatsappLine: 'لو الأطفال محتاجين أي حاجة، إحنا جاهزين نجهزها ونوصلها لحضرتك بسرعة.',
  },
  mother_customer: {
    question: 'تحبي نجهز طلب شهري ثابت لاحتياجات البيت عشان يوصلك أول بأول من غير ما تتعبي تفتكري؟',
    whatsappLine: 'تحبي نظبطلك طلب شهري ثابت لاحتياجات البيت يوصلك تلقائي كل شهر؟',
  },
  elderly_in_house: {
    question: 'هل احتياجات كبار السن في البيت بتوصل بانتظام، وهل التوصيل مناسب لظروفهم؟',
    whatsappLine: 'لو حابب نظبط ميعاد توصيل ثابت ومريح لكبار السن في البيت، إحنا جاهزين.',
  },
};

function activeProfileHints(tags?: string[]): ProfileHint[] {
  if (!tags || !tags.length) return [];
  const seen = new Set<string>();
  const hints: ProfileHint[] = [];
  for (const tag of tags) {
    const hint = PROFILE_HINTS[tag];
    if (hint && !seen.has(tag)) {
      seen.add(tag);
      hints.push(hint);
    }
  }
  return hints.slice(0, 2); // أهم إشارتين بس، عشان المكالمة متتقلش بأسئلة كتير
}

function applyProfileHints(pack: ScriptPack, tags?: string[]): ScriptPack {
  const hints = activeProfileHints(tags);
  if (!hints.length) return pack;
  return {
    ...pack,
    questions: [...pack.questions, ...hints.map((h) => h.question)],
    whatsapp: `${pack.whatsapp}\n\n${hints.map((h) => h.whatsappLine).join(' ')}`,
  };
}

function buildFollowupScriptCore(context: FollowupScriptContext): ScriptPack {
  const intro = brandedIntro(context);
  const reason = publicReason(context.reason);
  const text = `${context.source || ''} ${context.reason || ''} ${context.result || ''}`;
  const subject = reason ? ` بخصوص ${reason}` : '';

  if (/شكوى|غاضب|تأخير|مشكلة|تصعيد/i.test(text)) {
    const opening = `${intro} حبيت أطمن على حضرتك وأسمع منك بنفسي علشان أتأكد إن تجربتك معانا كويسة. ولو في أي حاجة ضايقت حضرتك، يهمني أعرف التفاصيل بهدوء ونساعدك بشكل يرضيك.`;
    return {
      title: 'احتواء شكوى واسترجاع رضا العميل',
      objective: 'الاستماع الكامل، الاعتذار بوضوح، وتحديد حل ومسؤول وموعد متابعة.',
      opening,
      questions: [
        'ممكن حضرتك تحكيلي اللي حصل من البداية؟',
        'إيه أكتر نقطة ضايقت حضرتك أو أثرت على تجربتك؟',
        'إيه الحل اللي يرضي حضرتك ونقدر نبدأ فيه فورًا؟',
      ],
      objections: [
        {
          objection: 'أنا اشتكيت قبل كده ومحدش حل',
          response:
            'مع حضرتك حق تزعل. أنا هراجع كل التفاصيل دلوقتي، وهحدد لحضرتك خطوة واضحة وموعد رجوع محدد بدل ما نسيب الموضوع مفتوح.',
        },
        {
          objection: 'مش عايز أتعامل تاني',
          response:
            'أتفهم قرار حضرتك تمامًا ومش هضغط عليك. يهمني بس أصلح الخطأ وأضمن إن حق حضرتك وصل كامل.',
        },
      ],
      closing: respectfulClose(),
      nextStep: 'سجّل المشكلة، الحل المطلوب، المسؤول، وموعد الرجوع للعميل قبل إنهاء المكالمة.',
      whatsapp: `${opening}\n\nممكن تبعتلنا التفاصيل هنا في الوقت المناسب لحضرتك، وإحنا هنتابعها باهتمام.\n\n${respectfulClose()}`,
    };
  }

  if (/doctor|طلب دكتور|طلب متابعة/i.test(text) || validPersonName(context.doctorName)) {
    const opening = naturalOpening(context);
    return {
      title: 'اطمئنان عام على العميل',
      objective: 'الاطمئنان الطبيعي على تجربة العميل وفهم أي احتياج بدون كشف أي تفاصيل داخلية.',
      opening,
      questions: [
        'هل آخر تعامل لحضرتك معانا كان كويس وكل حاجة تمت بالشكل المطلوب؟',
        'هل في أي استفسار أو ملاحظة نقدر نساعد حضرتك فيها؟',
        'هل في حاجة تحب نتابعها لحضرتك أو نرجعلك بخصوصها في وقت مناسب؟',
      ],
      objections: [
        {
          objection: 'مش محتاج حاجة',
          response:
            'تمام يا فندم، إحنا بس حبينا نطمن على حضرتك. شكرًا جدًا لوقتك، وإحنا تحت أمرك في أي وقت.',
        },
        {
          objection: 'الوقت غير مناسب',
          response: 'أكيد يا فندم، ولا يهم حضرتك. إمتى يكون وقت مناسب نتواصل فيه من غير ما نعطلك؟',
        },
      ],
      closing: respectfulClose(),
      nextStep:
        'سجّل ملاحظات العميل وأي احتياج أو موعد مناسب للرجوع له، بدون إظهار سبب التواصل الداخلي.',
      whatsapp: `${opening}\n\nتقدر ترد في الوقت المناسب لحضرتك، وصيدليات دواء تحت أمرك دائمًا.`,
    };
  }

  if (/مهدد|متوقف|قلل|استرجاع/i.test(text)) {
    const opening = `${intro} حبيت أطمن على حضرتك وأعرف هل آخر تجربة ليك معانا كانت كويسة، وهل في أي حاجة نقدر نحسنها أو نساعدك فيها.`;
    return {
      title: 'اطمئنان واهتمام بعميل مهم',
      objective: 'اكتشاف أي مشكلة واستعادة الثقة بدون ذكر انخفاض التعامل أو الضغط على العميل.',
      opening,
      questions: [
        'هل واجهت حضرتك مشكلة في التوافر أو التوصيل أو طريقة التعامل؟',
        'هل في أصناف شهرية بيكون صعب تلاقيها أو تحب نتابع توافرها؟',
        'إيه أهم حاجة لو حسّناها تخلي تجربتك أفضل مع صيدليات دواء؟',
      ],
      objections: [
        {
          objection: 'الأسعار أعلى',
          response:
            'شكرًا إن حضرتك وضحت. نقدر نراجع البدائل والعروض المتاحة، والأهم ما نغيرش أي دواء إلا بعد التأكد إنه مناسب لحالتك.',
        },
        {
          objection: 'الصنف مش بيكون موجود',
          response:
            'حق حضرتك. هسجل الأصناف المتكررة وننسق مع الفرع لتجهيزها أو إبلاغ حضرتك أول ما تتوفر.',
        },
      ],
      closing: respectfulClose(),
      nextStep: 'صنّف سبب الملاحظة وحدد إجراء واحد قابل للقياس وموعد متابعة.',
      whatsapp: `${opening}\n\nيسعدنا جدًا نسمع ملاحظات حضرتك ونساعدك في أي احتياج.`,
    };
  }

  if (/أمس|بعد الشراء|فاتورة|طلب/i.test(text)) {
    const opening = `${intro} حبيت أطمن على حضرتك وأتأكد إن آخر طلب أو تعامل معانا كان كويس، وإن كل الأصناف وصلت سليمة وطريقة استخدامها واضحة لحضرتك.`;
    return {
      title: 'اطمئنان بعد الشراء',
      objective: 'التأكد من اكتمال الطلب وسلامة التجربة ومعالجة أي نقص فورًا.',
      opening,
      questions: [
        'هل الطلب وصل كامل وبالحالة المطلوبة؟',
        'هل في صنف محتاج شرح استخدام أو استفسار عنه؟',
        'هل في أي ملاحظة على التوصيل أو التعامل نقدر نحسنها؟',
      ],
      objections: [
        {
          objection: 'في صنف ناقص أو بديل غير مناسب',
          response:
            'بنعتذر لحضرتك عن ده. هسجل الصنف بدقة ونراجع الاستكمال أو البديل المناسب مع الفرع فورًا.',
        },
        {
          objection: 'مش محتاج حاجة',
          response:
            'تمام يا فندم، إحنا بس كنا حابين نطمن إن كل حاجة وصلت بشكل مناسب. شكرًا جدًا لوقتك.',
        },
      ],
      closing: respectfulClose(),
      nextStep: 'سجّل اكتمال الطلب وأي نقص أو استفسار دوائي يحتاج رجوعًا للصيدلي.',
      whatsapp: `${opening}\n\nرأيك يهمنا جدًا، وصيدليات دواء تحت أمرك في أي وقت.`,
    };
  }

  const opening = naturalOpening(context);
  return {
    title: 'اطمئنان واهتمام بالعميل',
    objective: 'فهم الاحتياج الحالي وتقديم مساعدة مناسبة دون كشف أي سبب داخلي للتواصل.',
    opening,
    questions: [
      'هل آخر تعامل لحضرتك معانا كان كويس؟',
      'هل في أي استفسار أو ملاحظة نقدر نساعد حضرتك فيها؟',
      'هل في حاجة تحب نجهزها أو نتابع توافرها لحضرتك؟',
    ],
    objections: [
      {
        objection: 'الوقت غير مناسب',
        response: 'أكيد يا فندم، إمتى يكون أنسب وقت نتواصل مع حضرتك؟',
      },
      {
        objection: 'مش محتاج حاليًا',
        response: 'تمام جدًا، شكرًا لوقت حضرتك. إحنا موجودين وقت ما تحتاجنا من غير أي ضغط.',
      },
    ],
    closing: respectfulClose(),
    nextStep: 'اختر نتيجة واضحة: مكتمل، موعد لاحق، احتياج، شكوى، أو تصعيد للمسؤول.',
    whatsapp: `${opening}\n\nتقدر ترد في الوقت المناسب لحضرتك، وصيدليات دواء تحت أمرك دائمًا.`,
  };
}

export function buildFollowupScript(context: FollowupScriptContext): ScriptPack {
  const core = buildFollowupScriptCore(context);
  return applyProfileHints(core, context.profileTags);
}

// ============================================================================
// رسالة ترحيب لعميل جديد — سيناريو منفصل تمامًا عن المتابعة، لأن الهدف مختلف:
// تعريف بالصيدلية + كسر الجليد + فهم الاحتياج الأساسي، مش اطمئنان بعد تعامل.
// ============================================================================
export function buildWelcomeMessageScript(context: FollowupScriptContext): ScriptPack {
  const greeting = customerGreeting(context.customerName);
  const opening = `أهلًا وسهلًا بحضرتك ${greeting} في صيدليات دواء 🌿 معاك ${agentLabel(context.agentName)}، وحبينا نرحب بحضرتك بيننا ونكون تحت أمرك في أي وقت.`;
  const core: ScriptPack = {
    title: 'ترحيب بعميل جديد',
    objective: 'كسر الجليد، تعريف العميل إزاي يتواصل معانا بسهولة، وفهم أول احتياج ليه.',
    opening,
    questions: [
      'حابب تعرف حضرتك إن عندنا خدمة توصيل وتقدر تطلب من غير ما تتعب نفسك بالنزول؟',
      'في احتياج معين حضرتك عايز نجهزه لحضرتك دلوقتي أو بشكل دوري؟',
      'هل حضرتك تفضل نتواصل معاك واتساب ولا مكالمة في المرات الجاية؟',
    ],
    objections: [
      {
        objection: 'أنا عادة باشتري من مكان تاني',
        response:
          'تشرفنا إن حضرتك جربتنا المرة دي، وهنكون سعداء نبقى خيار حضرتك الأساسي — وأي حاجة محتاجها إحنا جاهزين نجهزها بسرعة وبجودة.',
      },
      {
        objection: 'مش محتاج حاجة دلوقتي',
        response:
          'تمام يا فندم، وده طبيعي جدًا. خدت رقم حضرتك عشان لو احتجت أي حاجة في أي وقت تلاقينا على بعد رسالة أو مكالمة واحدة.',
      },
    ],
    closing: 'يسعدنا جدًا وجود حضرتك معانا، وصيدليات دواء تحت أمرك دايمًا 🌿',
    nextStep: 'سجّل أول احتياج أو تفضيل تواصل ذكره العميل، عشان نبني عليه أول متابعة فعلية.',
    whatsapp: `${opening}\n\nمعاك خدمة توصيل سريع، ولو احتجت أي دواء أو منتج في أي وقت إحنا هنا. تحت أمر حضرتك 🌿`,
  };
  return applyProfileHints(core, context.profileTags);
}

// ============================================================================
// تعامل خاص مع عميل مهم جدًا / VIP — نفس منطق الاطمئنان لكن بلهجة أرقى واهتمام
// أوضح بالتفاصيل الشخصية، لأن الخطأ هنا (فقدان عميل مهم) تكلفته أعلى بكتير.
// ============================================================================
export function buildVipCareScript(context: FollowupScriptContext): ScriptPack {
  const intro = brandedIntro(context);
  const opening = `${intro} حضرتك من أهم عملاء صيدليات دواء، وحبينا نطمن على حضرتك شخصيًا ونتأكد إن كل تعامل ليك معانا بيوصل لمستوى تستحقه.`;
  const core: ScriptPack = {
    title: 'رعاية خاصة لعميل مهم جدًا',
    objective: 'إشعار العميل بمكانته الحقيقية، ومعالجة أي احتياج بأولوية فورية.',
    opening,
    questions: [
      'هل في أي حاجة حصلت مؤخرًا حسيت إنها أقل من مستوى تعاملنا المعتاد معاك؟',
      'إيه اللي ممكن نظبطه لحضرتك عشان تجربتك تبقى أسهل ومريحة أكتر (ميعاد توصيل ثابت، تجهيز مسبق، خط تواصل مباشر)؟',
      'هل حضرتك عايز حد معين يكون مسؤول عن متابعتك بشكل شخصي؟',
    ],
    objections: [
      {
        objection: 'محتاج رد أسرع من العادي',
        response:
          'حق حضرتك تمامًا، ومكانتك تستاهل أولوية فعلية مش كلام بس. هفتح لحضرتك خط متابعة مباشر ونتأكد إن أي طلب بتاعك بياخد أولوية.',
      },
      {
        objection: 'حاسس إن الاهتمام قل عن الأول',
        response:
          'بشكرك جدًا إنك قلتلي كده صراحة. هراجع تعاملاتك الأخيرة بنفسي وهرجعلك بخطوة واضحة، مش وعد عام.',
      },
    ],
    closing: 'وجود حضرتك معانا شرف لصيدليات دواء، وهفضل شخصيًا متابع أي احتياج ليك.',
    nextStep:
      'وثّق أي التزام شخصي بالاسم والتاريخ، وحدد مين المسؤول عن متابعته — عميل VIP مش بيتسجّل "ملاحظة عامة".',
    whatsapp: `${opening}\n\nلو محتاج أي حاجة في أي وقت، ابعتلي هنا مباشرة وهتابعها بنفسي أولًا بأول.`,
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
  const text = `${input.source || ''} ${input.priority || ''} ${input.reason || ''}`;
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
