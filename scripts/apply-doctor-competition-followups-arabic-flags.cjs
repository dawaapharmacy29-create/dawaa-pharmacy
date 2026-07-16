const fs = require('fs');
const path = require('path');

function patch(file, transform) {
  const full = path.join(process.cwd(), file);
  const before = fs.readFileSync(full, 'utf8');
  const after = transform(before);
  if (after !== before) fs.writeFileSync(full, after, 'utf8');
}

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`[doctor workspace patch] Missing target: ${label}`);
  return source.replace(from, to);
}

patch('src/pages/DoctorCompetition.tsx', (source) => {
  const from = `      const doctorRows = doctorScoped\n        ? allRows.filter((row) => rowMatchesCurrentDoctor(user, { ...row, doctor_name: row.name, staff_id: row.staffId }))\n        : allRows;\n      const scopedRows = doctorRows;\n      setScopeWarning(\n        doctorScoped && !doctorRows.length\n          ? 'حسابك غير مربوط ببيانات الفواتير بشكل صحيح. برجاء التواصل مع الإدارة لربط الحساب.'\n          : null\n      );`;
  const to = `      // The competition is a branch leaderboard, not a personal-only report.\n      // Branch/RLS scope is already applied by getDoctorCompetitionMetrics.\n      const scopedRows = allRows;\n      const currentDoctorExists = allRows.some((row) =>\n        rowMatchesCurrentDoctor(user, { ...row, doctor_name: row.name, staff_id: row.staffId })\n      );\n      setScopeWarning(\n        doctorScoped && !currentDoctorExists\n          ? 'يظهر ترتيب دكاترة الفرع، لكن حسابك غير مربوط ببيانات الفواتير بشكل صحيح. برجاء التواصل مع الإدارة لربط الحساب.'\n          : null\n      );`;
  return replaceRequired(source, from, to, 'doctor competition personal-only filter');
});

patch('src/pages/DoctorDashboardStable.tsx', (source) => {
  source = replaceRequired(
    source,
    `import { loadSalesAnalyticsSummary, type SalesAnalyticsSummary } from '@/lib/salesAnalyticsSummaryService';`,
    `import { loadSalesAnalyticsSummary, type SalesAnalyticsSummary } from '@/lib/salesAnalyticsSummaryService';\nimport DoctorRequestedFollowups from '@/components/doctor/DoctorRequestedFollowups';`,
    'followups component import'
  );
  source = replaceRequired(
    source,
    `type Tab = 'overview' | 'branch' | 'performance' | 'reviews' | 'notifications' | 'rules';`,
    `type Tab = 'overview' | 'branch' | 'performance' | 'followups' | 'reviews' | 'notifications' | 'rules';`,
    'followups tab type'
  );
  source = replaceRequired(
    source,
    `{ label: 'متابعاتي المطلوبة', href: '/doctor-dashboard?tab=overview#followups', icon: Headphones },`,
    `{ label: 'متابعاتي المطلوبة', href: '/doctor-dashboard?tab=followups', icon: Headphones },`,
    'followups quick action route'
  );
  source = replaceRequired(
    source,
    `return ['overview', 'branch', 'performance', 'reviews', 'notifications', 'rules'].includes(String(value)) ? (value as Tab) : 'overview';`,
    `return ['overview', 'branch', 'performance', 'followups', 'reviews', 'notifications', 'rules'].includes(String(value)) ? (value as Tab) : 'overview';`,
    'followups search tab parsing'
  );
  source = replaceRequired(
    source,
    `<nav className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-800 bg-slate-950/60 p-2 md:grid-cols-3 xl:grid-cols-6">`,
    `<nav className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-800 bg-slate-950/60 p-2 md:grid-cols-4 xl:grid-cols-7">`,
    'doctor dashboard nav columns'
  );
  source = replaceRequired(
    source,
    `['overview', 'الملخص'], ['branch', 'تقدم الفرع'], ['performance', 'أدائي وترتيبي'],\n          ['reviews', 'تقييماتي'],`,
    `['overview', 'الملخص'], ['branch', 'تقدم الفرع'], ['performance', 'أدائي وترتيبي'],\n          ['followups', 'متابعاتي المطلوبة'], ['reviews', 'تقييماتي'],`,
    'followups nav item'
  );
  source = replaceRequired(
    source,
    `      {tab === 'reviews' && (`,
    `      {tab === 'followups' && <DoctorRequestedFollowups />}\n\n      {tab === 'reviews' && (`,
    'followups panel render'
  );
  return source;
});

