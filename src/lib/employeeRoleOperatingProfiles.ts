import { normalizeRole } from '@/lib/core/permissionSystem';

export type EmployeeOperatingRoleKey =
  | 'general_manager'
  | 'branch_manager'
  | 'customer_service_manager'
  | 'customer_service'
  | 'pharmacist'
  | 'assistant'
  | 'rider'
  | 'cleaning'
  | 'warehouse'
  | 'accountant'
  | 'admin';

export type RolePolicyKey =
  | 'customer'
  | 'team'
  | 'delivery'
  | 'cleanliness'
  | 'escalation';

export type EmployeeRoleOperatingProfile = {
  role_key: EmployeeOperatingRoleKey;
  role_name_ar: string;
  mission: string;
  manager_role: EmployeeOperatingRoleKey | null;
  daily_responsibilities: string[];
  weekly_responsibilities: string[];
  monthly_responsibilities: string[];
  daily_checklist: Array<{
    key: string;
    title: string;
    description: string;
    priority: 'normal' | 'high' | 'urgent';
    related_route: string;
  }>;
  kpis: string[];
  scoring_weights: Array<{ label: string; weight: number }>;
  required_followups: string[];
  policies: Record<RolePolicyKey, string[]>;
  escalation_rules: string[];
  forbidden_actions: string[];
  notifications_to_receive: string[];
  dashboard_widgets: string[];
  recommended_actions: string[];
};

const COMMON_POLICIES: Record<RolePolicyKey, string[]> = {
  customer: [
    'الترحيب باحترام وفهم الحالة قبل الترشيح.',
    'السؤال عن السن والحمل والضغط والسكر والحساسية عند الحاجة.',
    'عدم الضغط على العميل واحترام اعتراض السعر.',
    'تصعيد الشكاوى وتسجيل نتيجة المتابعة.',
  ],
  team: [
    'احترام الزملاء وتسليم الشيفت بوضوح.',
    'تسجيل ملاحظات الشيفت والتعاون وقت الضغط.',
    'عدم تحميل خطأ لزميل بدون توثيق.',
    'احترام تسلسل الإدارة.',
  ],
  delivery: [
    'بيانات الطلب ورقم الفاتورة والعميل والهاتف والعنوان واضحة.',
    'طريقة الدفع وأي تعديل يتم تسجيلهما.',
    'أي فشل تسليم له سبب موثق.',
    'احترام متبادل مع فريق الدليفري.',
  ],
  cleanliness: [
    'Checklist صباحي ومسائي للنظافة.',
    'الكاونتر والأرفف والأرضية منظمة ونظيفة.',
    'لا توجد كراتين أو فوضى أمام العميل.',
    'أي ملاحظة نظافة تتحول لمهمة والتكرار يدخل في التقييم.',
  ],
  escalation: [
    'تصعيد شكاوى العملاء أو تعارضات الفريق للمدير المباشر.',
    'تصعيد أي نقص بيانات أو فاتورة غير واضحة قبل نهاية اليوم.',
    'توثيق سبب التصعيد والنتيجة المتوقعة.',
  ],
};

function checklist(
  role: EmployeeOperatingRoleKey,
  rows: Array<[string, string, string, ('normal' | 'high' | 'urgent')?, string?]>
) {
  return rows.map(([key, title, description, priority = 'normal', route]) => ({
    key: `${role}.${key}`,
    title,
    description,
    priority,
    related_route: route || '/employee-operating-system',
  }));
}

