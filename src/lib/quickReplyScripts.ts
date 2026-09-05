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
  'cosmetics_interest',
  'supplements_interest',
  'family_kids',
  'elderly_care',
  'retention',
  'no_purchase_welcome',
  'referral_welcome',
  'first_purchase_thanks',
  'mother_dedicated',
  'churn_long_term',
  'reorder_reminder',
  'complaint_followup',
  'restock_notice',
  'post_treatment_checkin',
  'points_reminder',
  'loyalty_thanks',
  'angry_customer',
  'order_status_followup',
  'vip_active_checkin',
  'vip_winback',
  'substitute_unavailable',
  'missing_info_request',
  'partial_order_apology',
  'review_request',
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
  {
    shortcut: '/كوزمو',
    title: 'اهتمام العميل بالكوزمو والعناية',
    category: 'كوزمو وعناية',
    script_type: 'cosmetics_interest',
    message_body:
      'أهلًا بحضرتك {{customer_name}}، وصلنا تشكيلة جديدة من منتجات العناية والكوزمو حسينا إنها تناسب اهتمام حضرتك بيها. تحب أبعتلك التفاصيل والأسعار، ونساعدك تختار الأنسب لبشرتك؟',
    tags: ['كوزمو', 'عناية', 'cross-sell'],
  },
  {
    shortcut: '/مكملات',
    title: 'متابعة مكمل غذائي',
    category: 'مكملات غذائية',
    script_type: 'supplements_interest',
    message_body:
      'أهلًا بحضرتك {{customer_name}}، حبيت أطمن على المكمل اللي بتاخده: لسه مستمر عليه بانتظام؟ وهل حابب نجهزلك كمية جديدة قبل ما يخلص عندك عشان الاستمرارية متتقطعش؟',
    tags: ['مكملات', 'استمرارية', 'cross-sell'],
  },
  {
    shortcut: '/أطفال',
    title: 'احتياجات الأطفال والبيت',
    category: 'أسرة وأطفال',
    script_type: 'family_kids',
    message_body:
      'أهلًا بحضرتك {{customer_name}}، حابين نطمن هل احتياجات الأطفال (فيتامينات، لقاحات، منتجات عناية) بتوصل بانتظام؟ ولو حابة نظبطلك طلب شهري ثابت لاحتياجات البيت يوصلك تلقائي من غير ما تتعبي تفتكري، إحنا جاهزين.',
    tags: ['أطفال', 'أم', 'طلب شهري'],
  },
  {
    shortcut: '/كبار_سن',
    title: 'رعاية كبار السن في البيت',
    category: 'رعاية كبار السن',
    script_type: 'elderly_care',
    message_body:
      'أهلًا بحضرتك {{customer_name}}، حابين نطمن هل احتياجات كبار السن في البيت بتوصل بانتظام وهل التوصيل بيتم في وقت وطريقة مريحة ليهم؟ نقدر نظبط ميعاد توصيل ثابت أو نجهز الأصناف المتكررة مسبقًا عشان تبقى التجربة أسهل عليكم.',
    tags: ['كبار السن', 'رعاية', 'توصيل'],
  },
  {
    shortcut: '/استرجاع',
    title: 'استرجاع عميل مهدد أو متوقف',
    category: 'استرجاع عملاء',
    script_type: 'retention',
    message_body:
      'أهلًا بحضرتك {{customer_name}}، حسينا إن فترة طويلة عدت من غير ما نخدم حضرتك، وحبينا نطمن عليك ونعرف هل في أي سبب أو مشكلة خلت تجربتك معانا أقل من المتوقع. رأي حضرتك يهمنا جدًا ونحب نصلح أي حاجة تستاهل التحسين.',
    tags: ['استرجاع', 'مهدد', 'متوقف', 'win-back'],
  },
  {
    shortcut: '/عميل_جديد',
    title: 'ترحيب بعميل مسجل بدون شراء',
    category: 'ترحيب',
    script_type: 'no_purchase_welcome',
    message_body:
      'أهلًا بحضرتك {{customer_name}}، معاك فريق صيدليات دواء. لاحظنا إن بيانات حضرتك متسجلة عندنا بس لسه ما جربتش تتعامل معانا، وحبينا نتواصل ونعرّفك إن عندنا خدمة توصيل سريع وتشكيلة كاملة من الأدوية والمكملات والعناية. لو محتاج أي حاجة في أي وقت، إحنا على بعد رسالة واحدة 🌿',
    tags: ['ترحيب', 'بدون شراء', 'إعادة تنشيط'],
  },
  {
    shortcut: '/توصية',
    title: 'ترحيب بعميل جاء بتوصية',
    category: 'ترحيب',
    script_type: 'referral_welcome',
    message_body:
      'أهلًا بحضرتك {{customer_name}}، معاك فريق صيدليات دواء. حبيت أشكرك إنك جيت لينا بتوصية من {{referrer_name}}، وده شرف كبير لينا. هنبذل قصارى جهدنا نكون عند حسن ظنك، وأي استفسار حضرتك تحت أمرك في أي وقت.',
    tags: ['ترحيب', 'توصية', 'إحالة'],
  },
  {
    shortcut: '/أول_شراء',
    title: 'شكر بعد أول عملية شراء كبيرة',
    category: 'ترحيب',
    script_type: 'first_purchase_thanks',
    message_body:
      'أهلًا بحضرتك {{customer_name}}، حبينا نشكرك على ثقتك في أول تعامل ليك معانا. حسينا إن تجربتك الأولى تستاهل نتابعها بنفسنا: هل كل حاجة وصلت زي ما توقعت؟ وأي ملاحظة، إحنا جاهزين نسمعها ونحسّن بيها.',
    tags: ['أول شراء', 'اطمئنان', 'عميل جديد'],
  },
  {
    shortcut: '/أم',
    title: 'أم مسؤولة عن مشتريات البيت',
    category: 'أسرة وأطفال',
    script_type: 'mother_dedicated',
    message_body:
      'أهلًا بحضرتك {{customer_name}}، حبينا نسهّل عليك حاجة: تحبي نظبطلك "قايمة ثابتة" لاحتياجات البيت الشهرية (فيتامينات، عناية، مستلزمات) تتجهز وتوصلك تلقائي من غير ما تتعبي تفتكري كل مرة؟ إحنا هنتابع نيابةً عنك.',
    tags: ['أم', 'طلب شهري', 'بيت'],
  },
  {
    shortcut: '/غياب_طويل',
    title: 'عميل متوقف تمامًا من فترة طويلة',
    category: 'استرجاع عملاء',
    script_type: 'churn_long_term',
    message_body:
      'أهلًا بحضرتك {{customer_name}}، معاك فريق صيدليات دواء. لاحظنا إن فترة طويلة عدت من غير ما نخدمك، وحابين نكون صرحاء: يهمنا نعرف هل في سبب حقيقي خلاك تبعد، عشان نصلحه فعليًا مش بس نعتذر. رأي حضرتك هيتاخد بجدية وهيوصل للمسؤول مباشرة.',
    tags: ['استرجاع', 'غياب طويل', 'churn'],
  },
  {
    shortcut: '/إعادة_طلب',
    title: 'تذكير بموعد إعادة الطلب المتوقع',
    category: 'متابعة شهرية',
    script_type: 'reorder_reminder',
    message_body:
      'أهلًا بحضرتك {{customer_name}}، بناءً على معدل تعاملك المعتاد معانا، حسينا إنه ممكن يكون قرّب ميعاد احتياجك لـ{{last_product_category}} تاني. حابين نجهزهولك من دلوقتي قبل ما يخلص عندك تمامًا؟',
    tags: ['إعادة طلب', 'استباقي', 'معدل شراء'],
  },
  {
    shortcut: '/بعد_الشكوى',
    title: 'متابعة بعد حل الشكوى',
    category: 'شكاوى',
    script_type: 'complaint_followup',
    message_body:
      'أهلًا بحضرتك {{customer_name}}، بعد ما اتحل الموضوع اللي كان ضايقك، حبينا نطمن بصدق: هل فعلاً الحل كان مُرضي لحضرتك؟ ولو لسه فيه أي حاجة ناقصة، قولّنا بصراحة، مش هنعتبر الموضوع مقفول إلا لما حضرتك تقولنا إنك مرتاح.',
    tags: ['شكوى', 'تأكيد رضا', 'متابعة'],
  },
  {
    shortcut: '/توفر_صنف',
    title: 'إشعار توفر صنف كان ناقص',
    category: 'متابعة',
    script_type: 'restock_notice',
    message_body:
      'أهلًا بحضرتك {{customer_name}}، الصنف اللي كان طلبه اتأجل قبل كده بسبب عدم التوافر ({{product_name}}) وصلنا دلوقتي. تحب نجهزهولك ونوصله لحضرتك؟',
    tags: ['توفر', 'نواقص', 'متابعة'],
  },
  {
    shortcut: '/بعد_العلاج',
    title: 'متابعة بعد كورس علاج قصير',
    category: 'متابعة',
    script_type: 'post_treatment_checkin',
    message_body:
      'أهلًا بحضرتك {{customer_name}}، حبينا نطمن على حالتك بعد الكورس اللي أخده: هل حسيت بتحسن؟ وهل احتجت تكمل جرعة إضافية أو تراجع الدكتور تاني؟ رأيك مهم لينا وممكن يفيد حد تاني كمان.',
    tags: ['متابعة طبية', 'بعد العلاج'],
  },
  {
    shortcut: '/نقاط',
    title: 'تذكير برصيد نقاط أو كاش باك',
    category: 'ولاء ونقاط',
    script_type: 'points_reminder',
    message_body:
      'أهلًا بحضرتك {{customer_name}}، عندك رصيد {{points_balance}} نقطة/كاش باك متاح للاستخدام. حابين نفكرك بيه قبل ما تنساه، وتقدر تستخدمه في أي طلب جاي.',
    tags: ['نقاط', 'كاش باك', 'ولاء'],
  },
  {
    shortcut: '/عميل_قديم',
    title: 'شكر لعميل ولاء طويل',
    category: 'ولاء ونقاط',
    script_type: 'loyalty_thanks',
    message_body:
      'أهلًا بحضرتك {{customer_name}}، بقالك معانا فترة طويلة وده بيشرفنا جدًا. حبينا نشكرك على ثقتك المستمرة، ولو في أي حاجة نقدر نميزك بيها كعميل قديم، قولّنا.',
    tags: ['ولاء', 'عميل قديم', 'شكر'],
  },
  {
    shortcut: '/غضب',
    title: 'احتواء عميل غضبان بشدة',
    category: 'شكاوى',
    script_type: 'angry_customer',
    message_body:
      'بحس بغضب حضرتك وحقك تمامًا يا فندم، وأنا آسف جدًا على اللي حصل. مش هرد عليك بجمل جاهزة — عايز أفهم بالظبط اللي حصل من حضرتك بنفسك، وهقعد معاك لحد ما نوصل لحل يريحك فعلًا، مش بس نقفل الموضوع.',
    tags: ['شكوى', 'غضب', 'احتواء', 'تصعيد'],
  },
  {
    shortcut: '/حالة_الطلب',
    title: 'متابعة حالة طلب العميل',
    category: 'متابعة',
    script_type: 'order_status_followup',
    message_body:
      'أهلًا بحضرتك {{customer_name}}، حابين نطمّنك على طلبك: هو دلوقتي في مرحلة {{order_status}}. لو عايز أي تفاصيل إضافية أو موعد وصول متوقع أدق، إحنا جاهزين نجيبهولك فورًا.',
    tags: ['متابعة طلب', 'حالة الطلب'],
  },
  {
    shortcut: '/vip_نشط',
    title: 'متابعة دورية لعميل VIP نشط',
    category: 'VIP',
    script_type: 'vip_active_checkin',
    message_body:
      'أهلًا بحضرتك {{customer_name}}، حبينا نمر عليك ونطمن إن كل حاجة ماشية تمام معانا زي ما تعودت. مفيش أي مشكلة نتكلم فيها، بس حضرتك من أهم عملائنا وحبينا نسمع رأيك باستمرار: في حاجة تحب نضيفها أو نحسّنها في تعاملك معانا؟',
    tags: ['vip', 'رعاية استباقية', 'متابعة دورية'],
  },
  {
    shortcut: '/استرجاع_vip',
    title: 'استرجاع عميل VIP قلل تعامله',
    category: 'VIP',
    script_type: 'vip_winback',
    message_body:
      'أهلًا بحضرتك {{customer_name}}، معاك {{doctor_name}} من صيدليات دواء شخصيًا. لاحظنا إن تعاملك معانا قلّ عن المعتاد، وحضرتك من أهم عملائنا فحبيت أتواصل بنفسي مش عن طريق رسالة عامة. ممكن تصارحني: في حاجة حصلت خلتك تقلل، عشان أصلحها بنفسي فورًا؟',
    tags: ['vip', 'استرجاع', 'تعامل شخصي'],
  },
  {
    shortcut: '/بديل_دواء',
    title: 'اقتراح بديل لدواء غير متوفر',
    category: 'روشتة',
    script_type: 'substitute_unavailable',
    message_body:
      'حضرتك، الصنف اللي طلبته مش متوفر عندنا دلوقتي، وعشان محضرتكش تستنى، فيه بديل بنفس المادة الفعالة وبنفس الفاعلية اسمه {{product_name}}. حابب صيدلي يراجعلك التبديل ده قبل ما نجهزه؟',
    tags: ['بديل', 'نواقص', 'روشتة'],
  },
  {
    shortcut: '/بيانات_ناقصة',
    title: 'طلب معلومات إضافية لإتمام الطلب',
    category: 'متابعة',
    script_type: 'missing_info_request',
    message_body:
      'حضرتك، عشان نقدر نكمل طلبك بسرعة، محتاجين منك {{missing_info}}. تقدر تبعتها لينا هنا وهنكمل الطلب على طول.',
    tags: ['بيانات ناقصة', 'إتمام طلب'],
  },
  {
    shortcut: '/نقص_طلب',
    title: 'اعتذار عن نقص في الطلب',
    category: 'متابعة',
    script_type: 'partial_order_apology',
    message_body:
      'بنعتذر جدًا يا فندم، طلب حضرتك وصل ناقص صنف ({{product_name}}) بسبب نقص مؤقت عندنا. هنجهزلك الصنف الناقص ونوصله لحضرتك فورًا أول ما يتوفر، من غير أي تكلفة إضافية.',
    tags: ['نقص طلب', 'اعتذار', 'توصيل'],
  },
  {
    shortcut: '/طلب_تقييم',
    title: 'طلب تقييم من عميل راضٍ',
    category: 'ولاء ونقاط',
    script_type: 'review_request',
    message_body:
      'أهلًا بحضرتك {{customer_name}}، سعدنا جدًا إن تجربتك معانا كانت كويسة. لو عندك دقيقة، رأيك يفرق معانا جدًا ويساعد عملاء تانيين — تحب تشاركنا تقييمك؟',
    tags: ['تقييم', 'رضا العميل'],
  },
];

