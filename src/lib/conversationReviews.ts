export type ReviewErrorType =
  | 'forgotten_customer'
  | 'missing_greeting'
  | 'missing_doctor_name'
  | 'poor_tone'
  | 'medical_error'
  | 'invoice_error'
  | 'delivery_error'
  | 'missed_sale'
  | 'missing_order_confirmation'
  | 'wrong_price'
  | 'promised_unavailable';

export type ReviewCriterionKey =
  | 'first_response_speed'
  | 'greeting'
  | 'doctor_name'
  | 'customer_name'
  | 'tone'
  | 'understanding'
  | 'followup_after_wait'
  | 'consultation_quality'
  | 'dosage_explanation'
  | 'unavailable_items'
  | 'sales_closing'
  | 'cross_sell_upsell'
  | 'angry_customer'
  | 'order_confirmation'
  | 'closing_message';

export type SevereErrorKey =
  | 'medical_error'
  | 'invoice_error'
  | 'delivery_error'
  | 'wrong_price'
  | 'promised_unavailable'
  | 'insult';

export interface ReviewChoice {
  value: string;
  label: string;
  pointsEarned: number;
  errorType?: ReviewErrorType;
  forgottenCustomer?: boolean;
  missedSale?: boolean;
  successfulCrossSell?: boolean;
  handledAngryCustomerWell?: boolean;
  excellentCase?: boolean;
  severe?: boolean;
  training?: string;
}

export interface ReviewCriterion {
  key: ReviewCriterionKey;
  label: string;
  hint: string;
  maxPoints: number;
  defaultApplies: boolean;
  defaultChoice: string;
  choices: ReviewChoice[];
}

export type ConversationReviewState = Record<
  ReviewCriterionKey,
  { applies: boolean; choice: string; notes?: string }
>;
export type SevereErrorsState = Record<SevereErrorKey, boolean>;

export interface ReviewItemSummary {
  key: ReviewCriterionKey;
  label: string;
  applies: boolean;
  selectedOption: string;
  pointsEarned: number;
  maxPoints: number;
  notes?: string;
  errorType?: ReviewErrorType;
}

export interface ConversationReviewResult {
  finalScore: number;
  earnedPoints: number;
  totalApplicablePoints: number;
  totalApplicableItems: number;
  totalNotApplicableItems: number;
  baseDoctorImpact: number;
  extraPenaltyPoints: number;
  doctorPointsImpact: number;
  impactStatus: 'approved' | 'pending';
  impactLabel: string;
  impactReason: string;
  level: string;
  mainPositiveReason: string;
  mainNegativeReason: string;
  trainingRecommendation: string;
  hasSevereError: boolean;
  forgottenCustomer: boolean;
  missedSalesOpportunity: boolean;
  successfulCrossSell: boolean;
  handledAngryCustomerWell: boolean;
  excellentCase: boolean;
  repeatErrorType: ReviewErrorType | null;
  reviewItems: ReviewItemSummary[];
  extraPenalties: Array<{ key: ReviewErrorType; label: string; points: number }>;
}

