import type { IncentiveRuleDefinition } from "@/lib/incentives/incentiveRulesEngine";

function rule(
  rule_code: string,
  title_ar: string,
  category: string,
  points_delta: number,
  options: Partial<IncentiveRuleDefinition> = {},
): IncentiveRuleDefinition {
  const isReward = points_delta > 0;
  const isWarning = points_delta === 0;
  return {
    rule_code,
    title_ar,
    description_ar: options.description_ar || title_ar,
    role_scope: options.role_scope || "all",
    category,
    impact_type: options.impact_type || (isWarning ? "warning_only" : isReward ? "monthly_exceptional_reward" : "monthly_points_deduction"),
    points_delta,
    money_delta: options.money_delta || 0,
    approval_required: options.approval_required ?? Math.abs(points_delta) >= 30,
    severity: options.severity || (Math.abs(points_delta) >= 50 ? "critical" : Math.abs(points_delta) >= 30 ? "high" : Math.abs(points_delta) >= 15 ? "medium" : "low"),
    repeat_policy: options.repeat_policy || (points_delta < 0 ? "linear_multiplier" : "none"),
    visible_to_staff: options.visible_to_staff ?? true,
    included_in_pdf: options.included_in_pdf ?? true,
    source_module: options.source_module || "manual_review",
    active: options.active ?? true,
  };
}