const branchManager: EmployeeRoleOperatingProfile = {
  role_key: 'branch_manager',
  role_name_ar: 'مدير فرع',
  mission: 'قيادة الفرع يوميًا لتحقيق هدف المبيعات مع ضبط الحضور والخدمة والنظافة والمتابعات.',
  manager_role: 'general_manager',
  daily_responsibilities: [
    'متابعة مبيعات الفرع يوميًا وتحقيق هدف الدورة.',
    'متابعة حضور وانصراف الفريق وأداء الصيادلة والمساعدين.',
    'حل مشاكل العملاء التي تحتاج مدير ومراجعة العملاء المهمين والمتوقفين.',
    'متابعة النظافة والنظام والدليفري والفواتير بدون كود.',
    'مراجعة التنبيهات اليومية وتسجيل ملاحظات الشيفت.',
  ],
  weekly_responsibilities: ['مراجعة اتجاه المبيعات وأداء الفريق', 'متابعة تكرار الفواتير بدون كود', 'خطة تحسين قصيرة للفريق'],
  monthly_responsibilities: ['مراجعة نتيجة الدورة', 'اعتماد فرص تطوير الفريق', 'مراجعة التزام النظافة والحضور'],
  daily_checklist: checklist('branch_manager', [
    ['sales', 'مراجعة مبيعات اليوم', 'راجع مبيعات الفرع ونسبة تحقيق الهدف.', 'high', '/daily-target'],
    ['shift', 'مراجعة الموجودين في الشيفت', 'تأكد من الحضور والانصراف والمتأخرين والغائبين.', 'high', '/attendance-report'],
    ['manager_customers', 'مراجعة عملاء يحتاجون مدير', 'افتح حالات العملاء التي تحتاج تدخل إداري.', 'high', '/customer-service?needsManager=1'],
    ['uncoded_invoices', 'مراجعة الفواتير بدون كود', 'راجع الفواتير غير المرتبطة بعميل.', 'normal', '/customer-coding'],
    ['shift_note', 'تسجيل ملاحظة شيفت', 'سجل ملاحظة تشغيلية واضحة للفريق.', 'normal', '/shift-notes'],
    ['cleanliness', 'تأكيد نظافة الفرع', 'راجع الكاونتر والأرضية والأرفف ومنطقة العملاء.', 'normal', '/branch-cleaning'],
  ]),
  kpis: ['تحقيق هدف الفرع', 'انتظام حضور الفريق', 'جودة خدمة العملاء', 'تقليل الفواتير بدون كود', 'متابعة المتأخرات والتنبيهات', 'نظافة ونظام الفرع', 'تطوير الفريق وملاحظات الشيفت'],
  scoring_weights: [
    { label: 'تحقيق هدف الفرع', weight: 25 },
    { label: 'انتظام حضور الفريق', weight: 15 },
    { label: 'جودة خدمة العملاء', weight: 20 },
    { label: 'تقليل الفواتير بدون كود', weight: 10 },
    { label: 'متابعة المتأخرات والتنبيهات', weight: 10 },
    { label: 'نظافة ونظام الفرع', weight: 10 },
    { label: 'تطوير الفريق وملاحظات الشيفت', weight: 10 },
  ],
  required_followups: ['مبيعات اليوم', 'الحضور', 'الفواتير بدون كود', 'عملاء يحتاجون مدير', 'النظافة'],
  policies: COMMON_POLICIES,
  escalation_rules: ['أي شكوى مؤثرة أو عجز في الشيفت تصعد للمدير العام في نفس اليوم.', 'أي تكرار في فواتير بدون كود يتحول لخطة متابعة.'],
  forbidden_actions: ['تجاهل تنبيه يومي', 'إغلاق شكوى بدون توثيق', 'تغيير تقييم موظف بدون سبب واضح'],
  notifications_to_receive: ['branch_manager_task', 'employee_task', 'attendance', 'sales_target', 'customer_request'],
  dashboard_widgets: ['sales_target', 'team_attendance', 'daily_tasks', 'uncoded_invoices', 'cleanliness'],
  recommended_actions: ['افتح مهام الفريق قبل بداية الشيفت', 'راجع المتأخرات آخر اليوم', 'سجل ملاحظة شيفت واحدة على الأقل'],
};