// ============================================================================
// اقتراح السكريبت الأنسب تلقائيًا حسب تصنيف العميل (customer_flags) وحالته —
// عشان الموظف مايفكرش "أدور على أي سكريبت"، النظام يرشحله الأنسب مباشرة.
// ============================================================================
const PROFILE_TAG_TO_SCRIPT_TYPE: Record<string, string> = {
  monthly_treatment: 'monthly_refill',
  cosmetics_interest: 'cosmetics_interest',
  supplements_interest: 'supplements_interest',
  has_children: 'family_kids',
  mother_customer: 'mother_dedicated',
  elderly_in_house: 'elderly_care',
};

const LONG_CHURN_DAYS = 180;

export function suggestScriptTypesForCustomer(input: {
  profileTags?: string[] | null;
  customerStatus?: string | null;
  segment?: string | null;
  invoicesCount?: number | null;
  lastPurchase?: string | null;
}): string[] {
  const suggestions: string[] = [];
  const status = String(input.customerStatus || '');

  // عميل مسجل بس لسه ما اشتراش خالص — أولوية أعلى من أي حاجة تانية، لأنه
  // محتاج ترحيب أول أصلًا مش متابعة عادية.
  if ((input.invoicesCount ?? null) === 0 || /بدون شراء/.test(status)) {
    suggestions.push('no_purchase_welcome');
  }

  for (const tag of input.profileTags || []) {
    const scriptType = PROFILE_TAG_TO_SCRIPT_TYPE[tag];
    if (scriptType && !suggestions.includes(scriptType)) suggestions.push(scriptType);
  }

  const daysSincePurchase = input.lastPurchase
    ? Math.floor((Date.now() - new Date(input.lastPurchase).getTime()) / 86400000)
    : null;
  if (/مهدد/.test(status) && !suggestions.includes('retention')) {
    suggestions.push('retention');
  } else if (/متوقف/.test(status)) {
    // "متوقف من فترة طويلة جدًا" محتاج نبرة اعتراف صريح بالغياب، مختلفة عن
    // "مهدد بالتوقف" العادي — نفرّق بينهم بعدد الأيام لو متاح.
    const isLongChurn = daysSincePurchase == null || daysSincePurchase >= LONG_CHURN_DAYS;
    const churnType = isLongChurn ? 'churn_long_term' : 'retention';
    if (!suggestions.includes(churnType)) suggestions.push(churnType);
  }

  if (input.segment === 'مهم جدًا' && !suggestions.includes('vip')) {
    // عميل VIP: نفرّق بين نشاطه الطبيعي (رعاية استباقية) وتراجع تعامله
    // (استرجاع شخصي بلهجة مختلفة تمامًا عن أي عميل عادي بيقل تعامله).
    if (/مهدد|متوقف/.test(status)) suggestions.unshift('vip_winback');
    else suggestions.push('vip_active_checkin');
  }
  if (!suggestions.length) suggestions.push('followup');
  return suggestions;
}

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
    .eq('active', true)
    .order('category', { ascending: true })
    .order('shortcut', { ascending: true })
    .limit(1000);
  if (error) {
    console.warn('[quickReplyScripts] using fallback scripts', error);
    return fallbackScripts();
  }
  return ((data || []) as QuickReplyScript[]).length
    ? ((data || []) as QuickReplyScript[])
    : fallbackScripts();
}

