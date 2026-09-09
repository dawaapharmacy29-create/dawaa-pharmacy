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
  'quick_reply','welcome','cross_sell','up_sell','complaint','followup','cold_flu',
  'monthly_refill','no_answer','price_objection','delivery_delay','cosmetics_interest',
  'supplements_interest','family_kids','elderly_care','retention','no_purchase_welcome',
  'referral_welcome','first_purchase_thanks','reorder_reminder','complaint_followup',
  'restock_notice','post_treatment_checkin','points_reminder','loyalty_thanks',
  'angry_customer','order_status_followup','vip_active_checkin','vip_winback',
  'substitute_unavailable','missing_info_request','partial_order_apology','review_request',
  'order_confirmation','wrong_item_delivered','return_refund_request',
  'drug_interaction_concern','side_effect_report','dosage_clarification',
  'escalation_notice','goodwill_gesture'
] as const;

export const SCRIPT_TYPE_GROUPS: Array<{ label: string; types: string[] }> = [
  { label: '1) خدمة العملاء والولاء', types: ['welcome','no_purchase_welcome','referral_welcome','first_purchase_thanks','followup','vip_active_checkin','vip_winback','retention','loyalty_thanks','review_request','points_reminder'] },
  { label: '2) الطلبات والنواقص', types: ['reorder_reminder','order_confirmation','order_status_followup','delivery_delay','missing_info_request','partial_order_apology','wrong_item_delivered','substitute_unavailable','restock_notice','return_refund_request'] },
  { label: '3) الشكاوى واستعادة الرضا', types: ['complaint','angry_customer','escalation_notice','goodwill_gesture','complaint_followup','no_answer'] },
  { label: '4) المتابعة الصحية', types: ['monthly_refill','post_treatment_checkin','elderly_care','family_kids','cold_flu','drug_interaction_concern','dosage_clarification','side_effect_report'] },
  { label: '5) العمليات البيعية', types: ['price_objection','up_sell','cross_sell','cosmetics_interest','supplements_interest'] },
  { label: '6) ردود عامة', types: ['quick_reply'] },
];

export function scriptTypeGroupLabel(scriptType: string): string {
  return SCRIPT_TYPE_GROUPS.find((group) => group.types.includes(scriptType))?.label || '6) ردود عامة';
}

type SeedScript = Pick<QuickReplyScript, 'shortcut' | 'title' | 'category' | 'script_type' | 'message_body'> & Partial<QuickReplyScript>;

const s = (shortcut: string, title: string, category: string, script_type: string, message_body: string, questions: string[]): SeedScript => ({ shortcut, title, category, script_type, message_body, questions, active: true });