const customerServiceManager: EmployeeRoleOperatingProfile = {
  role_key: 'customer_service_manager',
  role_name_ar: 'مدير خدمة العملاء',
  mission: 'توزيع ومتابعة متابعات العملاء وضمان جودة الردود وتقليل التأخير واسترجاع العملاء.',
  manager_role: 'general_manager',
  daily_responsibilities: [
    'توزيع متابعات اليوم ومراجعة المتأخرات.',
    'مراجعة العملاء الذين لم يردوا أو تواصلوا ولم يشتروا.',
    'مراجعة الرسائل الترحيبية والردود السريعة ونقاط العملاء.',
    'تقييم فريق خدمة العملاء وتصعيد المشاكل.',
    'متابعة VIP والمتوقفين وتحليل أسباب عدم الشراء.',
  ],
  weekly_responsibilities: ['تحليل أسباب عدم الشراء', 'تطوير scripts واتساب', 'مراجعة جودة التقييم الداخلي'],
  monthly_responsibilities: ['مراجعة نسبة الإغلاق', 'تقييم أداء الفريق', 'خطة تحسين الردود والمتابعات'],
  daily_checklist: checklist('customer_service_manager', [
    ['today_followups', 'مراجعة قائمة متابعات اليوم', 'راجع التوزيع والحالات المفتوحة.', 'high', '/customer-service?tab=today'],
    ['late_followups', 'مراجعة المتأخر', 'تابع المتابعات المتأخرة قبل نهاية اليوم.', 'urgent', '/customer-service?status=late'],
    ['needs_manager', 'مراجعة يحتاج مدير', 'افتح الحالات التي تحتاج قرار مدير.', 'high', '/customer-service?needsManager=1'],
    ['contacted_no_sale', 'مراجعة تواصل ولم يشتر', 'حلل أسباب عدم الشراء وسجل القرار.', 'normal', '/customer-service'],
    ['welcome', 'متابعة الرسائل الترحيبية', 'راجع مهام الرسائل الترحيبية المفتوحة.', 'normal', '/welcome-messages'],
    ['quick_replies', 'مراجعة الردود السريعة', 'راجع أكثر الردود استخدامًا وجودتها.', 'normal', '/quick-replies'],
  ]),
  kpis: ['نسبة إغلاق المتابعات', 'جودة التقييم الداخلي', 'العملاء المسترجعون', 'تقليل المتأخرات', 'جودة الردود والرسائل', 'دقة التسجيل والبيانات'],
  scoring_weights: [
    { label: 'نسبة إغلاق المتابعات', weight: 25 },
    { label: 'جودة التقييم الداخلي', weight: 20 },
    { label: 'العملاء المسترجعون', weight: 20 },
    { label: 'تقليل المتأخرات', weight: 15 },
    { label: 'جودة الردود والرسائل', weight: 10 },
    { label: 'دقة التسجيل والبيانات', weight: 10 },
  ],
  required_followups: ['متابعات اليوم', 'المتأخر', 'يحتاج مدير', 'تواصل ولم يشتر', 'الرسائل الترحيبية'],
  policies: COMMON_POLICIES,
  escalation_rules: ['تصعيد الشكاوى للمدير العام أو مدير الفرع حسب الفرع.', 'أي عميل VIP متوقف يحتاج متابعة خاصة.'],
  forbidden_actions: ['إغلاق متابعة بدون نتيجة', 'ترك المتأخرات بدون مالك', 'استخدام ردود غير معتمدة في الحالات الحساسة'],
  notifications_to_receive: ['employee_task', 'staff_task', 'customer_followup', 'customer_request', 'welcome_task'],
  dashboard_widgets: ['followups', 'late_followups', 'customer_recovery', 'quick_replies_quality'],
  recommended_actions: ['ابدأ بالمتأخرات', 'راجع عينة محادثات يومية', 'حدّث scripts واتساب عند تكرار اعتراض'],
};