export const REVIEW_CRITERIA: ReviewCriterion[] = [
  {
    key: 'first_response_speed',
    label: 'سرعة أول رد',
    hint: 'يتم حسابها طوال 24 ساعة بدون استثناء خارج مواعيد العمل.',
    maxPoints: 10,
    defaultApplies: true,
    defaultChoice: 'within_5',
    choices: [
      { value: 'within_5', label: 'من 0 إلى 5 دقائق', pointsEarned: 10 },
      {
        value: 'five_to_10',
        label: 'أكثر من 5 إلى 10 دقائق',
        pointsEarned: 5,
        training: 'تقليل زمن أول رد للعميل.',
      },
      {
        value: 'ten_to_20',
        label: 'أكثر من 10 إلى 20 دقيقة',
        pointsEarned: 0,
        training: 'تدريب على سرعة الاستجابة ومتابعة الرسائل.',
      },
      {
        value: 'over_20',
        label: 'أكثر من 20 دقيقة',
        pointsEarned: 0,
        training: 'مراجعة توزيع مسؤولية الرد أثناء الشيفت.',
      },
      {
        value: 'over_30',
        label: 'أكثر من 30 دقيقة',
        pointsEarned: 0,
        training: 'تدخل إداري لتحسين سرعة الرد.',
      },
    ],
  },
  {
    key: 'greeting',
    label: 'رسالة الترحيب الرسمية',
    hint: 'يفضل أن تحتوي على تحية، اسم صيدليات دواء، اسم الدكتور، وعرض المساعدة.',
    maxPoints: 10,
    defaultApplies: true,
    defaultChoice: 'official_full',
    choices: [
      { value: 'official_full', label: 'استخدم الرسالة الرسمية كاملة', pointsEarned: 10 },
      { value: 'close_with_name', label: 'رسالة قريبة وبها اسم الدكتور', pointsEarned: 8 },
      {
        value: 'greeting_no_name',
        label: 'رحب بدون اسم الدكتور',
        pointsEarned: 5,
        errorType: 'missing_doctor_name',
      },
      {
        value: 'direct_reply',
        label: 'رد مباشرة بدون ترحيب مناسب',
        pointsEarned: 2,
        errorType: 'missing_greeting',
        training: 'تدريب على استخدام رسالة الترحيب الرسمية وذكر اسم الدكتور.',
      },
      {
        value: 'none',
        label: 'لم يستخدم ترحيب أو بداية غير مهنية',
        pointsEarned: 0,
        errorType: 'missing_greeting',
        training: 'تدريب على رسالة الترحيب الرسمية لصيدليات دواء.',
      },
    ],
  },
  {
    key: 'doctor_name',
    label: 'ذكر اسم الدكتور',
    hint: 'يزيد الثقة ويحدد المسؤول عن المحادثة.',
    maxPoints: 10,
    defaultApplies: true,
    defaultChoice: 'start',
    choices: [
      { value: 'start', label: 'ذكر اسمه في بداية المحادثة', pointsEarned: 10 },
      { value: 'later', label: 'ذكره لاحقًا', pointsEarned: 5 },
      {
        value: 'none',
        label: 'لم يذكر اسمه',
        pointsEarned: 0,
        errorType: 'missing_doctor_name',
        training: 'تدريب على تقديم النفس في بداية المحادثة لزيادة ثقة العميل.',
      },
    ],
  },
  {
    key: 'customer_name',
    label: 'استخدام اسم العميل والاهتمام الشخصي',
    hint: 'فعله فقط لو اسم العميل متاح في النظام أو المحادثة.',
    maxPoints: 10,
    defaultApplies: false,
    defaultChoice: 'used',
    choices: [
      { value: 'used', label: 'استخدم اسم العميل بشكل محترم ومناسب', pointsEarned: 10 },
      { value: 'not_used_good', label: 'لم يستخدم الاسم لكن الأسلوب كان مهتمًا', pointsEarned: 5 },
      {
        value: 'ignored_dry',
        label: 'تجاهل الاسم وكان الرد جافًا',
        pointsEarned: 0,
        errorType: 'poor_tone',
        training: 'تدريب على تخصيص الرد باسم العميل عند توفره.',
      },
    ],
  },
  {
    key: 'tone',
    label: 'احترام العميل وجودة الأسلوب',
    hint: 'يقيس نبرة الدكتور واحترافه في المحادثة.',
    maxPoints: 10,
    defaultApplies: true,
    defaultChoice: 'professional',
    choices: [
      { value: 'professional', label: 'أسلوب محترم ومهني وواضح', pointsEarned: 10 },
      { value: 'acceptable', label: 'أسلوب مقبول', pointsEarned: 7 },
      {
        value: 'dry',
        label: 'أسلوب جاف أو مختصر بطريقة سيئة',
        pointsEarned: 4,
        errorType: 'poor_tone',
        training: 'تحسين صياغة الردود لتكون أهدأ وأوضح.',
      },
      {
        value: 'bad',
        label: 'أسلوب سيئ أو فيه تجاهل',
        pointsEarned: 0,
        errorType: 'poor_tone',
        training: 'مراجعة قواعد التعامل مع العملاء.',
      },
      {
        value: 'very_bad',
        label: 'أسلوب سيئ جدًا أو تسبب في غضب العميل',
        pointsEarned: 0,
        errorType: 'poor_tone',
        training: 'تدريب عاجل على إدارة غضب العميل.',
      },
      {
        value: 'insult',
        label: 'إساءة واضحة للعميل',
        pointsEarned: 0,
        errorType: 'poor_tone',
        severe: true,
        training: 'تصعيد إداري بسبب إساءة للعميل.',
      },
    ],
  },
  {
    key: 'understanding',
    label: 'فهم طلب العميل',
    hint: 'هل فهم الدكتور طلب العميل قبل الرد أو البيع؟',
    maxPoints: 10,
    defaultApplies: true,
    defaultChoice: 'strong',
    choices: [
      { value: 'strong', label: 'فهم الطلب بدقة وسأل أسئلة مناسبة', pointsEarned: 10 },
      { value: 'acceptable', label: 'فهم مقبول', pointsEarned: 7 },
      { value: 'medium', label: 'فهم متوسط', pointsEarned: 5 },
      {
        value: 'rushed',
        label: 'استعجل قبل فهم الطلب',
        pointsEarned: 2,
        training: 'تدريب على طرح أسئلة قبل الترشيح أو البيع.',
      },
      {
        value: 'wrong',
        label: 'فهم الطلب غلط',
        pointsEarned: 0,
        training: 'مراجعة طريقة قراءة طلب العميل.',
      },
      {
        value: 'caused_error',
        label: 'تسبب في خطأ بسبب سوء الفهم',
        pointsEarned: 0,
        errorType: 'medical_error',
        training: 'تدريب على تأكيد الطلب قبل التصرف.',
      },
    ],
  },
  {
    key: 'followup_after_wait',
    label: 'المتابعة بعد كلمة لحظات أو هراجع',
    hint: 'ينطبق لو الدكتور وعد العميل بالرجوع أو مراجعة التوفر.',
    maxPoints: 10,
    defaultApplies: false,
    defaultChoice: 'within_5',
    choices: [
      { value: 'within_5', label: 'رجع خلال 5 دقائق', pointsEarned: 10 },
      { value: 'five_to_10', label: 'رجع خلال 5 إلى 10 دقائق', pointsEarned: 5 },
      {
        value: 'over_10',
        label: 'رجع بعد أكثر من 10 دقائق',
        pointsEarned: 2,
        errorType: 'forgotten_customer',
        training: 'تدريب على متابعة العملاء بعد كلمة لحظات.',
      },
      {
        value: 'over_20',
        label: 'رجع بعد أكثر من 20 دقيقة',
        pointsEarned: 0,
        errorType: 'forgotten_customer',
        training: 'تدريب على عدم ترك العميل بعد وعد بالرجوع.',
      },
      {
        value: 'never',
        label: 'لم يرجع نهائيًا',
        pointsEarned: 0,
        errorType: 'forgotten_customer',
        forgottenCustomer: true,
        training: 'تصعيد ومراجعة بسبب نسيان العميل.',
      },
    ],
  },
  {
    key: 'consultation_quality',
    label: 'جودة الاستشارة',
    hint: 'ينطبق فقط لو المحادثة فيها استشارة دوائية أو صحية.',
    maxPoints: 15,
    defaultApplies: false,
    defaultChoice: 'strong_safe',
    choices: [
      { value: 'strong_safe', label: 'استشارة قوية وآمنة ومفيدة', pointsEarned: 15 },
      { value: 'good', label: 'استشارة جيدة', pointsEarned: 12 },
      { value: 'medium', label: 'استشارة متوسطة', pointsEarned: 8 },
      {
        value: 'weak',
        label: 'رد عام وضعيف',
        pointsEarned: 4,
        training: 'تدريب على الاستشارة الآمنة وحدود الرد الصيدلي.',
      },
      {
        value: 'rushed',
        label: 'استعجل بدون أسئلة مهمة',
        pointsEarned: 2,
        training: 'مراجعة خطوات الاستشارة قبل الترشيح.',
      },
      {
        value: 'dangerous',
        label: 'معلومة خطأ أو خطر',
        pointsEarned: 0,
        errorType: 'medical_error',
        severe: true,
        training: 'تصعيد إداري وتدريب دوائي عاجل.',
      },
    ],
  },
  {
    key: 'dosage_explanation',
    label: 'توضيح الجرعة وطريقة الاستخدام',
    hint: 'ينطبق لو الدواء أو المنتج يحتاج شرح.',
    maxPoints: 10,
    defaultApplies: false,
    defaultChoice: 'full',
    choices: [
      { value: 'full', label: 'شرح كامل للجرعة والاستخدام والتحذيرات', pointsEarned: 10 },
      { value: 'good', label: 'شرح جيد لكن ناقص تفصيلة بسيطة', pointsEarned: 8 },
      { value: 'medium', label: 'شرح متوسط', pointsEarned: 5 },
      {
        value: 'incomplete',
        label: 'شرح ناقص',
        pointsEarned: 2,
        training: 'تدريب على شرح الجرعات وطريقة الاستخدام والتحذيرات.',
      },
      {
        value: 'none',
        label: 'لم يشرح رغم الحاجة',
        pointsEarned: 0,
        training: 'إلزام شرح الاستخدام عند الحاجة.',
      },
      {
        value: 'wrong',
        label: 'شرح خاطئ',
        pointsEarned: 0,
        errorType: 'medical_error',
        severe: true,
        training: 'تصعيد بسبب شرح جرعة خاطئ.',
      },
    ],
  },
  {
    key: 'unavailable_items',
    label: 'النواقص وترشيح البدائل',
    hint: 'ينطبق لو العميل سأل عن صنف غير متوفر أو ناقص.',
    maxPoints: 10,
    defaultApplies: false,
    defaultChoice: 'alternative_explained',
    choices: [
      {
        value: 'alternative_explained',
        label: 'اعتذر ورشح بديل مناسب وشرح الفرق',
        pointsEarned: 10,
      },
      { value: 'alternative_no_explain', label: 'رشح بديل مناسب بدون شرح كافي', pointsEarned: 7 },
      {
        value: 'unavailable_only',
        label: 'قال مش موجود فقط بدون محاولة مساعدة',
        pointsEarned: 3,
        training: 'تدريب على ترشيح البدائل بدل إنهاء المحادثة.',
      },
      {
        value: 'ignored',
        label: 'تجاهل طلب العميل',
        pointsEarned: 0,
        training: 'مراجعة متابعة طلبات النواقص.',
      },
      {
        value: 'bad_alternative',
        label: 'رشح بديل غير مناسب',
        pointsEarned: 0,
        errorType: 'medical_error',
        severe: true,
        training: 'تدريب دوائي على البدائل المناسبة.',
      },
    ],
  },
  {
    key: 'sales_closing',
    label: 'جودة عملية البيع وإغلاق الطلب',
    hint: 'يقيس هل أدار الدكتور عملية البيع باحتراف بدون ضغط.',
    maxPoints: 10,
    defaultApplies: true,
    defaultChoice: 'clear_order',
    choices: [
      { value: 'clear_order', label: 'قاد المحادثة لطلب واضح باحتراف', pointsEarned: 10 },
      { value: 'helped', label: 'ساعد العميل على القرار بدون ضغط', pointsEarned: 8 },
      {
        value: 'passive',
        label: 'رد فقط بدون محاولة إغلاق رغم وجود فرصة',
        pointsEarned: 4,
        training: 'تدريب على إغلاق الطلب بطريقة محترمة.',
      },
      {
        value: 'missed',
        label: 'أضاع فرصة بيع واضحة',
        pointsEarned: 0,
        errorType: 'missed_sale',
        missedSale: true,
        training: 'تدريب على تحويل الاهتمام إلى طلب واضح.',
      },
      {
        value: 'pressure',
        label: 'ضغط على العميل بطريقة سيئة',
        pointsEarned: 0,
        errorType: 'poor_tone',
        training: 'تدريب على البيع المسؤول بدون ضغط.',
      },
    ],
  },
  {
    key: 'cross_sell_upsell',
    label: 'Cross-selling / Upselling',
    hint: 'ينطبق فقط لو توجد فرصة حقيقية ومفيدة للعميل.',
    maxPoints: 10,
    defaultApplies: false,
    defaultChoice: 'useful',
    choices: [
      {
        value: 'useful',
        label: 'اقترح منتج مكمل أو اختيار أفضل بشكل مفيد ومحترم',
        pointsEarned: 10,
        successfulCrossSell: true,
      },
      { value: 'partial', label: 'محاولة جيدة لكن ناقصة', pointsEarned: 7 },
      {
        value: 'missed',
        label: 'كانت هناك فرصة واضحة ولم يحاول',
        pointsEarned: 2,
        errorType: 'missed_sale',
        missedSale: true,
        training: 'تدريب على اقتراح المنتجات المكملة بدون ضغط.',
      },
      {
        value: 'unsuitable',
        label: 'اقترح شيء غير مناسب',
        pointsEarned: 0,
        training: 'مراجعة مناسبة الاقتراح لاحتياج العميل.',
      },
      {
        value: 'pressure',
        label: 'ضغط على العميل',
        pointsEarned: 0,
        errorType: 'poor_tone',
        training: 'تدريب على البيع المسؤول.',
      },
    ],
  },
  {
    key: 'angry_customer',
    label: 'التعامل مع العميل الغاضب أو الشكوى',
    hint: 'ينطبق لو العميل غاضب أو عنده شكوى.',
    maxPoints: 10,
    defaultApplies: false,
    defaultChoice: 'solved',
    choices: [
      {
        value: 'solved',
        label: 'امتص غضب العميل واعتذر وقدم حل واضح',
        pointsEarned: 10,
        handledAngryCustomerWell: true,
        excellentCase: true,
      },
      {
        value: 'good',
        label: 'تعامل جيد وحافظ على العميل',
        pointsEarned: 8,
        handledAngryCustomerWell: true,
      },
      { value: 'medium', label: 'تعامل متوسط', pointsEarned: 5 },
      {
        value: 'argued',
        label: 'جادل العميل أو زاد غضبه',
        pointsEarned: 0,
        errorType: 'poor_tone',
        training: 'تدريب على امتصاص غضب العميل وحل الشكاوى.',
      },
      {
        value: 'inappropriate',
        label: 'رد غير لائق',
        pointsEarned: 0,
        errorType: 'poor_tone',
        severe: true,
        training: 'تصعيد إداري بسبب رد غير لائق.',
      },
    ],
  },
  {
    key: 'order_confirmation',
    label: 'تأكيد بيانات الطلب',
    hint: 'ينطبق لو المحادثة انتهت بطلب أو دليفري.',
    maxPoints: 10,
    defaultApplies: false,
    defaultChoice: 'full',
    choices: [
      { value: 'full', label: 'أكد كل البيانات المطلوبة', pointsEarned: 10 },
      { value: 'minor_missing', label: 'ناقص بند بسيط', pointsEarned: 7 },
      {
        value: 'many_missing',
        label: 'ناقص أكثر من بند',
        pointsEarned: 4,
        training: 'تدريب على قائمة تأكيد بيانات الطلب.',
      },
      {
        value: 'important_missing',
        label: 'لم يؤكد بيانات مهمة',
        pointsEarned: 0,
        errorType: 'missing_order_confirmation',
        training: 'إلزام تأكيد بيانات الطلب قبل التنفيذ.',
      },
      {
        value: 'caused_error',
        label: 'تسبب في خطأ فاتورة أو دليفري',
        pointsEarned: 0,
        errorType: 'missing_order_confirmation',
        training: 'مراجعة أخطاء تأكيد الطلب.',
      },
    ],
  },
  {
    key: 'closing_message',
    label: 'رسالة الختام',
    hint: 'إغلاق محترم يحافظ على علاقة العميل بالصيدلية.',
    maxPoints: 5,
    defaultApplies: true,
    defaultChoice: 'official',
    choices: [
      { value: 'official', label: 'استخدم رسالة الختام الرسمية', pointsEarned: 5 },
      { value: 'respectful', label: 'ختام محترم قريب من الرسمي', pointsEarned: 3 },
      {
        value: 'none_completed',
        label: 'لا يوجد ختام رغم اكتمال المحادثة',
        pointsEarned: 0,
        training: 'تدريب على إنهاء المحادثة برسالة الختام الرسمية.',
      },
      {
        value: 'left_open',
        label: 'ترك العميل بدون إغلاق',
        pointsEarned: 0,
        training: 'تحسين متابعة نهاية المحادثة.',
      },
    ],
  },
];

