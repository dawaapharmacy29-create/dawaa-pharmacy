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
    shortcut: '/برد',
    title: 'استفسار أعراض برد',
    category: 'برد ومناعة',
    script_type: 'cold_flu',
    message_body:
      'أهلا بحضرتك، مع حضرتك صيدليات دواء. نطمن على حضرتك الأول: هل في حرارة؟ كحة ناشفة ولا ببلغم؟ رشح أو انسداد أنف؟ وهل حضرتك عندك حساسية من أي دواء أو ضغط/سكر أو حمل؟',
    tags: ['برد', 'أعراض', 'آمن'],
  },
  {
    shortcut: '/مناعة',
    title: 'Cross Sell خفيف للمناعة',
    category: 'Cross Sell',
    script_type: 'cross_sell',
    message_body:
      'ممكن كمان نهتم برفع المناعة والسوائل الدافئة والراحة، ولو حضرتك بتحب نرشح لحضرتك اختيار مناسب حسب السن والحالة.',
    tags: ['مناعة', 'cross-sell'],
  },
  {
    shortcut: '/متابعة',
    title: 'متابعة بعد آخر تعامل',
    category: 'متابعة',
    script_type: 'followup',
    message_body:
      'أهلا بحضرتك، مع حضرتك صيدليات دواء. بنطمن على حضرتك بعد آخر تعامل، هل الدواء مناسب مع حضرتك؟ وهل في أي ملاحظة نقدر نساعد فيها؟',
    tags: ['متابعة'],
  },
  {
    shortcut: '/سعر',
    title: 'اعتراض على السعر',
    category: 'اعتراضات',
    script_type: 'price_objection',
    message_body:
      'حضرتك معاك حق تسأل على السعر. إحنا بنحاول نوفر لحضرتك أفضل اختيار مناسب وفعال، ولو تحب نرشح بديل مناسب حسب الحالة والسعر المتاح.',
    tags: ['سعر', 'بديل'],
  },
  {
    shortcut: '/توصيل',
    title: 'تأخير أو متابعة توصيل',
    category: 'توصيل',
    script_type: 'delivery_delay',
    message_body:
      'طلب حضرتك محل اهتمامنا، وهنراجع حالة التوصيل فورًا ونطمن حضرتك بالتحديث. بنعتذر لحضرتك عن أي تأخير.',
    tags: ['توصيل'],
  },
  {
    shortcut: '/شكوى',
    title: 'احتواء شكوى',
    category: 'شكاوى',
    script_type: 'complaint',
    message_body:
      'بنعتذر جدًا لحضرتك عن أي تجربة غير مرضية. يهمنا نحل الموضوع فورًا، ممكن حضرتك توضح لنا تفاصيل المشكلة ورقم الطلب لو متاح؟',
    tags: ['شكوى'],
  },
  {
    shortcut: '/روشتة',
    title: 'طلب صورة روشتة واضحة',
    category: 'روشتة',
    script_type: 'quick_reply',
    message_body:
      'حضرتك ممكن تبعت صورة الروشتة بوضوح، ويفضل تكون الإضاءة كويسة، وهنراجعها لحضرتك ونوضح المتاح والبدائل المناسبة.',
    tags: ['روشتة'],
  },
  {
    shortcut: '/مزمن',
    title: 'متابعة علاج شهري',
    category: 'متابعة شهرية',
    script_type: 'monthly_refill',
    message_body:
      'بنطمن على علاج حضرتك الشهري. هل حضرتك محتاج نفس الأصناف الشهر ده؟ ولو فيه أي تغيير في الجرعات أو تعليمات الدكتور بلغنا.',
    tags: ['مزمن', 'شهري'],
  },
  {
    shortcut: '/رفض',
    title: 'إغلاق محترم بدون ضغط',
    category: 'متابعة',
    script_type: 'no_answer',
    message_body:
      'تمام يا فندم، تحت أمر حضرتك في أي وقت. لو احتجت أي استفسار أو بديل مناسب، صيدليات دواء تتشرف بخدمتك دائمًا.',
    tags: ['رفض'],
  },
  {
    shortcut: '/vip',
    title: 'متابعة عميل مميز',
    category: 'VIP',
    script_type: 'vip',
    message_body:
      'حضرتك من عملائنا المميزين، ويهمنا نتابع احتياجاتك بشكل أفضل. لو فيه أي صنف شهري أو ملاحظة خاصة تحب نسجلها لحضرتك، تحت أمرك.',
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
    .replaceAll('{{doctor_name}}', values.doctor_name || 'صيدليات دواء')
    .replaceAll('{doctor_name}', values.doctor_name || 'صيدليات دواء')
    .replaceAll('{{branch}}', values.branch || 'فرع الصيدلية')
    .replaceAll('{branch}', values.branch || 'فرع الصيدلية')
    .replaceAll('{{last_purchase}}', values.last_purchase || 'آخر تعامل')
    .replaceAll('{last_purchase}', values.last_purchase || 'آخر تعامل')
    .trim();
}