export const DEFAULT_QUICK_REPLY_SCRIPTS: SeedScript[] = [
  s('/ترحيب','ترحيب بعميل جديد','خدمة العملاء والولاء','welcome','مساء الخير يا فندم 🌷\nمع حضرتك هبة من خدمة عملاء صيدليات دواء.\n\nسعداء بأول تواصل لحضرتك معانا، وهدفنا نخلي التعامل سهل ومريح من البداية.\n\nخدمة التوصيل متاحة 24 ساعة.\nتحب نساعد حضرتك في إيه دلوقتي؟\nدواء أو روشتة\nصنف ناقص\nمنتج عناية أو مكمل\nاستفسار آخر',['دواء أو روشتة','صنف ناقص','منتج عناية أو مكمل','استفسار آخر']),
  s('/عميل_جديد','ترحيب بعميل مسجل جديد','خدمة العملاء والولاء','no_purchase_welcome','مساء الخير يا فندم 🌷\nمع حضرتك هبة من خدمة عملاء صيدليات دواء.\n\nسعداء بانضمام حضرتك لعملائنا، وحابين نعرّفك إن التوصيل متاح 24 ساعة وإننا نقدر نساعدك في توفير احتياجاتك ومتابعتها.\n\nإيه أكتر خدمة ممكن تفيد حضرتك؟\nالتوصيل\nتوفير صنف ناقص\nمتابعة علاج متكرر\nاستفسار دوائي',['التوصيل','توفير صنف ناقص','متابعة علاج متكرر','استفسار دوائي']),
  s('/توصية','ترحيب بعميل جاء بترشيح','خدمة العملاء والولاء','referral_welcome','مساء الخير يا فندم 🌷\nمع حضرتك هبة من خدمة عملاء صيدليات دواء.\n\nسعداء جدًا إن حضرتك اتعرفت علينا عن طريق {{referrer_name}}، وثقة الترشيح دي محل تقدير كبير عندنا.\n\nنبدأ نخدم حضرتك في إيه؟\nطلب أو روشتة\nصنف ناقص\nاستفسار عن منتج',['طلب أو روشتة','صنف ناقص','استفسار عن منتج']),
  s('/أول_شراء','متابعة أول تجربة شراء','خدمة العملاء والولاء','first_purchase_thanks','مساء الخير يا فندم 🌷\nمع حضرتك هبة من خدمة عملاء صيدليات دواء.\n\nحابين نطمن على أول تجربة لحضرتك معانا، وهل الطلب وصل بالشكل اللي كنت متوقعه؟\n\nويهمنا تقييم أول تجربة:\nممتازة ⭐\nمقبولة\nسيئة',['ممتازة ⭐','مقبولة','سيئة']),
  s('/متابعة','متابعة الطلب وتقييم الخدمة','خدمة العملاء والولاء','followup','مساء الخير يا فندم 🌷\nمع حضرتك هبة من خدمة عملاء صيدليات دواء.\n\nحابين نطمن إن طلب حضرتك وصل تمام، وهل في أي ملاحظة على الخدمة أو الطلب؟\n\nويهمنا تقييم حضرتك للخدمة:\nممتازة ⭐\nمقبولة\nسيئة',['ممتازة ⭐','مقبولة','سيئة']),
  s('/عميل_مميز_نشط','متابعة عميل مميز نشط','خدمة العملاء والولاء','vip_active_checkin','مساء الخير يا فندم 🌷\nمع حضرتك هبة من خدمة عملاء صيدليات دواء.\n\nثقة حضرتك المستمرة محل تقدير كبير عندنا، وبيهمنا نفضل محافظين على مستوى الخدمة اللي يريحك.\n\nلو هنحسن حاجة واحدة في تجربتك معانا، تختار:\nسرعة التوصيل\nتوفير الأصناف\nالمتابعة والاهتمام\nالخدمة ممتازة كما هي ⭐',['سرعة التوصيل','توفير الأصناف','المتابعة والاهتمام','الخدمة ممتازة كما هي ⭐']),
  s('/استرجاع','استعادة عميل بعد فترة غياب','خدمة العملاء والولاء','retention','مساء الخير يا فندم 🌷\nمع حضرتك هبة من خدمة عملاء صيدليات دواء.\n\nبقالنا فترة ما اتشرفناش بخدمة حضرتك، فحبينا نسأل عليك ونتأكد إن تجربتك السابقة كانت مرضية.\n\nآخر تجربة لحضرتك كانت:\nممتازة\nمقبولة\nكان في ملاحظة',['ممتازة','مقبولة','كان في ملاحظة']),
  s('/استرجاع_عميل_مميز','إعادة تواصل مع عميل مميز','خدمة العملاء والولاء','vip_winback','مساء الخير يا فندم 🌷\nمع حضرتك هبة من خدمة عملاء صيدليات دواء.\n\nحبينا نسأل على حضرتك ونتأكد إن آخر تجربة ليك معانا كانت بالشكل اللي يرضيك.\n\nلو في حاجة نقدر نخليها أفضل، إيه الأقرب؟\nتوفير الأصناف\nسرعة التوصيل\nالأسعار والعروض\nالتعامل والمتابعة\nمفيش مشكلة',['توفير الأصناف','سرعة التوصيل','الأسعار والعروض','التعامل والمتابعة','مفيش مشكلة']),
  s('/إعادة_طلب','تذكير باحتياج متكرر','متابعة الطلبات والنواقص','reorder_reminder','مساء الخير يا فندم 🌷\nمع حضرتك هبة من خدمة عملاء صيدليات دواء.\n\nبنتابع مع حضرتك بخصوص احتياجك المعتاد قبل ما يخلص.\n\nلسه محتاج {{last_product_category}}؟\nنعم، راجعوا التوفر والسعر\nلسه عندي كمية\nالاحتياج اتغير',['نعم، راجعوا التوفر والسعر','لسه عندي كمية','الاحتياج اتغير']),
  s('/تأكيد_طلب','تأكيد الطلب قبل التنفيذ','متابعة الطلبات والنواقص','order_confirmation','تمام يا فندم 🌷\nقبل ما نبدأ التجهيز، نراجع 3 تفاصيل عشان الطلب يوصل مظبوط من أول مرة:\nالعنوان\nالكمية\nطريقة الدفع\n\nالعنوان المسجل لسه مناسب لحضرتك؟',['العنوان صحيح','محتاج تعديل العنوان']),
  s('/حالة_الطلب','تحديث حالة الطلب','متابعة الطلبات والنواقص','order_status_followup','مساء الخير يا فندم 🌷\nتحديث سريع: طلب حضرتك حاليًا {{order_status}}.\n\nتحب نبلغ حضرتك بمجرد ما يكون في تحديث جديد أو وقت وصول مؤكد؟',['نعم','لا، شكرًا']),
  s('/تأخير_التوصيل','معالجة تأخير التوصيل','متابعة الطلبات والنواقص','delivery_delay','مساء الخير يا فندم 🌷\nمع حضرتك هبة من خدمة عملاء صيدليات دواء.\n\nبنعتذر لحضرتك عن تأخير الطلب، وعارفين إن وقت حضرتك مهم.\n\nالطلب وصل دلوقتي؟\nوصل ✅\nلسه ماوصلش',['وصل ✅','لسه ماوصلش']),
  s('/بيانات_ناقصة','طلب بيانات ناقصة لإتمام الطلب','متابعة الطلبات والنواقص','missing_info_request','يا فندم، ناقصنا بس {{missing_info}} عشان نكمل طلب حضرتك بشكل صحيح.\n\nممكن تبعتهالنا هنا؟ أول ما يوصل نكمل الطلب مباشرة.',['إرسال البيانات الآن']),
  s('/نقص_طلب','معالجة نقص في الطلب','متابعة الطلبات والنواقص','partial_order_apology','مساء الخير يا فندم 🌷\nمع حضرتك هبة من خدمة عملاء صيدليات دواء.\n\nبنعتذر إن الطلب وصل ناقص، وده مش المستوى اللي بنحب حضرتك تستلمه مننا.\n\nبالنسبة لـ {{product_name}} تحب:\nنتابع توفير نفس الصنف\nنراجع فرع تاني\nنخلي الصيدلي يراجع بديل مناسب',['متابعة نفس الصنف','مراجعة فرع تاني','مراجعة بديل مناسب']),
  s('/صنف_غلط','معالجة وصول صنف غير صحيح','متابعة الطلبات والنواقص','wrong_item_delivered','مساء الخير يا فندم 🌷\nمع حضرتك هبة من خدمة عملاء صيدليات دواء.\n\nبنعتذر إن الصنف اللي وصل مش هو المطلوب، وهنتابع تصحيح الموضوع بأقل مجهود على حضرتك.\n\nممكن تبعتلنا صورة الصنف اللي وصل؟',['إرسال صورة الصنف']),
  s('/بديل_دواء','مراجعة بديل لدواء غير متوفر','متابعة الطلبات والنواقص','substitute_unavailable','يا فندم، الصنف المطلوب غير متوفر حاليًا.\n\nتحب نعمل إيه؟\nنستمر في متابعة نفس الصنف\nنراجع فرع تاني\nنخلي الدكتور الصيدلي يراجع البدائل المناسبة قبل أي تغيير',['متابعة نفس الصنف','مراجعة فرع تاني','مراجعة البدائل مع الصيدلي']),
  s('/توفر_صنف','إبلاغ بتوفر صنف كان ناقص','متابعة الطلبات والنواقص','restock_notice','مساء الخير يا فندم 🌷\nمع حضرتك هبة من خدمة عملاء صيدليات دواء.\n\nحبيت أبلغ حضرتك إن {{product_name}} اللي كنا بنتابعه أصبح متوفر ✅\n\nتحب:\nنحجزه لحضرتك\nنجهزه للتوصيل\nمش محتاجه حاليًا',['حجز','توصيل','مش محتاجه حاليًا']),
  s('/استرجاع_منتج','طلب استرجاع أو استرداد','متابعة الطلبات والنواقص','return_refund_request','أكيد يا فندم، هنساعد حضرتك في طلب الاسترجاع.\n\nسبب الاسترجاع إيه؟\nالصنف غير مناسب\nوصل تالف أو به مشكلة\nتم طلبه بالخطأ\nسبب آخر',['الصنف غير مناسب','وصل تالف أو به مشكلة','تم طلبه بالخطأ','سبب آخر']),
  s('/شكوى','استقبال شكوى العميل','الشكاوى واستعادة الرضا','complaint','مساء الخير يا فندم 🌷\nمع حضرتك هبة من خدمة عملاء صيدليات دواء.\n\nمتأسفين إن تجربتك المرة دي ماكنتش بالشكل اللي يرضيك، ويهمنا نفهم المشكلة صح ونتابعها بجدية.\n\nالمشكلة كانت في:\nالطلب\nالتوصيل\nالتعامل\nالسعر أو الخصم\nحاجة تانية',['الطلب','التوصيل','التعامل','السعر أو الخصم','حاجة تانية']),
  s('/غضب','تهدئة العميل وبدء الحل','الشكاوى واستعادة الرضا','angry_customer','مقدّرين إن حضرتك متضايق، وبنعتذر إن التجربة وصلت لكده.\n\nالأهم دلوقتي نفهم المشكلة من حضرتك من غير ما نفترض السبب.\nإيه أكتر نقطة ضايقت حضرتك؟',['إيه أكتر نقطة ضايقت حضرتك؟']),
  s('/تصعيد','تصعيد الشكوى للمسؤول المختص','الشكاوى واستعادة الرضا','escalation_notice','يا فندم، عشان الموضوع ياخد الاهتمام المناسب هنرفعه للمسؤول المختص، وخدمة العملاء هتفضل متابعة مع حضرتك.\n\nتفضل يكون الرد:\nعلى واتساب هنا\nبمكالمة تليفون',['واتساب','مكالمة']),
  s('/تعويض','تقديم تعويض بعد مشكلة','الشكاوى واستعادة الرضا','goodwill_gesture','يا فندم، مقدّرين الإزعاج اللي حصل، وتم اعتماد {{goodwill_offer}} تقديرًا للموقف.\n\nالأهم عندنا: هل الحل الأساسي للمشكلة أصبح مرضي لحضرتك؟\nنعم، تمام\nلسه في نقطة محتاجة متابعة',['نعم، تمام','لسه في نقطة محتاجة متابعة']),
  s('/بعد_الشكوى','متابعة بعد حل الشكوى','الشكاوى واستعادة الرضا','complaint_followup','مساء الخير يا فندم 🌷\nمع حضرتك هبة من خدمة عملاء صيدليات دواء.\n\nبتابع مع حضرتك بعد معالجة المشكلة، والأهم عندنا نتأكد إن الحل كان مرضي ليك.\n\nتقييمك للحل:\nممتاز ⭐\nمقبول\nالمشكلة لسه موجودة',['ممتاز ⭐','مقبول','المشكلة لسه موجودة']),
  s('/لم_يرد','متابعة أخيرة بعد عدم الرد','الشكاوى واستعادة الرضا','no_answer','مساء الخير يا فندم 🌷\nمع حضرتك هبة من خدمة عملاء صيدليات دواء.\n\nبنتابع مع حضرتك للمرة الأخيرة بخصوص طلبك السابق، وممكن الوقت ماكانش مناسب.\n\nلسه محتاج نكمل؟\nنعم\nلا، شكرًا',['نعم','لا، شكرًا']),
  s('/مزمن','متابعة العلاج الشهري','المتابعة الصحية','monthly_refill','مساء الخير يا فندم 🌷\nمع حضرتك هبة من خدمة عملاء صيدليات دواء.\n\nبنراجع مع حضرتك العلاج المنتظم قبل ميعاده عشان مايحصلش أي انقطاع.\n\nالعلاج دلوقتي:\nلسه متوفر\nفي صنف قرب يخلص\nمحتاجين نجهز الطلب المعتاد',['لسه متوفر','في صنف قرب يخلص','تجهيز الطلب المعتاد']),
  s('/بعد_العلاج','متابعة بعد فترة علاج','المتابعة الصحية','post_treatment_checkin','مساء الخير يا فندم 🌷\nمع حضرتك هبة من خدمة عملاء صيدليات دواء.\n\nبنتواصل مخصوص عشان نطمن على الحالة بعد فترة العلاج.\n\nالحالة دلوقتي:\nأفضل الحمد لله\nنفس الوضع\nلسه في أعراض أو مشكلة',['أفضل الحمد لله','نفس الوضع','لسه في أعراض أو مشكلة']),
  s('/كبار_سن','متابعة احتياجات كبار السن','المتابعة الصحية','elderly_care','مساء الخير يا فندم 🌷\nمع حضرتك هبة من خدمة عملاء صيدليات دواء.\n\nبنراجع مع حضرتك احتياجات الوالد/الوالدة المعتادة عشان مايحصلش انقطاع في أي علاج مهم.\n\nفي صنف قرب يخلص؟\nنعم، نراجع التوفر\nلسه العلاج متوفر\nفي تغيير في العلاج',['نعم، نراجع التوفر','لسه العلاج متوفر','في تغيير في العلاج']),
  s('/أطفال','متابعة احتياجات الأطفال والأسرة','المتابعة الصحية','family_kids','مساء الخير يا فندم 🌷\nمع حضرتك هبة من خدمة عملاء صيدليات دواء.\n\nبنتابع احتياجات الأطفال والبيت المعتادة عشان تكون موجودة وقت ما تحتاجوها.\n\nفي حاجة قربت تخلص؟\nأدوية أو فيتامينات\nمستلزمات أطفال\nعناية شخصية\nمفيش احتياج حاليًا',['أدوية أو فيتامينات','مستلزمات أطفال','عناية شخصية','مفيش احتياج حاليًا']),
  s('/برد','استفسار أولي عن أعراض البرد','المتابعة الصحية','cold_flu','أهلًا بحضرتك 🌷\nعشان الدكتور الصيدلي يراجع الحالة بشكل مناسب، محتاجين نعرف شوية تفاصيل بسيطة:\n\nالأعراض بدأت من إمتى؟\nفي حرارة أو كحة أو رشح؟\nوفي أدوية ثابتة أو حساسية دوائية؟',['الأعراض بدأت من إمتى؟','في حرارة أو كحة أو رشح؟','في أدوية ثابتة أو حساسية دوائية؟']),
  s('/تعارض_دواء','مراجعة تعارض بين دوائين','المتابعة الصحية','drug_interaction_concern','سؤال حضرتك مهم يا فندم.\n\nممكن تبعت اسم الدوائين والتركيزات؟\nوالدكتور الصيدلي هيراجعهم بدقة قبل ما نأكد لحضرتك أي معلومة.',['اسم الدواء الأول وتركيزه','اسم الدواء الثاني وتركيزه']),
  s('/طريقة_الاستخدام','مراجعة طريقة الاستخدام أو الجرعة','المتابعة الصحية','dosage_clarification','أكيد يا فندم.\n\nممكن تبعت اسم الدواء والتركيز وتعليمات الطبيب لو موجودة؟\nوالدكتور الصيدلي هيراجع طريقة الاستخدام مع حضرتك بدقة.',['اسم الدواء والتركيز','تعليمات الطبيب إن وجدت']),
  s('/عرض_جانبي','متابعة عرض جانبي أو أثر غير متوقع','المتابعة الصحية','side_effect_report','شكرًا إن حضرتك بلغتنا بالأعراض دي فورًا، وده مهم لسلامتك.\n\nمحتاجين نعرف:\nالأعراض بدأت إمتى؟\nشدتها دلوقتي عاملة إزاي؟\nفي أعراض تانية؟\n\nلو في ضيق تنفس أو تورم أو أعراض شديدة، الأفضل التوجه للطوارئ فورًا.',['وقت بداية الأعراض','شدة الأعراض','هل توجد أعراض أخرى؟']),
  s('/سعر','مناقشة السعر واختيار الأنسب','العمليات البيعية','price_objection','متفهمين إن السعر نقطة مهمة يا فندم 🌷\n\nنقدر نراجع لحضرتك الاختيارات المتاحة ونوضح الفرق من غير ضغط.\n\nإيه الأنسب لحضرتك؟\nنراجع نفس الصنف والعروض عليه\nنشوف اختيار أوفر مناسب\nأفضل نفس الاختيار',['نفس الصنف والعروض','اختيار أوفر مناسب','أفضل نفس الاختيار']),
  s('/ترقية_الاختيار','مقارنة اختيارين من نفس الفئة','العمليات البيعية','up_sell','لو تسمحلي يا فندم، في اختيار تاني من نفس الفئة ممكن يكون أنسب لاحتياج حضرتك.\n\nتحب المقارنة تكون على:\nالسعر\nالاستخدام والميزة\nالاثنين معًا\nأكمل على اختياري الحالي',['السعر','الاستخدام والميزة','الاثنين معًا','أكمل على اختياري الحالي']),
  s('/بيع_تكميلي','مراجعة احتياج مرتبط بالطلب','العمليات البيعية','cross_sell','يا فندم، قبل ما نأكد الطلب في منتج مرتبط باستخدام طلب حضرتك وممكن يكون مفيد فعلًا.\n\nتحب أعرفك بيه وسبب ترشيحه؟\nنعم\nلا، شكرًا',['نعم','لا، شكرًا']),
  s('/كوزمو','استكشاف احتياج العناية والكوزمو','العمليات البيعية','cosmetics_interest','أكيد يا فندم 🌷\nعشان الترشيح يكون مناسب فعلًا، إيه الهدف الأساسي لحضرتك؟\nترطيب\nحبوب وآثارها\nتفتيح وتصبغات\nعناية بالشعر\nهدف تاني',['ترطيب','حبوب وآثارها','تفتيح وتصبغات','عناية بالشعر','هدف تاني']),
  s('/مكملات','استكشاف احتياج المكملات','العمليات البيعية','supplements_interest','أكيد يا فندم 🌷\nقبل أي ترشيح، إيه الهدف الأساسي من المكمل؟\nطاقة ونشاط\nمناعة\nشعر وبشرة\nعظام ومفاصل\nهدف آخر',['طاقة ونشاط','مناعة','شعر وبشرة','عظام ومفاصل','هدف آخر']),
  s('/رصيد_الكاش_باك','إبلاغ بقيمة الكاش باك','الولاء والكاش باك','points_reminder','مساء الخير يا فندم 🌷\nمع حضرتك هبة من خدمة عملاء صيدليات دواء.\n\nحبيت أبلغ حضرتك إن قيمة الكاش باك المتاحة لحضرتك هي {{points_balance}}.\n\nتحب:\nنوضح طريقة الاستفادة منه\nنراجع تفاصيل التسوية\nتستخدمه مع الطلب القادم',['شرح طريقة الاستفادة','مراجعة التسوية','استخدامه مع الطلب القادم']),
  s('/طلب_تقييم','طلب تقييم من عميل راضٍ','الولاء والكاش باك','review_request','سعداء إن تجربتك معانا كانت مريحة 🌷\n\nويهمنا تقييم حضرتك للخدمة:\nممتازة ⭐\nمقبولة\nسيئة',['ممتازة ⭐','مقبولة','سيئة']),
  s('/عميل_قديم','شكر وتقدير لعميل مستمر','الولاء والكاش باك','loyalty_thanks','مساء الخير يا فندم 🌷\nمع حضرتك هبة من خدمة عملاء صيدليات دواء.\n\nوجود حضرتك معانا باستمرار حاجة بنقدّرها جدًا، وبيهمنا نعرف إيه اللي لازم نفضل محافظين عليه.\n\nإيه أكتر حاجة بتفرق مع حضرتك؟\nسرعة الخدمة\nتوفير الأصناف\nالتعامل والاهتمام\nالأسعار والعروض',['سرعة الخدمة','توفير الأصناف','التعامل والاهتمام','الأسعار والعروض']),
];

