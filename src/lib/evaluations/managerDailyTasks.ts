export type ManagerDailyRole = 'branch_manager' | 'branches_manager' | 'customer_service_manager';

export type ManagerTaskCadence = 'daily' | 'weekly' | 'monthly';

export type DailySubTask = {
  key: string;
  label: string;
  hint?: string;
  cadence?: ManagerTaskCadence;
};

export type DailyTaskGroup = {
  groupKey: string;
  groupLabel: string;
  groupHint?: string;
  subtasks: DailySubTask[];
};

/**
 * كل دور عنده مجموعة قليلة من المحاور الرئيسية، وكل محور جواه بنود دقيقة قابلة للتحديد
 * لوحدها. ده بيقلل عدد القرارات اللي المدير محتاج يتخذها وهو بيفتح الصفحة (يشوف 6-9 محاور
 * بس بدل 17-24 بند مفرود)، وفي نفس الوقت بيحافظ على نفس الدقة اللي كانت موجودة قبل كده —
 * كل بند فرعي لسه له مفتاحه المستقل في manager_daily_checklist.
 */
export const MANAGER_DAILY_TASK_GROUPS: Record<ManagerDailyRole, DailyTaskGroup[]> = {
  branch_manager: [
    {
      groupKey: 'cash_and_complaints',
      groupLabel: 'الضبط المالي والشكاوى',
      subtasks: [
        {
          key: 'cash_reconciliation',
          label: 'مطابقة الكاش والعهدة اليومية',
          hint: 'مطابقة كاش الدرج/الماكينة مع تقرير المبيعات — أهم ضبط مالي يومي.',
        },
        {
          key: 'complaints_escalation',
          label: 'مراجعة الشكاوى المتصاعدة ومتابعة حلها',
          hint: 'أي شكوى وصلتلك من خدمة العملاء أو مباشرة من عميل — لازم رد وحل موثّق.',
        },
      ],
    },
    {
      groupKey: 'purchases_and_supply',
      groupLabel: 'المشتريات والتوريد',
      subtasks: [
        { key: 'purchases_review', label: 'مراجعة فواتير المشتريات والموردين' },
        { key: 'purchase_orders_preparation', label: 'تحضير طلبيات الدواء والإكسسوار والمستلزمات' },
      ],
    },
    {
      groupKey: 'inventory_and_stock',
      groupLabel: 'الجرد والمخزون',
      subtasks: [
        { key: 'inventory_review', label: 'متابعة الجرد والنواقص' },
        { key: 'stock_shelf_refill', label: 'مراجعة الاستوكات وإعادة ملء الأرفف' },
        { key: 'stagnant_items_followup', label: 'متابعة الرواكد والتزام الدكاترة بصرفها' },
      ],
    },
    {
      groupKey: 'shortages_and_expiry',
      groupLabel: 'النواقص والإكسباير',
      subtasks: [
        { key: 'shortages_handling', label: 'التصرف السليم في النواقص ووجود مكان مخصص لها' },
        { key: 'expiry_check', label: 'التأكد من عدم وجود أصناف إكسباير' },
      ],
    },
    {
      groupKey: 'customers',
      groupLabel: 'العملاء',
      subtasks: [
        { key: 'customer_requests_fulfillment', label: 'تسجيل وتحقيق طلبات العملاء' },
        { key: 'vip_customers_followup', label: 'متابعة أهم عملاء VIP بالفرع' },
        {
          key: 'daily_high_value_customers_review',
          label: 'مراجعة عملاء اليوم اللي فاتورتهم ≥ 500ج',
          hint: 'من صفحة متابعة العملاء — مصدرها RPC: get_daily_high_value_customers.',
        },
      ],
    },
    {
      groupKey: 'doctors_compliance',
      groupLabel: 'الدكاترة والالتزام',
      subtasks: [
        { key: 'pconnect_personal_account', label: 'استخدام الدكاترة لحسابهم الشخصي على PConnect' },
        { key: 'dress_code', label: 'الالتزام بالزي الرسمي' },
        { key: 'doctor_classification_audit', label: 'دقة تصنيف الدكاترة للعملاء على الفواتير' },
        { key: 'policy_compliance', label: 'الالتزام بسياسات الخصومات والمرتجعات والأذونات والمواعيد' },
      ],
    },
    {
      groupKey: 'internal_communication',
      groupLabel: 'المتابعة والتواصل الداخلي',
      subtasks: [
        { key: 'conversations_review', label: 'مراجعة محادثات الواتساب' },
        { key: 'shift_notes_followup', label: 'متابعة ملاحظات الشيفتات وتنفيذها' },
        { key: 'branches_manager_notes_followup', label: 'متابعة ملاحظات مدير الفروع وتنفيذها' },
        { key: 'cs_manager_notes_followup', label: 'متابعة ملاحظات مسؤول خدمة العملاء وتوجيه الدكاترة' },
        { key: 'team_briefing', label: 'تسليم الشيفت وتجميعة سريعة مع الفريق' },
      ],
    },
    {
      groupKey: 'daily_operations',
      groupLabel: 'التشغيل اليومي',
      subtasks: [
        { key: 'floor_cleanliness', label: 'النظافة' },
        { key: 'shelf_arrangement', label: 'الرص' },
        { key: 'transfers_error_correction', label: 'تصحيح أخطاء التحويلات' },
        { key: 'returns_to_suppliers_followup', label: 'متابعة المرتجعات للشركات والمخازن' },
      ],
    },
  ],

  branches_manager: [
    {
      groupKey: 'appearance_and_infrastructure',
      groupLabel: 'الشكل العام والبنية التحتية',
      subtasks: [
        { key: 'branch_appearance_cleanliness_audit', label: 'الشكل العام والنظافة بالفرع' },
        { key: 'infrastructure_check', label: 'الكاميرات والخط الأرضي والنت' },
        { key: 'consumables_check', label: 'الأكياس وبكر الريسيت والباركود' },
      ],
    },
    {
      groupKey: 'sales_and_reporting',
      groupLabel: 'المبيعات والتقارير',
      subtasks: [
        { key: 'daily_sales_file_upload', label: 'رفع ملف المبيعات اليومي' },
        {
          key: 'previous_day_high_value_customers_list',
          label: 'قائمة عملاء اليوم السابق اللي اشتروا فواتير ≥ 500ج',
          hint: 'مصدرها RPC: get_daily_high_value_customers، تاريخ اليوم السابق.',
        },
      ],
    },
    {
      groupKey: 'discipline_and_compliance',
      groupLabel: 'الالتزام والانضباط',
      subtasks: [
        { key: 'dress_pconnect_audit', label: 'الالتزام بالزي واستخدام الدكاترة لحسابهم الشخصي على PConnect' },
        { key: 'doctor_classification_accuracy_review', label: 'التزام الدكاترة بالتصنيف ودقته' },
        { key: 'shift_notes_compliance_review', label: 'الالتزام بمتابعة ملاحظات الشيفتات' },
      ],
    },
    {
      groupKey: 'purchases_and_customers',
      groupLabel: 'المشتريات والعملاء',
      subtasks: [
        { key: 'purchases_speed_availability_review', label: 'سرعة المشتريات وتوافر الأصناف' },
        { key: 'customer_requests_speed_review', label: 'سرعة تسجيل طلبات العملاء وتحقيقها' },
        {
          key: 'top20_customers_retention_review',
          label: 'أهم 20 عميل بالفرع — الاستمرارية وجودة الخدمة',
          hint: 'مصدرها RPC: get_top_customers_per_branch(branch, 20).',
        },
      ],
    },
    {
      groupKey: 'customer_service_oversight',
      groupLabel: 'الإشراف على خدمة العملاء',
      subtasks: [
        { key: 'cs_oversight_conversations_review', label: 'تقييم المحادثات' },
        { key: 'cs_oversight_followup_list_review', label: 'متابعة القائمة المجهزة للمتابعة' },
        { key: 'cs_oversight_points_review', label: 'نظام النقاط' },
        { key: 'cs_oversight_sales_quality_review', label: 'جودة البيع (Cross/Up-selling)' },
      ],
    },
    {
      groupKey: 'inventory_and_warehouse',
      groupLabel: 'الجرد والمخزن',
      subtasks: [
        { key: 'inventory_shelf_review', label: 'الجرد والرص' },
        { key: 'warehouse_review', label: 'أداء المخزن: مواعيد الطلبيات، أذونات التحويل، الباركود' },
      ],
    },
    {
      groupKey: 'shortages_and_stagnant',
      groupLabel: 'النواقص والرواكد',
      subtasks: [
        { key: 'shortages_conduct_review', label: 'النواقص وحسن التصرف فيها' },
        { key: 'stock_movement_review', label: 'تحريك الأصناف اللي خلصت من الرف' },
        { key: 'stagnant_compliance_review', label: 'التزام الدكاترة بالرواكد واللستة' },
      ],
    },
  ],

  customer_service_manager: [
    {
      groupKey: 'conversation_quality',
      groupLabel: 'جودة المحادثات والتصنيف',
      subtasks: [
        {
          key: 'conversations_reviewed',
          label: 'تقييم المحادثات',
          hint: 'تقييم محادثات فعلي بيؤثر على تحسين تعامل الدكاترة مع العملاء.',
        },
        { key: 'classification_accuracy_review', label: 'الالتزام بالتصنيف ودقته' },
      ],
    },
    {
      groupKey: 'branches_manager_alignment',
      groupLabel: 'ملاحظات مدير الفروع',
      subtasks: [{ key: 'branches_manager_notes_followup', label: 'تنفيذ ملاحظات مدير الفروع' }],
    },
    {
      groupKey: 'exceptional_followup',
      groupLabel: 'المتابعة الاستثنائية',
      groupHint: 'مطلوب → تم التواصل → تم الرد → النتيجة → عاد للشراء أم لا — مش مجرد "تم الاتصال".',
      subtasks: [
        { key: 'doctor_requests_followup', label: 'طلبات الدكاترة' },
        { key: 'app_requests_followup', label: 'الطلبات المسجّلة على الأبلكيشن' },
        { key: 'complaints_followup', label: 'شكاوى العملاء' },
        { key: 'branches_manager_list_followup', label: 'القائمة المجهزة من مدير الفروع' },
      ],
    },
    {
      groupKey: 'points_and_loyalty',
      groupLabel: 'النقاط ونظام الولاء',
      subtasks: [
        { key: 'points_communication_review', label: 'التزام الدكاترة بتبليغ العملاء بالنقاط ونظام النقاط عمومًا' },
      ],
    },
    {
      groupKey: 'top20_customers',
      groupLabel: 'متابعة أهم 20 عميل بالفرع',
      groupHint: 'مصدرها RPC: get_top_customers_per_branch(branch, 20).',
      subtasks: [
        { key: 'top20_purchases_followup', label: 'متابعة مشترياتهم' },
        { key: 'top20_satisfaction_followup', label: 'التواصل معهم ورضاهم' },
        { key: 'top20_new_customers_growth', label: 'زيادة عدد العملاء الجدد' },
      ],
    },
    {
      groupKey: 'sales_quality',
      groupLabel: 'جودة البيع',
      subtasks: [
        { key: 'cross_selling_review', label: 'Cross-selling' },
        { key: 'up_selling_review', label: 'Up-selling' },
      ],
    },
    {
      groupKey: 'doctor_development',
      groupLabel: 'تطوير الدكاترة',
      subtasks: [
        {
          key: 'doctor_coaching',
          label: 'أرسلت توجيه أو تدريب لدكتور',
          hint: 'رسالة توجيهية أو صورة توضيحية لتطوير أداء دكتور معيّن — سجّل التفاصيل في الملاحظة.',
        },
      ],
    },
  ],
};

