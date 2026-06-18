import type { CustomerClassKey, CustomerStatusKey } from '@/lib/customerMetrics';

export type ScriptKey =
  | 'vip'
  | 'important'
  | 'medium'
  | 'at_risk'
  | 'stopped'
  | 'post_purchase'
  | 'complaint'
  | 'missing_item'
  | 'monthly_meds'
  | 'price_objection'
  | 'discount_offer'
  | 'cashback'
  | 'return_stopped'
  | 'solve_problem'
  | 'loyalty_check'
  | 'no_answer'
  | 'happy'
  | 'angry';

export interface ScriptVars {
  customerName?: string;
  staffName?: string;
  branchName?: string;
  itemName?: string;
}

const customerName = (vars: ScriptVars) => vars.customerName || 'حضرتك';
const staffName = (vars: ScriptVars) => vars.staffName || 'فريق صيدليات دواء';
const branchName = (vars: ScriptVars) => (vars.branchName ? ` - ${vars.branchName}` : '');

export const SCRIPTS: Record<ScriptKey, { label: string; text: (vars: ScriptVars) => string }> = {
  vip: {
    label: 'عميل VIP / مهم جدًا',
    text: (vars) =>
      `أهلًا أ/ ${customerName(vars)}، مع حضرتك ${staffName(vars)} من صيدليات دواء${branchName(vars)}.\nحضرتك من عملائنا المهمين، وبنطمن عليك ونتأكد إن احتياجاتك الشهرية متوفرة.\nلو في أي أصناف محتاجها، نقدر نجهزها لحضرتك فورًا ونوفرلك التوصيل.\nتحت أمرك في أي وقت.`,
  },
  important: {
    label: 'عميل مهم',
    text: (vars) =>
      `أهلًا أ/ ${customerName(vars)}، مع حضرتك ${staffName(vars)} من صيدليات دواء.\nبنطمن على حضرتك ونتأكد إن كل احتياجاتك متوفرة.\nلو محتاج أي دواء أو طلب، نجهزه لحضرتك بكل سهولة.`,
  },
  medium: {
    label: 'عميل متوسط',
    text: (vars) =>
      `أهلًا أ/ ${customerName(vars)}، مع حضرتك ${staffName(vars)} من صيدليات دواء.\nحابين نطمن إن كل حاجة تمام، ولو محتاج أي صنف أو توصيل إحنا تحت أمرك.`,
  },
  at_risk: {
    label: 'عميل مهدد بالتوقف',
    text: (vars) =>
      `أهلًا أ/ ${customerName(vars)}، وحشتنا في صيدليات دواء.\nبنطمن عليك ونسأل لو في أي حاجة قصرنا فيها أو صنف مش متوفر.\nيهمنا نعرف ونساعدك.`,
  },
  stopped: {
    label: 'عميل متوقف',
    text: (vars) =>
      `أهلًا أ/ ${customerName(vars)}، حضرتك من العملاء اللي يهمونا.\nلاحظنا إن بقالنا فترة ما اتشرفناش بخدمتك، فحبينا نطمن ونشوف لو نقدر نساعد في أي احتياج.`,
  },
  post_purchase: {
    label: 'متابعة بعد الشراء',
    text: (vars) =>
      `أهلًا أ/ ${customerName(vars)}، بنطمن إن طلب حضرتك وصل تمام وإن الخدمة كانت مناسبة.\nأي ملاحظة منك تهمنا جدًا.`,
  },
  complaint: {
    label: 'متابعة شكوى',
    text: (vars) =>
      `أهلًا أ/ ${customerName(vars)}، بنعتذر لحضرتك عن أي مشكلة حصلت.\nيهمنا نراجع التفاصيل ونحل الموضوع بشكل يرضيك.`,
  },
  missing_item: {
    label: 'صنف ناقص',
    text: (vars) =>
      `أهلًا أ/ ${customerName(vars)}، بخصوص الصنف المطلوب${vars.itemName ? ` (${vars.itemName})` : ''}، هنتابع توفره ونبلغ حضرتك أول ما يكون جاهز.\nشكرًا لصبرك.`,
  },
  monthly_meds: {
    label: 'أدوية شهرية',
    text: (vars) =>
      `أهلًا أ/ ${customerName(vars)}، بنفكرك بلطف لو ميعاد الأدوية الشهرية قرب.\nنقدر نجهز طلبك ونوصله لحضرتك في الوقت المناسب.`,
  },
  price_objection: {
    label: 'اعتراض على السعر',
    text: (vars) =>
      `أهلًا أ/ ${customerName(vars)}، فاهمين ملاحظتك بخصوص السعر.\nهنراجع المتاح ونقترح لحضرتك أفضل اختيار مناسب بدون أي ضغط.`,
  },
  discount_offer: {
    label: 'عرض أو خصم مناسب',
    text: (vars) =>
      `أهلًا أ/ ${customerName(vars)}، مع حضرتك ${staffName(vars)} من صيدليات دواء.\nحبّيت أبلغ حضرتك إن في عرض مناسب على بعض الاحتياجات، ولو تحب نراجع طلبك ونشوف الأنسب ليك نجهزه لحضرتك.`,
  },
  cashback: {
    label: 'كاش باك للعميل',
    text: (vars) =>
      `أهلًا أ/ ${customerName(vars)}، بنقدّر ثقتك في صيدليات دواء.\nلو طلبك مناسب للعرض الحالي ممكن تستفيد بكاش باك أو ميزة إضافية. تحب أراجع لحضرتك التفاصيل؟`,
  },
  return_stopped: {
    label: 'إعادة عميل متوقف',
    text: (vars) =>
      `أهلًا أ/ ${customerName(vars)}، وحشتنا في صيدليات دواء.\nيهمنا نعرف لو فيه سبب خلاك تبعد عننا أو خدمة محتاجين نحسنها. هدفنا نرجع نخدمك بالطريقة اللي تريحك.`,
  },
  solve_problem: {
    label: 'حل مشكلة أو شكوى',
    text: (vars) =>
      `أهلًا أ/ ${customerName(vars)}، مع حضرتك ${staffName(vars)} من صيدليات دواء.\nوصلنا إن فيه نقطة محتاجة مراجعة، وحقك علينا نسمع التفاصيل ونحلها بشكل واضح يرضيك.`,
  },
  loyalty_check: {
    label: 'متابعة علاقة دائمة',
    text: (vars) =>
      `أهلًا أ/ ${customerName(vars)}، بنطمن عليك من صيدليات دواء.\nلو عندك أدوية شهرية أو طلبات بتتكرر نقدر نرتبها معاك في الوقت المناسب.`,
  },
  no_answer: {
    label: 'عميل لم يرد',
    text: (vars) =>
      `أهلًا أ/ ${customerName(vars)}، حاولنا نطمن على حضرتك.\nوقت ما يكون مناسب لك ابعتلنا، وإحنا تحت أمرك في أي طلب.`,
  },
  happy: {
    label: 'عميل سعيد',
    text: (vars) =>
      `أهلًا أ/ ${customerName(vars)}، سعداء جدًا إن تجربتك كانت كويسة.\nرأيك بيفرق معانا، ودايمًا في خدمتك.`,
  },
  angry: {
    label: 'عميل غاضب',
    text: (vars) =>
      `أهلًا أ/ ${customerName(vars)}، بنعتذر لحضرتك بصدق.\nهنراجع اللي حصل ونرجعلك بحل واضح، ورضاك مهم عندنا.`,
  },
};

export const SCRIPT_OPTIONS = Object.entries(SCRIPTS).map(([value, script]) => ({
  value: value as ScriptKey,
  label: script.label,
}));

export function getScript(
  keyOrClass?: ScriptKey | CustomerClassKey,
  status?: CustomerStatusKey | string,
  vars: ScriptVars = {}
): string {
  let key: ScriptKey = 'medium';

  if (keyOrClass && keyOrClass in SCRIPTS) {
    key = keyOrClass as ScriptKey;
  } else if (status === 'stopped') {
    key = 'stopped';
  } else if (status === 'at_risk') {
    key = 'at_risk';
  } else if (keyOrClass === 'vip') {
    key = 'vip';
  } else if (keyOrClass === 'important') {
    key = 'important';
  } else if (keyOrClass === 'medium') {
    key = 'medium';
  }

  return SCRIPTS[key].text(vars);
}