const pharmacist: EmployeeRoleOperatingProfile = {
  role_key: 'pharmacist',
  role_name_ar: 'صيدلي',
  mission: 'خدمة العميل باحتراف مع تحسين متوسط الفاتورة وربط الفواتير بالعملاء والالتزام بالشيفت.',
  manager_role: 'branch_manager',
  daily_responsibilities: [
    'خدمة العميل باحترام وفهم احتياجه قبل البيع.',
    'تسجيل العميل أو التأكد من كوده.',
    'رفع متوسط الفاتورة وCross Sell وUp Sell بدون ضغط.',
    'بيع الرواكد واللستة حسب السياسة.',
    'الالتزام بالحضور والنظافة وتصعيد الشكاوى.',
  ],
  weekly_responsibilities: ['مراجعة متوسط الفاتورة', 'مراجعة فرص البيع الإضافي', 'تحسين جودة المحادثات'],
  monthly_responsibilities: ['مراجعة نتيجة الحافز', 'مراجعة العملاء المتكررين', 'تحسين الربط بالكود'],
  daily_checklist: checklist('pharmacist', [
    ['avg_invoice', 'مراجعة متوسط الفاتورة', 'راجع متوسطك مقارنة بالفرع.', 'high', '/staff-dashboard'],
    ['uncoded', 'مراجعة فواتيرك بدون كود', 'تابع الفواتير غير المرتبطة بعميل.', 'high', '/customer-coding'],
    ['reviews', 'مراجعة تقييمات المحادثات', 'راجع أي تقييم سلبي مرتبط بك.', 'normal', '/reviews'],
    ['cross_sell', 'مراجعة فرص Cross Sell', 'اختر فرص بيع إضافي مناسبة بدون ضغط.', 'normal', '/stagnant-medicines'],
    ['welcome', 'تسجيل رسالة ترحيبية مطلوبة', 'سجل الترحيب عند الحاجة.', 'normal', '/welcome-messages'],
  ]),
  kpis: ['إجمالي المبيعات', 'متوسط الفاتورة', 'جودة خدمة العميل/المحادثات', 'بيع الرواكد واللستة', 'تسجيل العملاء وربط الفواتير', 'الالتزام بالحضور والنظافة'],
  scoring_weights: [
    { label: 'إجمالي المبيعات', weight: 25 },
    { label: 'متوسط الفاتورة', weight: 20 },
    { label: 'جودة خدمة العميل/المحادثات', weight: 20 },
    { label: 'بيع الرواكد واللستة', weight: 15 },
    { label: 'تسجيل العملاء وربط الفواتير', weight: 10 },
    { label: 'الالتزام بالحضور والنظافة', weight: 10 },
  ],
  required_followups: ['متوسط الفاتورة', 'الفواتير بدون كود', 'تقييمات المحادثات', 'الرواكد واللستة'],
  policies: COMMON_POLICIES,
  escalation_rules: ['أي شكوى أو حالة طبية غير واضحة تصعد فورًا للمدير أو الصيدلي المسؤول.', 'أي اعتراض سعر متكرر يوثق للمدير.'],
  forbidden_actions: ['الضغط على العميل', 'بيع غير مهني', 'تجاهل كود العميل', 'ترك شكوى بدون تصعيد'],
  notifications_to_receive: ['staff_task', 'employee_task', 'sales_target', 'conversation_review'],
  dashboard_widgets: ['avg_invoice', 'sales', 'reviews', 'daily_tasks'],
  recommended_actions: ['راجع فواتير بدون كود قبل نهاية الشيفت', 'اختر صنف راكد مناسب لكل فرصة', 'سجل نتيجة المتابعة'],
};

const assistant: EmployeeRoleOperatingProfile = {
  role_key: 'assistant',
  role_name_ar: 'مساعد',
  mission: 'تجهيز الطلبات بدقة وسرعة ومساندة الصيدلي والحفاظ على ترتيب ونظافة منطقة العمل.',
  manager_role: 'branch_manager',
  daily_responsibilities: ['تجهيز الطلبات بدقة', 'مساعدة الصيدلي', 'ترتيب الأرفف', 'متابعة النظافة والنواقص', 'تجهيز طلبات الدليفري', 'الإبلاغ عن مشاكل المخزون'],
  weekly_responsibilities: ['مراجعة النواقص المتكررة', 'تحسين ترتيب الأرفف'],
  monthly_responsibilities: ['مراجعة الالتزام بالحضور والدقة', 'خطة تحسين تجهيز الطلبات'],
  daily_checklist: checklist('assistant', [
    ['work_area', 'ترتيب منطقة العمل', 'تأكد من ترتيب منطقة التجهيز.', 'normal', '/shelf-organization'],
    ['shortages', 'مراجعة النواقص', 'راجع النواقص وبلغ المسؤول.', 'high', '/shortages'],
    ['delivery_prepare', 'تجهيز طلبات الدليفري بدقة', 'تأكد من الأصناف والفاتورة قبل التسليم.', 'high', '/delivery'],
    ['counter_clean', 'تأكيد نظافة الكاونتر', 'راجع نظافة الكاونتر ومنطقة العملاء.', 'normal', '/branch-cleaning'],
    ['inventory_issue', 'الإبلاغ عن مشكلة مخزون', 'سجل أي مشكلة مخزون واضحة.', 'normal', '/stock-alerts'],
  ]),
  kpis: ['سرعة تجهيز الطلبات', 'دقة تجهيز الطلبات', 'النظافة والترتيب', 'التعاون مع الفريق', 'الالتزام بالحضور'],
  scoring_weights: [
    { label: 'سرعة تجهيز الطلبات', weight: 25 },
    { label: 'دقة تجهيز الطلبات', weight: 25 },
    { label: 'النظافة والترتيب', weight: 20 },
    { label: 'التعاون مع الفريق', weight: 15 },
    { label: 'الالتزام بالحضور', weight: 15 },
  ],
  required_followups: ['النواقص', 'التجهيز', 'النظافة', 'مشاكل المخزون'],
  policies: COMMON_POLICIES,
  escalation_rules: ['أي نقص مؤثر أو خطأ تجهيز يصعد لمدير الفرع فورًا.'],
  forbidden_actions: ['تسليم طلب ناقص بدون إبلاغ', 'ترك منطقة العمل غير مرتبة', 'تجاهل مشكلة مخزون'],
  notifications_to_receive: ['staff_task', 'employee_task', 'stock_alert'],
  dashboard_widgets: ['shortages', 'delivery_prepare', 'cleanliness'],
  recommended_actions: ['ابدأ بالنواقص', 'راجع الطلب قبل خروجه', 'بلغ عن أي مشكلة فورًا'],
};

