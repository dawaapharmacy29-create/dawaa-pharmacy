export type ManagerDailyRole = 'branch_manager' | 'branches_manager' | 'customer_service_manager';

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
      key: 'pconnect_personal_account',
      label: 'الدكاترة استخدموا حسابهم الشخصي على PConnect وقت البيع',
      hint: 'التزام سياسة الحسابات الفردية أثناء التعامل مع العملاء — مفيش مصدر بيانات آلي، تقييم مباشر.',
    },
    {
      key: 'dress_code',
      label: 'التزام الدكاترة بالزي الرسمي',
      hint: 'جولة بصرية سريعة على الفريق.',
    },
    {
      key: 'purchases_review',
      label: 'راجعت فواتير المشتريات والموردين اليوم',
      hint: 'التأكد من دقة الفواتير المسجلة ومطابقتها للمستلم فعليًا.',
      linkedEvaluationCriterion: 'purchases',
    },
    {
      key: 'purchase_orders_preparation',
      label: 'جهّزت طلبيات الدواء والإكسسوار والمستلزمات',
      hint: 'تحضير الطلبيات الناقصة قبل ما تتحول لنواقص فعلية.',
    },
    {
      key: 'doctor_classification_audit',
      label: 'راجعت تسجيل الدكاترة لتصنيف العملاء على الفواتير في PConnect',
      hint: 'دقة التصنيف وقت البيع — بيغذي معيار دقة التصنيف عند مسؤول خدمة العملاء كمان.',
    },
    {
      key: 'customer_requests_fulfillment',
      label: 'تابعت طلبات العملاء: تسجيل، تحقيق، وتوفير',
      hint: 'Request → Fulfilled — مش بس تسجيل الطلب.',
    },
    {
      key: 'vip_customers_followup',
      label: 'تابعت أهم عملاء VIP بالفرع',
    },
    {
      key: 'daily_high_value_customers_review',
      label: 'راجعت قائمة عملاء اليوم اللي فاتورتهم (أو مجموع فواتيرهم) ≥ 500ج',
      hint: 'من صفحة متابعة العملاء — مصدرها RPC: get_daily_high_value_customers.',
    },
    {
      key: 'transfers_error_correction',
      label: 'صحّحت أخطاء التحويلات',
    },
    {
      key: 'floor_cleanliness',
      label: 'النظافة',
    },
    {
      key: 'shelf_arrangement',
      label: 'الرص',
    },
    {
      key: 'inventory_review',
      label: 'تابعت الجرد والمخزون (نواقص ورواكد)',
      hint: 'مراجعة حالة الجرد وقوائم النواقص والرواكد.',
      linkedEvaluationCriterion: 'inventory',
    },
    {
      key: 'conversations_review',
      label: 'راجعت محادثات الواتساب',
      hint: 'الاطلاع على تقييمات المحادثات وأي شكاوى محتاجة تدخّل.',
    },
    {
      key: 'shift_notes_followup',
      label: 'تابعت ملاحظات الشيفتات والتأكدت من تنفيذها',
    },
    {
      key: 'branches_manager_notes_followup',
      label: 'تابعت ملاحظات مدير الفروع ونفّذتها',
    },
    {
      key: 'cs_manager_notes_followup',
      label: 'تابعت ملاحظات مسؤول خدمة العملاء عن المحادثات والدكاترة ووجّهتهم',
    },
    {
      key: 'policy_compliance',
      label: 'الالتزام بسياسات الخصومات والمرتجعات والأذونات والمواعيد لكل الدكاترة',
    },
    {
      key: 'shortages_handling',
      label: 'التأكدت من التصرف السليم في النواقص + وجود مكان مرتب ومخصص لها',
    },
    {
      key: 'stock_shelf_refill',
      label: 'راجعت الاستوكات وأعدت ملء الأرفف من الأصناف',
    },
    {
      key: 'stagnant_items_followup',
      label: 'تابعت الرواكد واللستة والتزام الدكاترة بصرفهم',
    },
    {
      key: 'expiry_check',
      label: 'تأكدت من عدم وجود أصناف إكسباير في الصيدلية',
    },
    {
      key: 'returns_to_suppliers_followup',
      label: 'تابعت المرتجعات للشركات والمخازن',
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
      key: 'branch_appearance_cleanliness_audit',
      label: 'راجعت الشكل العام والنظافة في الفرعين',
    },
    {
      key: 'previous_day_high_value_customers_list',
      label: 'عملت قائمة عملاء اليوم السابق اللي اشتروا فواتير ≥ 500ج',
      hint: 'مصدرها نفس RPC: get_daily_high_value_customers، تاريخ اليوم السابق.',
    },
    {
      key: 'infrastructure_check',
      label: 'راجعت الكاميرات والخط الأرضي والنت وسلامتهم',
      hint: 'مفيش مصدر بيانات آلي — Checklist يدوي بالكامل.',
    },
    {
      key: 'consumables_check',
      label: 'راجعت توافر الأكياس وبكر الريسيت وبكر الباركود',
    },
    {
      key: 'daily_sales_file_upload',
      label: 'رفعت ملف المبيعات اليومي على التطبيق',
    },
    {
      key: 'dress_pconnect_audit',
      label: 'راجعت الالتزام بالزي واستخدام الدكاترة لحسابهم الشخصي على PConnect',
    },
    {
      key: 'purchases_speed_availability_review',
      label: 'راجعت سرعة المشتريات وتوافر الأصناف',
    },
    {
      key: 'customer_requests_speed_review',
      label: 'راجعت الالتزام بتسجيل طلبات العملاء وسرعة تحقيقها وتوفيرها',
    },
    {
      key: 'top20_customers_retention_review',
      label: 'راجعت قائمة أهم 20 عميل بكل فرع — الاستمرارية وجودة الخدمة',
      hint: 'مصدرها RPC: get_top_customers_per_branch(branch, 20).',
    },
    {
      key: 'doctor_classification_accuracy_review',
      label: 'راجعت التزام الدكاترة بالتصنيف ودقته',
    },
    {
      key: 'shift_notes_compliance_review',
      label: 'راجعت الالتزام بمتابعة ملاحظات الشيفتات',
    },
    {
      key: 'customer_service_oversight',
      label: 'راجعت خدمة العملاء: تقييم المحادثات، متابعة القائمة المجهزة، نظام النقاط، جودة البيع (Cross/Up-selling)',
    },
    {
      key: 'inventory_shelf_review',
      label: 'راجعت الجرد والرص',
    },
    {
      key: 'warehouse_review',
      label: 'راجعت أداء المخزن: مواعيد الطلبيات، أذونات التحويل، الباركود على كل الأصناف',
      linkedEvaluationCriterion: 'warehouse',
    },
    {
      key: 'shortages_conduct_review',
      label: 'راجعت النواقص وحسن التصرف فيها',
    },
    {
      key: 'stock_movement_review',
      label: 'راجعت أماكن الاستوك والتأكد من تحريك الأصناف اللي خلصت من الرف',
    },
    {
      key: 'stagnant_compliance_review',
      label: 'راجعت أداء الدكاترة والتزامهم بالرواكد واللستة',
    },
  ],
  customer_service_manager: [
    {
      key: 'conversations_reviewed',
      label: 'راجعت تقييم المحادثات',
      hint: 'تقييم محادثات فعلي بيؤثر على تحسين تعامل الدكاترة مع العملاء.',
    },
    {
      key: 'classification_accuracy_review',
      label: 'راجعت الالتزام بالتصنيف ودقته',
    },
    {
      key: 'branches_manager_notes_followup',
      label: 'ملاحظات مدير الفروع',
    },
    {
      key: 'exceptional_followup_execution',
      label: 'متابعة الاستثنائية: طلبات الدكاترة + المسجّلة على الأبلكيشن + شكاوى العملاء + القائمة المجهزة من مدير الفروع',
      hint: 'مطلوب → تم التواصل → تم الرد → النتيجة → عاد للشراء أم لا — مش مجرد "تم الاتصال".',
    },
    {
      key: 'points_communication_review',
      label: 'راجعت التزام الدكاترة بتبليغ العملاء بالنقاط ونظام النقاط عمومًا',
    },
    {
      key: 'top20_customers_satisfaction_growth',
      label: 'متابعة أهم 20 عميل بالفرع: الرضا، زيادة المشتريات، زيادة عدد العملاء',
      hint: 'مصدرها RPC: get_top_customers_per_branch(branch, 20).',
    },
    {
      key: 'sales_quality_cross_upsell_review',
      label: 'التأكد من جودة عمليات البيع والـ Cross-selling والـ Up-selling',
    },
    {
      key: 'doctor_coaching',
      label: 'أرسلت توجيه أو تدريب لدكتور',
      hint: 'رسالة توجيهية أو صورة توضيحية لتطوير أداء دكتور معيّن — سجّل التفاصيل في الملاحظة.',
    },
  ],
};