export const MONTHLY_DEDUCTION_RULES: IncentiveRuleDefinition[] = [
  rule("DISC-001", "التأخير حتى 20 دقيقة", "الحضور والانضباط", 0, { impact_type: "warning_only" }),
  rule("DISC-002", "التأخير أكثر من 20 دقيقة وحتى 30 دقيقة", "الحضور والانضباط", -10),
  rule("DISC-003", "التأخير من 30 إلى 60 دقيقة", "الحضور والانضباط", -20),
  rule("DISC-004", "التأخير أكثر من ساعة", "الحضور والانضباط", -30, { approval_required: true }),
  rule("DISC-005", "تكرار التأخير أكثر من مرتين في نفس الدورة", "الحضور والانضباط", -30, { approval_required: true }),
  rule("DISC-006", "غياب بدون إذن", "الحضور والانضباط", -80, { approval_required: true, repeat_policy: "manager_review_only" }),
  rule("DISC-007", "الخروج من الشيفت بدون تنسيق", "الحضور والانضباط", -30),
  rule("DISC-008", "عدم الالتزام بالزي أو الشكل العام", "الحضور والانضباط", -10),
  rule("DISC-009", "استخدام الهاتف الشخصي بشكل يؤثر على العمل", "الحضور والانضباط", -10),
  rule("DISC-010", "استخدام الهاتف أثناء وجود عميل بدون ضرورة", "الحضور والانضباط", -15),
  rule("DISC-011", "إهمال نظافة أو ترتيب مكان العمل", "الحضور والانضباط", -10),
  rule("DISC-012", "عدم تسليم الشيفت بشكل واضح", "الحضور والانضباط", -10),
  rule("DISC-013", "ترك مهمة شيفت بدون تنفيذ", "الحضور والانضباط", -15),
  rule("DISC-014", "تكرار عدم تنفيذ مهام الشيفت", "الحضور والانضباط", -30),
  rule("DISC-015", "تعطيل سير العمل بسبب عدم الالتزام", "الحضور والانضباط", -20),
  rule("DISC-016", "رفض تعليمات مسؤول الشيفت بدون سبب مقبول", "الحضور والانضباط", -20),
  rule("DISC-017", "عدم إبلاغ مسؤول الشيفت بمشكلة مؤثرة", "الحضور والانضباط", -15),

  rule("CUST-001", "أسلوب غير مناسب مع العميل", "التعامل مع العملاء", -20),
  rule("CUST-002", "شكوى مؤكدة من العميل بسبب الدكتور", "التعامل مع العملاء", -30, { approval_required: true }),
  rule("CUST-003", "شكوى شديدة من عميل مهم جدًا", "التعامل مع العملاء", -50, { approval_required: true, repeat_policy: "manager_review_only" }),
  rule("CUST-004", "التعامل ببرود أو عدم اهتمام مع عميل مهم جدًا", "التعامل مع العملاء", -20),
  rule("CUST-012", "عدم تصعيد شكوى تستحق مدير", "التعامل مع العملاء", -20),
  rule("CUST-018", "فقد عميل مهم بسبب إهمال مثبت", "التعامل مع العملاء", -50, { approval_required: true, repeat_policy: "manager_review_only" }),
  rule("CUST-021", "اقتراح بديل لعميل مسجل أنه لا يحب البدائل", "التعامل مع العملاء", -15),
  rule("CUST-022", "إضافة توصيل لعميل مسجل أنه لا يضاف له توصيل", "التعامل مع العملاء", -15),
  rule("CUST-023", "عدم مراعاة أن العميل حساس للسعر", "التعامل مع العملاء", -10),

  rule("CLASS-001", "عدم تسجيل تصنيف العميل", "تصنيف العملاء والفواتير", -10, { source_module: "classification" }),
  rule("CLASS-002", "عدم تسجيل تصنيف الفاتورة", "تصنيف العملاء والفواتير", -10, { source_module: "classification" }),
  rule("CLASS-003", "عدم تسجيل تصنيف العميل وتصنيف الفاتورة معًا", "تصنيف العملاء والفواتير", -25, { source_module: "classification" }),
  rule("CLASS-004", "اختيار تصنيف عشوائي لا يعبر عن الحالة", "تصنيف العملاء والفواتير", -15, { source_module: "classification" }),
  rule("CLASS-005", "تكرار التصنيف العشوائي خلال الدورة", "تصنيف العملاء والفواتير", -30, { approval_required: true, source_module: "classification" }),
  rule("CLASS-012", "إدخال تصنيف مخالف للحقيقة لتحسين الشكل فقط", "تصنيف العملاء والفواتير", -30, { approval_required: true, source_module: "classification" }),
  rule("CLASS-013", "تكرار إهمال التصنيف في أكثر من 5 فواتير خلال الدورة", "تصنيف العملاء والفواتير", -40, { approval_required: true, source_module: "classification" }),
  rule("CLASS-019", "عدم ربط الفاتورة بالعميل الصحيح عند وجود بيانات واضحة", "تصنيف العملاء والفواتير", -20, { source_module: "invoice_quality" }),
  rule("CLASS-020", "إدخال بيانات تصنيف تؤدي لتضليل خدمة العملاء", "تصنيف العملاء والفواتير", -30, { approval_required: true, source_module: "classification" }),

  rule("SALE-002", "صرف صنف خطأ وتم تداركه بدون ضرر", "جودة البيع والصرف", -30, { approval_required: true }),
  rule("SALE-003", "صرف صنف خطأ تسبب في شكوى أو ضرر محتمل", "جودة البيع والصرف", -60, { approval_required: true, repeat_policy: "manager_review_only" }),
  rule("SALE-004", "صرف صنف خطأ لعميل مهم جدًا", "جودة البيع والصرف", -70, { approval_required: true, repeat_policy: "manager_review_only" }),
  rule("SALE-013", "تكرار أخطاء صرف الأصناف في نفس الدورة", "جودة البيع والصرف", -50, { approval_required: true }),

  rule("CHAT-001", "تأخير رد غير مبرر أكثر من 10 دقائق", "واتساب وجودة المحادثات", -5, { source_module: "conversation_reviews" }),
  rule("CHAT-004", "أسلوب غير مناسب في المحادثة", "واتساب وجودة المحادثات", -15, { source_module: "conversation_reviews" }),
  rule("CHAT-009", "تقييم محادثة أقل من 70/100", "واتساب وجودة المحادثات", -15, { source_module: "conversation_reviews" }),
  rule("CHAT-010", "تقييم محادثة أقل من 50/100", "واتساب وجودة المحادثات", -25, { source_module: "conversation_reviews" }),

  rule("STAG-001", "إهمال صنف راكد مخصص بدون سبب", "الرواكد", -10, { source_module: "stagnant" }),
  rule("STAG-006", "عدم تحقيق أي تقدم في صنف راكد بدون سبب", "الرواكد", -15, { source_module: "stagnant" }),
  rule("STAG-010", "تسبب الإهمال في تحول صنف إلى معجز", "الرواكد", 0, { impact_type: "warning_only", source_module: "stagnant" }),
  rule("LIST-001", "عدم متابعة أصناف اللستة المخصصة", "اللستة", -10, { source_module: "list_items" }),
  rule("LIST-002", "عدم تحقيق أي تقدم بدون سبب واضح", "اللستة", -15, { source_module: "list_items" }),
  rule("STOCK-001", "عدم تنفيذ جرد مكلف به", "المخزون والجرد", -15, { source_module: "inventory" }),
  rule("STOCK-005", "تجاهل فرق مخزون واضح", "المخزون والجرد", -30, { approval_required: true, source_module: "inventory" }),
  rule("DEL-001", "تسليم طلب ناقص للدليفري", "التوصيل", -10, { source_module: "delivery" }),
  rule("DEL-011", "عدم مراعاة ملاحظة توصيل خاصة بالعميل", "التوصيل", -15, { source_module: "delivery" }),
  rule("TEAM-002", "عدم احترام زميل", "الفريق", -20, { source_module: "team" }),
  rule("TEAM-008", "نقاش أو خلاف أمام العملاء", "الفريق", -20, { source_module: "team" }),
  rule("APP-001", "عدم تسجيل نتيجة متابعة مطلوبة", "استخدام التطبيق", -10, { source_module: "app_usage" }),
  rule("APP-005", "إغلاق مهمة بدون تنفيذ فعلي", "استخدام التطبيق", -25, { source_module: "app_usage" }),
  rule("APP-011", "تسجيل بيانات عشوائية لتجنب المتابعة", "استخدام التطبيق", -30, { approval_required: true, source_module: "app_usage" }),
];