const PROFILE_TAG_TO_SCRIPT_TYPE: Record<string,string> = {
  monthly_treatment: 'monthly_refill', cosmetics_interest: 'cosmetics_interest', supplements_interest: 'supplements_interest', has_children: 'family_kids', mother_customer: 'family_kids', elderly_in_house: 'elderly_care'
};

export function suggestScriptTypesForCustomer(input: { profileTags?: string[] | null; customerStatus?: string | null; segment?: string | null; invoicesCount?: number | null; lastPurchase?: string | null }): string[] {
  const suggestions: string[] = [];
  const status = String(input.customerStatus || '');
  if ((input.invoicesCount ?? null) === 0 || /بدون شراء/.test(status)) suggestions.push('no_purchase_welcome');
  for (const tag of input.profileTags || []) {
    const type = PROFILE_TAG_TO_SCRIPT_TYPE[tag];
    if (type && !suggestions.includes(type)) suggestions.push(type);
  }
  if (/مهدد|متوقف/.test(status) && !suggestions.includes('retention')) suggestions.push('retention');
  if (input.segment === 'مهم جدًا') {
    if (/مهدد|متوقف/.test(status)) suggestions.unshift('vip_winback');
    else if (!suggestions.includes('vip_active_checkin')) suggestions.push('vip_active_checkin');
  }
  if (!suggestions.length) suggestions.push('followup');
  return suggestions;
}

