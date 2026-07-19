export type FollowupScriptContext = {
  customerName: string;
  agentName: string;
  doctorName?: string | null;
  reason?: string | null;
  source?: string | null;
  result?: string | null;
  branch?: string | null;
  lastPurchase?: string | null;
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
    /طلب متابعة|متابعة العميل|عميل مهم|مهم جدًا|مهم جدا|يجب متابعته|متابعته كويس|أولوية|استثنائي|غير مصنف|doctor[_ -]?request/i.test(reason);
  return looksInternal ? '' : reason.replace(/^(?:بخصوص|بسبب)\s*/i, '').trim();
}

function agentLabel(value: string) {
  const agent = validPersonName(value);
  return agent ? `د/ ${agent.replace(/^د\/?\s*/i, '')}` : 'فريق خدمة العملاء';
}

function brandedIntro(context: FollowupScriptContext) {
  return `أهلًا بحضرتك ${customerGreeting(context.customerName)}، مع حضرتك ${agentLabel(context.agentName)} من خدمة عملاء صيدليات دواء.`;
}

function respectfulClose(extra = '') {
  return `شكرًا جدًا لوقت حضرتك وثقتك في صيدليات دواء. سجلت كل التفاصيل${extra}، وإحنا تحت أمر حضرتك في أي وقت.`;
}

