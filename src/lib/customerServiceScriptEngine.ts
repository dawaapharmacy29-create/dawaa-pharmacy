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

function customerGreeting(value: string) {
  const cleaned = String(value || '')
    .replace(/\++/g, ' ')
    .replace(/^(?:أ\/?|ا\/?|د\/?|دكتور(?:ة)?|أستاذ(?:ة)?)\s*/i, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || /^(?:غير محدد|عميل|بدون اسم|مجهول)$/i.test(cleaned)) return 'يا فندم';
  const nameParts = cleaned.split(/\s+/);
  if (nameParts.length > 1 && nameParts[0].length === 1) nameParts.shift();
  const displayName = nameParts.slice(0, 2).join(' ');
  return displayName ? `يا أستاذ ${displayName}` : 'يا فندم';
}

function publicReason(value?: string | null) {
  const reason = String(value || '')
    .replace(/\[بدون رقم صحيح\]|المصدر\s*:[^\n|]+/gi, '')
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

function validPersonName(value?: string | null) {
  const name = String(value || '').replace(/\s+/g, ' ').trim();
  return name && !/^(?:غير محدد|غير معروف|لا يوجد|بدون|النظام الذكي)$/i.test(name) ? name : '';
}

export function buildFollowupScript(context: FollowupScriptContext): ScriptPack {
  const greeting = customerGreeting(context.customerName);
  const agent = context.agentName || 'فريق خدمة العملاء';
  const doctor = validPersonName(context.doctorName);
  const reason = publicReason(context.reason);
  const text = `${context.source || ''} ${context.reason || ''} ${context.result || ''}`;
  const intro = `أهلًا بحضرتك ${greeting}، مع حضرتك ${agent} من خدمة عملاء صيدليات دواء.`;

  if (/شكوى|غاضب|تأخير|مشكلة|تصعيد/i.test(text)) {
    const subject = reason ? ` بخصوص ${reason}` : '';
    const opening = `${intro} بتواصل مع حضرتك${subject} علشان أفهم اللي حصل بالتفصيل وأساعد حضرتك نوصل لحل مناسب.`;
    return {
      title: 'احتواء شكوى واسترجاع رضا العميل',
      objective: 'فهم المشكلة كاملة، تهدئة العميل، وتحديد حل بموعد ومسؤول واضحين.',
      opening,
      questions: [
        'ممكن حضرتك تحكيلي اللي حصل من البداية؟',
        'إيه أكتر نقطة ضايقت حضرتك؟',
        'إيه الحل المناسب من وجهة نظر حضرتك؟',
      ],
      objections: [
        {
          objection: 'أنا اشتكيت قبل كده ومحدش حل',
          response:
            'مع حضرتك حق. خليني أراجع اللي اتسجل وأحدد لحضرتك الآن مين المسؤول وإمتى هنوصل للحل.',
        },
        {
          objection: 'مش عايز أتعامل تاني',
          response: 'أتفهم تمامًا. مش هضغط على حضرتك؛ هدفي أصلّح التجربة وأضمن إن حق حضرتك وصل.',
        },
      ],
      closing:
        'أنا سجلت كل التفاصيل وهتابع الموضوع بنفسي، ومش هنعتبره انتهى غير لما نتأكد إن حضرتك راضي.',
      nextStep: 'سجّل الحل المطلوب، المسؤول، وموعد الرجوع للعميل قبل إنهاء المكالمة.',
      whatsapp: `${opening}\n\nلو الوقت مش مناسب للمكالمة، ابعتلنا التفاصيل هنا وأنا هتابعها مع حضرتك خطوة بخطوة.`,
    };
  }

  if (/doctor|طلب دكتور|طلب متابعة/i.test(text) || doctor) {
    const requestSource = doctor ? `د/ ${doctor.replace(/^د\/?\s*/i, '')} طلب مننا نطمن على حضرتك` : 'عندنا متابعة مسجلة لحضرتك';
    const subject = reason ? ` بخصوص ${reason}` : '';
    const opening = `${intro} ${requestSource}${subject}. هل الموضوع تم، ولا في حاجة لسه نقدر نساعد حضرتك فيها؟`;
    return {
      title: 'متابعة بطلب من الدكتور',
      objective: 'إغلاق طلب الدكتور بنتيجة مؤكدة وإبلاغه بما تم أو بالخطوة التالية.',
      opening,
      questions: [
        'هل الطلب أو المشكلة ما زالت قائمة؟',
        'هل تم التواصل مع حضرتك قبل كده؟',
        'هل في أي تفصيلة إضافية تحب توضحها؟',
      ],
      objections: [
        {
          objection: 'مش فاكر الطلب',
          response: reason
            ? `ولا يهم حضرتك، المتابعة المسجلة عندنا بخصوص ${reason}. أوضحها لحضرتك بسرعة.`
            : 'ولا يهم حضرتك، هراجع لحضرتك التفاصيل المسجلة عندنا بسرعة.',
        },
        {
          objection: 'الدكتور يتواصل معايا',
          response: 'أكيد، هسجل طلب حضرتك وأرسل للدكتور ملخصًا واضحًا وموعد التواصل المناسب.',
        },
      ],
      closing: doctor
        ? 'تمام يا فندم، شكرًا لوقتك. سجلت كل التفاصيل وهبلغ الدكتور بالنتيجة، ولو في خطوة تانية هنرجع لحضرتك في الموعد اللي اتفقنا عليه.'
        : 'تمام يا فندم، شكرًا لوقتك. سجلت كل التفاصيل، ولو في خطوة تانية هنرجع لحضرتك في الموعد اللي اتفقنا عليه.',
      nextStep: 'حدّث نتيجة الطلب ثم أرسل إشعار النتيجة للدكتور مقدم الطلب.',
      whatsapp: `${intro}\n${requestSource}${subject}، وحابين نطمن: هل الموضوع تم، ولا في حاجة لسه نقدر نساعد حضرتك فيها؟\n\nصيدليات دواء — دايمًا تحت أمر حضرتك.`,
    };
  }

  if (/مهدد|متوقف|قلل|استرجاع/i.test(text)) {
    const opening = `${intro} حضرتك من عملائنا اللي بنعتز بيهم، ولاحظنا إن تعامل حضرتك قل الفترة الأخيرة، فحبيت أطمن إن مفيش موقف ضايق حضرتك أو احتياج إحنا مقصرين فيه.`;
    return {
      title: 'استرجاع عميل مهم',
      objective: 'اكتشاف سبب انخفاض التعامل واستعادة الثقة بدون ضغط بيعي.',
      opening,
      questions: [
        'هل واجهت حضرتك مشكلة في التوافر أو الخدمة؟',
        'هل في منتجات شهرية تحب نجهزها لحضرتك؟',
        'إيه أكتر حاجة نقدر نحسنها؟',
      ],
      objections: [
        {
          objection: 'الأسعار أعلى',
          response:
            'شكرًا إن حضرتك وضحت. نقدر نراجع البدائل والعروض المتاحة من غير تغيير غير مناسب لحالتك.',
        },
        {
          objection: 'الصنف مش بيكون موجود',
          response: 'حق حضرتك. أسجل الأصناف المتكررة وننسق تجهيزها أو إبلاغ حضرتك فور توافرها.',
        },
      ],
      closing:
        'تشرفنا ملاحظات حضرتك، وهنشتغل عليها فورًا. وجود حضرتك يفرق معانا ونتمنى نكون دائمًا عند حسن ظنك.',
      nextStep: 'صنّف سبب التوقف وحدد إجراء استرجاع واحد قابل للقياس وموعد متابعة.',
      whatsapp: `${opening}\n\nيسعدنا جدًا نسمع ملاحظات حضرتك ونساعدك في أي احتياج.`,
    };
  }

  if (/أمس|بعد الشراء|فاتورة|طلب/i.test(text)) {
    const opening = `${intro} حبيت أطمن على طلب حضرتك الأخير: هل وصل كامل وفي الموعد، وهل طريقة الاستخدام واضحة وكل الأصناف مناسبة؟`;
    return {
      title: 'اطمئنان بعد الشراء',
      objective: 'التأكد من اكتمال الطلب وسلامة التجربة ومعالجة أي نقص فورًا.',
      opening,
      questions: [
        'هل الطلب وصل كامل؟',
        'هل يوجد صنف يحتاج شرح استخدام؟',
        'هل في احتياج مكمل نقدر نساعد فيه بدون تحميل حضرتك حاجة غير لازمة؟',
      ],
      objections: [
        {
          objection: 'في صنف ناقص أو بديل غير مناسب',
          response: 'آسف على ده. خليني أسجل الصنف بدقة ونراجع البديل أو الاستكمال مع الفرع فورًا.',
        },
        {
          objection: 'مش محتاج حاجة',
          response: 'تمام يا فندم، إحنا فقط بنطمن إن الطلب وصل كامل. شكرًا لوقتك.',
        },
      ],
      closing: 'سعداء إننا اطمنا على حضرتك، ولو ظهر أي استفسار ابعتلنا في أي وقت وإحنا تحت أمرك.',
      nextStep: 'سجّل اكتمال الطلب وأي نقص أو استفسار دوائي يحتاج رجوعًا للصيدلي.',
      whatsapp: `${opening}\n\nرأيك يهمنا جدًا، ولو في أي ملاحظة هنحلها فورًا.`,
    };
  }

  const subject = reason ? `، وخصوصًا بخصوص ${reason}` : '';
  const opening = `${intro} حبيت أطمن على حضرتك وأعرف لو في أي احتياج أو استفسار نقدر نساعد حضرتك فيه${subject}.`;
  return {
    title: 'متابعة واهتمام بالعميل',
    objective: 'فهم الاحتياج الحالي وتقديم مساعدة مناسبة دون مكالمة بيعية مزعجة.',
    opening,
    questions: [
      'هل في أصناف شهرية قاربت على الانتهاء؟',
      'هل يوجد استفسار عن الاستخدام أو بديل؟',
      'هل تحب نجهز احتياجاتك قبل الزيارة أو التوصيل؟',
    ],
    objections: [
      {
        objection: 'الوقت غير مناسب',
        response: 'أكيد يا فندم، إمتى يكون أنسب وقت أتواصل مع حضرتك؟',
      },
      {
        objection: 'مش محتاج حاليًا',
        response: 'تمام جدًا، شكرًا لوقتك. إحنا موجودين وقت ما تحتاجنا.',
      },
    ],
    closing: 'تشرفنا بخدمة حضرتك، وإحنا موجودين في أي وقت بدون أي ضغط للشراء.',
    nextStep: 'اختر نتيجة واضحة: مكتمل، موعد لاحق، احتياج، شكوى، أو تصعيد للمدير.',
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
  if (/doctor|طلب دكتور/i.test(text)) {
    score += 90;
    reasons.push('طلب دكتور');
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
