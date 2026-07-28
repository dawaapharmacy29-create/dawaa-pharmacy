const fs = require('node:fs');
const path = require('node:path');

const pagePath = path.join(process.cwd(), 'src/pages/StaffMonthlyEvaluation.tsx');
let source = fs.readFileSync(pagePath, 'utf8');

const oldSections = `const BASE_SECTIONS: Section[] = [
  { key: 'sales', title: 'الأداء البيعي وتحقيق الهدف', description: 'المبيعات، متوسط الفاتورة، جودة البيع، وربط العملاء', weight: 20, score: 0, notes: '' },
  { key: 'customer_service', title: 'خدمة العملاء والمحادثات', description: 'الأسلوب، سرعة الرد، فهم الطلب، وحل المشكلات', weight: 15, score: 0, notes: '' },
  { key: 'attendance', title: 'الحضور والانضباط', description: 'الالتزام بالمواعيد، الغياب، الأذونات، والزي', weight: 15, score: 0, notes: '' },
  { key: 'accuracy', title: 'الدقة والمسؤولية المهنية', description: 'أخطاء الصرف، مراجعة الروشتات، والتعامل الآمن', weight: 15, score: 0, notes: '' },
  { key: 'operations', title: 'التشغيل والمخزون', description: 'النواقص، الرواكد، الصلاحية، الجرد، وترتيب الفرع', weight: 10, score: 0, notes: '' },
  { key: 'followups', title: 'المتابعات والمبادرة', description: 'طلبات المتابعة، متابعة العملاء، وتنفيذ المهام', weight: 10, score: 0, notes: '' },
  { key: 'teamwork', title: 'التعاون والقيادة', description: 'التعاون مع الفريق، تحمل المسؤولية، ودعم الشيفت', weight: 10, score: 0, notes: '' },
  { key: 'development', title: 'التطوير والتعلم', description: 'التدريب، تقبل الملاحظات، وتحسن الأداء', weight: 5, score: 0, notes: '' },
];`;

const newSections = `const BASE_SECTIONS: Section[] = [
  { key: 'customer_service', title: 'خدمة العملاء', description: 'الترحيب والاحترام، فهم احتياج العميل، وضوح الشرح، سرعة الخدمة، حل المشكلات، جودة المحادثات، والمحافظة على رضا العميل وعودته للفرع', weight: 25, score: 0, notes: '' },
  { key: 'sales_quality', title: 'جودة ودقة المبيعات', description: 'صرف الصنف والتركيز والكمية الصحيحة، مراجعة الروشتة، تجنب الأخطاء، اختيار البديل المناسب، تسجيل النواقص، البيع المسؤول وعدم إضافة أصناف بلا احتياج', weight: 20, score: 0, notes: '' },
  { key: 'team_collaboration', title: 'التعامل مع الدكاترة والدليفري', description: 'الاحترام والتعاون، وضوح تسليم الطلبات، تجهيز أوردرات الدليفري بدقة، سرعة حل الخلافات، مساعدة الزملاء، وتحمل المسؤولية داخل الشيفت', weight: 15, score: 0, notes: '' },
  { key: 'basket_performance', title: 'متوسط الفاتورة وعدد الأصناف', description: 'متوسط قيمة الفاتورة، متوسط عدد الأصناف، جودة البيع الإضافي، اقتراح مكملات مناسبة، وتحقيق نمو حقيقي دون تحميل العميل أصنافًا غير لازمة', weight: 15, score: 0, notes: '' },
  { key: 'attendance_permissions', title: 'الالتزام بالمواعيد والأذونات', description: 'الحضور والانصراف في المواعيد، عدم ترك الشيفت، تنظيم الإجازات، طلب الإذن مسبقًا، وانتظار موافقة مدير الفرع قبل التأخير أو المغادرة', weight: 10, score: 0, notes: '' },
  { key: 'uniform_account', title: 'الالتزام بالزي واستخدام الحساب الشخصي', description: 'بالطو نظيف ومظهر مهني، الالتزام بسياسة الزي، استخدام الحساب الشخصي فقط، عدم مشاركة بيانات الدخول، وتسجيل كل إجراء باسم منفذه الحقيقي', weight: 5, score: 0, notes: '' },
  { key: 'tasks_classifications', title: 'الالتزام بالمهام والتصنيفات', description: 'تنفيذ مهام الشيفت، تصنيف الفواتير والعملاء بصورة صحيحة، تسجيل طلبات العملاء والنواقص، متابعة الرواكد والصلاحية، إكمال المهام في وقتها وتوثيقها بوضوح', weight: 10, score: 0, notes: '' },
];`;

if (source.includes(oldSections)) {
  source = source.replace(oldSections, newSections);
  console.log('[staff-evaluation-v2] replaced legacy evaluation criteria');
} else if (!source.includes("key: 'sales_quality'") || !source.includes("key: 'tasks_classifications'")) {
  throw new Error('[staff-evaluation-v2] criteria anchor not found');
}

const helperAnchor = `function monthStart(value: string) { return \`${'${value}'}-01\`; }`;
const helper = `${helperAnchor}
function normalizeSavedSections(value: unknown): Section[] {
  const rows = Array.isArray(value) ? value as Section[] : [];
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const legacyAliases: Record<string, string[]> = {
    customer_service: ['customer_service'],
    sales_quality: ['accuracy'],
    team_collaboration: ['teamwork'],
    basket_performance: ['sales'],
    attendance_permissions: ['attendance'],
    uniform_account: [],
    tasks_classifications: ['followups', 'operations'],
  };
  return BASE_SECTIONS.map((base) => {
    const direct = byKey.get(base.key);
    const legacy = (legacyAliases[base.key] || []).map((key) => byKey.get(key)).find(Boolean);
    const saved = direct || legacy;
    return { ...base, score: Number(saved?.score || 0), notes: String(saved?.notes || '') };
  });
}`;

if (!source.includes('function normalizeSavedSections')) {
  if (!source.includes(helperAnchor)) throw new Error('[staff-evaluation-v2] helper anchor not found');
  source = source.replace(helperAnchor, helper);
}

source = source.replace(
  `setSections(Array.isArray(row.sections) ? row.sections : BASE_SECTIONS.map((x) => ({ ...x })));`,
  `setSections(normalizeSavedSections(row.sections));`
);

fs.writeFileSync(pagePath, source, 'utf8');

const verified = fs.readFileSync(pagePath, 'utf8');
for (const required of ["key: 'customer_service'", "weight: 25", "key: 'sales_quality'", "key: 'team_collaboration'", "key: 'basket_performance'", "key: 'attendance_permissions'", "key: 'uniform_account'", "key: 'tasks_classifications'", 'normalizeSavedSections(row.sections)']) {
  if (!verified.includes(required)) throw new Error(`[staff-evaluation-v2] verification failed: ${required}`);
}
console.log('Monthly doctor evaluation criteria v2 verified.');