const rider: EmployeeRoleOperatingProfile = {
  role_key: 'rider',
  role_name_ar: 'دليفري',
  mission: 'تسجيل وتسليم الأوردرات بدقة وفي الوقت مع توثيق الفواتير والحالات المفتوحة.',
  manager_role: 'branch_manager',
  daily_responsibilities: ['تسجيل الحضور والانصراف', 'تسجيل كل أوردر بدقة', 'تحديث حالة التسليم', 'تسجيل سبب الفشل', 'احترام العميل', 'عدم التلاعب في الفواتير أو المواقع'],
  weekly_responsibilities: ['مراجعة الأوردرات المفتوحة', 'تحسين الالتزام بالتسليم'],
  monthly_responsibilities: ['مراجعة تقييم العميل/الفرع', 'مراجعة دقة التسجيل'],
  daily_checklist: checklist('rider', [
    ['clock_in', 'تسجيل الحضور', 'سجل بداية الشيفت.', 'high', '/attendance-report'],
    ['open_orders', 'مراجعة الأوردرات المفتوحة', 'راجع أي أوردر غير مغلق.', 'urgent', '/delivery'],
    ['delivered', 'إغلاق الأوردرات المسلمة', 'حدّث حالة كل أوردر تم تسليمه.', 'high', '/delivery'],
    ['failed_reason', 'تسجيل سبب الفشل', 'سجل سبب فشل التسليم بوضوح.', 'normal', '/delivery'],
    ['missing_invoices', 'مراجعة الفواتير الناقصة', 'أكمل رقم الفاتورة أو صورة الريسيت إن طلبت.', 'normal', '/delivery'],
  ]),
  kpis: ['عدد الأوردرات الصحيحة', 'الالتزام بالتسليم في الوقت', 'دقة تسجيل الفاتورة والعميل', 'عدم وجود أوردرات مفتوحة', 'الحضور والانصراف', 'تقييم العميل/الفرع'],
  scoring_weights: [
    { label: 'عدد الأوردرات الصحيحة', weight: 25 },
    { label: 'الالتزام بالتسليم في الوقت', weight: 20 },
    { label: 'دقة تسجيل الفاتورة والعميل', weight: 20 },
    { label: 'عدم وجود أوردرات مفتوحة', weight: 15 },
    { label: 'الحضور والانصراف', weight: 10 },
    { label: 'تقييم العميل/الفرع', weight: 10 },
  ],
  required_followups: ['الأوردرات المفتوحة', 'الفواتير الناقصة', 'أسباب الفشل'],
  policies: COMMON_POLICIES,
  escalation_rules: ['أي فشل تسليم أو مشكلة دفع تصعد لمدير الفرع فورًا.'],
  forbidden_actions: ['ترك أوردر مفتوح بدون سبب', 'تغيير بيانات فاتورة', 'تجاهل تحديث الحالة'],
  notifications_to_receive: ['employee_task', 'delivery_order'],
  dashboard_widgets: ['open_orders', 'delivery_accuracy', 'attendance'],
  recommended_actions: ['راجع المفتوح قبل الخروج', 'حدث الحالة فور التسليم', 'سجل سبب الفشل'],
};