export async function saveQuickReplyScript(
  script: Partial<QuickReplyScript> &
    Pick<QuickReplyScript, 'shortcut' | 'title' | 'category' | 'script_type' | 'message_body'>
) {
  if (!isSupabaseConfigured) throw new Error('Supabase غير متصل');
  const payload = {
    shortcut: script.shortcut.trim().startsWith('/')
      ? script.shortcut.trim()
      : `/${script.shortcut.trim()}`,
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
    if (
      /questions.*text\[\].*jsonb|suggested_products.*text\[\].*jsonb|tags.*text\[\].*jsonb|expression is of type jsonb/i.test(
        message
      )
    ) {
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
    referrer_name?: string | null;
    last_product_category?: string | null;
    product_name?: string | null;
    points_balance?: string | number | null;
    order_status?: string | null;
    missing_info?: string | null;
    use_customer_name?: boolean;
  }
) {
  const safeCustomerName =
    values.use_customer_name &&
    values.customer_name &&
    !/^\d+$|عميل|غير محدد|بدون/i.test(values.customer_name)
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
    .replaceAll('{{referrer_name}}', values.referrer_name || 'أحد عملائنا')
    .replaceAll('{referrer_name}', values.referrer_name || 'أحد عملائنا')
    .replaceAll('{{last_product_category}}', values.last_product_category || 'احتياجاتك المعتادة')
    .replaceAll('{last_product_category}', values.last_product_category || 'احتياجاتك المعتادة')
    .replaceAll('{{product_name}}', values.product_name || 'الصنف المطلوب')
    .replaceAll('{product_name}', values.product_name || 'الصنف المطلوب')
    .replaceAll(
      '{{points_balance}}',
      values.points_balance != null ? String(values.points_balance) : 'المتاح'
    )
    .replaceAll(
      '{points_balance}',
      values.points_balance != null ? String(values.points_balance) : 'المتاح'
    )
    .replaceAll('{{order_status}}', values.order_status || 'قيد التجهيز')
    .replaceAll('{order_status}', values.order_status || 'قيد التجهيز')
    .replaceAll('{{missing_info}}', values.missing_info || 'العنوان بالتفصيل ورقم تواصل بديل')
    .replaceAll('{missing_info}', values.missing_info || 'العنوان بالتفصيل ورقم تواصل بديل')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([،,.!?])/g, '$1')
    .trim();
}