export const SEVERE_ERRORS: Record<
  SevereErrorKey,
  { label: string; points: number; errorType: ReviewErrorType; training: string }
> = {
  medical_error: {
    label: 'خطأ طبي مؤثر',
    points: -25,
    errorType: 'medical_error',
    training: 'تدريب دوائي عاجل ومراجعة مدير.',
  },
  invoice_error: {
    label: 'خطأ فاتورة',
    points: -15,
    errorType: 'invoice_error',
    training: 'مراجعة دقة الفاتورة قبل الإغلاق.',
  },
  delivery_error: {
    label: 'خطأ عنوان أو دليفري بسبب الدكتور',
    points: -15,
    errorType: 'delivery_error',
    training: 'تأكيد بيانات التوصيل قبل التنفيذ.',
  },
  wrong_price: {
    label: 'وعد بسعر أو خصم غير صحيح',
    points: -10,
    errorType: 'wrong_price',
    training: 'مراجعة سياسة الأسعار والعروض.',
  },
  promised_unavailable: {
    label: 'وعد بتوفر صنف وهو غير متوفر',
    points: -10,
    errorType: 'promised_unavailable',
    training: 'تأكيد التوفر قبل وعد العميل.',
  },
  insult: {
    label: 'إساءة واضحة للعميل',
    points: -25,
    errorType: 'poor_tone',
    training: 'تصعيد إداري بسبب إساءة للعميل.',
  },
};

