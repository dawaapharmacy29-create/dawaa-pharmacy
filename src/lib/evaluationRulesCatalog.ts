import type { ApproverRoleKey } from "@/lib/approverRoles";

export type RuleType = "deduction" | "bonus";
export type Severity = "low" | "medium" | "high" | "critical";
export type RoleScope = "doctor" | "assistant" | "delivery" | "cleaning" | "customer_service" | "manager" | "all";
export type RepeatPolicy = "double_per_cycle" | "none";

export interface EvaluationRuleDef {
  code: string;
  category: string;
  title: string;
  description: string;
  default_points: number;
  type: RuleType;
  severity: Severity;
  role_scope: RoleScope;
  requires_approval: boolean;
  evidence_required: boolean;
  allowed_approver_roles: ApproverRoleKey[];
  repeat_policy: RepeatPolicy;
  active: boolean;
  /** حد أقصى للخصم بعد المضاعفة */
  max_points_cap?: number;
}

const BM: ApproverRoleKey[] = ["branch_manager"];
const GM: ApproverRoleKey[] = ["general_manager"];
const QM: ApproverRoleKey[] = ["quality_manager", "general_manager"];
const CSM: ApproverRoleKey[] = ["customer_service_manager", "general_manager"];
const DEL: ApproverRoleKey[] = ["branch_manager", "delivery_manager"];
const BM_GM: ApproverRoleKey[] = ["branch_manager", "general_manager"];

