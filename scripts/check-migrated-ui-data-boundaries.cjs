#!/usr/bin/env node
const fs = require('node:fs');

const migratedUiFiles = [
  'src/pages/Invoices.tsx',
  'src/components/customerService/CustomerFollowupOperationsCompletionPanel.tsx',
  'src/components/customerService/ContinueFollowupModal.tsx',
];

const violations = [];
for (const file of migratedUiFiles) {
  if (!fs.existsSync(file)) {
    violations.push(`${file}: الملف غير موجود`);
    continue;
  }
  const source = fs.readFileSync(file, 'utf8');
  if (/from\s+['"]@\/lib\/supabase['"]/.test(source) || /\bsupabase\s*\./.test(source)) {
    violations.push(`${file}: عاد للوصول المباشر إلى Supabase`);
  }
}

if (violations.length) {
  console.error('[migrated-ui-data-boundaries] architecture regression detected');
  violations.forEach((item) => console.error(`- ${item}`));
  console.error('استخدم خدمة المجال أو read model بدل الوصول المباشر من الواجهة.');
  process.exit(1);
}

console.log(`[migrated-ui-data-boundaries] OK (${migratedUiFiles.length} UI files locked)`);