const repeatPriority: ReviewErrorType[] = [
  'medical_error',
  'forgotten_customer',
  'poor_tone',
  'invoice_error',
  'delivery_error',
  'missing_order_confirmation',
  'missed_sale',
  'missing_greeting',
  'missing_doctor_name',
  'wrong_price',
  'promised_unavailable',
];

export function defaultReviewState(): ConversationReviewState {
  return REVIEW_CRITERIA.reduce((acc, criterion) => {
    acc[criterion.key] = {
      applies: criterion.defaultApplies,
      choice: criterion.defaultChoice,
      notes: '',
    };
    return acc;
  }, {} as ConversationReviewState);
}

export function defaultSevereErrors(): SevereErrorsState {
  return {
    medical_error: false,
    invoice_error: false,
    delivery_error: false,
    wrong_price: false,
    promised_unavailable: false,
    insult: false,
  };
}

export function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function baseDoctorImpactFromScore(score: number) {
  if (score >= 95) return 5;
  if (score >= 90) return 3;
  if (score >= 85) return 0;
  if (score >= 80) return -5;
  if (score >= 70) return -10;
  if (score >= 60) return -15;
  return -20;
}

export function conversationLevel(score: number) {
  if (score >= 95) return 'ممتازة';
  if (score >= 90) return 'قوية';
  if (score >= 85) return 'جيدة';
  if (score >= 80) return 'مقبولة';
  if (score >= 70) return 'تحتاج تحسين';
  if (score >= 60) return 'ضعيفة';
  return 'حرجة';
}