export function buildFollowupScript(context: FollowupScriptContext): ScriptPack {
  const intro = brandedIntro(context);
  const reason = publicReason(context.reason);
  const text = `${context.source || ''} ${context.reason || ''} ${context.result || ''}`;
  const subject = reason ? ` بخصوص ${reason}` : '';

  if (/شكوى|غاضب|تأخير|مشكلة|تصعيد/i.test(text)) {
    const opening = `${intro} بتواصل مع حضرتك${subject} لأن راحتك ورضاك مهمين جدًا لينا. أحب أسمع من حضرتك اللي حصل من غير ما أقاطعك، وبعدها أوضح لحضرتك الخطوة اللي هنبدأ فيها وموعد الرجوع ليك.`;
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
          response: 'مع حضرتك حق تزعل. أنا هراجع كل اللي اتسجل دلوقتي، وهحدد لحضرتك خطوة واضحة وموعد رجوع محدد بدل ما نسيب الموضوع مفتوح.',
        },
        {
          objection: 'مش عايز أتعامل تاني',
          response: 'أتفهم قرار حضرتك تمامًا ومش هضغط عليك. يهمني بس أصلح الخطأ وأضمن إن حق حضرتك وصل كامل.',
        },
      ],
      closing: respectfulClose(' وحددت الإجراء وموعد المتابعة القادمة'),
      nextStep: 'سجّل المشكلة، الحل المطلوب، المسؤول، وموعد الرجوع للعميل قبل إنهاء المكالمة.',
      whatsapp: `${opening}\n\nممكن تبعتلنا التفاصيل هنا في الوقت المناسب، وأنا هتابعها مع الفرع خطوة بخطوة.\n\nصيدليات دواء — راحتك وثقتك مسؤوليتنا.`,
    };
  }

  if (/doctor|طلب دكتور|طلب متابعة/i.test(text) || validPersonName(context.doctorName)) {
    const opening = `${intro} عندنا متابعة مسجلة لحضرتك${subject}، وحابين نطمن إن الموضوع تم بالشكل اللي يرضيك. حضرتك تسمحلي أعرف وصلنا لفين، وهل في أي خطوة لسه محتاجة متابعة مننا؟`;
    return {
      title: 'متابعة طلب مسجل للعميل',
      objective: 'فهم ما تم فعليًا، توثيق النتيجة، وتحديد الخطوة التالية بدون ذكر صاحب الطلب.',
      opening,
      questions: [
        'حضرتك ممكن توضحلي آخر خطوة تمت في الموضوع؟',
        'هل تم التواصل مع حضرتك قبل كده، وإيه النتيجة؟',
        'هل في حاجة لسه معلقة أو موعد مناسب نرجع لحضرتك فيه؟',
      ],
      objections: [
        {
          objection: 'مش فاكر الطلب',
          response: reason
            ? `ولا يهم حضرتك، المتابعة المسجلة عندنا بخصوص ${reason}. هوضح لحضرتك التفاصيل باختصار ومن غير ما أعطلك.`
            : 'ولا يهم حضرتك، هراجع التفاصيل المسجلة وأوضحها لحضرتك باختصار.',
        },
        {
          objection: 'عايز أكلم المسؤول نفسه',
          response: 'تحت أمر حضرتك. هسجل طلب التواصل وموعد مناسب لحضرتك، وأتابع إن المسؤول المختص يرجع لحضرتك.',
        },
      ],
      closing: respectfulClose(' وحددت الخطوة التالية وموعد المتابعة'),
      nextStep: 'حدّث النتيجة، اكتب ما قاله العميل بوضوح، ثم أرسل التنبيه داخليًا للمسؤول المختص دون ذكر اسمه للعميل.',
      whatsapp: `${intro}\nعندنا متابعة مسجلة لحضرتك${subject}، وحابين نطمن: هل الموضوع تم بالكامل، ولا في خطوة لسه نقدر نساعد حضرتك فيها؟\n\nممكن ترد في الوقت المناسب لحضرتك، وإحنا هنتابع الموضوع من داخل صيدليات دواء لحد ما يتم.`,
    };
  }

  if (/مهدد|متوقف|قلل|استرجاع/i.test(text)) {
    const opening = `${intro} حضرتك من العملاء اللي بنعتز بيهم، ولاحظنا إن تعامل حضرتك قل الفترة الأخيرة. مكالمتي مش للضغط على حضرتك في شراء؛ إحنا بس حابين نسمعك ونعرف هل حصل موقف ضايقك أو خدمة محتاجة تتحسن.`;
    return {
      title: 'استرجاع عميل مهم باهتمام حقيقي',
      objective: 'اكتشاف سبب انخفاض التعامل واستعادة الثقة بدون ضغط بيعي.',
      opening,
      questions: [
        'هل واجهت حضرتك مشكلة في التوافر أو التوصيل أو طريقة التعامل؟',
        'هل في أصناف شهرية بيكون صعب تلاقيها أو تحب نتابع توافرها؟',
        'إيه أهم حاجة لو حسّناها تخلي تجربتك أفضل مع صيدليات دواء؟',
      ],
      objections: [
        {
          objection: 'الأسعار أعلى',
          response: 'شكرًا إن حضرتك وضحت. نقدر نراجع البدائل والعروض المتاحة، والأهم ما نغيرش أي دواء إلا بعد التأكد إنه مناسب لحالتك.',
        },
        {
          objection: 'الصنف مش بيكون موجود',
          response: 'حق حضرتك. هسجل الأصناف المتكررة وننسق مع الفرع لتجهيزها أو إبلاغ حضرتك أول ما تتوفر.',
        },
      ],
      closing: 'تشرفنا جدًا بملاحظات حضرتك، وهنبدأ في الإجراء اللي اتفقنا عليه. وجود حضرتك يفرق معانا ونتمنى نكون دائمًا عند حسن ظنك.',
      nextStep: 'صنّف سبب انخفاض التعامل وحدد إجراء استرجاع واحد قابل للقياس وموعد متابعة.',
      whatsapp: `${opening}\n\nيسعدنا جدًا نسمع ملاحظات حضرتك ونساعدك في أي احتياج.`,
    };
  }

  if (/أمس|بعد الشراء|فاتورة|طلب/i.test(text)) {
    const opening = `${intro} حبيت أطمن على طلب حضرتك الأخير: هل وصل كامل وفي الموعد؟ وهل طريقة استخدام الأصناف واضحة وكل حاجة مناسبة مع حضرتك؟`;
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
          response: 'بنعتذر لحضرتك عن ده. هسجل الصنف بدقة ونراجع الاستكمال أو البديل المناسب مع الفرع فورًا.',
        },
        {
          objection: 'مش محتاج حاجة',
          response: 'تمام يا فندم، إحنا بس كنا حابين نطمن إن كل حاجة وصلت بشكل مناسب. شكرًا جدًا لوقتك.',
        },
      ],
      closing: 'سعداء إننا اطمنا على حضرتك، ولو ظهر أي استفسار بعد كده ابعتلنا في أي وقت وإحنا تحت أمرك.',
      nextStep: 'سجّل اكتمال الطلب وأي نقص أو استفسار دوائي يحتاج رجوعًا للصيدلي.',
      whatsapp: `${opening}\n\nرأيك يهمنا جدًا، ولو في أي ملاحظة هنبدأ في حلها فورًا.`,
    };
  }

  const opening = `${intro} حبيت أطمن على حضرتك وأعرف لو في أي احتياج أو استفسار نقدر نساعد حضرتك فيه${subject}.`;
  return {
    title: 'متابعة واهتمام بالعميل',
    objective: 'فهم الاحتياج الحالي وتقديم مساعدة مناسبة دون مكالمة بيعية مزعجة.',
    opening,
    questions: [
      'هل في أصناف شهرية قربت تخلص أو تحب نتابع توافرها؟',
      'هل في استفسار عن الاستخدام أو بديل مناسب؟',
      'هل تحب نجهز احتياجات حضرتك قبل الزيارة أو التوصيل؟',
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
    closing: 'تشرفنا بخدمة حضرتك، وصيدليات دواء موجودة في أي وقت لأي استفسار أو احتياج.',
    nextStep: 'اختر نتيجة واضحة: مكتمل، موعد لاحق، احتياج، شكوى، أو تصعيد للمسؤول.',
    whatsapp: `${opening}\n\nلما يكون مناسب لحضرتك ابعتلنا احتياجك، وإحنا هنساعدك بكل اهتمام.`,
  };
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
