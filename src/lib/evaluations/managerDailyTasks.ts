export type ManagerDailyRole = 'branch_manager' | 'branches_manager';

export type DailyTaskDefinition = {
  key: string;
  label: string;
  hint?: string;
  /** لو موجود، معدل الإنجاز الأسبوعي للمهمة دي بيغذّي معيار في التقييم الأسبوعي بنفس المفتاح. */
  linkedEvaluationCriterion?: string;
};

export const MANAGER_DAILY_TASKS: Record<ManagerDailyRole, DailyTaskDefinition[]> = {
  branch_manager: [
    {
      key: 'purchases_review',
      label: 'راجعت فواتير المشتريات والموردين اليوم',
      hint: 'التأكد من دقة الفواتير المسجلة ومطابقتها للمستلم فعليًا.',
      linkedEvaluationCriterion: 'purchases',
    },
    {
      key: 'sales_review',
      label: 'راجعت مبيعات الفرع اليوم',
      hint: 'متابعة قيمة المبيعات، متوسط الفاتورة، وعدد الأصناف.',
    },
    {
      key: 'conversations_review',
      label: 'راجعت محادثات وتقييمات خدمة العملاء',
      hint: 'الاطلاع على تقييمات المحادثات وأي شكاوى محتاجة تدخّل.',
    },
    {
      key: 'inventory_review',
      label: 'تابعت الجرد والمخزون (نواقص ورواكد)',
      hint: 'مراجعة حالة الجرد وقوائم النواقص والرواكد.',
      linkedEvaluationCriterion: 'inventory',
    },
    {
      key: 'followups_review',
      label: 'راجعت المتابعات المعلّقة لخدمة العملاء',
      hint: 'التأكد من عدم وجود متابعات متأخرة بدون رد.',
    },
    {
      key: 'attendance_review',
      label: 'راجعت حضور وانضباط الفريق',
      hint: 'متابعة الحضور والانصراف والالتزام بالزي.',
    },
    {
      key: 'floor_walk',
      label: 'عملت جولة ميدانية داخل الفرع',
      hint: 'تفقد النظافة والترتيب وعرض المنتجات.',
    },
  ],
  branches_manager: [
    {
      key: 'branches_performance_review',
      label: 'راجعت أداء الفرعين ومقارنة المبيعات',
    },
    {
      key: 'warehouse_review',
      label: 'تابعت المخزن المركزي',
    },
    {
      key: 'branch_managers_reports_review',
      label: 'راجعت تقارير/مهام مديري الفروع',
    },
    {
      key: 'customer_service_oversight',
      label: 'تابعت خدمة العملاء على مستوى الفروع',
    },
    {
      key: 'escalations_review',
      label: 'راجعت المشاكل التشغيلية المُصعّدة',
    },
    {
      key: 'standards_compliance_review',
      label: 'تابعت الالتزام بمعايير التشغيل في الفرعين',
    },
  ],
};