export function monthCycleFromDate(dateInput: Date | string = new Date()) {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  const year = date.getFullYear();
  const month = date.getMonth();
  const cycleMonth = date.getDate() >= 26 ? month + 1 : month;
  const cycleDate = new Date(year, cycleMonth, 1);
  return `${cycleDate.getFullYear()}-${String(cycleDate.getMonth() + 1).padStart(2, '0')}`;
}

function scoreReason(score: number) {
  if (score >= 95) return 'تقييم محادثة ممتاز';
  if (score >= 90) return 'تقييم محادثة قوي';
  if (score >= 85) return 'تقييم محادثة جيد بدون تأثير نقاط';
  if (score >= 80) return 'تقييم محادثة أقل من 85';
  if (score >= 70) return 'تقييم محادثة أقل من 80';
  if (score >= 60) return 'تقييم محادثة ضعيف';
  return 'تقييم محادثة حرج';
}

export function evaluateConversationReview(
  state: ConversationReviewState,
  severeErrors: SevereErrorsState
): ConversationReviewResult {
  const reviewItems: ReviewItemSummary[] = [];
  let earnedPoints = 0;
  let totalApplicablePoints = 0;
  let totalApplicableItems = 0;
  let forgottenCustomer = false;
  let missedSalesOpportunity = false;
  let successfulCrossSell = false;
  let handledAngryCustomerWell = false;
  let excellentCase = false;
  let hasSevereError = false;
  const extraPenaltyMap = new Map<
    ReviewErrorType,
    { key: ReviewErrorType; label: string; points: number }
  >();

  for (const criterion of REVIEW_CRITERIA) {
    const item = state[criterion.key];
    const choice =
      criterion.choices.find((row) => row.value === item?.choice) || criterion.choices[0];
    const applies = Boolean(item?.applies);
    if (applies) {
      totalApplicableItems += 1;
      totalApplicablePoints += criterion.maxPoints;
      earnedPoints += choice.pointsEarned;
      if (choice.forgottenCustomer) forgottenCustomer = true;
      if (choice.missedSale) missedSalesOpportunity = true;
      if (choice.successfulCrossSell) successfulCrossSell = true;
      if (choice.handledAngryCustomerWell) handledAngryCustomerWell = true;
      if (choice.excellentCase) excellentCase = true;
      if (choice.severe) hasSevereError = true;
      if (choice.errorType && choice.pointsEarned === 0) {
        const extra = extraPenaltyForError(choice.errorType);
        if (extra) extraPenaltyMap.set(extra.key, extra);
      }
    }
    reviewItems.push({
      key: criterion.key,
      label: criterion.label,
      applies,
      selectedOption: choice.label,
      pointsEarned: applies ? choice.pointsEarned : 0,
      maxPoints: criterion.maxPoints,
      notes: item?.notes || '',
      errorType: applies ? choice.errorType : undefined,
    });
  }

  for (const [key, active] of Object.entries(severeErrors) as Array<[SevereErrorKey, boolean]>) {
    if (!active) continue;
    const severe = SEVERE_ERRORS[key];
    hasSevereError = true;
    extraPenaltyMap.set(severe.errorType, {
      key: severe.errorType,
      label: severe.label,
      points: severe.points,
    });
  }

  const finalScore =
    totalApplicablePoints > 0 ? clampScore((earnedPoints / totalApplicablePoints) * 100) : 100;
  const baseDoctorImpact = baseDoctorImpactFromScore(finalScore);
  const extraPenalties = Array.from(extraPenaltyMap.values());
  const extraPenaltyPoints = extraPenalties.reduce((sum, penalty) => sum + penalty.points, 0);
  const doctorPointsImpact = baseDoctorImpact + extraPenaltyPoints;
  const impactStatus: 'approved' | 'pending' =
    doctorPointsImpact < 0 || hasSevereError ? 'pending' : 'approved';
  const impactLabel =
    doctorPointsImpact > 0
      ? `+${doctorPointsImpact} نقاط حافز`
      : doctorPointsImpact < 0
        ? `${doctorPointsImpact} نقاط خصم`
        : '0 — لا يوجد تأثير على النقاط';

  const appliedSorted = reviewItems
    .filter((item) => item.applies)
    .sort((a, b) => a.pointsEarned / a.maxPoints - b.pointsEarned / b.maxPoints);
  const positives = reviewItems.filter(
    (item) => item.applies && item.pointsEarned === item.maxPoints
  );
  const negative = appliedSorted.find((item) => item.pointsEarned < item.maxPoints);
  const errorTypes = reviewItems.map((item) => item.errorType).filter(Boolean) as ReviewErrorType[];
  extraPenalties.forEach((penalty) => errorTypes.push(penalty.key));
  const repeatErrorType = repeatPriority.find((type) => errorTypes.includes(type)) || null;
  const mainNegativeReason =
    extraPenalties[0]?.label ||
    (negative ? `${negative.label}: ${negative.selectedOption}` : scoreReason(finalScore));
  const mainPositiveReason = positives[0]
    ? `${positives[0].label}: ${positives[0].selectedOption}`
    : 'لا توجد نقطة إيجابية كاملة بارزة';
  const weakestTraining =
    appliedSorted
      .map((item) => {
        const criterion = REVIEW_CRITERIA.find((row) => row.key === item.key);
        const choice = criterion?.choices.find((row) => row.label === item.selectedOption);
        return choice?.training || (item.errorType ? trainingByErrorType(item.errorType) : '');
      })
      .find(Boolean) ||
    (repeatErrorType
      ? trainingByErrorType(repeatErrorType)
      : 'لا توجد توصية تدريب واضحة، استمر في متابعة جودة المحادثات.');

  return {
    finalScore,
    earnedPoints,
    totalApplicablePoints,
    totalApplicableItems,
    totalNotApplicableItems: REVIEW_CRITERIA.length - totalApplicableItems,
    baseDoctorImpact,
    extraPenaltyPoints,
    doctorPointsImpact,
    impactStatus,
    impactLabel,
    impactReason: scoreReason(finalScore),
    level: conversationLevel(finalScore),
    mainPositiveReason,
    mainNegativeReason,
    trainingRecommendation: weakestTraining,
    hasSevereError,
    forgottenCustomer,
    missedSalesOpportunity,
    successfulCrossSell,
    handledAngryCustomerWell,
    excellentCase,
    repeatErrorType,
    reviewItems,
    extraPenalties,
  };
}