const cleaning: EmployeeRoleOperatingProfile = {
  role_key: 'cleaning',
  role_name_ar: 'مسؤول نظافة',
  mission: 'الحفاظ على نظافة الفرع طوال اليوم وتنفيذ checklist صباحي ومسائي وتسجيل الملاحظات.',
  manager_role: 'branch_manager',
  daily_responsibilities: ['نظافة الأرضية والأرفف والكاونتر ومنطقة العملاء', 'التخلص من القمامة', 'متابعة التعقيم', 'الإبلاغ عن التلف', 'تنفيذ Checklist صباحي ومسائي'],
  weekly_responsibilities: ['مراجعة ملاحظات النظافة المتكررة', 'تجهيز احتياجات التنظيف'],
  monthly_responsibilities: ['مراجعة تقييم مدير الفرع', 'خطة تقليل ملاحظات النظافة'],
  daily_checklist: checklist('cleaning', [
    ['morning', 'Checklist صباحي', 'نفذ قائمة النظافة الصباحية.', 'high', '/branch-cleaning'],
    ['evening', 'Checklist مسائي', 'نفذ قائمة النظافة المسائية.', 'high', '/branch-cleaning'],
    ['floor', 'تأكيد نظافة الأرضية', 'راجع الأرضية ومنطقة العملاء.', 'normal', '/branch-cleaning'],
    ['counter', 'تأكيد نظافة الكاونتر', 'راجع الكاونتر والأرفف.', 'normal', '/branch-cleaning'],
    ['note', 'تسجيل أي ملاحظة', 'سجل أي تلف أو احتياج تنظيف.', 'normal', '/branch-cleaning'],
  ]),
  kpis: ['الالتزام بالـ checklist', 'نظافة الفرع وقت المرور', 'سرعة الاستجابة للملاحظات', 'الالتزام بالحضور', 'تقييم مدير الفرع'],
  scoring_weights: [
    { label: 'الالتزام بالـ checklist', weight: 30 },
    { label: 'نظافة الفرع وقت المرور', weight: 30 },
    { label: 'سرعة الاستجابة للملاحظات', weight: 20 },
    { label: 'الالتزام بالحضور', weight: 10 },
    { label: 'تقييم مدير الفرع', weight: 10 },
  ],
  required_followups: ['Checklist صباحي', 'Checklist مسائي', 'ملاحظات النظافة'],
  policies: COMMON_POLICIES,
  escalation_rules: ['أي تلف أو نقص أدوات تنظيف يصعد لمدير الفرع.'],
  forbidden_actions: ['ترك فوضى أمام العملاء', 'تجاهل checklist', 'عدم تسجيل التلف'],
  notifications_to_receive: ['cleaning_task', 'employee_task'],
  dashboard_widgets: ['cleaning_checklist', 'branch_cleanliness'],
  recommended_actions: ['ابدأ بالصباحي', 'راجع منطقة العملاء باستمرار', 'سجل الملاحظات فورًا'],
};

function simpleProfile(
  role_key: EmployeeOperatingRoleKey,
  role_name_ar: string,
  mission: string,
  manager_role: EmployeeOperatingRoleKey | null,
  daily: string[],
  kpis: string[]
): EmployeeRoleOperatingProfile {
  return {
    role_key,
    role_name_ar,
    mission,
    manager_role,
    daily_responsibilities: daily,
    weekly_responsibilities: ['مراجعة الالتزام الأسبوعي', 'تحديد نقاط التحسين'],
    monthly_responsibilities: ['مراجعة نتيجة الدور الشهرية', 'تحديث خطة التشغيل'],
    daily_checklist: checklist(role_key, daily.slice(0, 5).map((item, index) => [`task_${index + 1}`, item, item, index === 0 ? 'high' : 'normal'])),
    kpis,
    scoring_weights: kpis.map((label) => ({ label, weight: Math.round(100 / Math.max(1, kpis.length)) })),
    required_followups: daily.slice(0, 4),
    policies: COMMON_POLICIES,
    escalation_rules: ['أي عائق يمنع تنفيذ المهمة اليومية يصعد للمدير المباشر.'],
    forbidden_actions: ['تجاهل المهام اليومية', 'تعديل بيانات بدون توثيق', 'إخفاء مشكلة تشغيلية'],
    notifications_to_receive: ['employee_task', 'staff_task'],
    dashboard_widgets: ['daily_tasks', 'role_kpis'],
    recommended_actions: ['راجع مهام اليوم', 'أغلق المهام المكتملة', 'سجل ملاحظة عند وجود عائق'],
  };
}