/** قواعد التقييم الكاملة — مصدر الواجهة عند عدم توفر جدول evaluation_rules في Supabase */
export const FULL_EVALUATION_RULES: EvaluationRuleDef[] = [
  /* 1 — الانضباط والحضور */
  { code: "ATT_LATE_LT10", category: "الانضباط والحضور", title: "تأخير أقل من 10 دقائق", description: "تأخير بسيط عن بداية الشيفت.", default_points: 5, type: "deduction", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "ATT_LATE_10_30", category: "الانضباط والحضور", title: "تأخير 10 إلى 30 دقيقة", description: "تأخير متوسط.", default_points: 15, type: "deduction", severity: "medium", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "ATT_LATE_GT30", category: "الانضباط والحضور", title: "تأخير أكثر من 30 دقيقة", description: "تأخير كبير.", default_points: 30, type: "deduction", severity: "high", role_scope: "all", requires_approval: true, evidence_required: true, allowed_approver_roles: BM_GM, repeat_policy: "none", active: true },
  { code: "ATT_ABSENT_UNAUTH", category: "الانضباط والحضور", title: "غياب بدون إذن", description: "غياب كامل دون تصريح.", default_points: 80, type: "deduction", severity: "critical", role_scope: "all", requires_approval: true, evidence_required: true, allowed_approver_roles: BM_GM, repeat_policy: "none", active: true },
  { code: "ATT_EARLY_LEAVE", category: "الانضباط والحضور", title: "انصراف مبكر بدون إذن", description: "مغادرة قبل نهاية الشيفت.", default_points: 25, type: "deduction", severity: "medium", role_scope: "all", requires_approval: true, evidence_required: true, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "ATT_NO_CHECKIN", category: "الانضباط والحضور", title: "عدم تسجيل حضور أو انصراف", description: "لم يتم تسجيل بصمة أو تسجيل.", default_points: 10, type: "deduction", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "ATT_SHIFT_SWAP", category: "الانضباط والحضور", title: "تبديل شيفت بدون موافقة", description: "تغيير شيفت دون اعتماد.", default_points: 20, type: "deduction", severity: "medium", role_scope: "all", requires_approval: true, evidence_required: true, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "ATT_LATE_REPEAT3", category: "الانضباط والحضور", title: "تكرار التأخير 3 مرات في نفس الدورة", description: "خصم إضافي بعد تكرار التأخير.", default_points: 20, type: "deduction", severity: "high", role_scope: "all", requires_approval: true, evidence_required: true, allowed_approver_roles: BM_GM, repeat_policy: "double_per_cycle", active: true, max_points_cap: 160 },

  /* 2 — المظهر والسلوك */
  { code: "APP_NO_GREET_STAND", category: "المظهر والسلوك داخل الفرع", title: "عدم الوقوف أو الاستعداد لخدمة العميل", description: "عدم الاستعداد عند دخول العميل.", default_points: 10, type: "deduction", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "APP_PHONE_SERVICE", category: "المظهر والسلوك داخل الفرع", title: "استخدام الهاتف الشخصي أثناء خدمة العميل لغير مصلحة العميل", description: "انشغال بالهاتف أثناء الخدمة.", default_points: 20, type: "deduction", severity: "medium", role_scope: "all", requires_approval: true, evidence_required: true, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "APP_SIDE_TALK", category: "المظهر والسلوك داخل الفرع", title: "الانشغال بكلام جانبي أثناء وجود العميل", description: "حديث جانبي أثناء خدمة عميل.", default_points: 15, type: "deduction", severity: "medium", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "APP_DRESS", category: "المظهر والسلوك داخل الفرع", title: "عدم الالتزام بالزي", description: "زي غير لائق.", default_points: 10, type: "deduction", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "APP_RUDE_TONE", category: "المظهر والسلوك داخل الفرع", title: "أسلوب غير لائق أو نبرة حادة", description: "تعامل غير مناسب.", default_points: 25, type: "deduction", severity: "high", role_scope: "all", requires_approval: true, evidence_required: true, allowed_approver_roles: BM_GM, repeat_policy: "none", active: true },
  { code: "APP_CUST_PRAISE", category: "المظهر والسلوك داخل الفرع", title: "إشادة عميل باسم الموظف", description: "تغذية راجعة إيجابية.", default_points: 15, type: "bonus", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "APP_HARD_CUST", category: "المظهر والسلوك داخل الفرع", title: "تعامل ممتاز مع عميل صعب", description: "صبر واحتراف مع عميل صعب.", default_points: 15, type: "bonus", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },

  /* 3 — خدمة العملاء داخل الفرع */
  { code: "CS_DELAY_60S", category: "خدمة العملاء داخل الفرع", title: "تأخير بدء الخدمة أكثر من 60 ثانية بدون سبب", description: "بطء في بدء الخدمة.", default_points: 10, type: "deduction", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "CS_GREET_END", category: "خدمة العملاء داخل الفرع", title: "عدم الترحيب أو إنهاء التعامل بشكل لائق", description: "سوء استقبال أو ختام.", default_points: 5, type: "deduction", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "CS_MISUNDERSTAND", category: "خدمة العملاء داخل الفرع", title: "عدم فهم طلب العميل بدقة", description: "سوء فهم للطلب.", default_points: 10, type: "deduction", severity: "medium", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "CS_INTERRUPT", category: "خدمة العملاء داخل الفرع", title: "مقاطعة العميل أو عدم الاستماع الجيد", description: "عدم إنصات.", default_points: 10, type: "deduction", severity: "medium", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "CS_DOSE_EXPLAIN", category: "خدمة العملاء داخل الفرع", title: "عدم شرح الجرعة عند الحاجة", description: "ترك الجرعة دون شرح.", default_points: 25, type: "deduction", severity: "high", role_scope: "doctor", requires_approval: true, evidence_required: true, allowed_approver_roles: QM, repeat_policy: "none", active: true },
  { code: "CS_WARN_IMPORTANT", category: "خدمة العملاء داخل الفرع", title: "عدم تنبيه العميل لتعليمات مهمة", description: "عدم تحذير من تعليمات حرجة.", default_points: 30, type: "deduction", severity: "high", role_scope: "doctor", requires_approval: true, evidence_required: true, allowed_approver_roles: QM, repeat_policy: "none", active: true },
  { code: "CS_NO_ALT_STOCK", category: "خدمة العملاء داخل الفرع", title: "عدم عرض بديل مناسب عند نقص الصنف", description: "لم يعرض بديلًا مناسبًا.", default_points: 10, type: "deduction", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "CS_NO_DELIVERY_OFFER", category: "خدمة العملاء داخل الفرع", title: "عدم عرض خدمة التوصيل عند الحاجة", description: "تجاهل عرض التوصيل.", default_points: 5, type: "deduction", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "CS_NO_NEW_CODE", category: "خدمة العملاء داخل الفرع", title: "عدم تكويد عميل جديد", description: "عميل جديد دون تكويد.", default_points: 20, type: "deduction", severity: "medium", role_scope: "all", requires_approval: true, evidence_required: true, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "CS_WRONG_PHONE", category: "خدمة العملاء داخل الفرع", title: "تسجيل رقم هاتف خاطئ أو ناقص", description: "خطأ في رقم الهاتف.", default_points: 15, type: "deduction", severity: "medium", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "CS_NO_LINK_INV", category: "خدمة العملاء داخل الفرع", title: "عدم ربط الفاتورة بالعميل رغم توفر بياناته", description: "فاتورة غير مربوطة.", default_points: 15, type: "deduction", severity: "medium", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "CS_NEW_FULL", category: "خدمة العملاء داخل الفرع", title: "تكويد عميل جديد كامل البيانات", description: "بيانات كاملة للعميل الجديد.", default_points: 5, type: "bonus", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "CS_FIX_OLD", category: "خدمة العملاء داخل الفرع", title: "تصحيح بيانات عميل قديم", description: "تحسين جودة البيانات.", default_points: 5, type: "bonus", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "CS_WIN_BACK", category: "خدمة العملاء داخل الفرع", title: "استرجاع عميل متوقف", description: "إعادة عميل خامد.", default_points: 20, type: "bonus", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "CS_VIP_SVC", category: "خدمة العملاء داخل الفرع", title: "خدمة عميل VIP باحتراف", description: "خدمة متميزة لـ VIP.", default_points: 15, type: "bonus", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },

  /* 4 — واتساب والهاتف */
  { code: "WA_DELAY_5", category: "واتساب والهاتف", title: "تأخير الرد أكثر من 5 دقائق", description: "بطء أول رد.", default_points: 5, type: "deduction", severity: "low", role_scope: "customer_service", requires_approval: false, evidence_required: false, allowed_approver_roles: CSM, repeat_policy: "none", active: true },
  { code: "WA_DELAY_15", category: "واتساب والهاتف", title: "تأخير الرد أكثر من 15 دقيقة", description: "تأخير متوسط في الرد.", default_points: 15, type: "deduction", severity: "medium", role_scope: "customer_service", requires_approval: false, evidence_required: false, allowed_approver_roles: CSM, repeat_policy: "none", active: true },
  { code: "WA_IGNORE", category: "واتساب والهاتف", title: "تجاهل مكالمة أو رسالة بدون سبب", description: "عدم الرد بدون عذر.", default_points: 10, type: "deduction", severity: "medium", role_scope: "customer_service", requires_approval: true, evidence_required: true, allowed_approver_roles: CSM, repeat_policy: "none", active: true },
  { code: "WA_UNPRO_MSG", category: "واتساب والهاتف", title: "رسالة غير واضحة أو غير مهنية", description: "صياغة ضعيفة.", default_points: 10, type: "deduction", severity: "low", role_scope: "customer_service", requires_approval: false, evidence_required: false, allowed_approver_roles: CSM, repeat_policy: "none", active: true },
  { code: "WA_NO_ADDR_CONFIRM", category: "واتساب والهاتف", title: "عدم تأكيد العنوان أو رقم الهاتف", description: "تجاهل التأكيد.", default_points: 15, type: "deduction", severity: "medium", role_scope: "customer_service", requires_approval: false, evidence_required: false, allowed_approver_roles: CSM, repeat_policy: "none", active: true },
  { code: "WA_NO_ITEMS_CONFIRM", category: "واتساب والهاتف", title: "عدم تأكيد الأصناف والتركيز", description: "لم يؤكد الأصناف.", default_points: 15, type: "deduction", severity: "medium", role_scope: "customer_service", requires_approval: false, evidence_required: false, allowed_approver_roles: CSM, repeat_policy: "none", active: true },
  { code: "WA_NO_PRICE_TIME", category: "واتساب والهاتف", title: "عدم توضيح السعر أو وقت التوصيل", description: "معلومات ناقصة.", default_points: 10, type: "deduction", severity: "low", role_scope: "customer_service", requires_approval: false, evidence_required: false, allowed_approver_roles: CSM, repeat_policy: "none", active: true },
  { code: "WA_NO_OUTCOME", category: "واتساب والهاتف", title: "عدم تسجيل نتيجة المحادثة", description: "لم تُسجل النتيجة.", default_points: 5, type: "deduction", severity: "low", role_scope: "customer_service", requires_approval: false, evidence_required: false, allowed_approver_roles: CSM, repeat_policy: "none", active: true },
  { code: "WA_ORDER_CONV", category: "واتساب والهاتف", title: "تحويل محادثة إلى أوردر ناجح", description: "إغلاق ببيع.", default_points: 10, type: "bonus", severity: "low", role_scope: "customer_service", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "WA_WIN_BACK", category: "واتساب والهاتف", title: "استرجاع عميل عبر واتساب", description: "عميل متوقف عاد.", default_points: 20, type: "bonus", severity: "low", role_scope: "customer_service", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "WA_SCORE_GT90", category: "واتساب والهاتف", title: "تقييم محادثة أعلى من 90%", description: "أداء تقييم مرتفع.", default_points: 10, type: "bonus", severity: "low", role_scope: "customer_service", requires_approval: false, evidence_required: false, allowed_approver_roles: CSM, repeat_policy: "none", active: true },
  { code: "WA_SOLVE_NO_ESC", category: "واتساب والهاتف", title: "حل مشكلة عميل عبر واتساب بدون تصعيد", description: "حل محلي ناجح.", default_points: 10, type: "bonus", severity: "low", role_scope: "customer_service", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },

  /* 5 — دقة الفواتير والأوردرات */
  { code: "INV_PREP_SMALL", category: "دقة الفواتير والأوردرات", title: "خطأ بسيط في تجهيز فاتورة", description: "خطأ تحضير بسيط.", default_points: 20, type: "deduction", severity: "medium", role_scope: "all", requires_approval: true, evidence_required: true, allowed_approver_roles: BM, repeat_policy: "double_per_cycle", active: true, max_points_cap: 160 },
  { code: "INV_ITEM_WRONG", category: "دقة الفواتير والأوردرات", title: "خطأ في صنف", description: "صنف خاطئ.", default_points: 30, type: "deduction", severity: "high", role_scope: "all", requires_approval: true, evidence_required: true, allowed_approver_roles: BM_GM, repeat_policy: "double_per_cycle", active: true, max_points_cap: 160 },
  { code: "INV_STRENGTH_FORM", category: "دقة الفواتير والأوردرات", title: "خطأ في تركيز الدواء أو الشكل الدوائي", description: "خطأ دوائي محتمل.", default_points: 50, type: "deduction", severity: "critical", role_scope: "doctor", requires_approval: true, evidence_required: true, allowed_approver_roles: QM, repeat_policy: "double_per_cycle", active: true, max_points_cap: 160 },
  { code: "INV_DOSE_INSTR", category: "دقة الفواتير والأوردرات", title: "خطأ في الجرعة أو التعليمات", description: "خطأ جرعة/تعليمات.", default_points: 60, type: "deduction", severity: "critical", role_scope: "doctor", requires_approval: true, evidence_required: true, allowed_approver_roles: QM, repeat_policy: "double_per_cycle", active: true, max_points_cap: 160 },
  { code: "INV_FORGOT_LINE", category: "دقة الفواتير والأوردرات", title: "نسيان صنف من الأوردر", description: "سطر منسى.", default_points: 25, type: "deduction", severity: "medium", role_scope: "all", requires_approval: true, evidence_required: true, allowed_approver_roles: BM, repeat_policy: "double_per_cycle", active: true, max_points_cap: 160 },
  { code: "INV_INCOMPLETE_ORD", category: "دقة الفواتير والأوردرات", title: "تسليم أوردر غير مكتمل", description: "أوردر ناقص.", default_points: 30, type: "deduction", severity: "high", role_scope: "all", requires_approval: true, evidence_required: true, allowed_approver_roles: BM_GM, repeat_policy: "double_per_cycle", active: true, max_points_cap: 160 },
  { code: "INV_NO_REVIEW", category: "دقة الفواتير والأوردرات", title: "عدم مراجعة الفاتورة قبل التسليم", description: "لم يراجع قبل التسليم.", default_points: 15, type: "deduction", severity: "medium", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "INV_WRONG_CUST_ADDR", category: "دقة الفواتير والأوردرات", title: "تسليم أوردر لعميل خطأ أو عنوان خطأ", description: "خطأ في العميل أو العنوان.", default_points: 60, type: "deduction", severity: "critical", role_scope: "all", requires_approval: true, evidence_required: true, allowed_approver_roles: BM_GM, repeat_policy: "double_per_cycle", active: true, max_points_cap: 160 },
  { code: "INV_PAY_WRONG", category: "دقة الفواتير والأوردرات", title: "خطأ في التحصيل أو طريقة الدفع", description: "خطأ تحصيل.", default_points: 20, type: "deduction", severity: "medium", role_scope: "all", requires_approval: true, evidence_required: true, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "INV_CATCH_PRE_OUT", category: "دقة الفواتير والأوردرات", title: "اكتشاف خطأ قبل خروج الأوردر", description: "منع خطأ قبل الخروج.", default_points: 10, type: "bonus", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "INV_LARGE_CLEAN", category: "دقة الفواتير والأوردرات", title: "تجهيز أوردر كبير بدون أخطاء", description: "أوردر معقد نظيف.", default_points: 10, type: "bonus", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "INV_PEER_SAVE", category: "دقة الفواتير والأوردرات", title: "مراجعة فاتورة زميل ومنع خطأ مؤثر", description: "منع خطأ زميل.", default_points: 10, type: "bonus", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },

  /* 6 — المبيعات المسؤولة */
  { code: "SALES_NO_ALT", category: "المبيعات المسؤولة وتحسين قيمة الفاتورة", title: "عدم عرض بديل مناسب عند نقص صنف مطلوب", description: "لم يعرض بديلاً.", default_points: 10, type: "deduction", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "SALES_IGNORE_SUPP", category: "المبيعات المسؤولة وتحسين قيمة الفاتورة", title: "تجاهل ترشيح منتج مكمل واضح الفائدة", description: "فرصة مكمل مهمة.", default_points: 5, type: "deduction", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "SALES_BAD_REC", category: "المبيعات المسؤولة وتحسين قيمة الفاتورة", title: "ترشيح منتج غير مناسب", description: "ترشيح غير ملائم.", default_points: 25, type: "deduction", severity: "high", role_scope: "doctor", requires_approval: true, evidence_required: true, allowed_approver_roles: QM, repeat_policy: "none", active: true },
  { code: "SALES_PRESSURE", category: "المبيعات المسؤولة وتحسين قيمة الفاتورة", title: "الضغط على العميل لشراء غير ضروري", description: "ضغط بيع غير أخلاقي.", default_points: 30, type: "deduction", severity: "high", role_scope: "all", requires_approval: true, evidence_required: true, allowed_approver_roles: BM_GM, repeat_policy: "none", active: true },
  { code: "SALES_WRONG_ITEM_COND", category: "المبيعات المسؤولة وتحسين قيمة الفاتورة", title: "بيع صنف غير مناسب لحالة العميل", description: "صنف لا يصلح للحالة.", default_points: 40, type: "deduction", severity: "critical", role_scope: "doctor", requires_approval: true, evidence_required: true, allowed_approver_roles: QM, repeat_policy: "none", active: true },
  { code: "SALES_UPSET_UPSELL", category: "المبيعات المسؤولة وتحسين قيمة الفاتورة", title: "زيادة قيمة الفاتورة مع شكوى أو عدم رضا", description: "Upsell مع شكوى.", default_points: 20, type: "deduction", severity: "high", role_scope: "all", requires_approval: true, evidence_required: true, allowed_approver_roles: BM_GM, repeat_policy: "none", active: true },
  { code: "SALES_ALT_SAVE", category: "المبيعات المسؤولة وتحسين قيمة الفاتورة", title: "ترشيح بديل مناسب وأنقذ البيع", description: "بديل أنقذ الطلب.", default_points: 10, type: "bonus", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "SALES_UP_VALUE_OK", category: "المبيعات المسؤولة وتحسين قيمة الفاتورة", title: "رفع قيمة الفاتورة بشكل مناسب مع رضا العميل", description: "زيادة قيمة أخلاقية.", default_points: 10, type: "bonus", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "SALES_MORE_LINES", category: "المبيعات المسؤولة وتحسين قيمة الفاتورة", title: "زيادة عدد الأصناف في الفاتورة بشكل منطقي وبدون شكوى", description: "توسيع سلّة منطقي.", default_points: 10, type: "bonus", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "SALES_STRONG_SVC", category: "المبيعات المسؤولة وتحسين قيمة الفاتورة", title: "تحقيق مبيعات قوية مع تقييم خدمة ممتاز", description: "دمج بيع وخدمة.", default_points: 20, type: "bonus", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },

  /* 7 — المخزون */
  { code: "STOCK_NO_SHORT_LOG", category: "المخزون والنواقص", title: "عدم تسجيل نواقص متكررة الطلب", description: "لم يُسجل نقصًا متكررًا.", default_points: 15, type: "deduction", severity: "medium", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "STOCK_IGNORE_NEAR_EXP", category: "المخزون والنواقص", title: "تجاهل صنف قريب الانتهاء", description: "إهمال صلاحية.", default_points: 40, type: "deduction", severity: "high", role_scope: "all", requires_approval: true, evidence_required: true, allowed_approver_roles: BM_GM, repeat_policy: "none", active: true },
  { code: "STOCK_WRONG_ISSUE", category: "المخزون والنواقص", title: "صرف صنف خطأ من المخزون", description: "صرف خاطئ.", default_points: 30, type: "deduction", severity: "high", role_scope: "all", requires_approval: true, evidence_required: true, allowed_approver_roles: BM_GM, repeat_policy: "none", active: true },
  { code: "STOCK_MESSY_SHELVE", category: "المخزون والنواقص", title: "عدم ترتيب الأدوية بشكل صحيح", description: "فوضى رفوف.", default_points: 10, type: "deduction", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "STOCK_BAD_WH_REQ", category: "المخزون والنواقص", title: "طلب ناقص أو غير واضح من المخزن الرئيسي", description: "طلب مخزن سيء.", default_points: 10, type: "deduction", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "STOCK_RECV_NO_CHK", category: "المخزون والنواقص", title: "استلام من المخزن بدون مراجعة", description: "استلام أعمى.", default_points: 20, type: "deduction", severity: "medium", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "STOCK_RECV_GAP", category: "المخزون والنواقص", title: "فرق استلام بسبب عدم المراجعة", description: "فرق بعد الاستلام.", default_points: 30, type: "deduction", severity: "high", role_scope: "all", requires_approval: true, evidence_required: true, allowed_approver_roles: BM_GM, repeat_policy: "none", active: true },
  { code: "STOCK_EARLY_ALERT", category: "المخزون والنواقص", title: "الإبلاغ المبكر عن نقص صنف مهم", description: "تنبيه استباقي.", default_points: 10, type: "bonus", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "STOCK_SOLVE_SHORT", category: "المخزون والنواقص", title: "حل مشكلة نقص صنف مطلوب", description: "تغطية نقص.", default_points: 10, type: "bonus", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "STOCK_NEAR_EXP_CATCH", category: "المخزون والنواقص", title: "اكتشاف صنف قريب الانتهاء قبل حدوث خسارة", description: "منع هدر.", default_points: 15, type: "bonus", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },

  /* 8 — الفريق والمناديب */
  { code: "TEAM_CONFLICT", category: "الفريق والمناديب", title: "خلاف متكرر أو تعطيل زميل", description: "تعطيل الفريق.", default_points: 20, type: "deduction", severity: "medium", role_scope: "all", requires_approval: true, evidence_required: true, allowed_approver_roles: BM_GM, repeat_policy: "none", active: true },
  { code: "TEAM_NO_HANDOFF", category: "الفريق والمناديب", title: "عدم تسليم مشكلة مهمة للشيفت التالي", description: "Hand-off ضعيف.", default_points: 20, type: "deduction", severity: "medium", role_scope: "all", requires_approval: true, evidence_required: true, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "TEAM_NO_COOP_PRESSURE", category: "الفريق والمناديب", title: "عدم التعاون وقت الضغط", description: "رفض مساندة.", default_points: 15, type: "deduction", severity: "medium", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "TEAM_REP_RUDE", category: "الفريق والمناديب", title: "تعامل غير لائق مع مندوب", description: "سوء مع مندوب.", default_points: 10, type: "deduction", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "TEAM_REP_NO_CHK", category: "الفريق والمناديب", title: "استلام من مندوب بدون مراجعة", description: "استلام دون فحص.", default_points: 20, type: "deduction", severity: "medium", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "TEAM_WRONG_ITEM_ACCEPT", category: "الفريق والمناديب", title: "قبول صنف غير مطلوب بدون موافقة", description: "قبول خطأ.", default_points: 25, type: "deduction", severity: "medium", role_scope: "all", requires_approval: true, evidence_required: true, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "TEAM_HELP_PRESSURE", category: "الفريق والمناديب", title: "مساعدة زميل وقت ضغط", description: "تعاون تحت الضغط.", default_points: 10, type: "bonus", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "TEAM_TRAIN_NEW", category: "الفريق والمناديب", title: "تدريب موظف جديد", description: "توجيه زميل جديد.", default_points: 10, type: "bonus", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "TEAM_RESOLVE_INT", category: "الفريق والمناديب", title: "حل مشكلة بين الفريق بدون تصعيد", description: "احتواء داخلي.", default_points: 10, type: "bonus", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },

  /* 9 — السيستم */
  { code: "SYS_WRONG_ACCOUNT", category: "استخدام السيستم", title: "استخدام حساب شخص آخر", description: "دخول بحساب غيره.", default_points: 40, type: "deduction", severity: "critical", role_scope: "all", requires_approval: true, evidence_required: true, allowed_approver_roles: GM, repeat_policy: "none", active: true },
  { code: "SYS_LEAVE_OPEN", category: "استخدام السيستم", title: "ترك الحساب مفتوحًا لشخص آخر", description: "جلسة مفتوحة.", default_points: 30, type: "deduction", severity: "high", role_scope: "all", requires_approval: true, evidence_required: true, allowed_approver_roles: BM_GM, repeat_policy: "none", active: true },
  { code: "SYS_SHARE_PASS", category: "استخدام السيستم", title: "مشاركة كلمة المرور", description: "مخالفة أمنية.", default_points: 50, type: "deduction", severity: "critical", role_scope: "all", requires_approval: true, evidence_required: true, allowed_approver_roles: GM, repeat_policy: "none", active: true },
  { code: "SYS_WRONG_USER_ACTION", category: "استخدام السيستم", title: "تنفيذ عملية بدون مستخدم صحيح", description: "عمليات تحت مستخدم خاطئ.", default_points: 25, type: "deduction", severity: "high", role_scope: "all", requires_approval: true, evidence_required: true, allowed_approver_roles: BM_GM, repeat_policy: "none", active: true },
  { code: "SYS_NO_FOLLOW_LOG", category: "استخدام السيستم", title: "عدم تسجيل متابعة عميل", description: "متابعة غير مسجلة.", default_points: 10, type: "deduction", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "SYS_NO_COMPLAINT_LOG", category: "استخدام السيستم", title: "عدم تسجيل شكوى أو ملاحظة مهمة", description: "شكوى غير مسجلة.", default_points: 15, type: "deduction", severity: "medium", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "SYS_NO_CUST_UPDATE", category: "استخدام السيستم", title: "عدم تحديث بيانات عميل مهم", description: "بيانات قديمة.", default_points: 10, type: "deduction", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "SYS_DATA_QUALITY", category: "استخدام السيستم", title: "تحسين جودة بيانات العملاء", description: "تصحيح بيانات جماعية.", default_points: 10, type: "bonus", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "SYS_MGMT_NOTE", category: "استخدام السيستم", title: "تسجيل ملاحظات مفيدة للإدارة", description: "ملاحظة تشغيلية قيمة.", default_points: 5, type: "bonus", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },

  /* 10 — الشكاوى والتطوير */
  { code: "CMP_STYLE_PROVEN", category: "الشكاوى والتطوير", title: "شكوى مثبتة بسبب أسلوب", description: "شكوى أسلوب.", default_points: 40, type: "deduction", severity: "high", role_scope: "all", requires_approval: true, evidence_required: true, allowed_approver_roles: CSM, repeat_policy: "double_per_cycle", active: true, max_points_cap: 160 },
  { code: "CMP_ORDER_ERR", category: "الشكاوى والتطوير", title: "شكوى بسبب خطأ أوردر", description: "شكوى تشغيل.", default_points: 30, type: "deduction", severity: "high", role_scope: "all", requires_approval: true, evidence_required: true, allowed_approver_roles: BM_GM, repeat_policy: "double_per_cycle", active: true, max_points_cap: 160 },
  { code: "CMP_BAD_HANDLE", category: "الشكاوى والتطوير", title: "سوء إدارة شكوى", description: "إدارة شكوى ضعيفة.", default_points: 25, type: "deduction", severity: "medium", role_scope: "all", requires_approval: true, evidence_required: true, allowed_approver_roles: CSM, repeat_policy: "none", active: true },
  { code: "CMP_REPEAT_AFTER_WARN", category: "الشكاوى والتطوير", title: "تكرار نفس الخطأ بعد تنبيه", description: "إعادة خطأ بعد تنبيه.", default_points: 40, type: "deduction", severity: "critical", role_scope: "all", requires_approval: true, evidence_required: true, allowed_approver_roles: BM_GM, repeat_policy: "double_per_cycle", active: true, max_points_cap: 160 },
  { code: "DEV_REJECT_TRAIN", category: "الشكاوى والتطوير", title: "رفض تعليمات أو تدريب", description: "رفض تطوير.", default_points: 20, type: "deduction", severity: "medium", role_scope: "all", requires_approval: true, evidence_required: true, allowed_approver_roles: BM_GM, repeat_policy: "none", active: true },
  { code: "DEV_NO_PLAN", category: "الشكاوى والتطوير", title: "عدم تنفيذ خطة تحسين", description: "خطة تحسين متوقفة.", default_points: 20, type: "deduction", severity: "medium", role_scope: "all", requires_approval: true, evidence_required: true, allowed_approver_roles: BM_GM, repeat_policy: "none", active: true },
  { code: "CMP_HARD_SOLVE", category: "الشكاوى والتطوير", title: "حل شكوى صعبة", description: "إغلاق شكوى معقدة.", default_points: 15, type: "bonus", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "DEV_IMPROVE_MONTH", category: "الشكاوى والتطوير", title: "تحسن واضح عن الشهر السابق", description: "تحسن أداء ملحوظ.", default_points: 20, type: "bonus", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM_GM, repeat_policy: "none", active: true },
  { code: "DEV_PLAN_OK", category: "الشكاوى والتطوير", title: "تنفيذ خطة تحسين بنجاح", description: "إنجاز خطة.", default_points: 15, type: "bonus", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM_GM, repeat_policy: "none", active: true },
  { code: "DEV_NO_CMP_HIGH_TOUCH", category: "الشكاوى والتطوير", title: "عدم وجود شكاوى طوال الدورة مع تعامل مباشر عالي", description: "أداء نظيف مع خدمة مكثفة.", default_points: 20, type: "bonus", severity: "low", role_scope: "all", requires_approval: true, evidence_required: false, allowed_approver_roles: BM_GM, repeat_policy: "none", active: true },

  /* 11 — الدليفري */
  { code: "DEL_LATE_UNFAIR", category: "الدليفري", title: "تأخير غير مبرر في التسليم", description: "تأخير توصيل.", default_points: 15, type: "deduction", severity: "medium", role_scope: "delivery", requires_approval: true, evidence_required: true, allowed_approver_roles: DEL, repeat_policy: "none", active: true },
  { code: "DEL_ADDR_WRONG", category: "الدليفري", title: "خطأ في العنوان أو التسليم", description: "عنوان/تسليم خاطئ.", default_points: 30, type: "deduction", severity: "high", role_scope: "delivery", requires_approval: true, evidence_required: true, allowed_approver_roles: DEL, repeat_policy: "none", active: true },
  { code: "DEL_PAY_WRONG", category: "الدليفري", title: "خطأ في التحصيل", description: "تحصيل خاطئ.", default_points: 40, type: "deduction", severity: "critical", role_scope: "delivery", requires_approval: true, evidence_required: true, allowed_approver_roles: DEL, repeat_policy: "none", active: true },
  { code: "DEL_RUDE", category: "الدليفري", title: "أسلوب غير لائق مع العميل", description: "سوء تعامل مع عميل.", default_points: 30, type: "deduction", severity: "high", role_scope: "delivery", requires_approval: true, evidence_required: true, allowed_approver_roles: DEL, repeat_policy: "none", active: true },
  { code: "DEL_STATUS_UPDATE", category: "الدليفري", title: "عدم تحديث حالة التوصيل أو تسليم الفاتورة", description: "حالة غير محدثة.", default_points: 10, type: "deduction", severity: "low", role_scope: "delivery", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "DEL_APPEARANCE", category: "الدليفري", title: "عدم الالتزام بالمظهر أو التعامل اللائق", description: "مظهر/سلوك.", default_points: 10, type: "deduction", severity: "low", role_scope: "delivery", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "DEL_FAST_IMPORTANT", category: "الدليفري", title: "توصيل أوردر مهم بسرعة وبدون مشكلة", description: "توصيل ممتاز.", default_points: 10, type: "bonus", severity: "low", role_scope: "delivery", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "DEL_CUST_TOP_RATE", category: "الدليفري", title: "تقييم عميل ممتاز للدليفري", description: "تقييم خارجي ممتاز.", default_points: 10, type: "bonus", severity: "low", role_scope: "delivery", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "DEL_NO_CMP_GOOD_VOL", category: "الدليفري", title: "عدم وجود شكاوى طوال الدورة مع عدد توصيلات جيد", description: "أداء توصيل مستقر.", default_points: 20, type: "bonus", severity: "low", role_scope: "delivery", requires_approval: true, evidence_required: false, allowed_approver_roles: DEL, repeat_policy: "none", active: true },

  /* 12 — النظافة */
  { code: "CLN_SCHEDULE", category: "النظافة والتنظيم", title: "عدم الالتزام بجدول النظافة", description: "جدول نظافة متخطى.", default_points: 15, type: "deduction", severity: "medium", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "CLN_SENS_AREA", category: "النظافة والتنظيم", title: "إهمال منطقة حساسة مثل الثلاجات أو الرفوف", description: "مناطق حساسة مهملة.", default_points: 20, type: "deduction", severity: "medium", role_scope: "all", requires_approval: true, evidence_required: true, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "CLN_WORKSPACE", category: "النظافة والتنظيم", title: "عدم ترتيب منطقة العمل", description: "فوضى منطقة عمل.", default_points: 10, type: "deduction", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
  { code: "CLN_EXCELLENT", category: "النظافة والتنظيم", title: "نظافة ممتازة مثبتة بمراجعة المدير", description: "تقدير نظافة.", default_points: 10, type: "bonus", severity: "low", role_scope: "all", requires_approval: false, evidence_required: false, allowed_approver_roles: BM, repeat_policy: "none", active: true },
];

const ROLE_MAP: Record<RoleScope, string[]> = {
  doctor: ["صيدلاني"],
  assistant: ["مساعد"],
  delivery: ["توصيل"],
  cleaning: ["مساعد", "صيدلاني"],
  customer_service: ["خدمة عملاء"],
  manager: ["مدير فرع", "أدمن"],
  all: [],
};

export function ruleAppliesToStaff(scope: RoleScope, staffRole: string): boolean {
  if (scope === "all") return true;
  return ROLE_MAP[scope]?.includes(staffRole) ?? false;
}

export function rulesForStaffRole(staffRole: string): EvaluationRuleDef[] {
  return FULL_EVALUATION_RULES.filter((r) => ruleAppliesToStaff(r.role_scope, staffRole));
}

export function mergeRulesFromSupabase(rows: Record<string, unknown>[] | null): EvaluationRuleDef[] {
  if (!rows?.length) return FULL_EVALUATION_RULES;
  const merged = new Map(FULL_EVALUATION_RULES.map((r) => [r.code, { ...r }]));
  for (const row of rows) {
    const code = String(row.code ?? "");
    if (!code || !merged.has(code)) continue;
    const base = merged.get(code)!;
    merged.set(code, {
      ...base,
      default_points: Number(row.default_points ?? base.default_points),
      requires_approval: Boolean(row.requires_approval ?? base.requires_approval),
      evidence_required: Boolean(row.evidence_required ?? base.evidence_required),
      active: row.active !== false,
    });
  }
  return [...merged.values()].filter((r) => r.active);
}