function extraPenaltyForError(type: ReviewErrorType) {
  const map: Partial<
    Record<ReviewErrorType, { key: ReviewErrorType; label: string; points: number }>
  > = {
    medical_error: { key: 'medical_error', label: 'خطأ طبي مؤثر', points: -25 },
    invoice_error: { key: 'invoice_error', label: 'خطأ فاتورة', points: -15 },
    delivery_error: {
      key: 'delivery_error',
      label: 'خطأ عنوان أو دليفري بسبب الدكتور',
      points: -15,
    },
    forgotten_customer: {
      key: 'forgotten_customer',
      label: 'نسيان العميل بعد وعد بالمتابعة',
      points: -10,
    },
    poor_tone: { key: 'poor_tone', label: 'سوء أسلوب مؤثر', points: -10 },
    missed_sale: { key: 'missed_sale', label: 'إضاعة فرصة بيع واضحة', points: -10 },
    missing_order_confirmation: {
      key: 'missing_order_confirmation',
      label: 'عدم تأكيد بيانات الطلب',
      points: -10,
    },
    wrong_price: { key: 'wrong_price', label: 'وعد بسعر أو خصم غير صحيح', points: -10 },
    promised_unavailable: {
      key: 'promised_unavailable',
      label: 'وعد بتوفر صنف وهو غير متوفر',
      points: -10,
    },
  };
  return map[type] || null;
}