patch('src/lib/customerDisplay.tsx', (source) => {
  const marker = `function labelFromValue(value: unknown): string[] {`;
  const helper = `const CUSTOMER_FLAG_LABELS: Record<string, string> = {\n  vip: 'عميل VIP',\n  very_important: 'مهم جدًا',\n  important: 'مهم',\n  medium: 'متوسط',\n  normal: 'عادي',\n  stopped: 'متوقف',\n  at_risk: 'مهدد بالتوقف',\n  price_sensitive: 'حساس للسعر',\n  no_delivery: 'لا يضاف له توصيل',\n  no_substitutes: 'لا يفضل البدائل',\n  delivery_speed_sensitive: 'يهتم بسرعة التوصيل',\n  needs_special_handling: 'يحتاج تعامل خاص',\n  complains_often: 'كثير الشكاوى',\n  prefers_whatsapp: 'يفضل التواصل واتساب',\n  prefers_call: 'يفضل الاتصال الهاتفي',\n  needs_manager: 'يحتاج متابعة مدير',\n  slow_response: 'يتأخر في الرد',\n  repeats_same_items: 'يطلب نفس الأصناف غالبًا',\n  needs_price_explanation: 'يحتاج شرح فرق السعر',\n  needs_usage_explanation: 'يحتاج شرح طريقة الاستخدام',\n  family_buyer: 'يشتري للأسرة',\n  needs_periodic_reminder: 'يحتاج تذكير دوري',\n  dislikes_pressure: 'لا يحب الإلحاح',\n  offers_sensitive: 'يهتم بالعروض',\n  confirm_before_delivery: 'يحتاج تأكيد قبل التوصيل',\n  address_needs_review: 'العنوان يحتاج مراجعة',\n};\n\nfunction normalizeChipLabel(value: string) {\n  const raw = value.trim();\n  if (!raw) return '';\n  const key = raw.toLowerCase().replace(/[\\s-]+/g, '_');\n  return CUSTOMER_FLAG_LABELS[key] || raw.replace(/_/g, ' ');\n}\n\nfunction semanticChipKey(value: string) {\n  return normalizeChipLabel(value)\n    .replace(/[أإآ]/g, 'ا')\n    .replace(/ة/g, 'ه')\n    .replace(/ى/g, 'ي')\n    .replace(/\\s+/g, ' ')\n    .trim()\n    .toLowerCase();\n}\n\n${marker}`;
  if (!source.includes('const CUSTOMER_FLAG_LABELS: Record<string, string>')) {
    if (!source.includes(marker)) throw new Error('[doctor workspace patch] Missing customer chip helper marker');
    source = source.replace(marker, helper);
  }

  const from = `  return [...new Set(labels.map((label) => label.trim()).filter(Boolean))].slice(0, 8);`;
  const to = `  const unique = new Map<string, string>();\n  labels.map(normalizeChipLabel).filter(Boolean).forEach((label) => {\n    const key = semanticChipKey(label);\n    if (!unique.has(key)) unique.set(key, label);\n  });\n  return [...unique.values()].slice(0, 8);`;
  return replaceRequired(source, from, to, 'Arabic customer chips and semantic deduplication');
});

console.log('Applied doctor competition leaderboard, requested followups, and Arabic customer flag fixes.');