function fallbackScripts(): QuickReplyScript[] {
  return DEFAULT_QUICK_REPLY_SCRIPTS.map((script,index) => ({ id:`default-${index}`, shortcut:script.shortcut, title:script.title, category:script.category, script_type:script.script_type, doctor_name:script.doctor_name||null, branch:script.branch||null, message_body:script.message_body, questions:script.questions||null, suggested_products:script.suggested_products||null, tags:script.tags||null, active:script.active!==false, usage_count:Number(script.usage_count||0), created_by:script.created_by||null, created_by_name:script.created_by_name||null, created_at:null, updated_at:null }));
}

export async function fetchQuickReplyScripts() {
  if (!isSupabaseConfigured) return fallbackScripts();
  const { data, error } = await supabase.from('quick_reply_scripts').select('*').eq('active',true).order('category',{ascending:true}).order('shortcut',{ascending:true}).limit(1000);
  if (error) { console.warn('[quickReplyScripts] using fallback scripts', error); return fallbackScripts(); }
  return ((data||[]) as QuickReplyScript[]).length ? (data as QuickReplyScript[]) : fallbackScripts();
}

export async function saveQuickReplyScript(script: Partial<QuickReplyScript> & Pick<QuickReplyScript,'shortcut'|'title'|'category'|'script_type'|'message_body'>) {
  if (!isSupabaseConfigured) throw new Error('Supabase غير متصل');
  const payload = { shortcut: script.shortcut.trim().startsWith('/') ? script.shortcut.trim() : `/${script.shortcut.trim()}`, title:script.title.trim(), category:script.category.trim()||'عام', script_type:script.script_type||'quick_reply', doctor_name:script.doctor_name||null, branch:script.branch||null, message_body:script.message_body.trim(), questions:script.questions||null, suggested_products:script.suggested_products||null, tags:script.tags||null, active:script.active!==false };
  const { data,error } = await supabase.rpc('save_quick_reply_script',{ p_id:script.id&&!script.id.startsWith('default-')?script.id:null, p_shortcut:payload.shortcut, p_title:payload.title, p_category:payload.category, p_script_type:payload.script_type, p_doctor_name:payload.doctor_name, p_branch:payload.branch, p_message_body:payload.message_body, p_questions:payload.questions, p_suggested_products:payload.suggested_products, p_tags:payload.tags, p_active:payload.active, p_actor_id:script.created_by||null, p_actor_name:script.created_by_name||null });
  if (error) {
    const message=String(error.message||'');
    if (/questions.*text\[\].*jsonb|suggested_products.*text\[\].*jsonb|tags.*text\[\].*jsonb|expression is of type jsonb/i.test(message)) throw new Error(QUICK_REPLY_ARRAY_FORMAT_MESSAGE);
    if (/row-level security|permission|صلاحية|quick_reply/i.test(message)) throw new Error(QUICK_REPLY_RLS_MESSAGE);
    throw new Error(message||QUICK_REPLY_RLS_MESSAGE);
  }
  return data as QuickReplyScript;
}

