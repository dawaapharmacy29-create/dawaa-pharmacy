import { canonicalStaffRole, type CanonicalStaffRole } from '@/lib/staff/staffRoleCapabilities';

export type StaffEvaluationSectionV3 = {
  key: string;
  title: string;
  description: string;
  weight: number;
  score: number;
  notes: string;
};

export type StaffEvaluationProfileV3 = {
  role: CanonicalStaffRole;
  label: string;
  mission: string;
  sections: StaffEvaluationSectionV3[];
};

type Seed = [key: string, title: string, description: string, weight: number];

function sections(rows: Seed[]): StaffEvaluationSectionV3[] {
  const total = rows.reduce((sum, row) => sum + row[3], 0);
  if (total !== 100) throw new Error(`Evaluation profile weights must total 100, received ${total}`);
  return rows.map(([key, title, description, weight]) => ({ key, title, description, weight, score: 0, notes: '' }));
}

const COMMON_DEVELOPMENT: Seed = ['development', 'التعلم والتحسن', 'تقبل الملاحظات، تنفيذ خطة التطوير، وعدم تكرار الأخطاء.', 10];

const PROFILES: Record<CanonicalStaffRole, StaffEvaluationProfileV3> = {
  doctor: {
    role: 'doctor', label: 'الصيدلي', mission: 'خدمة آمنة ومهنية للعميل مع دقة الصرف والمتابعة وجودة المحادثة والتشغيل.',
    sections: sections([
      ['discipline', 'الالتزام والانضباط', 'الحضور، الزي، التعليمات، تسليم الشيفت والسلوك المهني.', 15],
      ['conversations', 'جودة المحادثات وخدمة العميل', 'الترحيب، سرعة الرد، فهم الطلب، الأسلوب، الإغلاق والمتابعة.', 20],
      ['dispensing', 'دقة صرف الدواء والإرشاد', 'صحة الصنف والتركيز والكمية والجرعة وطريقة الاستخدام والاحتياطات.', 20],
      ['followups_requests', 'طلبات العملاء والمتابعات', 'التسجيل الكامل، التنفيذ في الموعد، النتيجة، والموعد التالي.', 15],
      ['sales_quality', 'جودة البيع والفاتورة', 'فهم الاحتياج، البدائل، الإضافات المناسبة بلا ضغط، ودقة الفاتورة.', 10],
      ['inventory', 'المخزون والرواكد والنواقص', 'التبليغ المبكر، متابعة الأصناف، الجرد والصلاحية.', 10],
      COMMON_DEVELOPMENT,
    ]),
  },
  assistant: {
    role: 'assistant', label: 'مساعد الصيدلي', mission: 'دقة تجهيز وتشغيل المخزون والطلبيات والرفوف مع تقليل الأخطاء ودعم الفريق.',
    sections: sections([
      ['discipline', 'الالتزام والانضباط', 'الحضور، التعليمات، النظافة الشخصية، وتسليم المهام.', 15],
      ['orders_accuracy', 'دقة إدخال وتجهيز الطلبيات', 'الصنف والكمية والبيانات ومراجعة الطلب قبل التسليم.', 25],
      ['inventory', 'الجرد ودقة المخزون', 'اكتشاف الفروق، التبليغ، العهدة، والنواقص.', 20],
      ['shelf', 'رص الأرفف والتنظيم', 'الترتيب حسب الجدول، سهولة الوصول، ومنع الفوضى.', 15],
      ['delivery_support', 'تجهيز الدليفري والتعاون', 'دقة تجهيز الطلب وتسليمه والملاحظات الخاصة بالعميل.', 10],
      ['teamwork', 'التعاون وتحمل المسؤولية', 'الاستجابة وقت الضغط، احترام الفريق، وإغلاق المهام فعليًا.', 5],
      COMMON_DEVELOPMENT,
    ]),
  },
  inventory_assistant: {
    role: 'inventory_assistant', label: 'مساعد المخزون', mission: 'حقيقة مخزون دقيقة وسريعة مع جرد منضبط وتصعيد مبكر للفروق والنواقص.',
    sections: sections([
      ['discipline', 'الالتزام والانضباط', 'الحضور، التعليمات، والتوثيق.', 15],
      ['inventory_accuracy', 'دقة الجرد والمخزون', 'مطابقة الأرصدة، توثيق الفروق، ومراجعة العهدة.', 30],
      ['shortages', 'النواقص والتوافر', 'الاكتشاف المبكر، التسجيل، والتصعيد والمتابعة.', 20],
      ['expiry', 'الصلاحية والرواكد', 'المراجعة الدورية، ترتيب الأولويات، والتنبيه المبكر.', 15],
      ['documentation', 'جودة التسجيل والتسليم', 'وضوح البيانات والملاحظات وتسليم العمل.', 10],
      COMMON_DEVELOPMENT,
    ]),
  },
  cleaning: {
    role: 'cleaning', label: 'عامل النظافة', mission: 'فرع نظيف وآمن طوال اليوم مع تنفيذ الـChecklist والاستجابة السريعة لأي ملاحظة.',
    sections: sections([
      ['daily_stars', 'التقييم اليومي بالنجوم', 'متوسط تقييمات المدير اليومية وجودة التنفيذ الفعلية خلال الدورة.', 35],
      ['checklist', 'الالتزام بالـChecklist', 'تنفيذ مهام الفتح وأثناء اليوم والقفل وإرفاق الدليل عند الحاجة.', 25],
      ['sensitive_areas', 'المناطق الحساسة', 'دورة المياه، الاستراحة، الأرضيات، الكاونتر والأسطح والواجهات.', 20],
      ['response', 'سرعة تصحيح الملاحظات', 'الاستجابة للملاحظة، إعادة العمل، والتبليغ المبكر عن المشاكل.', 10],
      COMMON_DEVELOPMENT,
    ]),
  },
  delivery: {
    role: 'delivery', label: 'الدليفري', mission: 'توصيل آمن ودقيق وسريع مع بيانات صحيحة وتوثيق واضح لكل نتيجة.',
    sections: sections([
      ['attendance', 'الحضور والالتزام', 'بدء الشيفت والانصراف والالتزام بخطة العمل.', 15],
      ['delivery_success', 'نجاح وإغلاق الأوردرات', 'إغلاق الحالات بدقة وتقليل الفشل غير المبرر.', 25],
      ['timing', 'الوقت وكفاءة الرحلة', 'سرعة مناسبة بدون تجاوزات وحسن تنظيم الرحلات.', 20],
      ['customer', 'التعامل مع العميل', 'الاحترام، الملاحظات الخاصة، والتحصيل والتسليم.', 15],
      ['data', 'دقة البيانات والتوثيق', 'العنوان والهاتف والفاتورة وسبب الفشل والتعديلات.', 15],
      COMMON_DEVELOPMENT,
    ]),
  },
  customer_service: {
    role: 'customer_service', label: 'خدمة العملاء', mission: 'متابعة دقيقة وسريعة تحفظ العميل وتغلق الطلبات ببيانات كاملة ونتيجة واضحة.',
    sections: sections([
      ['followups', 'المتابعات والالتزام بالمواعيد', 'تنفيذ المتابعات، عدم التأخير، وتحديد النتيجة والخطوة التالية.', 30],
      ['conversation', 'جودة المحادثة', 'سرعة الرد والأسلوب والفهم والإغلاق المهني.', 20],
      ['data_quality', 'جودة بيانات العميل', 'الكود والهاتف والتصنيف والملاحظات وربط المتابعة.', 20],
      ['requests', 'طلبات العملاء وإغلاقها', 'التسجيل الكامل، تحديث الحالة، والتصعيد في الوقت المناسب.', 15],
      ['discipline', 'الالتزام والتعاون', 'الحضور والتعليمات والتعاون مع الفروع.', 5],
      COMMON_DEVELOPMENT,
    ]),
  },
  customer_service_manager: {
    role: 'customer_service_manager', label: 'مدير خدمة العملاء', mission: 'إدارة جودة خدمة العملاء والفريق والـSLA وتحويل المتابعات إلى نتائج قابلة للقياس.',
    sections: sections([
      ['team_quality', 'جودة أداء الفريق', 'مراجعة المحادثات، تطوير الموظفين، وضبط جودة التنفيذ.', 25],
      ['followups_sla', 'المتابعات والـSLA', 'منع التأخير، توزيع العمل، وإغلاق الحالات في موعدها.', 25],
      ['customer_outcomes', 'نتائج العملاء', 'الشراء بعد المتابعة، الاحتفاظ بالعملاء، والشكاوى.', 20],
      ['data_governance', 'حوكمة البيانات', 'التصنيف والهوية والملخصات ومنع التكرار.', 15],
      ['leadership', 'القيادة والتعاون', 'التصعيد والتنسيق مع الفروع والإدارة.', 5],
      COMMON_DEVELOPMENT,
    ]),
  },
  shift_supervisor: {
    role: 'shift_supervisor', label: 'مسؤول الشيفت', mission: 'شيفت منضبط سريع التسليم وحل المشكلات مع متابعة تنفيذ الفريق.',
    sections: sections([
      ['shift_discipline', 'انضباط الشيفت', 'الحضور والتوزيع والالتزام أثناء الشيفت.', 25],
      ['handover', 'التسليم والاستلام', 'وضوح الملاحظات والعهدة والمهام المفتوحة.', 20],
      ['team_execution', 'متابعة تنفيذ الفريق', 'التأكد من إغلاق المهام وعدم ترك المشاكل.', 20],
      ['customer_issues', 'مشاكل العملاء والتصعيد', 'سرعة الحل والتصعيد والتوثيق.', 15],
      ['operations', 'استمرارية التشغيل', 'النواقص والدليفري والنظافة والأعطال.', 10],
      COMMON_DEVELOPMENT,
    ]),
  },
  branch_manager: {
    role: 'branch_manager', label: 'مدير الفرع', mission: 'تشغيل فرع مستقر عالي الجودة مع فريق منضبط وعملاء محفوظين ونتائج واضحة.',
    sections: sections([
      ['team', 'إدارة الفريق', 'الحضور، توزيع المهام، التطوير، والمحاسبة.', 25],
      ['operations', 'جودة التشغيل', 'الشيفتات، الفواتير، المخزون، النظافة والدليفري.', 20],
      ['customers', 'خدمة العملاء والمتابعات', 'الحالات الحرجة، العملاء المهمون، وجودة المتابعة.', 20],
      ['quality', 'الجودة والرقابة', 'تقليل الأخطاء، مراجعة الأدلة، وسلامة البيانات.', 15],
      ['execution', 'إغلاق المشكلات والمهام', 'السرعة، الملكية، والتصعيد المناسب.', 10],
      COMMON_DEVELOPMENT,
    ]),
  },
  branches_manager: {
    role: 'branches_manager', label: 'مدير الفروع', mission: 'توحيد جودة الفروع وتطوير المديرين وتقليل فجوات الأداء والتشغيل.',
    sections: sections([
      ['branch_health', 'صحة أداء الفروع', 'الثبات والجودة وتقليل الفجوة بين الفروع.', 25],
      ['managers', 'تطوير مديري الفروع', 'المتابعة والمحاسبة وخطط التحسين.', 20],
      ['operations', 'التشغيل والمخزون', 'التوافر، الأعطال، الجرد واستمرارية التشغيل.', 20],
      ['customers', 'جودة خدمة العملاء', 'الاحتفاظ والعملاء المهمون والتصعيدات.', 15],
      ['execution', 'إغلاق المشكلات والمشروعات', 'المسؤول والموعد والنتيجة.', 10],
      COMMON_DEVELOPMENT,
    ]),
  },
  purchasing: {
    role: 'purchasing', label: 'المشتريات', mission: 'توافر سريع ودقيق بأقل أخطاء مع متابعة الطلبات والموردين والمخزون.',
    sections: sections([
      ['availability', 'التوافر وسرعة التوريد', 'النواقص الحرجة وسرعة توفيرها.', 25],
      ['purchase_accuracy', 'دقة الشراء', 'الصنف والكمية والسعر والمورد والفاتورة.', 25],
      ['customer_requests', 'طلبات العملاء', 'توفير الطلبات وتحديث الحالة والتأكيد قبل الشراء عند الحاجة.', 20],
      ['inventory', 'المخزون والرواكد', 'منع زيادة غير ضرورية ومراعاة الصلاحية والدوران.', 15],
      ['coordination', 'التنسيق والتوثيق', 'التواصل مع الفروع والمخزن والموردين.', 5],
      COMMON_DEVELOPMENT,
    ]),
  },
  executive: {
    role: 'executive', label: 'الإدارة التنفيذية', mission: 'قيادة النتائج والاستقرار والمخاطر والمشروعات عبر المنظومة.',
    sections: sections([
      ['results', 'النتائج والاستقرار', 'استقرار التشغيل وتحقيق الأولويات.', 25],
      ['governance', 'الحوكمة والرقابة', 'البيانات والصلاحيات والقرارات الموثقة.', 20],
      ['leaders', 'تطوير القيادات', 'مديرو الفروع والمسؤولون وخطط التحسين.', 20],
      ['customers', 'صحة العملاء والخدمة', 'الجودة والاحتفاظ والتصعيدات.', 15],
      ['projects', 'المشروعات وإغلاق المخاطر', 'التنفيذ والموعد والأثر.', 10],
      COMMON_DEVELOPMENT,
    ]),
  },
  admin: {
    role: 'admin', label: 'الإدارة', mission: 'رقابة وتشغيل موثق مع حماية الصلاحيات وسلامة النظام.',
    sections: sections([
      ['governance', 'الحوكمة والصلاحيات', 'سلامة القرارات والصلاحيات والتوثيق.', 30],
      ['operations', 'استقرار التشغيل', 'متابعة الأعطال والمخاطر والإجراءات.', 25],
      ['data', 'سلامة البيانات', 'الدقة والتكرار ومصادر الحقيقة.', 20],
      ['execution', 'إغلاق الإجراءات', 'المتابعة والموعد والنتيجة.', 15],
      COMMON_DEVELOPMENT,
    ]),
  },
  other: {
    role: 'other', label: 'الموظف', mission: 'تقييم عام للالتزام وجودة التنفيذ والتعاون والتطور.',
    sections: sections([
      ['discipline', 'الالتزام والانضباط', 'الحضور والتعليمات والسلوك المهني.', 30],
      ['quality', 'جودة تنفيذ العمل', 'الدقة وإكمال المسؤوليات.', 30],
      ['teamwork', 'التعاون والمسؤولية', 'التعاون والتواصل والتصعيد.', 20],
      ['initiative', 'المبادرة وحل المشكلات', 'التبليغ المبكر والاقتراح والتنفيذ.', 10],
      COMMON_DEVELOPMENT,
    ]),
  },
};

export function evaluationProfileForRole(role: unknown): StaffEvaluationProfileV3 {
  const canonical = canonicalStaffRole(role);
  const profile = PROFILES[canonical] || PROFILES.other;
  return {
    ...profile,
    sections: profile.sections.map((section) => ({ ...section })),
  };
}

export function evaluationProfileWeightsAreValid() {
  return Object.values(PROFILES).every((profile) => profile.sections.reduce((sum, section) => sum + section.weight, 0) === 100);
}
