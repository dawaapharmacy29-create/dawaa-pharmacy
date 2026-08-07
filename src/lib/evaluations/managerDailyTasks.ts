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
    {
      key: 'cash_reconciliation',
      label: 'طابقت الكاش والعهدة اليومية',
      hint: 'مطابقة كاش الدرج/الماكينة مع تقرير المبيعات — أهم ضبط مالي يومي.',
      linkedEvaluationCriterion: 'cash_integrity',
    },
    {
      key: 'complaints_escalation',
      label: 'راجعت الشكاوى المتصاعدة وتابعت حلها',
      hint: 'أي شكوى وصلتلك من خدمة العملاء أو مباشرة من عميل — لازم رد وحل موثّق.',
      linkedEvaluationCriterion: 'complaints_handling',
    },
    {
      key: 'team_briefing',
      label: 'عملت تجميعة سريعة مع الفريق (تسليم الشيفت)',
      hint: 'مراجعة أولويات اليوم مع الفريق وملاحظات الشيفت السابق.',
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
      linkedEvaluationCriterion: 'warehouse',
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
    {
      key: 'budget_expense_review',
      label: 'راجعت المصروفات التشغيلية والميزانية',
      hint: 'مقارنة المصروفات الفعلية بالميزانية المعتمدة للفرعين والمخزن.',
      linkedEvaluationCriterion: 'budget_control',
    },
    {
      key: 'supplier_relations_review',
      label: 'تابعت علاقات الموردين الاستراتيجيين',
      hint: 'التفاوض على الأسعار، مواعيد التوريد، وحل أي مشكلة توريد.',
      linkedEvaluationCriterion: 'supplier_relations',
    },
    {
      key: 'team_development_review',
      label: 'تابعت تطوير وتدريب مديري الفروع',
      hint: 'متابعة خطط التطوير والتدريب المتفق عليها مع كل مدير فرع.',
    },
  ],
};