export function trainingByErrorType(type: ReviewErrorType) {
  const map: Record<ReviewErrorType, string> = {
    forgotten_customer: 'تدريب على متابعة العملاء وعدم ترك العميل بعد وعد بالرجوع.',
    missing_greeting: 'تدريب على استخدام رسالة الترحيب الرسمية وذكر اسم الدكتور.',
    missing_doctor_name: 'تدريب على تقديم النفس في بداية المحادثة لزيادة ثقة العميل.',
    poor_tone: 'تدريب على الأسلوب الودود وإدارة العميل الغاضب.',
    medical_error: 'تدريب على الاستشارة الآمنة وحدود الرد الصيدلي.',
    invoice_error: 'تدريب على مراجعة بيانات الفاتورة قبل الإغلاق.',
    delivery_error: 'تدريب على تأكيد العنوان والرقم وموعد التوصيل.',
    missed_sale: 'تدريب على إغلاق الطلب والـ Cross-selling بدون ضغط.',
    missing_order_confirmation: 'تدريب على قائمة تأكيد بيانات الطلب.',
    wrong_price: 'مراجعة سياسة الأسعار والعروض قبل الوعد للعميل.',
    promised_unavailable: 'تأكيد التوفر من السيستم أو الفرع قبل إبلاغ العميل.',
  };
  return map[type];
}