export async function incrementQuickReplyUsage(id:string) {
  if (!isSupabaseConfigured || id.startsWith('default-')) return;
  await supabase.rpc('increment_quick_reply_usage',{p_id:id});
}

export function renderQuickReplyTemplate(message:string, values:{ customer_name?:string|null; doctor_name?:string|null; branch?:string|null; last_purchase?:string|null; referrer_name?:string|null; last_product_category?:string|null; product_name?:string|null; points_balance?:string|number|null; order_status?:string|null; missing_info?:string|null; storage_condition?:string|null; followup_window?:string|null; goodwill_offer?:string|null; unavailability_reason?:string|null; alternative_branch?:string|null; use_customer_name?:boolean }) {
  const safeCustomerName = values.use_customer_name && values.customer_name && !/^\d+$|عميل|غير محدد|بدون/i.test(values.customer_name) ? values.customer_name : '';
  const replacements: Array<[string,string]> = [
    ['customer_name',safeCustomerName],['doctor_name',values.doctor_name||'فريق صيدليات دواء'],['branch',values.branch||'صيدليات دواء'],['last_purchase',values.last_purchase||'آخر تعامل'],['referrer_name',values.referrer_name||'أحد عملائنا'],['last_product_category',values.last_product_category||'احتياجاتك المعتادة'],['product_name',values.product_name||'الصنف المطلوب'],['points_balance',values.points_balance!=null?String(values.points_balance):'المتاح'],['order_status',values.order_status||'قيد التجهيز'],['missing_info',values.missing_info||'البيانات المطلوبة'],['storage_condition',values.storage_condition||'طريقة الحفظ الموصى بها'],['followup_window',values.followup_window||'الوقت المحدد للمتابعة'],['goodwill_offer',values.goodwill_offer||'لفتة تقدير معتمدة'],['unavailability_reason',values.unavailability_reason||'غير متاح مؤقتًا'],['alternative_branch',values.alternative_branch||'الفرع الآخر']
  ];
  let rendered=message;
  for (const [key,value] of replacements) rendered=rendered.replaceAll(`{{${key}}}`,value).replaceAll(`{${key}}`,value);
  return rendered.replace(/\s{2,}/g,' ').replace(/\s+([،,.!?])/g,'$1').trim();
}