export const EMPLOYEE_ROLE_OPERATING_PROFILES: Record<EmployeeOperatingRoleKey, EmployeeRoleOperatingProfile> = {
  general_manager: simpleProfile(
    'general_manager',
    'مدير عام',
    'متابعة تشغيل كل الفروع والنتائج والتنبيهات الحرجة.',
    null,
    ['مراجعة داشبورد اليوم', 'متابعة الفروع المتأخرة', 'مراجعة المهام عالية الأولوية', 'متابعة المديرين', 'اعتماد قرارات التصعيد'],
    ['تحقيق الأهداف', 'انضباط الفروع', 'حل التصعيدات', 'صحة البيانات']
  ),
  branch_manager: branchManager,
  customer_service_manager: customerServiceManager,
  customer_service: simpleProfile(
    'customer_service',
    'خدمة عملاء',
    'تنفيذ المتابعات وخدمة العملاء وتسجيل النتائج بدقة.',
    'customer_service_manager',
    ['مراجعة متابعات اليوم', 'إغلاق المتابعات المكتملة', 'تسجيل نتيجة التواصل', 'متابعة الرسائل الترحيبية', 'تصعيد يحتاج مدير'],
    ['إغلاق المتابعات', 'جودة الردود', 'دقة التسجيل', 'تقليل المتأخر']
  ),
  pharmacist,
  assistant,
  rider,
  cleaning,
  warehouse: simpleProfile(
    'warehouse',
    'مخزن',
    'متابعة النواقص والمخزون والصلاحيات ودقة التسجيل.',
    'branch_manager',
    ['مراجعة النواقص', 'مراجعة المخزون الحرج', 'تسجيل مشاكل المخزون', 'متابعة الصلاحيات', 'تنسيق طلبات الفرع'],
    ['دقة المخزون', 'تقليل النواقص', 'سرعة الاستجابة', 'صحة التسجيل']
  ),
  accountant: simpleProfile(
    'accountant',
    'حسابات',
    'متابعة الفواتير والحسابات والتسويات بدقة.',
    'general_manager',
    ['مراجعة الفواتير', 'مراجعة المرتجعات', 'متابعة التسويات', 'تسجيل ملاحظات الحسابات', 'تصعيد فروق غير مفسرة'],
    ['دقة الفواتير', 'سرعة التسوية', 'تقليل الفروق', 'صحة التقارير']
  ),
  admin: simpleProfile(
    'admin',
    'مسؤول نظام',
    'إدارة النظام والصلاحيات وصحة البيانات بدون تعطيل التشغيل.',
    'general_manager',
    ['مراجعة صحة البيانات', 'متابعة أخطاء النظام', 'مراجعة الصلاحيات الحساسة', 'دعم المستخدمين', 'توثيق التغييرات'],
    ['استقرار النظام', 'صحة الصلاحيات', 'سرعة الدعم', 'توثيق التغييرات']
  ),
};

export function normalizeEmployeeOperatingRole(role?: unknown): EmployeeOperatingRoleKey {
  const normalized = normalizeRole(role);
  if (normalized === 'delivery') return 'rider';
  if (normalized === 'cleaning_supervisor') return 'cleaning';
  if (normalized === 'inventory_assistant' || normalized === 'procurement_manager') return 'warehouse';
  if (normalized === 'executive_manager' || normalized === 'branches_manager') return 'general_manager';
  if (String(role || '').toLowerCase() === 'admin') return 'admin';
  if (normalized in EMPLOYEE_ROLE_OPERATING_PROFILES) return normalized as EmployeeOperatingRoleKey;
  return 'assistant';
}

export function getEmployeeRoleOperatingProfile(role?: unknown): EmployeeRoleOperatingProfile {
  return EMPLOYEE_ROLE_OPERATING_PROFILES[normalizeEmployeeOperatingRole(role)];
}

export function getRoleDailyChecklist(role?: unknown) {
  return getEmployeeRoleOperatingProfile(role).daily_checklist;
}

export const EMPLOYEE_OPERATING_ROLE_KEYS = Object.keys(
  EMPLOYEE_ROLE_OPERATING_PROFILES
) as EmployeeOperatingRoleKey[];
