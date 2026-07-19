import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type QuickReplyScript = {
  id: string;
  shortcut: string;
  title: string;
  category: string;
  script_type: string;
  doctor_name: string | null;
  branch: string | null;
  message_body: string;
  questions: string[] | null;
  suggested_products: string[] | null;
  tags: string[] | null;
  active: boolean;
  usage_count: number;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export const QUICK_REPLY_RLS_MESSAGE =
  'ليس لديك صلاحية حفظ الردود السريعة أو لم يتم تفعيل صلاحيات الجدول.';
export const QUICK_REPLY_ARRAY_FORMAT_MESSAGE =
  'حدث خطأ في صيغة الأسئلة أو الوسوم. تم إرسال القائمة بصيغة غير مناسبة.';

export const QUICK_REPLY_SCRIPT_TYPES = [
  'quick_reply',
  'welcome',
  'cross_sell',
  'up_sell',
  'complaint',
  'followup',
  'cold_flu',
  'monthly_refill',
  'vip',
  'no_answer',
  'price_objection',
  'delivery_delay',
] as const;

export const DEFAULT_QUICK_REPLY_SCRIPTS: Array<
  Pick<QuickReplyScript, 'shortcut' | 'title' | 'category' | 'script_type' | 'message_body'> &
    Partial<QuickReplyScript>
> = [
  {
    shortcut: '/ترحيب',
    title: 'ترحيب احترافي بعميل جديد',
    category: 'ترحيب',
    script_type: 'welcome',
    message_body:
      'أهلًا بحضرتك {{customer_name}}، مع حضرتك د/ {{doctor_name}} من صيدليات دواء. نورتنا، ويسعدنا نخدم حضرتك ونساعدك في أي استفسار عن دواء أو طلب أو متابعة. حضرتك تحت أمرنا في أي وقت.',
    tags: ['ترحيب', 'welcome', 'عميل جديد'],
  },
  {
    shortcut: '/برد',
    title: 'استفسار أعراض برد بأمان',
    category: 'برد ومناعة',
    script_type: 'cold_flu',
    message_body:
      'أهلًا بحضرتك {{customer_name}}، مع حضرتك د/ {{doctor_name}} من صيدليات دواء. نطمن على حضرتك الأول: هل في حرارة؟ الكحة ناشفة ولا ببلغم؟ في رشح أو انسداد؟ وهل عند حضرتك حساسية من أدوية أو ضغط أو سكر أو حمل؟ بعد إجابات حضرتك نرشح الأنسب بأمان.',
    tags: ['برد', 'أعراض', 'آمن'],
  },
  {
    shortcut: '/مناعة',
    title: 'اقتراح مكمل بدون ضغط',
    category: 'Cross Sell',
    script_type: 'cross_sell',
    message_body:
      'ممكن كمان نهتم بالسوائل الدافئة والراحة والتغذية، ولو حضرتك تحب نراجع اختيار مناسب لدعم المناعة حسب السن والحالة. طبعًا من غير ما نحمل حضرتك أي حاجة مش محتاجها.',
    tags: ['مناعة', 'cross-sell'],
  },
  {
    shortcut: '/متابعة',
    title: 'متابعة بعد آخر تعامل',
    category: 'متابعة',
    script_type: 'followup',
    message_body:
      'أهلًا بحضرتك {{customer_name}}، مع حضرتك د/ {{doctor_name}} من صيدليات دواء. حبيت أطمن على حضرتك بعد آخر تعامل: هل كل شيء تم بالشكل المطلوب؟ وهل في أي ملاحظة أو احتياج نقدر نساعد حضرتك فيه؟',
    tags: ['متابعة'],
  },
  {
    shortcut: '/سعر',
    title: 'احتواء اعتراض السعر',
    category: 'اعتراضات',
    script_type: 'price_objection',
    message_body:
      'حضرتك معاك حق تسأل عن السعر. هدفنا نوفر لحضرتك اختيار مناسب وفعال، ونوضح البدائل والعروض المتاحة بدون تغيير أي علاج إلا بعد التأكد إنه مناسب لحالتك. تحب أراجع لحضرتك أفضل اختيار متاح؟',
    tags: ['سعر', 'بديل'],
  },
  {
    shortcut: '/توصيل',
    title: 'تأخير أو متابعة توصيل',
    category: 'توصيل',
    script_type: 'delivery_delay',
    message_body:
      'طلب حضرتك محل اهتمامنا جدًا، وبنعتذر عن أي تأخير حصل. هراجع حالة الطلب مع الفرع فورًا وأرجع لحضرتك بتحديث واضح وموعد متوقع بدل ما نسيبك منتظر.',
    tags: ['توصيل'],
  },
  {
    shortcut: '/شكوى',
    title: 'احتواء شكوى واستعادة رضا العميل',
    category: 'شكاوى',
    script_type: 'complaint',
    message_body:
      'بنعتذر جدًا لحضرتك عن التجربة اللي ضايقتك. يهمنا نسمع التفاصيل كاملة ونحل الموضوع بشكل يرضيك. ممكن توضح لنا اللي حصل ورقم الطلب لو متاح؟ وهنتابع مع حضرتك لحد التأكد إن المشكلة انتهت.',
    tags: ['شكوى'],
  },
  {
    shortcut: '/روشتة',
    title: 'طلب صورة روشتة واضحة',
    category: 'روشتة',
    script_type: 'quick_reply',
    message_body:
      'حضرتك ممكن تبعت صورة الروشتة كاملة وواضحة، ويفضل بإضاءة جيدة ومن غير قص أي جزء. دكتور صيدلي من صيدليات دواء هيراجعها ويوضح المتاح وطريقة الاستخدام والبدائل المناسبة عند الحاجة.',
    tags: ['روشتة'],
  },
  {
    shortcut: '/مزمن',
    title: 'متابعة علاج شهري',
    category: 'متابعة شهرية',
    script_type: 'monthly_refill',
    message_body:
      'أهلًا بحضرتك {{customer_name}}، مع حضرتك د/ {{doctor_name}} من صيدليات دواء. بنطمن على علاج حضرتك الشهري: هل الأصناف قربت تخلص؟ وهل حصل أي تغيير في الجرعات أو تعليمات الطبيب؟ نقدر نجهز احتياجات حضرتك قبل الموعد المناسب.',
    tags: ['مزمن', 'شهري'],
  },
  {
    shortcut: '/رفض',
    title: 'إغلاق محترم بدون ضغط',
    category: 'متابعة',
    script_type: 'no_answer',
    message_body:
      'تمام يا فندم، شكرًا جدًا لوقت حضرتك. مش هنضغط عليك في أي شراء، وإحنا موجودين وقت ما تحتاج استفسار أو بديل أو متابعة. صيدليات دواء تتشرف بخدمتك دائمًا.',
    tags: ['رفض'],
  },
  {
    shortcut: '/vip',
    title: 'متابعة عميل مميز',
    category: 'VIP',
    script_type: 'vip',
    message_body:
      'أهلًا بحضرتك {{customer_name}}، حضرتك من عملائنا المميزين ويهمنا نخدمك بشكل يليق بثقتك. لو عندك علاج شهري أو أصناف متكررة أو أي ملاحظة تحب نسجلها، فريق صيدليات دواء تحت أمرك وهنرتبها بالطريقة والموعد المناسبين.',
    tags: ['vip', 'مميز'],
  },
];

function fallbackScripts(): QuickReplyScript[] {
  return DEFAULT_QUICK_REPLY_SCRIPTS.map((script, index) => ({
    id: `default-${index}`,
    shortcut: script.shortcut,
    title: script.title,
    category: script.category,
    script_type: script.script_type,
    doctor_name: script.doctor_name || null,
    branch: script.branch || null,
    message_body: script.message_body,
    questions: script.questions || null,
    suggested_products: script.suggested_products || null,
    tags: script.tags || null,
    active: script.active !== false,
    usage_count: Number(script.usage_count || 0),
    created_by: script.created_by || null,
    created_by_name: script.created_by_name || null,
    created_at: null,
    updated_at: null,
  }));
}

export async function fetchQuickReplyScripts() {
  if (!isSupabaseConfigured) return fallbackScripts();
  const { data, error } = await supabase
    .from('quick_reply_scripts')
    .select('*')
    .order('shortcut', { ascending: true })
    .limit(1000);
  if (error) {
    console.warn('[quickReplyScripts] using fallback scripts', error);
    return fallbackScripts();
  }
  return ((data || []) as QuickReplyScript[]).length ? ((data || []) as QuickReplyScript[]) : fallbackScripts();
}

export async function saveQuickReplyScript(
  script: Partial<QuickReplyScript> & Pick<QuickReplyScript, 'shortcut' | 'title' | 'category' | 'script_type' | 'message_body'>
) {
  if (!isSupabaseConfigured) throw new Error('Supabase غير متصل');
  const payload = {
    shortcut: script.shortcut.trim().startsWith('/') ? script.shortcut.trim() : `/${script.shortcut.trim()}`,
    title: script.title.trim(),
    category: script.category.trim() || 'عام',
    script_type: script.script_type || 'quick_reply',
    doctor_name: script.doctor_name || null,
    branch: script.branch || null,
    message_body: script.message_body.trim(),
    questions: script.questions || null,
    suggested_products: script.suggested_products || null,
    tags: script.tags || null,
    active: script.active !== false,
    created_by: script.created_by || null,
    created_by_name: script.created_by_name || null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.rpc('save_quick_reply_script', {
    p_id: script.id && !script.id.startsWith('default-') ? script.id : null,
    p_shortcut: payload.shortcut,
    p_title: payload.title,
    p_category: payload.category,
    p_script_type: payload.script_type,
    p_doctor_name: payload.doctor_name,
    p_branch: payload.branch,
    p_message_body: payload.message_body,
    p_questions: payload.questions,
    p_suggested_products: payload.suggested_products,
    p_tags: payload.tags,
    p_active: payload.active,
    p_actor_id: script.created_by || null,
    p_actor_name: script.created_by_name || null,
  });
  if (error) {
    const message = String(error.message || '');
    if (/questions.*text\[\].*jsonb|suggested_products.*text\[\].*jsonb|tags.*text\[\].*jsonb|expression is of type jsonb/i.test(message)) {
      throw new Error(QUICK_REPLY_ARRAY_FORMAT_MESSAGE);
    }
    if (/row-level security|permission|صلاحية|quick_reply/i.test(message)) {
      throw new Error(QUICK_REPLY_RLS_MESSAGE);
    }
    throw new Error(message || QUICK_REPLY_RLS_MESSAGE);
  }
  return data as QuickReplyScript;
}

export async function incrementQuickReplyUsage(id: string) {
  if (!isSupabaseConfigured || id.startsWith('default-')) return;
  await supabase.rpc('increment_quick_reply_usage', { p_id: id });
}

export function renderQuickReplyTemplate(
  message: string,
  values: {
    customer_name?: string | null;
    doctor_name?: string | null;
    branch?: string | null;
    last_purchase?: string | null;
    use_customer_name?: boolean;
  }
) {
  const safeCustomerName =
    values.use_customer_name && values.customer_name && !/^\d+$|عميل|غير محدد|بدون/i.test(values.customer_name)
      ? values.customer_name
      : '';
  return message
    .replaceAll('{{customer_name}}', safeCustomerName)
    .replaceAll('{customer_name}', safeCustomerName)
    .replaceAll('{{doctor_name}}', values.doctor_name || 'فريق صيدليات دواء')
    .replaceAll('{doctor_name}', values.doctor_name || 'فريق صيدليات دواء')
    .replaceAll('{{branch}}', values.branch || 'صيدليات دواء')
    .replaceAll('{branch}', values.branch || 'صيدليات دواء')
    .replaceAll('{{last_purchase}}', values.last_purchase || 'آخر تعامل')
    .replaceAll('{last_purchase}', values.last_purchase || 'آخر تعامل')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([،,.!?])/g, '$1')
    .trim();
}