/**
 * التكرار التشغيلي لكل مهمة. المفاتيح غير الموجودة هنا تظل يومية للتوافق مع
 * البيانات القديمة. المهمة الأسبوعية تُحتسب مرة واحدة فقط داخل الأسبوع.
 */
export const MANAGER_TASK_CADENCE_BY_KEY: Record<string, ManagerTaskCadence> = {
  purchases_review: 'weekly',
  inventory_review: 'weekly',
  stagnant_items_followup: 'weekly',
  expiry_check: 'weekly',
  vip_customers_followup: 'weekly',
  doctor_classification_audit: 'weekly',
  conversations_review: 'weekly',
  returns_to_suppliers_followup: 'weekly',

  // مدير الفروع: اليومي هو الأصل. نُبقي أسبوعيًا فقط البنود التي تحتاج تجميعًا
  // أو فحصًا أوسع من المرور التشغيلي اليومي.
  infrastructure_check: 'weekly',
  top20_customers_retention_review: 'weekly',
  warehouse_review: 'weekly',

  conversations_reviewed: 'weekly',
  classification_accuracy_review: 'weekly',
  top20_purchases_followup: 'weekly',
  top20_satisfaction_followup: 'weekly',
  top20_new_customers_growth: 'monthly',
  cross_selling_review: 'weekly',
  up_selling_review: 'weekly',
  doctor_coaching: 'weekly',
};

export function getManagerTaskCadence(taskKey: string): ManagerTaskCadence {
  return MANAGER_TASK_CADENCE_BY_KEY[taskKey] || 'daily';
}

/** توافقًا مع أي كود قديم لسه بيستخدم قائمة مفرودة — بيرجع كل الـ subtasks من كل المجموعات في سطر واحد. */
export type DailyTaskDefinition = DailySubTask & { linkedEvaluationCriterion?: string };

export const MANAGER_DAILY_TASKS: Record<ManagerDailyRole, DailyTaskDefinition[]> = Object.fromEntries(
  (Object.keys(MANAGER_DAILY_TASK_GROUPS) as ManagerDailyRole[]).map((role) => [
    role,
    MANAGER_DAILY_TASK_GROUPS[role].flatMap((group) => group.subtasks),
  ])
) as Record<ManagerDailyRole, DailyTaskDefinition[]>;
