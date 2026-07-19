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

function naturalOpening(context: FollowupScriptContext) {
  return `${brandedIntro(context)} حبيت أطمن على حضرتك وأتأكد إن آخر تعامل ليك معانا كان كويس، وإن مفيش أي استفسار أو حاجة نقدر نساعد حضرتك فيها.`;
}

function respectfulClose() {
  return 'شكرًا جدًا لوقت حضرتك، وتشرفنا بالكلام معاك. سجلت ملاحظات حضرتك، وصيدليات دواء تحت أمر حضرتك في أي وقت.';
}

export function buildFollowupScript(context: FollowupScriptContext): ScriptPack {
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
          response: 'مع حضرتك حق تزعل. أنا هراجع كل التفاصيل دلوقتي، وهحدد لحضرتك خطوة واضحة وموعد رجوع محدد بدل ما نسيب الموضوع مفتوح.',
        },
        {
          objection: 'مش عايز أتعامل تاني',
          response: 'أتفهم قرار حضرتك تمامًا ومش هضغط عليك. يهمني بس أصلح الخطأ وأضمن إن حق حضرتك وصل كامل.',
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
          response: 'تمام يا فندم، إحنا بس حبينا نطمن على حضرتك. شكرًا جدًا لوقتك، وإحنا تحت أمرك في أي وقت.',
        },
        {
          objection: 'الوقت غير مناسب',
          response: 'أكيد يا فندم، ولا يهم حضرتك. إمتى يكون وقت مناسب نتواصل فيه من غير ما نعطلك؟',
        },
      ],
      closing: respectfulClose(),
      nextStep: 'سجّل ملاحظات العميل وأي احتياج أو موعد مناسب للرجوع له، بدون إظهار سبب التواصل الداخلي.',
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
          response: 'شكرًا إن حضرتك وضحت. نقدر نراجع البدائل والعروض المتاحة، والأهم ما نغيرش أي دواء إلا بعد التأكد إنه مناسب لحالتك.',
        },
        {
          objection: 'الصنف مش بيكون موجود',
          response: 'حق حضرتك. هسجل الأصناف المتكررة وننسق مع الفرع لتجهيزها أو إبلاغ حضرتك أول ما تتوفر.',
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
          response: 'بنعتذر لحضرتك عن ده. هسجل الصنف بدقة ونراجع الاستكمال أو البديل المناسب مع الفرع فورًا.',
        },
        {
          objection: 'مش محتاج حاجة',
          response: 'تمام يا فندم، إحنا بس كنا حابين نطمن إن كل حاجة وصلت بشكل مناسب. شكرًا جدًا لوقتك.',
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