export const MONTHLY_EXCEPTIONAL_REWARD_RULES: IncentiveRuleDefinition[] = [
  rule("REW-CUST-001", "حل شكوى عميل بنجاح", "مكافآت خدمة العملاء", 15),
  rule("REW-CUST-002", "حل شكوى عميل مهم جدًا", "مكافآت خدمة العملاء", 25, { approval_required: true }),
  rule("REW-CUST-003", "استرجاع عميل متوقف", "مكافآت خدمة العملاء", 20),
  rule("REW-CUST-004", "استرجاع عميل مهم جدًا", "مكافآت خدمة العملاء", 30, { approval_required: true }),
  rule("REW-CUST-011", "استكمال بيانات عميل مهم كان بدون بيانات", "مكافآت خدمة العملاء", 10),
  rule("REW-PRESS-003", "تغطية نقص مفاجئ في الفريق", "مكافآت الضغط والتشغيل", 20, { approval_required: true }),
  rule("REW-SALE-004", "تحقيق أفضل أداء بيعي يومي في الفرع", "مكافآت البيع", 15),
  rule("REW-SALE-007", "إنقاذ فاتورة كبيرة كانت معرضة للإلغاء", "مكافآت البيع", 15),
  rule("REW-STAG-001", "بيع صنف راكد مخصص", "مكافآت الرواكد", 5),
  rule("REW-STAG-003", "تحقيق هدف شهري للرواكد", "مكافآت الرواكد", 25, { approval_required: true }),
  rule("REW-LIST-001", "بيع صنف من اللستة المخصصة", "مكافآت اللستة", 5),
  rule("REW-LIST-003", "تحقيق هدف شهري للستة", "مكافآت اللستة", 25, { approval_required: true }),
  rule("REW-STOCK-004", "منع خسارة مخزون محتملة", "مكافآت المخزون", 20, { approval_required: true }),
];

