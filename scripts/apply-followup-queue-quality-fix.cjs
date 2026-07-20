#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(
  process.cwd(),
  'src/components/customerService/UnifiedCustomerServiceWorkspace.tsx'
);

const source = fs.readFileSync(file, 'utf8');
const checks = [
  ["const [statusFilter, setStatusFilter] = useState('open');", 'القائمة اليومية تبدأ بالمفتوح'],
  ["saved.status !== 'completed'", 'المكتمل مستبعد من المطلوب الآن'],
  ["'معرف المتابعة'", 'التصدير يحتوي معرف المتابعة'],
  ["'حالة جودة البيانات'", 'التصدير يحتوي جودة البيانات'],
];

const missing = checks.filter(([needle]) => !source.includes(needle));
if (missing.length) {
  for (const [, label] of missing) console.error(`✗ ${label}`);
  console.error('الإصلاحات يجب أن تُطبق داخل ملف المصدر مباشرة. هذا السكربت لا يعدّل الملفات.');
  process.exit(1);
}

for (const [, label] of checks) console.log(`✓ ${label}`);
console.log('✓ مصدر متابعة العملاء ثابت ولا يحتاج Text Replace');
