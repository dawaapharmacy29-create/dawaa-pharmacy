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

function firstName(value: string) {
  return value.trim().split(/\s+/)[0] || 'حضرتك';
}

function reasonText(value?: string | null) {
  const reason = String(value || '')
    .replace(/\[بدون رقم صحيح\]|المصدر\s*:[^\n|]+/gi, '')
    .replace(/[|]+/g, ' · ')
    .replace(/\s+/g, ' ')
    .trim();
  return reason && !/طلب متابعة|متابعة العميل/i.test(reason)
    ? reason
    : 'الاطمئنان على حضرتك والتأكد إن كل احتياجاتك تمت بشكل مناسب';
}

export function buildFollowupScript(context: FollowupScriptContext): ScriptPack {
  const name = firstName(context.customerName);
  const agent = context.agentName || 'فريق خدمة العملاء';
  const doctor = String(context.doctorName || '').trim();
  const reason = reasonText(context.reason);
  const text = `${context.source || ''} ${context.reason || ''} ${context.result || ''}`;
  const intro = `أهلًا بحضرتك يا أ/ ${name}، مع حضرتك ${agent} من خدمة عملاء صيدليات دواء.`;

  if (/شكوى|غاضب|تأخير|مشكلة|تصعيد/i.test(text)) {
    const opening = `${intro} أنا بتواصل مع حضرتك بنفسي بخصوص ${reason}. حق حضرتك علينا إننا نفهم اللي حصل كامل ونوصل لحل يرضيك.`;
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
    const doctorPart = doctor ? `${doctor} طلب مننا` : 'الدكتور المسؤول طلب مننا';
    const opening = `${intro} ${doctorPart} نتابع مع حضرتك بخصوص ${reason}، وحبيت أتواصل مع حضرتك وأتأكد إن الموضوع بيتابع لحد ما يتم بالشكل المناسب.`;
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
          response: `ولا يهم حضرتك، الطلب المسجل عندنا بخصوص ${reason}. أوضحه لحضرتك بسرعة.`,
        },
        {
          objection: 'الدكتور يتواصل معايا',
          response: 'أكيد، هسجل طلب حضرتك وأرسل للدكتور ملخصًا واضحًا وموعد التواصل المناسب.',
        },
      ],
      closing:
        'تمام يا فندم، سجلت كلام حضرتك وهبلغ الدكتور بالنتيجة، ولو محتاجين خطوة تانية هنرجع لحضرتك في الموعد المتفق عليه.',
      nextStep: 'حدّث نتيجة الطلب ثم أرسل إشعار النتيجة للدكتور مقدم الطلب.',
      whatsapp: `${opening}\n\nممكن حضرتك تطمنا هل الموضوع تم ولا ما زال يحتاج متابعة؟`,
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

  const opening = `${intro} حبيت أطمن على حضرتك وأعرف إذا كان في أي احتياج شهري أو استفسار نقدر نساعدك فيه، خصوصًا بخصوص ${reason}.`;
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