export const QUARTERLY_RULES: IncentiveRuleDefinition[] = [
  rule("Q-STAG-001", "صنف راكد أصبح معجزًا بسبب إهمال المتابعة", "خصومات الربع", 0, { impact_type: "quarterly_money_deduction", money_delta: -150, approval_required: true }),
  rule("Q-STAG-002", "تجاهل خطة رواكد طوال الربع", "خصومات الربع", 0, { impact_type: "quarterly_money_deduction", money_delta: -200, approval_required: true }),
  rule("Q-LIST-001", "عدم تحقيق أي تقدم في اللستة بدون سبب", "خصومات الربع", 0, { impact_type: "quarterly_money_deduction", money_delta: -150, approval_required: true }),
  rule("Q-STOCK-003", "تجاهل فرق مخزون مؤثر", "خصومات الربع", 0, { impact_type: "quarterly_money_deduction", money_delta: -200, approval_required: true }),
  rule("Q-EXP-001", "صنف خرج إكسبير بسبب إهمال واضح", "خصومات الربع", 0, { impact_type: "quarterly_money_deduction", money_delta: -400, approval_required: true }),
  rule("Q-CUST-001", "فقد أكثر من عميل مهم بسبب إهمال متكرر", "خصومات الربع", 0, { impact_type: "quarterly_money_deduction", money_delta: -500, approval_required: true }),
  rule("Q-REW-STAG-BEST", "أفضل أداء رواكد", "مكافآت الربع", 0, { impact_type: "quarterly_money_reward", money_delta: 500, approval_required: true }),
  rule("Q-REW-LIST-BEST", "أفضل أداء لستة", "مكافآت الربع", 0, { impact_type: "quarterly_money_reward", money_delta: 500, approval_required: true }),
  rule("Q-REW-CUST-BEST", "أفضل تعامل مع العملاء", "مكافآت الربع", 0, { impact_type: "quarterly_money_reward", money_delta: 500, approval_required: true }),
];

export const ALL_INCENTIVE_RULES = [
  ...MONTHLY_DEDUCTION_RULES,
  ...MONTHLY_EXCEPTIONAL_REWARD_RULES,
  ...QUARTERLY_RULES,
];

export const STAFF_OPERATING_POLICY_SECTIONS = [
  {
    title: "التعامل مع العميل",
    items: [
      "ابدأ بتحية محترمة واسمع طلب العميل كاملًا.",
      "لا تضغط في البيع ولا تستعجل العميل.",
      "راجع علامات العميل قبل البدائل أو التوصيل أو شرح السعر.",
      "صعّد الشكاوى المهمة ولا تعد بخصم أو صنف أو موعد غير مؤكد.",
    ],
  },
  {
    title: "تصنيف العميل والفاتورة",
    items: [
      "سجل تصنيف العميل وتصنيف الفاتورة عند كل حالة مؤثرة.",
      "لا تستخدم تصنيفًا عشوائيًا لتحسين شكل التقرير.",
      "علّم الفواتير الناتجة من متابعة خدمة العملاء أو الرواكد أو اللستة.",
      "حدّث تصنيف العميل عند تغير سلوكه أو توقفه أو انخفاض مشترياته.",
    ],
  },
  {
    title: "الرواكد واللستة والمخزون",
    items: [
      "اعرف الأصناف المكلف بها وهدفها الأسبوعي والشهري.",
      "سجل بيع الرواكد واللستة بشكل صحيح مع العميل والفاتورة.",
      "نفذ الجرد المكلف به وبلّغ عن النواقص وقرب الإكسبير والتالف.",
    ],
  },
  {
    title: "استخدام التطبيق",
    items: [
      "راجع نقاطك وخصوماتك ومكافآتك باستمرار.",
      "سجل نتيجة المتابعات والمهام ولا تغلق مهمة بدون تنفيذ فعلي.",
      "استجب للتنبيهات المهمة واطلب متابعة خدمة عملاء عند الحاجة.",
    ],
  },
];
